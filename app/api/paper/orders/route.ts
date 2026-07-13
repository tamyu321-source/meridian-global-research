import { fetchFxRate } from "@/lib/fx";
import { estimateMarketCosts, marketRulesForClient, marketSessionState, qualifiesForMinimumLotException, validateMarketQuantity, validatePositionQuantity } from "@/lib/market-rules";
import { fetchSymbolSnapshot } from "@/lib/public-data";
import { paperQuoteIsExecutable, paperQuoteNeedsRefresh } from "@/lib/quote-freshness";
import { recordAudit } from "@/lib/repository";
import { apiUser, runtimeEnv } from "@/lib/server";
import { RISK_PLANS, type AssetType, type MarketCode, type RiskPlanId } from "@/lib/types";

export const dynamic = "force-dynamic";

type DbRow = Record<string, unknown>;

type PaperErrorCode = "SIGN_IN_REQUIRED" | "SERVICE_UNAVAILABLE" | "INVALID_ORDER" | "SETUP_REQUIRED" | "NO_QUOTE" | "MARKET_QUANTITY_RULE" | "STALE_QUOTE" | "DRAWDOWN_BREAKER" | "CN_T_PLUS_ONE" | "POSITION_LIMIT" | "MARKET_LIMIT" | "SECTOR_LIMIT" | "INSUFFICIENT_CASH" | "PORTFOLIO_UNAVAILABLE" | "PAPER_ORDER_FAILED";

const paperErrorFallback:Record<PaperErrorCode,string> = {
  SIGN_IN_REQUIRED:"Sign in required", SERVICE_UNAVAILABLE:"Portfolio service unavailable", INVALID_ORDER:"Invalid paper order", SETUP_REQUIRED:"Complete portfolio setup before paper trading", NO_QUOTE:"No quote available", MARKET_QUANTITY_RULE:"Quantity violates market trading-unit rules", STALE_QUOTE:"Stale quote blocks paper execution", DRAWDOWN_BREAKER:"Portfolio drawdown breaker reached", CN_T_PLUS_ONE:"Sell quantity exceeds currently sellable A-share position", POSITION_LIMIT:"Single-position limit exceeded", MARKET_LIMIT:"Market exposure limit exceeded", SECTOR_LIMIT:"Sector exposure limit exceeded", INSUFFICIENT_CASH:"Insufficient paper cash after FX and costs", PORTFOLIO_UNAVAILABLE:"Paper portfolio unavailable", PAPER_ORDER_FAILED:"Paper order failed",
};

function paperError(errorCode:PaperErrorCode, status:number, errorParams:Record<string,string|number> = {}, detail?:unknown) {
  return Response.json({ error:paperErrorFallback[errorCode], errorCode, errorParams, detail:detail instanceof Error ? detail.message : undefined }, { status });
}

