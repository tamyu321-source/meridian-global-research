import { MARKET_RULES } from "./market-rules";
import { paperQuoteIsExecutable } from "./quote-freshness";
import { defaultRiskPolicy, marketLimitFor, type RiskPolicy } from "./risk-policy";
import { type AssetType, type MarketCode, type RiskPlanId, type TradePlan } from "./types";

export const HOLDING_ANALYSIS_MAX_AGE_MS = 4 * 24 * 60 * 60_000;

export type HoldingAdviceAction = "HOLD" | "REDUCE" | "EXIT" | "REVIEW";

export type HoldingSignal = {
  action: string;
  score: number;
  confidence: number;
  analysisCapturedAt: string;
  analysisPrice: number;
  modelVersion: string;
  assetModel: string;
  validationStatus: string;
  tradePlan: TradePlan;
  reasonCodes: string[];
  hardGates: string[];
  conflicts: unknown[];
  corporateActionAnomalies: unknown[];
};

export type HoldingAdviceInput = {
  market: MarketCode;
  assetType: AssetType;
  sector: string;
  quantity: number;
  sellableQuantity: number;
  price: number;
  averageCost: number;
  fxRate: number;
  baseMarketValue: number;
  equity: number;
  marketExposure: number;
  sectorExposure: number;
  riskPlan: RiskPlanId;
  riskPolicy?: RiskPolicy;
  minimumLotException?: boolean;
  quoteFreshness: string;
  quoteCapturedAt: string;
  signal: HoldingSignal | null;
  recentScores: Array<{ score:number; confidence:number; scoreDate:string }>;
  now?: number;
};

export type HoldingAdvice = {
  action: HoldingAdviceAction;
  urgency: "NORMAL" | "HIGH" | "CRITICAL" | "REVIEW";
  reasonCodes: string[];
  recommendedSellQuantity: number;
  currentWeightPct: number;
  marketWeightPct: number;
  sectorWeightPct: number;
  returnPct: number;
  score: number | null;
  confidence: number | null;
  signalAction: string | null;
  analysisCapturedAt: string | null;
  analysisPrice: number | null;
  modelVersion: string | null;
  assetModel: string | null;
  validationStatus: string | null;
  tradePlan: TradePlan | null;
  quoteCurrent: boolean;
  analysisCurrent: boolean;
};

function pct(value: number, total: number) {
  return total > 0 ? value / total * 100 : 0;
}

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeSellQuantity(input: HoldingAdviceInput, desired: number, exitAll: boolean) {
  const held = Math.max(0, Math.floor(input.quantity));
  const sellable = Math.min(held, Math.max(0, Math.floor(input.sellableQuantity)));
  if (!sellable) return 0;
  if (exitAll && sellable === held) return sellable;
  const rule = MARKET_RULES[input.market];
  const lot = input.assetType === "ETF" ? rule.etfLot : rule.stockLot;
  if (input.market === "CN" && lot) {
    const oddRemainder = held % lot;
    if (exitAll && oddRemainder > 0 && sellable === oddRemainder) return oddRemainder;
    const rounded = Math.ceil(Math.max(1, desired) / lot) * lot;
    if (rounded <= sellable) return rounded;
    if (sellable === oddRemainder || sellable === held) return sellable;
    return Math.floor(sellable / lot) * lot;
  }
  if (input.market === "JP" && input.assetType === "STOCK" && lot) {
    const rounded = Math.ceil(Math.max(1, desired) / lot) * lot;
    return rounded <= sellable ? rounded : (sellable === held ? sellable : Math.floor(sellable / lot) * lot);
  }
  return Math.min(sellable, Math.max(1, Math.ceil(desired)));
}

function twoScoresBelow(scores: HoldingAdviceInput["recentScores"], threshold: number) {
  return scores.length >= 2 && scores.slice(0, 2).every((item) => Number(item.score) < threshold);
}

