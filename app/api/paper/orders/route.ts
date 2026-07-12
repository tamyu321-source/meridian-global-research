import { fetchFxRate } from "@/lib/fx";
import { estimateMarketCosts, marketRulesForClient, marketSessionState, validateMarketQuantity, validatePositionQuantity } from "@/lib/market-rules";
import { recordAudit } from "@/lib/repository";
import { apiUser, jsonError, runtimeEnv } from "@/lib/server";
import { RISK_PLANS, type AssetType, type MarketCode, type RiskPlanId } from "@/lib/types";

export const dynamic = "force-dynamic";

type DbRow = Record<string, unknown>;

function chinaTradingDayStartUtc(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(now);
  const get = (type:string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")) - 8 * 60 * 60_000).toISOString().slice(0, 19).replace("T", " ");
}

async function portfolioState(db:D1Database, portfolio:DbRow) {
  const portfolioId = String(portfolio.id), baseCurrency = String(portfolio.base_currency);
  const result = await db.prepare(`SELECT p.*,s.symbol,s.name,s.market,s.currency,s.asset_type,s.sector,q.price,q.captured_at
    FROM paper_positions p JOIN securities s ON s.instrument_id=p.instrument_id LEFT JOIN latest_quotes q ON q.instrument_id=p.instrument_id WHERE p.portfolio_id=?`).bind(portfolioId).all<DbRow>();
  const raw = result.results ?? [];
  const currencies = [...new Set(raw.map((row) => String(row.currency)))];
  const fxEntries = await Promise.all(currencies.map(async (currency) => [currency, await fetchFxRate(currency, baseCurrency)] as const));
  const fx = new Map(fxEntries);
  const todayBuys = await db.prepare(`SELECT instrument_id,SUM(quantity) quantity FROM paper_orders WHERE portfolio_id=? AND side='BUY' AND status='FILLED' AND created_at>=? GROUP BY instrument_id`)
    .bind(portfolioId, chinaTradingDayStartUtc()).all<{ instrument_id:string; quantity:number }>();
  const chinaBuys = new Map((todayBuys.results ?? []).map((row) => [row.instrument_id, Number(row.quantity)]));
  const exposuresByMarket:Record<string,number> = {}, exposuresBySector:Record<string,number> = {};
  const positions = raw.map((row) => {
    const rateInfo = fx.get(String(row.currency)) ?? { rate:1, source:"identity", capturedAt:new Date().toISOString() };
    const quantity = Number(row.quantity), price = Number(row.price ?? 0), averageCost = Number(row.average_cost);
    const baseMarketValue = price * quantity * rateInfo.rate;
    const unrealizedPnlBase = (price - averageCost) * quantity * rateInfo.rate;
    const market = String(row.market), sector = String(row.sector ?? "Unclassified");
    exposuresByMarket[market] = (exposuresByMarket[market] ?? 0) + baseMarketValue;
    if (sector !== "Unclassified") exposuresBySector[sector] = (exposuresBySector[sector] ?? 0) + baseMarketValue;
    const sellableQuantity = market === "CN" ? Math.max(0, quantity - Number(chinaBuys.get(String(row.instrument_id)) ?? 0)) : quantity;
    return { ...row, quantity, price, average_cost:averageCost, fx_rate:rateInfo.rate, fx_source:rateInfo.source, base_currency:baseCurrency,
      base_market_value:Number(baseMarketValue.toFixed(2)), unrealized_pnl_base:Number(unrealizedPnlBase.toFixed(2)), sellable_quantity:sellableQuantity };
  });
  const marketValue = positions.reduce((sum, row) => sum + row.base_market_value, 0);
  const equity = Number(portfolio.cash) + marketValue;
  const highWatermark = Math.max(Number(portfolio.high_watermark), Number(portfolio.starting_capital));
  const drawdownPct = highWatermark > 0 ? Math.max(0, (1 - equity / highWatermark) * 100) : 0;
  return { positions, equity, marketValue, drawdownPct, exposuresByMarket, exposuresBySector };
}

export async function GET(request:Request) {
  const user = await apiUser(request);
  if (!user) return jsonError("Sign in required", 401);
  const db = runtimeEnv().DB;
  if (!db) return jsonError("D1 unavailable", 503);
  try {
    const portfolio = await db.prepare("SELECT * FROM paper_portfolios WHERE user_email=? LIMIT 1").bind(user.email).first<DbRow>();
    const orders = await db.prepare(`SELECT o.*,s.symbol,s.name,s.market,s.currency instrument_currency FROM paper_orders o JOIN securities s ON s.instrument_id=o.instrument_id WHERE o.user_email=? ORDER BY o.created_at DESC LIMIT 100`).bind(user.email).all();
    if (!portfolio) return Response.json({ portfolio:null, orders:orders.results ?? [], positions:[], summary:null, marketRules:marketRulesForClient() });
    const state = await portfolioState(db, portfolio);
    const summary = { baseCurrency:String(portfolio.base_currency), cash:Number(portfolio.cash), marketValue:Number(state.marketValue.toFixed(2)), equity:Number(state.equity.toFixed(2)),
      unrealizedPnl:Number(state.positions.reduce((sum,row) => sum + row.unrealized_pnl_base, 0).toFixed(2)), drawdownPct:Number(state.drawdownPct.toFixed(2)), exposuresByMarket:state.exposuresByMarket };
    return Response.json({ portfolio, orders:orders.results ?? [], positions:state.positions, summary, marketRules:marketRulesForClient() });
  } catch (error) { return jsonError("Paper portfolio unavailable", 503, error); }
}

export async function POST(request:Request) {
  const user = await apiUser(request);
  if (!user) return jsonError("Sign in required", 401);
  const db = runtimeEnv().DB;
  if (!db) return jsonError("D1 unavailable", 503);
  const payload = await request.json() as { instrumentId?:string; side?:"BUY"|"SELL"; quantity?:number; signalId?:string };
  const quantity = Number(payload.quantity ?? 0), side = payload.side;
  if (!payload.instrumentId || !side || !["BUY","SELL"].includes(side)) return jsonError("instrumentId, BUY/SELL and quantity are required", 400);
  try {
    const portfolio = await db.prepare("SELECT * FROM paper_portfolios WHERE user_email=? LIMIT 1").bind(user.email).first<DbRow>();
    if (!portfolio) return jsonError("Complete portfolio setup before paper trading", 409, "SETUP_REQUIRED");
    const quote = await db.prepare(`SELECT q.*,s.market,s.currency,s.asset_type,s.sector FROM latest_quotes q JOIN securities s ON s.instrument_id=q.instrument_id WHERE q.instrument_id=?`).bind(payload.instrumentId).first<DbRow>();
    if (!quote) return jsonError("No quote available", 409);
    const market = String(quote.market) as MarketCode, assetType = String(quote.asset_type) as AssetType;
    const quantityError = validateMarketQuantity(market, assetType, side, quantity);
    if (quantityError) return jsonError(quantityError, 409, "MARKET_QUANTITY_RULE");
    const age = Date.now() - Date.parse(String(quote.captured_at));
    if (String(quote.freshness) === "stale" || age > 36 * 60 * 60_000) return jsonError("Stale quote blocks paper execution", 409);
    const session = marketSessionState(market);
    const price = Number(quote.price), grossLocal = price * quantity;
    const costs = estimateMarketCosts(market, assetType, side, grossLocal, quantity);
    const fx = await fetchFxRate(String(quote.currency), String(portfolio.base_currency));
    const grossBase = grossLocal * fx.rate, feesBase = costs.total * fx.rate;
    const netCashFlowBase = side === "BUY" ? -(grossBase + feesBase) : grossBase - feesBase;
    const state = await portfolioState(db, portfolio);
    const riskPlan = String(portfolio.risk_plan) as RiskPlanId, limits = RISK_PLANS[riskPlan] ?? RISK_PLANS.capital_first;
    if (side === "BUY" && state.drawdownPct >= limits.drawdownBreakerPct) return jsonError(`Portfolio drawdown reached ${limits.drawdownBreakerPct}% breaker`, 409, "DRAWDOWN_BREAKER");
    const existing = state.positions.find((row) => String((row as DbRow).instrument_id) === payload.instrumentId);
    if (side === "SELL" && (!existing || quantity > Number(existing.sellable_quantity))) return jsonError("Sell quantity exceeds currently sellable position", 409, market === "CN" ? "CN_T_PLUS_ONE" : "POSITION_LIMIT");
    if (existing) {
      const positionQuantityError = validatePositionQuantity(market, side, quantity, Number(existing.quantity));
      if (positionQuantityError) return jsonError(positionQuantityError, 409, "MARKET_QUANTITY_RULE");
    }
    if (side === "BUY") {
      const positionAfter = Number(existing?.base_market_value ?? 0) + grossBase;
      if (positionAfter > state.equity * limits.maxWeightPct / 100) return jsonError(`Position would exceed ${limits.maxWeightPct}% single-position limit`, 409, "POSITION_LIMIT");
      const marketAfter = Number(state.exposuresByMarket[market] ?? 0) + grossBase;
      if (marketAfter > state.equity * limits.maxMarketPct / 100) return jsonError(`Market exposure would exceed ${limits.maxMarketPct}% limit`, 409, "MARKET_LIMIT");
      const sector = String(quote.sector ?? "Unclassified");
      if (sector !== "Unclassified" && Number(state.exposuresBySector[sector] ?? 0) + grossBase > state.equity * limits.maxSectorPct / 100) return jsonError(`Sector exposure would exceed ${limits.maxSectorPct}% limit`, 409, "SECTOR_LIMIT");
      if (-netCashFlowBase > Number(portfolio.cash)) return jsonError("Insufficient paper cash after FX and costs", 409, "INSUFFICIENT_CASH");
    }
    const orderId = crypto.randomUUID(), taxes = costs.exchangeFees + costs.stampDuty + costs.sellTax;
    const realizedPnlBase = side === "SELL" && existing ? ((price - Number(existing.average_cost)) * quantity - costs.total) * fx.rate : 0;
    const statements:D1PreparedStatement[] = [db.prepare(`INSERT INTO paper_orders (id,portfolio_id,user_email,instrument_id,side,quantity,requested_price,filled_price,status,currency,gross_value,commission,taxes,fx_rate,net_cash_flow,realized_pnl_base,market_rule_version,market_session,signal_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(orderId,String(portfolio.id),user.email,payload.instrumentId,side,quantity,price,price,"FILLED",String(quote.currency),grossLocal,costs.commission,taxes,fx.rate,netCashFlowBase,realizedPnlBase,costs.ruleVersion,session.state,payload.signalId ?? null)];
    const position = await db.prepare("SELECT * FROM paper_positions WHERE portfolio_id=? AND instrument_id=?").bind(String(portfolio.id),payload.instrumentId).first<DbRow>();
    if (side === "BUY") {
      const oldQty = Number(position?.quantity ?? 0), oldCost = Number(position?.average_cost ?? 0), newQty = oldQty + quantity;
      const newCost = (oldQty * oldCost + grossLocal + costs.total) / newQty;
      statements.push(db.prepare(`INSERT INTO paper_positions (portfolio_id,instrument_id,quantity,average_cost,realized_pnl,updated_at) VALUES (?,?,?,?,0,CURRENT_TIMESTAMP)
        ON CONFLICT(portfolio_id,instrument_id) DO UPDATE SET quantity=excluded.quantity,average_cost=excluded.average_cost,updated_at=CURRENT_TIMESTAMP`).bind(String(portfolio.id),payload.instrumentId,newQty,newCost));
    } else {
      const remaining = Number(position!.quantity) - quantity, realizedLocal = (price - Number(position!.average_cost)) * quantity - costs.total;
      if (remaining > 0) statements.push(db.prepare("UPDATE paper_positions SET quantity=?,realized_pnl=realized_pnl+?,updated_at=CURRENT_TIMESTAMP WHERE portfolio_id=? AND instrument_id=?").bind(remaining,realizedLocal,String(portfolio.id),payload.instrumentId));
      else statements.push(db.prepare("DELETE FROM paper_positions WHERE portfolio_id=? AND instrument_id=?").bind(String(portfolio.id),payload.instrumentId));
    }
    statements.push(db.prepare("UPDATE paper_portfolios SET cash=cash+?,high_watermark=MAX(high_watermark,?),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(netCashFlowBase,state.equity,String(portfolio.id)));
    await db.batch(statements);
    await recordAudit(user.email,"PAPER_ORDER_FILLED",orderId,{ instrumentId:payload.instrumentId,side,quantity,price,currency:quote.currency,grossLocal,costs,fx,netCashFlowBase,marketRuleVersion:costs.ruleVersion,session });
    return Response.json({ order:{ id:orderId,status:"FILLED",side,quantity,filledPrice:price,currency:quote.currency,grossLocal,costs,fxRate:fx.rate,baseCurrency:portfolio.base_currency,netCashFlowBase,realizedPnlBase,marketSession:session } },{ status:201 });
  } catch (error) { return jsonError("Paper order failed", 500, error); }
}
