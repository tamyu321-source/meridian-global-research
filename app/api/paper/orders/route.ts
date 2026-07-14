import { fetchFxRate } from "@/lib/fx";
import { deriveHoldingAdvice, type HoldingSignal } from "@/lib/holding-advice";
import { estimateMarketCosts, marketRulesForClient, marketSessionState, qualifiesForMinimumLotException, validateMarketQuantity, validatePositionQuantity } from "@/lib/market-rules";
import { evaluateEntryZone } from "@/lib/paper-entry";
import { fetchSymbolSnapshot } from "@/lib/public-data";
import { paperQuoteIsExecutable, paperQuoteNeedsRefresh } from "@/lib/quote-freshness";
import { recordAudit } from "@/lib/repository";
import { effectivePositionLimit, estimateTradeRisk, loadRiskPolicy, marketLimitFor } from "@/lib/risk-policy";
import { apiUser, runtimeEnv } from "@/lib/server";
import { ARCHIVED_CANDIDATE_MODEL_VERSION, CANDIDATE_MODEL_VERSION, MODEL_VERSION, isSupportedModelVersion, type AssetType, type MarketCode, type RiskPlanId, type TradePlan } from "@/lib/types";

export const dynamic = "force-dynamic";

type DbRow = Record<string, unknown>;

type PaperErrorCode = "SIGN_IN_REQUIRED" | "SERVICE_UNAVAILABLE" | "INVALID_ORDER" | "SETUP_REQUIRED" | "NO_QUOTE" | "MARKET_QUANTITY_RULE" | "STALE_QUOTE" | "PRICE_OUTSIDE_ENTRY_ZONE" | "DRAWDOWN_BREAKER" | "CN_T_PLUS_ONE" | "POSITION_LIMIT" | "MARKET_LIMIT" | "SECTOR_LIMIT" | "MARKET_NOT_ENABLED" | "TRADE_RISK_LIMIT" | "INSUFFICIENT_CASH" | "PORTFOLIO_UNAVAILABLE" | "PAPER_ORDER_FAILED";

const paperErrorFallback:Record<PaperErrorCode,string> = {
  SIGN_IN_REQUIRED:"Sign in required", SERVICE_UNAVAILABLE:"Portfolio service unavailable", INVALID_ORDER:"Invalid paper order", SETUP_REQUIRED:"Complete portfolio setup before paper trading", NO_QUOTE:"No quote available", MARKET_QUANTITY_RULE:"Quantity violates market trading-unit rules", STALE_QUOTE:"Stale quote blocks paper execution", PRICE_OUTSIDE_ENTRY_ZONE:"Latest price is outside the analyzed entry zone", DRAWDOWN_BREAKER:"Portfolio drawdown breaker reached", CN_T_PLUS_ONE:"Sell quantity exceeds currently sellable A-share position", POSITION_LIMIT:"Single-position limit exceeded", MARKET_LIMIT:"Market exposure limit exceeded", SECTOR_LIMIT:"Sector exposure limit exceeded", MARKET_NOT_ENABLED:"This market is not enabled for paper buying", TRADE_RISK_LIMIT:"Loss at the analyzed stop would exceed the risk-per-trade limit", INSUFFICIENT_CASH:"Insufficient paper cash after FX and costs", PORTFOLIO_UNAVAILABLE:"Paper portfolio unavailable", PAPER_ORDER_FAILED:"Paper order failed",
};

function paperError(errorCode:PaperErrorCode, status:number, errorParams:Record<string,string|number> = {}, detail?:unknown) {
  return Response.json({ error:paperErrorFallback[errorCode], errorCode, errorParams, detail:detail instanceof Error ? detail.message : undefined }, { status });
}

function parseJson<T>(value:unknown, fallback:T):T {
  try { return typeof value === "string" ? JSON.parse(value) as T : fallback; }
  catch { return fallback; }
}