export function deriveHoldingAdvice(input: HoldingAdviceInput): HoldingAdvice {
  const now = input.now ?? Date.now();
  const limits = input.riskPolicy ?? defaultRiskPolicy(input.riskPlan);
  const currentWeightPct = pct(input.baseMarketValue, input.equity);
  const marketWeightPct = pct(input.marketExposure, input.equity);
  const sectorWeightPct = pct(input.sectorExposure, input.equity);
  const returnPct = input.averageCost > 0 ? (input.price / input.averageCost - 1) * 100 : 0;
  const signal = input.signal;
  const analysisAge = signal ? now - Date.parse(signal.analysisCapturedAt) : Number.POSITIVE_INFINITY;
  const quoteCurrent = positive(input.price) > 0 && paperQuoteIsExecutable(input.quoteCapturedAt, input.quoteFreshness, now);
  const analysisCurrent = Boolean(signal && Number.isFinite(analysisAge) && analysisAge >= 0 && analysisAge <= HOLDING_ANALYSIS_MAX_AGE_MS);
  const base = {
    currentWeightPct:Number(currentWeightPct.toFixed(2)), marketWeightPct:Number(marketWeightPct.toFixed(2)), sectorWeightPct:Number(sectorWeightPct.toFixed(2)),
    returnPct:Number(returnPct.toFixed(2)), score:signal ? Number(signal.score) : null, confidence:signal ? Number(signal.confidence) : null,
    signalAction:signal?.action ?? null, analysisCapturedAt:signal?.analysisCapturedAt ?? null, analysisPrice:signal?.analysisPrice ?? null,
    modelVersion:signal?.modelVersion ?? null, assetModel:signal?.assetModel ?? null, validationStatus:signal?.validationStatus ?? null,
    tradePlan:signal?.tradePlan ?? null, quoteCurrent, analysisCurrent,
  };
  if (!quoteCurrent) return { ...base, action:"REVIEW", urgency:"REVIEW", reasonCodes:["HOLDING_QUOTE_STALE"], recommendedSellQuantity:0 };
  if (!signal) return { ...base, action:"REVIEW", urgency:"REVIEW", reasonCodes:["HOLDING_ANALYSIS_MISSING"], recommendedSellQuantity:0 };
  if (!analysisCurrent) return { ...base, action:"REVIEW", urgency:"REVIEW", reasonCodes:["HOLDING_ANALYSIS_STALE"], recommendedSellQuantity:0 };
  if (signal.conflicts.length || signal.corporateActionAnomalies.length || signal.hardGates.some((code) => ["SOURCE_CONFLICT","CORPORATE_ACTION_ANOMALY","STALE_DATA","INSUFFICIENT_HISTORY","INVALID_PRICE"].includes(code))) {
    return { ...base, action:"REVIEW", urgency:"REVIEW", reasonCodes:["HOLDING_DATA_CONFLICT", ...signal.hardGates], recommendedSellQuantity:0 };
  }

  const plan = signal.tradePlan;
  const stop = positive(plan.stop), invalidation = positive(plan.invalidation), target1 = positive(plan.target1), target2 = positive(plan.target2);
  const exitReasons:string[] = [];
  if (signal.action === "EXIT") exitReasons.push("HOLDING_SIGNAL_EXIT");
  if (stop && input.price <= stop) exitReasons.push("HOLDING_STOP_TRIGGERED");
  if (invalidation && input.price <= invalidation) exitReasons.push("HOLDING_INVALIDATION_TRIGGERED");
  if (twoScoresBelow(input.recentScores, 50)) exitReasons.push("HOLDING_SCORE_BELOW_50_TWO_DAYS");
  if (exitReasons.length) return { ...base, action:"EXIT", urgency:"CRITICAL", reasonCodes:exitReasons, recommendedSellQuantity:normalizeSellQuantity(input,input.sellableQuantity,true) };

  const reduceReasons:string[] = [];
  if (signal.action === "REDUCE") reduceReasons.push("HOLDING_SIGNAL_REDUCE");
  if (twoScoresBelow(input.recentScores, 55)) reduceReasons.push("HOLDING_SCORE_BELOW_55_TWO_DAYS");
  if (signal.hardGates.includes("RISK_OFF")) reduceReasons.push("HOLDING_RISK_OFF");
  if (signal.hardGates.includes("PRICE_NOT_ABOVE_MA_SET") && signal.hardGates.includes("LONG_TREND_NOT_RISING")) reduceReasons.push("HOLDING_TREND_FAILED");
  if (target2 && input.price >= target2) reduceReasons.push("HOLDING_TARGET2_REACHED");
  else if (target1 && input.price >= target1) reduceReasons.push("HOLDING_TARGET1_REACHED");
  const protectedLot=Boolean(input.minimumLotException);
  const positionExcess = protectedLot ? 0 : Math.max(0, input.baseMarketValue - input.equity * limits.maxWeightPct / 100);
  const marketExcess = protectedLot ? 0 : Math.max(0, input.marketExposure - input.equity * marketLimitFor(limits,input.market) / 100);
  const sectorExcess = input.sector && input.sector !== "Unclassified" ? Math.max(0, input.sectorExposure - input.equity * limits.maxSectorPct / 100) : 0;
  if (positionExcess > 0) reduceReasons.push("HOLDING_POSITION_LIMIT_EXCEEDED");
  if (marketExcess > 0) reduceReasons.push("HOLDING_MARKET_LIMIT_EXCEEDED");
  if (sectorExcess > 0 && !protectedLot) reduceReasons.push("HOLDING_SECTOR_LIMIT_EXCEEDED");
  if (reduceReasons.length) {
    const targetReduction = reduceReasons.some((reason) => reason === "HOLDING_TARGET2_REACHED") ? input.baseMarketValue * .75
      : reduceReasons.some((reason) => reason === "HOLDING_TARGET1_REACHED") ? input.baseMarketValue * .5 : 0;
    const allocatedMarketExcess = marketExposureShare(input.baseMarketValue,input.marketExposure,marketExcess);
    const allocatedSectorExcess = marketExposureShare(input.baseMarketValue,input.sectorExposure,sectorExcess);
    const requiredBase = Math.max(positionExcess,allocatedMarketExcess,allocatedSectorExcess,targetReduction || input.baseMarketValue * .25);
    const perUnitBase = Math.max(.000001,input.price * input.fxRate);
    return { ...base, action:"REDUCE", urgency:"HIGH", reasonCodes:reduceReasons, recommendedSellQuantity:normalizeSellQuantity(input,requiredBase/perUnitBase,false) };
  }

  const holdReasons = [signal.action === "WATCH" ? "HOLDING_SIGNAL_WATCH" : "HOLDING_PLAN_VALID"];
  if(protectedLot)holdReasons.push("HOLDING_MINIMUM_LOT_CONCENTRATION");
  if (target1 && input.price < target1) holdReasons.push("HOLDING_BELOW_FIRST_TARGET");
  return { ...base, action:"HOLD", urgency:"NORMAL", reasonCodes:holdReasons, recommendedSellQuantity:0 };
}

function marketExposureShare(positionValue:number, groupExposure:number, groupExcess:number) {
  if (groupExcess <= 0 || groupExposure <= 0) return 0;
  return groupExcess * Math.min(1,Math.max(0,positionValue / groupExposure));
}
