import { MODEL_VERSION, RISK_PLANS, type FactorScores, type MarketSnapshot, type RankedSecurity, type RiskPlanId } from "./types";

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function stdev(values: number[]) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function pctChange(current: number, previous: number) {
  return previous > 0 ? (current / previous - 1) * 100 : 0;
}

function percentile(values: number[], target: number) {
  if (values.length <= 1) return 50;
  const sorted = [...values].sort((a, b) => a - b);
  const below = sorted.filter((value) => value < target).length;
  const equal = sorted.filter((value) => value === target).length;
  return clamp(((below + Math.max(0, equal - 1) / 2) / (sorted.length - 1)) * 100);
}

function winsorize(values: number[], value: number) {
  if (values.length < 4) return value;
  const sorted = [...values].sort((a, b) => a - b);
  const low = sorted[Math.floor((sorted.length - 1) * 0.025)];
  const high = sorted[Math.ceil((sorted.length - 1) * 0.975)];
  return Math.max(low, Math.min(high, value));
}

function atr(snapshot: MarketSnapshot, period = 14) {
  const bars = snapshot.bars.slice(-(period + 1));
  if (bars.length < 2) return snapshot.price * 0.03;
  const ranges = bars.slice(1).map((bar, index) => Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - bars[index].close),
    Math.abs(bar.low - bars[index].close),
  ));
  return mean(ranges) || snapshot.price * 0.03;
}

function rawFactors(snapshot: MarketSnapshot) {
  const closes = snapshot.bars.map((bar) => bar.close).filter((value) => value > 0);
  const volumes = snapshot.bars.map((bar) => bar.volume).filter((value) => value >= 0);
  const current = closes.at(-1) ?? snapshot.price;
  const sma20 = mean(closes.slice(-20));
  const sma50 = mean(closes.slice(-50));
  const sma200 = mean(closes.slice(-200));
  const slope20 = sma20 && closes.length >= 40 ? pctChange(sma20, mean(closes.slice(-40, -20))) : 0;
  const trend = (current / Math.max(sma20, 0.0001) - 1) * 100 + (sma20 / Math.max(sma50, 0.0001) - 1) * 80 + (sma50 / Math.max(sma200, 0.0001) - 1) * 60 + slope20;

  const returns = closes.slice(1).map((value, index) => pctChange(value, closes[index]));
  const volatility = stdev(returns.slice(-126)) * Math.sqrt(252);
  const return1m = closes.length > 26 ? pctChange(current, closes.at(-26)!) : 0;
  const return3m = closes.length > 68 ? pctChange(current, closes.at(-68)!) : return1m;
  const return6m = closes.length > 131 ? pctChange(closes.at(-6)!, closes.at(-131)!) : return3m;
  const momentum = (return1m * 0.3 + return3m * 0.4 + return6m * 0.3) / Math.max(volatility, 5) * 20;

  const high252 = Math.max(...closes.slice(-252));
  const drawdown = high252 > 0 ? (current / high252 - 1) * 100 : 0;
  const downside = stdev(returns.slice(-126).filter((value) => value < 0)) * Math.sqrt(252);
  const risk = -(volatility * 0.65 + Math.abs(drawdown) * 0.25 + downside * 0.1);

  const volume20 = mean(volumes.slice(-20));
  const volume60 = mean(volumes.slice(-60));
  const tradedValue = mean(snapshot.bars.slice(-60).map((bar) => bar.close * bar.volume));
  const liquidity = Math.log10(Math.max(1, tradedValue)) + (volume60 ? volume20 / volume60 : 1);
  const relativeStrength = return3m;
  const regime = current > sma200 && sma50 > sma200 ? 1 : current > sma200 ? 0 : -1;

  return { trend, momentum, relativeStrength, liquidity, risk, regime };
}

function normalizedFactors(snapshot: MarketSnapshot, universe: MarketSnapshot[], raw: ReturnType<typeof rawFactors>): FactorScores {
  const peers = universe.filter((item) => item.market === snapshot.market && item.assetType === snapshot.assetType);
  const peerRaws = peers.map(rawFactors);
  const score = (key: keyof ReturnType<typeof rawFactors>) => {
    const values = peerRaws.map((item) => item[key]);
    return round(percentile(values, winsorize(values, raw[key])), 1);
  };
  return {
    trend: score("trend"), momentum: score("momentum"), relativeStrength: score("relativeStrength"),
    liquidity: score("liquidity"), risk: score("risk"), regime: raw.regime > 0 ? 80 : raw.regime === 0 ? 55 : 25,
  };
}