const emptyTradePlan:TradePlan = { entryLow:0,entryHigh:0,invalidation:0,stop:0,target1:0,target2:0,trailingAtr:0,rewardRisk:0,maxWeightPct:0,riskBudgetPct:0 };

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
  const result = await db.prepare(`SELECT p.*,s.symbol,s.name,s.market,s.currency,s.asset_type,s.sector,q.price,q.source,q.freshness,q.captured_at,
      out.analysis_captured_at,sig.id signal_id,sig.action signal_action,sig.score signal_score,sig.confidence signal_confidence,
      sig.trade_plan_json,sig.reasons_json,sig.hard_gates_json,sig.analysis_price,sig.model_version signal_model_version,
      sig.asset_model,sig.validation_status,sig.data_quality_json,
      EXISTS(SELECT 1 FROM paper_orders lot_order WHERE lot_order.portfolio_id=p.portfolio_id AND lot_order.instrument_id=p.instrument_id AND lot_order.side='BUY' AND lot_order.status='FILLED' AND lot_order.risk_exception='MINIMUM_TRADABLE_LOT') minimum_lot_exception
    FROM paper_positions p
    JOIN securities s ON s.instrument_id=p.instrument_id
    LEFT JOIN latest_quotes q ON q.instrument_id=p.instrument_id
    LEFT JOIN active_scan_outputs out ON out.id=(SELECT candidate.id FROM active_scan_outputs candidate
      LEFT JOIN scan_runs candidate_scan ON candidate_scan.id=candidate.scan_id
      LEFT JOIN model_market_profiles candidate_profile ON candidate_profile.profile_id=candidate_scan.market_profile_id
      WHERE candidate.market=s.market AND candidate.asset_type=s.asset_type
        AND (candidate.model_version=? OR (candidate.model_version=? AND candidate_profile.status='ACTIVE_SHADOW'))
      ORDER BY CASE WHEN candidate.model_version=? THEN 0 ELSE 1 END LIMIT 1)
    LEFT JOIN signals sig ON sig.scan_id=out.scan_id AND sig.instrument_id=p.instrument_id
    WHERE p.portfolio_id=?`).bind(MODEL_VERSION,CANDIDATE_MODEL_VERSION,CANDIDATE_MODEL_VERSION,portfolioId).all<DbRow>();
  const raw = result.results ?? [];
  const currencies = [...new Set(raw.map((row) => String(row.currency)))];
  const fxEntries = await Promise.all(currencies.map(async (currency) => [currency, await fetchFxRate(currency, baseCurrency)] as const));
  const fx = new Map(fxEntries);
  const todayBuys = await db.prepare(`SELECT instrument_id,SUM(quantity) quantity FROM paper_orders WHERE portfolio_id=? AND side='BUY' AND status='FILLED' AND created_at>=? GROUP BY instrument_id`)
    .bind(portfolioId, chinaTradingDayStartUtc()).all<{ instrument_id:string; quantity:number }>();
  const chinaBuys = new Map((todayBuys.results ?? []).map((row) => [row.instrument_id, Number(row.quantity)]));
  const scoreResult = await db.prepare(`SELECT instrument_id,model_version,score,confidence,score_date FROM (
      SELECT instrument_id,model_version,score,confidence,score_date,ROW_NUMBER() OVER (PARTITION BY instrument_id,model_version ORDER BY score_date DESC) score_rank
      FROM daily_scores WHERE model_version IN (?,?) AND risk_plan='capital_first'
        AND instrument_id IN (SELECT instrument_id FROM paper_positions WHERE portfolio_id=?))
    WHERE score_rank<=2 ORDER BY instrument_id,score_date DESC`).bind(MODEL_VERSION,CANDIDATE_MODEL_VERSION,portfolioId).all<{ instrument_id:string; model_version:string;score:number; confidence:number; score_date:string }>();
  const activeModelByInstrument=new Map(raw.map((row)=>[String(row.instrument_id),String(row.signal_model_version??MODEL_VERSION)]));
  const recentScores = new Map<string,Array<{ score:number; confidence:number; scoreDate:string }>>();
  for (const row of scoreResult.results ?? []) {
    if(row.model_version!==activeModelByInstrument.get(row.instrument_id))continue;
    const values = recentScores.get(row.instrument_id) ?? [];
    values.push({ score:Number(row.score),confidence:Number(row.confidence),scoreDate:String(row.score_date) });
    recentScores.set(row.instrument_id,values);
  }
  const exposuresByMarket:Record<string,number> = {}, exposuresBySector:Record<string,number> = {};
  const positionsWithoutAdvice = raw.map((row) => {
    const rateInfo = fx.get(String(row.currency)) ?? { rate:1, source:"identity", capturedAt:new Date().toISOString() };
    const quantity = Number(row.quantity), price = Number(row.price ?? 0), averageCost = Number(row.average_cost);
    const baseMarketValue = price * quantity * rateInfo.rate;
    const unrealizedPnlBase = (price - averageCost) * quantity * rateInfo.rate;
    const market = String(row.market), sector = String(row.sector ?? "Unclassified");
    exposuresByMarket[market] = (exposuresByMarket[market] ?? 0) + baseMarketValue;
    if (sector !== "Unclassified") exposuresBySector[sector] = (exposuresBySector[sector] ?? 0) + baseMarketValue;
    const sellableQuantity = market === "CN" ? Math.max(0, quantity - Number(chinaBuys.get(String(row.instrument_id)) ?? 0)) : quantity;
    return { ...row, quantity, price, average_cost:averageCost, fx_rate:rateInfo.rate, fx_source:rateInfo.source, base_currency:baseCurrency,
      base_market_value:Number(baseMarketValue.toFixed(2)), unrealized_pnl_base:Number(unrealizedPnlBase.toFixed(2)), sellable_quantity:sellableQuantity } as DbRow & {quantity:number;price:number;average_cost:number;fx_rate:number;fx_source:string;base_currency:string;base_market_value:number;unrealized_pnl_base:number;sellable_quantity:number};
  });
  const marketValue = positionsWithoutAdvice.reduce((sum, row) => sum + row.base_market_value, 0);
  const equity = Number(portfolio.cash) + marketValue;
  const highWatermark = Math.max(Number(portfolio.high_watermark), Number(portfolio.starting_capital));
  const drawdownPct = highWatermark > 0 ? Math.max(0, (1 - equity / highWatermark) * 100) : 0;
  const riskPlan = String(portfolio.risk_plan) as RiskPlanId;
  const riskPolicy=await loadRiskPolicy(db,String(portfolio.user_email),riskPlan);
  const positions = positionsWithoutAdvice.map((row) => {
    const quality = parseJson<{ conflicts?:unknown[]; corporateActionAnomalies?:unknown[] }>(row.data_quality_json,{});
    const signal:HoldingSignal|null = row.signal_id ? {
      action:String(row.signal_action),score:Number(row.signal_score),confidence:Number(row.signal_confidence),
      analysisCapturedAt:String(row.analysis_captured_at ?? row.captured_at ?? ""),analysisPrice:Number(row.analysis_price ?? 0),
      modelVersion:String(row.signal_model_version),assetModel:String(row.asset_model),validationStatus:String(row.validation_status),
      tradePlan:parseJson<TradePlan>(row.trade_plan_json,emptyTradePlan),reasonCodes:parseJson<string[]>(row.reasons_json,[]),
      hardGates:parseJson<string[]>(row.hard_gates_json,[]),conflicts:Array.isArray(quality.conflicts)?quality.conflicts:[],
      corporateActionAnomalies:Array.isArray(quality.corporateActionAnomalies)?quality.corporateActionAnomalies:[],
    } : null;
    const market = String(row.market) as MarketCode, sector = String(row.sector ?? "Unclassified");
    const advice = deriveHoldingAdvice({ market,assetType:String(row.asset_type) as AssetType,sector,quantity:Number(row.quantity),sellableQuantity:Number(row.sellable_quantity),
      price:Number(row.price),averageCost:Number(row.average_cost),fxRate:Number(row.fx_rate),baseMarketValue:Number(row.base_market_value),equity,
      marketExposure:Number(exposuresByMarket[market] ?? 0),sectorExposure:Number(exposuresBySector[sector] ?? 0),riskPlan,riskPolicy,minimumLotException:Boolean(row.minimum_lot_exception),
      quoteFreshness:String(row.freshness ?? "stale"),quoteCapturedAt:String(row.captured_at ?? ""),signal,recentScores:recentScores.get(String(row.instrument_id)) ?? [] });
    return { ...row,advice,recent_scores:recentScores.get(String(row.instrument_id)) ?? [] };
  });
  const adviceCounts = positions.reduce<Record<string,number>>((counts,row) => { counts[row.advice.action]=(counts[row.advice.action]??0)+1; return counts; },{});
  return { positions, equity, marketValue, drawdownPct, exposuresByMarket, exposuresBySector,adviceCounts,newBuysPaused:drawdownPct>=riskPolicy.drawdownBreakerPct,riskPolicy };
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
      unrealizedPnl:Number(state.positions.reduce((sum,row) => sum + Number(row.unrealized_pnl_base), 0).toFixed(2)), drawdownPct:Number(state.drawdownPct.toFixed(2)),
      exposuresByMarket:state.exposuresByMarket,exposuresBySector:state.exposuresBySector,adviceCounts:state.adviceCounts,newBuysPaused:state.newBuysPaused };
    return Response.json({ portfolio, orders:orders.results ?? [], positions:state.positions, summary, riskPolicy:state.riskPolicy, marketRules:marketRulesForClient() });
  } catch (error) { return paperError("PORTFOLIO_UNAVAILABLE", 503, {}, error); }
}

