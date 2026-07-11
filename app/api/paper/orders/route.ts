import { recordAudit } from "@/lib/repository";
import { apiUser, jsonError, runtimeEnv } from "@/lib/server";
import { RISK_PLANS, type RiskPlanId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await apiUser(request);
  if (!user) return jsonError("Sign in required", 401);
  const db = runtimeEnv().DB;
  if (!db) return jsonError("D1 unavailable", 503);
  try {
    const portfolio = await db.prepare("SELECT * FROM paper_portfolios WHERE user_email=? LIMIT 1").bind(user.email).first();
    const orders = await db.prepare(`SELECT o.*,s.symbol,s.name,s.market FROM paper_orders o JOIN securities s ON s.instrument_id=o.instrument_id WHERE o.user_email=? ORDER BY o.created_at DESC LIMIT 100`).bind(user.email).all();
    const positions = portfolio ? await db.prepare(`SELECT p.*,s.symbol,s.name,s.market,q.price FROM paper_positions p JOIN securities s ON s.instrument_id=p.instrument_id LEFT JOIN latest_quotes q ON q.instrument_id=p.instrument_id WHERE p.portfolio_id=?`).bind(String(portfolio.id)).all() : { results: [] };
    return Response.json({ portfolio, orders: orders.results ?? [], positions: positions.results ?? [] });
  } catch (error) { return jsonError("Paper portfolio unavailable", 503, error); }
}

export async function POST(request: Request) {
  const user = await apiUser(request);
  if (!user) return jsonError("Sign in required", 401);
  const db = runtimeEnv().DB;
  if (!db) return jsonError("D1 unavailable", 503);
  const payload = await request.json() as { instrumentId?: string; side?: "BUY" | "SELL"; quantity?: number; signalId?: string };
  const quantity = Number(payload.quantity ?? 0);
  if (!payload.instrumentId || !["BUY", "SELL"].includes(String(payload.side)) || quantity <= 0) return jsonError("instrumentId, BUY/SELL and positive quantity are required", 400);
  try {
    const portfolio = await db.prepare("SELECT * FROM paper_portfolios WHERE user_email=? LIMIT 1").bind(user.email).first<Record<string, unknown>>();
    if (!portfolio) return jsonError("Complete portfolio setup before paper trading", 409, "SETUP_REQUIRED");
    const quote = await db.prepare("SELECT q.*,s.market FROM latest_quotes q JOIN securities s ON s.instrument_id=q.instrument_id WHERE q.instrument_id=?").bind(payload.instrumentId).first<Record<string, unknown>>();
    if (!quote) return jsonError("No quote available", 409);
    const age = Date.now() - Date.parse(String(quote.captured_at));
    if (String(quote.freshness) === "stale" || age > 36 * 60 * 60_000) return jsonError("Stale quote blocks paper execution", 409);
    const price = Number(quote.price);
    const value = price * quantity;
    const side = payload.side!;
    const riskPlan = String(portfolio.risk_plan) as RiskPlanId;
    const limits = RISK_PLANS[riskPlan] ?? RISK_PLANS.capital_first;
    const equity = Number(portfolio.cash) + Number((await db.prepare(`SELECT COALESCE(SUM(p.quantity*q.price),0) value FROM paper_positions p JOIN latest_quotes q ON q.instrument_id=p.instrument_id WHERE p.portfolio_id=?`).bind(String(portfolio.id)).first<{ value: number }>())?.value ?? 0);
    if (side === "BUY" && value > equity * limits.maxWeightPct / 100) return jsonError(`Order exceeds ${limits.maxWeightPct}% single-position limit`, 409);
    if (side === "BUY" && value > Number(portfolio.cash)) return jsonError("Insufficient paper cash", 409);
    const existing = await db.prepare("SELECT * FROM paper_positions WHERE portfolio_id=? AND instrument_id=?").bind(String(portfolio.id), payload.instrumentId).first<Record<string, unknown>>();
    if (side === "SELL" && (!existing || quantity > Number(existing.quantity))) return jsonError("Sell quantity exceeds paper position", 409);
    const orderId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [db.prepare("INSERT INTO paper_orders (id,portfolio_id,user_email,instrument_id,side,quantity,requested_price,filled_price,status,signal_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(orderId, String(portfolio.id), user.email, payload.instrumentId, side, quantity, price, price, "FILLED", payload.signalId ?? null)];
    if (side === "BUY") {
      const oldQty = Number(existing?.quantity ?? 0), oldCost = Number(existing?.average_cost ?? 0);
      const newQty = oldQty + quantity, newCost = (oldQty * oldCost + value) / newQty;
      statements.push(db.prepare(`INSERT INTO paper_positions (portfolio_id,instrument_id,quantity,average_cost,realized_pnl,updated_at) VALUES (?,?,?,?,0,CURRENT_TIMESTAMP)
        ON CONFLICT(portfolio_id,instrument_id) DO UPDATE SET quantity=excluded.quantity,average_cost=excluded.average_cost,updated_at=CURRENT_TIMESTAMP`).bind(String(portfolio.id), payload.instrumentId, newQty, newCost));
      statements.push(db.prepare("UPDATE paper_portfolios SET cash=cash-?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(value, String(portfolio.id)));
    } else {
      const remaining = Number(existing!.quantity) - quantity;
      if (remaining > 0) statements.push(db.prepare("UPDATE paper_positions SET quantity=?,realized_pnl=realized_pnl+?,updated_at=CURRENT_TIMESTAMP WHERE portfolio_id=? AND instrument_id=?").bind(remaining, (price - Number(existing!.average_cost)) * quantity, String(portfolio.id), payload.instrumentId));
      else statements.push(db.prepare("DELETE FROM paper_positions WHERE portfolio_id=? AND instrument_id=?").bind(String(portfolio.id), payload.instrumentId));
      statements.push(db.prepare("UPDATE paper_portfolios SET cash=cash+?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(value, String(portfolio.id)));
    }
    await db.batch(statements);
    await recordAudit(user.email, "PAPER_ORDER_FILLED", orderId, { instrumentId: payload.instrumentId, side, quantity, price });
    return Response.json({ order: { id: orderId, status: "FILLED", side, quantity, filledPrice: price } }, { status: 201 });
  } catch (error) { return jsonError("Paper order failed", 500, error); }
}