function tradePlan(snapshot: MarketSnapshot, riskPlan: RiskPlanId) {
  const plan = RISK_PLANS[riskPlan];
  const current = snapshot.price;
  const averageTrueRange = atr(snapshot);
  const recentSupport = Math.min(...snapshot.bars.slice(-20).map((bar) => bar.low).filter((value) => value > 0));
  const atrStop = current - averageTrueRange * 2.2;
  const stop = Math.max(current * 0.88, Math.max(recentSupport || 0, atrStop));
  const risk = Math.max(current - stop, current * 0.015);
  return {
    entryLow: round(current - averageTrueRange * 0.35),
    entryHigh: round(current + averageTrueRange * 0.2),
    invalidation: round(Math.min(stop, recentSupport || stop)),
    stop: round(stop), target1: round(current + risk * 1.5), target2: round(current + risk * 2.5),
    trailingAtr: 2, rewardRisk: 2.5, maxWeightPct: plan.maxWeightPct, riskBudgetPct: plan.riskBudgetPct,
  };
}

export function rankSnapshots(snapshots: MarketSnapshot[], riskPlan: RiskPlanId = "capital_first", formalEnabled = false): RankedSecurity[] {
  return snapshots.map((snapshot) => {
    const raw = rawFactors(snapshot);
    const factors = normalizedFactors(snapshot, snapshots, raw);
    const score = round(factors.trend * 0.25 + factors.momentum * 0.25 + factors.relativeStrength * 0.15 + factors.liquidity * 0.1 + factors.risk * 0.15 + factors.regime * 0.1, 1);
    const hardGates: string[] = [];
    if (snapshot.bars.length < 252) hardGates.push("INSUFFICIENT_HISTORY");
    if (snapshot.freshness === "stale") hardGates.push("STALE_DATA");
    if (snapshot.sourceWarnings?.length) hardGates.push("SOURCE_WARNING");
    if (snapshot.price <= 0) hardGates.push("INVALID_PRICE");
    const confidence = clamp(100 - hardGates.length * 18 - (snapshot.freshness === "fallback" ? 12 : snapshot.freshness === "delayed" ? 6 : 0));
    const plan = tradePlan(snapshot, riskPlan);
    const eligibleBuy = score >= 80 && confidence >= 75 && factors.regime >= 55 && plan.rewardRisk >= 2 && hardGates.length === 0;
    const action = eligibleBuy ? "BUY" : score >= 65 ? "WATCH" : score < 50 ? "EXIT" : score < 55 ? "REDUCE" : "HOLD";
    const reasonCodes = [
      factors.trend >= 65 ? "TREND_CONFIRMED" : "TREND_UNCONFIRMED",
      factors.momentum >= 65 ? "MOMENTUM_LEADERSHIP" : "MOMENTUM_MIXED",
      factors.risk >= 55 ? "RISK_CONTROLLED" : "VOLATILITY_ELEVATED",
      factors.liquidity >= 50 ? "LIQUIDITY_ACCEPTABLE" : "LIQUIDITY_THIN",
      formalEnabled ? "FORMAL_GATE_ACTIVE" : "IBKR_NOT_CONNECTED",
    ];
    return {
      instrumentId: snapshot.instrumentId, symbol: snapshot.symbol, name: snapshot.name, market: snapshot.market,
      exchange: snapshot.exchange, currency: snapshot.currency, assetType: snapshot.assetType, sector: snapshot.sector ?? "Unclassified",
      price: round(snapshot.price, 4), changePct: round(pctChange(snapshot.price, snapshot.previousClose), 2), score,
      confidence, action, status: formalEnabled ? "FORMAL" : "SHADOW", freshness: snapshot.freshness, source: snapshot.source,
      capturedAt: snapshot.capturedAt, factors, tradePlan: plan, reasonCodes, hardGates, modelVersion: MODEL_VERSION,
    } as RankedSecurity;
  }).sort((a, b) => b.score - a.score);
}

export const algorithmInternals = { mean, stdev, pctChange, percentile, winsorize, atr, rawFactors };