function chinaTradingDayStartUtc(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Shanghai", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(now);
  const get = (type:string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")) - 8 * 60 * 60_000).toISOString().slice(0, 19).replace("T", " ");
}

async function refreshPaperQuote(db:D1Database, quote:DbRow) {
  const capturedAt = String(quote.captured_at ?? "");
  if (!paperQuoteNeedsRefresh(capturedAt, String(quote.freshness))) return quote;
  const market = String(quote.market) as MarketCode;
  const assetType = String(quote.asset_type) as AssetType;
  const snapshot = await fetchSymbolSnapshot(String(quote.symbol), market, String(quote.name ?? quote.symbol), assetType);
  if (!snapshot.price || snapshot.price <= 0 || snapshot.freshness === "stale") throw new Error("Fresh executable quote unavailable");
  await db.prepare(`UPDATE latest_quotes SET price=?,previous_close=?,source=?,freshness=?,captured_at=?,updated_at=CURRENT_TIMESTAMP WHERE instrument_id=?`)
    .bind(snapshot.price, snapshot.previousClose, snapshot.source, snapshot.freshness, snapshot.capturedAt, snapshot.instrumentId).run();
  return { ...quote, price:snapshot.price, previous_close:snapshot.previousClose, source:snapshot.source, freshness:snapshot.freshness, captured_at:snapshot.capturedAt };
}

async function portfolioState(db:D1Database, portfolio:DbRow) {
  const portfolioId = String(portfolio.id), baseCurrency = String(portfolio.base_currency);
  const result = await db.prepare(`SELECT p.*,s.symbol,s.name,s.market,s.currency,s.asset_type,s.sector,q.price,q.source,q.freshness,q.captured_at
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
  if (!user) return paperError("SIGN_IN_REQUIRED", 401);
  const db = runtimeEnv().DB;
  if (!db) return paperError("SERVICE_UNAVAILABLE", 503);
  try {
    const portfolio = await db.prepare("SELECT * FROM paper_portfolios WHERE user_email=? LIMIT 1").bind(user.email).first<DbRow>();
    const orders = await db.prepare(`SELECT o.*,s.symbol,s.name,s.market,s.currency instrument_currency FROM paper_orders o JOIN securities s ON s.instrument_id=o.instrument_id WHERE o.user_email=? ORDER BY o.created_at DESC LIMIT 100`).bind(user.email).all();
    if (!portfolio) return Response.json({ portfolio:null, orders:orders.results ?? [], positions:[], summary:null, marketRules:marketRulesForClient() });
    const state = await portfolioState(db, portfolio);
    const summary = { baseCurrency:String(portfolio.base_currency), cash:Number(portfolio.cash), marketValue:Number(state.marketValue.toFixed(2)), equity:Number(state.equity.toFixed(2)),
      unrealizedPnl:Number(state.positions.reduce((sum,row) => sum + row.unrealized_pnl_base, 0).toFixed(2)), drawdownPct:Number(state.drawdownPct.toFixed(2)), exposuresByMarket:state.exposuresByMarket };
    return Response.json({ portfolio, orders:orders.results ?? [], positions:state.positions, summary, marketRules:marketRulesForClient() });
  } catch (error) { return paperError("PORTFOLIO_UNAVAILABLE", 503, {}, error); }
}

export async function POST(request:Request) {
  const user = await apiUser(request);
  if (!user) return paperError("SIGN_IN_REQUIRED", 401);
  const db = runtimeEnv().DB;
  if (!db) return paperError("SERVICE_UNAVAILABLE", 503);
  const payload = await request.json() as { instrumentId?:string; side?:"BUY"|"SELL"; quantity?:number; signalId?:string };
  const quantity = Number(payload.quantity ?? 0), side = payload.side;
  if (!payload.instrumentId || !side || !["BUY","SELL"].includes(side)) return paperError("INVALID_ORDER", 400);
  try {
    const portfolio = await db.prepare("SELECT * FROM paper_portfolios WHERE user_email=? LIMIT 1").bind(user.email).first<DbRow>();
    if (!portfolio) return paperError("SETUP_REQUIRED", 409);
    let quote = await db.prepare(`SELECT q.*,s.symbol,s.name,s.market,s.currency,s.asset_type,s.sector FROM latest_quotes q JOIN securities s ON s.instrument_id=q.instrument_id WHERE q.instrument_id=?`).bind(payload.instrumentId).first<DbRow>();
    if (!quote) return paperError("NO_QUOTE", 409);
    try { quote = await refreshPaperQuote(db, quote); }
    catch (error) { return paperError("STALE_QUOTE", 409, {}, error); }
    const market = String(quote.market) as MarketCode, assetType = String(quote.asset_type) as AssetType;
    const quantityError = validateMarketQuantity(market, assetType, side, quantity);
    if (quantityError) return paperError("MARKET_QUANTITY_RULE", 409, { market, quantity });
    if (!paperQuoteIsExecutable(String(quote.captured_at), String(quote.freshness))) return paperError("STALE_QUOTE", 409);
    const session = marketSessionState(market);
    const price = Number(quote.price), grossLocal = price * quantity;
    const costs = estimateMarketCosts(market, assetType, side, grossLocal, quantity);
    const fx = await fetchFxRate(String(quote.currency), String(portfolio.base_currency));
    const grossBase = grossLocal * fx.rate, feesBase = costs.total * fx.rate;
    const netCashFlowBase = side === "BUY" ? -(grossBase + feesBase) : grossBase - feesBase;
    const state = await portfolioState(db, portfolio);
    const riskPlan = String(portfolio.risk_plan) as RiskPlanId, limits = RISK_PLANS[riskPlan] ?? RISK_PLANS.capital_first;
    if (side === "BUY" && state.drawdownPct >= limits.drawdownBreakerPct) return paperError("DRAWDOWN_BREAKER", 409, { max:limits.drawdownBreakerPct, plan:riskPlan });
    const existing = state.positions.find((row) => String((row as DbRow).instrument_id) === payload.instrumentId);
    if (side === "SELL" && (!existing || quantity > Number(existing.sellable_quantity))) return paperError(market === "CN" ? "CN_T_PLUS_ONE" : "POSITION_LIMIT", 409, { max:limits.maxWeightPct, plan:riskPlan });
    if (existing) {
      const positionQuantityError = validatePositionQuantity(market, side, quantity, Number(existing.quantity));
      if (positionQuantityError) return paperError("MARKET_QUANTITY_RULE", 409, { market, quantity });
    }
    const minimumLotEligible = qualifiesForMinimumLotException(market,assetType,side,quantity,Number(existing?.quantity??0));
    let minimumLotException = false;
    if (side === "BUY") {
      const positionAfter = Number(existing?.base_market_value ?? 0) + grossBase;
      const positionLimitExceeded = positionAfter > state.equity * limits.maxWeightPct / 100;
      const marketAfter = Number(state.exposuresByMarket[market] ?? 0) + grossBase;
      if (marketAfter > state.equity * limits.maxMarketPct / 100) return paperError("MARKET_LIMIT", 409, { max:limits.maxMarketPct, plan:riskPlan });
      const sector = String(quote.sector ?? "Unclassified");
      const sectorLimitExceeded = sector !== "Unclassified" && Number(state.exposuresBySector[sector] ?? 0) + grossBase > state.equity * limits.maxSectorPct / 100;
      minimumLotException = minimumLotEligible && (positionLimitExceeded || sectorLimitExceeded);
      if (positionLimitExceeded && !minimumLotException) return paperError("POSITION_LIMIT", 409, { max:limits.maxWeightPct, plan:riskPlan });
      if (sectorLimitExceeded && !minimumLotException) return paperError("SECTOR_LIMIT", 409, { max:limits.maxSectorPct, plan:riskPlan });
      if (-netCashFlowBase > Number(portfolio.cash)) return paperError("INSUFFICIENT_CASH", 409);
    }
    const orderId = crypto.randomUUID(), taxes = costs.exchangeFees + costs.stampDuty + costs.sellTax;
    const realizedPnlBase = side === "SELL" && existing ? ((price - Number(existing.average_cost)) * quantity - costs.total) * fx.rate : 0;
    const riskException = minimumLotException ? "MINIMUM_TRADABLE_LOT" : null;
    const statements:D1PreparedStatement[] = [db.prepare(`INSERT INTO paper_orders (id,portfolio_id,user_email,instrument_id,side,quantity,requested_price,filled_price,status,currency,gross_value,commission,taxes,fx_rate,net_cash_flow,realized_pnl_base,market_rule_version,market_session,risk_exception,signal_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(orderId,String(portfolio.id),user.email,payload.instrumentId,side,quantity,price,price,"FILLED",String(quote.currency),grossLocal,costs.commission,taxes,fx.rate,netCashFlowBase,realizedPnlBase,costs.ruleVersion,session.state,riskException,payload.signalId ?? null)];
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
    await recordAudit(user.email,"PAPER_ORDER_FILLED",orderId,{ instrumentId:payload.instrumentId,side,quantity,price,currency:quote.currency,grossLocal,costs,fx,netCashFlowBase,marketRuleVersion:costs.ruleVersion,session,riskException });
    return Response.json({ order:{ id:orderId,status:"FILLED",side,quantity,filledPrice:price,currency:quote.currency,grossLocal,costs,fxRate:fx.rate,baseCurrency:portfolio.base_currency,netCashFlowBase,realizedPnlBase,marketSession:session,riskException } },{ status:201 });
  } catch (error) { return paperError("PAPER_ORDER_FAILED", 500, {}, error); }
}