export async function POST(request:Request) {
  const user = await apiUser(request);
  if (!user) return paperError("SIGN_IN_REQUIRED", 401);
  const db = runtimeEnv().DB;
  if (!db) return paperError("SERVICE_UNAVAILABLE", 503);
  const payload = await request.json() as { instrumentId?:string; side?:"BUY"|"SELL"; quantity?:number; modelVersion?:string };
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
    let resolvedSignalId:string|null = null, resolvedTradePlan:TradePlan|null=null, resolvedMarketProfileId:string|null=null, resolvedConfigHash:string|null=null, resolvedModelVersion:string|null=null;
    if (side === "BUY") {
      const requestedModelVersion = String(payload.modelVersion ?? MODEL_VERSION);
      if (!isSupportedModelVersion(requestedModelVersion) || requestedModelVersion === ARCHIVED_CANDIDATE_MODEL_VERSION) return paperError("INVALID_ORDER", 409, { modelVersion:requestedModelVersion });
      const activeSignal = await db.prepare(`SELECT sig.id,sig.action,sig.trade_plan_json,sig.market_profile_id,sig.config_hash FROM active_scan_outputs out
        JOIN signals sig ON sig.scan_id=out.scan_id JOIN securities sec ON sec.instrument_id=sig.instrument_id
        WHERE out.model_version=? AND sig.model_version=out.model_version AND out.market=sec.market AND out.asset_type=sec.asset_type AND sig.instrument_id=? LIMIT 1`)
        .bind(requestedModelVersion,payload.instrumentId).first<{ id:string; action:string; trade_plan_json:string; market_profile_id:string|null; config_hash:string|null }>();
      if (!activeSignal || activeSignal.action !== "BUY") return paperError("INVALID_ORDER", 409, { modelVersion:requestedModelVersion });
      resolvedSignalId = activeSignal.id;
      resolvedModelVersion=requestedModelVersion;
      resolvedTradePlan=parseJson<TradePlan>(activeSignal.trade_plan_json,emptyTradePlan); resolvedMarketProfileId=activeSignal.market_profile_id; resolvedConfigHash=activeSignal.config_hash;
      const zone = evaluateEntryZone(price,resolvedTradePlan);
      if (!zone.configured) return paperError("INVALID_ORDER", 409, { modelVersion:requestedModelVersion });
      if (!zone.inside) return paperError("PRICE_OUTSIDE_ENTRY_ZONE", 409, { entryLow:zone.entryLow, entryHigh:zone.entryHigh, price:zone.price });
    }
    const costs = estimateMarketCosts(market, assetType, side, grossLocal, quantity);
    const fx = await fetchFxRate(String(quote.currency), String(portfolio.base_currency));
    const grossBase = grossLocal * fx.rate, feesBase = costs.total * fx.rate;
    const netCashFlowBase = side === "BUY" ? -(grossBase + feesBase) : grossBase - feesBase;
    const state = await portfolioState(db, portfolio);
    const riskPlan = String(portfolio.risk_plan) as RiskPlanId, limits=state.riskPolicy;
    if (side === "BUY" && !limits.enabledMarkets.includes(market)) return paperError("MARKET_NOT_ENABLED",409,{market});
    if (side === "BUY" && state.drawdownPct >= limits.drawdownBreakerPct) return paperError("DRAWDOWN_BREAKER", 409, { max:limits.drawdownBreakerPct, plan:riskPlan });
    const existing = state.positions.find((row) => String((row as DbRow).instrument_id) === payload.instrumentId);
    if (side === "SELL" && (!existing || quantity > Number(existing.sellable_quantity))) return paperError(market === "CN" ? "CN_T_PLUS_ONE" : "POSITION_LIMIT", 409, { max:limits.maxWeightPct, plan:riskPlan });
    if (existing) {
      const positionQuantityError = validatePositionQuantity(market, side, quantity, Number(existing.quantity));
      if (positionQuantityError) return paperError("MARKET_QUANTITY_RULE", 409, { market, quantity });
    }
    const minimumLotEligible = limits.allowMinimumLotException && qualifiesForMinimumLotException(market,assetType,side,quantity,Number(existing?.quantity??0));
    let minimumLotException = false;
    if (side === "BUY") {
      const profileCap=resolvedModelVersion===CANDIDATE_MODEL_VERSION?Number(resolvedTradePlan?.maxWeightPct||limits.maxWeightPct):limits.maxWeightPct;
      const sizeMultiplier=resolvedModelVersion===CANDIDATE_MODEL_VERSION?Number(resolvedTradePlan?.positionSizeMultiplier??1):1;
      const effectivePositionLimitPct=effectivePositionLimit(limits.maxWeightPct,profileCap,sizeMultiplier);
      const positionAfter = Number(existing?.base_market_value ?? 0) + grossBase;
      const positionLimitExceeded = positionAfter > state.equity * effectivePositionLimitPct / 100;
      const marketAfter = Number(state.exposuresByMarket[market] ?? 0) + grossBase;
      const marketLimitExceeded=marketAfter > state.equity * marketLimitFor(limits,market) / 100;
      const sector = String(quote.sector ?? "Unclassified");
      const sectorLimitExceeded = sector !== "Unclassified" && Number(state.exposuresBySector[sector] ?? 0) + grossBase > state.equity * limits.maxSectorPct / 100;
      minimumLotException = minimumLotEligible && (positionLimitExceeded || sectorLimitExceeded || marketLimitExceeded);
      if (marketLimitExceeded && !minimumLotException) return paperError("MARKET_LIMIT", 409, { max:marketLimitFor(limits,market), plan:riskPlan });
      if (positionLimitExceeded && !minimumLotException) return paperError("POSITION_LIMIT", 409, { max:effectivePositionLimitPct, plan:riskPlan });
      if (sectorLimitExceeded && !minimumLotException) return paperError("SECTOR_LIMIT", 409, { max:limits.maxSectorPct, plan:riskPlan });
      const analyzedStop=Number(resolvedTradePlan?.stop??0),estimatedExitCosts=analyzedStop>0?estimateMarketCosts(market,assetType,"SELL",analyzedStop*quantity,quantity).total*fx.rate:feesBase;
      const risk=estimateTradeRisk(price,analyzedStop,quantity,fx.rate,feesBase+estimatedExitCosts,state.equity,limits.riskBudgetPct);
      if(!resolvedTradePlan?.stop||resolvedTradePlan.stop>=price||risk.riskPct>limits.riskBudgetPct)return paperError("TRADE_RISK_LIMIT",409,{max:limits.riskBudgetPct,riskPct:risk.riskPct,maximumQuantity:risk.maximumQuantity,minimumCapital:risk.minimumCapital});
      if (-netCashFlowBase > Number(portfolio.cash)) return paperError("INSUFFICIENT_CASH", 409);
    }
    const orderId = crypto.randomUUID(), taxes = costs.exchangeFees + costs.stampDuty + costs.sellTax;
    const realizedPnlBase = side === "SELL" && existing ? ((price - Number(existing.average_cost)) * quantity - costs.total) * fx.rate : 0;
    const riskException = minimumLotException ? "MINIMUM_TRADABLE_LOT" : null;
    const statements:D1PreparedStatement[] = [db.prepare(`INSERT INTO paper_orders (id,portfolio_id,user_email,instrument_id,side,quantity,requested_price,filled_price,status,currency,gross_value,commission,taxes,fx_rate,net_cash_flow,realized_pnl_base,market_rule_version,market_session,risk_exception,risk_policy_revision_id,market_profile_id,config_hash,signal_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(orderId,String(portfolio.id),user.email,payload.instrumentId,side,quantity,price,price,"FILLED",String(quote.currency),grossLocal,costs.commission,taxes,fx.rate,netCashFlowBase,realizedPnlBase,costs.ruleVersion,session.state,riskException,limits.revisionId,resolvedMarketProfileId,resolvedConfigHash,resolvedSignalId)];
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
    await recordAudit(user.email,"PAPER_ORDER_FILLED",orderId,{ instrumentId:payload.instrumentId,side,quantity,price,currency:quote.currency,grossLocal,costs,fx,netCashFlowBase,marketRuleVersion:costs.ruleVersion,session,riskException,riskPolicyRevisionId:limits.revisionId,marketProfileId:resolvedMarketProfileId,configHash:resolvedConfigHash,signalId:resolvedSignalId,modelVersion:side === "BUY" ? String(payload.modelVersion ?? MODEL_VERSION) : null });
    return Response.json({ order:{ id:orderId,status:"FILLED",side,quantity,filledPrice:price,currency:quote.currency,grossLocal,costs,fxRate:fx.rate,baseCurrency:portfolio.base_currency,netCashFlowBase,realizedPnlBase,marketSession:session,riskException } },{ status:201 });
  } catch (error) { return paperError("PAPER_ORDER_FAILED", 500, {}, error); }
}
