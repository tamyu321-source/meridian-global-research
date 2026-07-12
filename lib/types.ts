export type Locale = "en" | "zh-TW" | "zh-CN" | "ja" | "ko";
export type MarketCode = "US" | "CN" | "HK" | "TW" | "JP" | "KR" | "SG";
export type AssetType = "STOCK" | "ETF";
export type DataFreshness = "realtime" | "delayed" | "fallback" | "stale";
export type SignalStatus = "SHADOW" | "FORMAL";
export type SignalAction = "BUY" | "WATCH" | "HOLD" | "REDUCE" | "EXIT";
export type RiskPlanId = "capital_first" | "balanced" | "growth";
export type AssetModel = "STOCK_V2" | "ETF_V2" | "LEGACY_V1";
export type ValidationStatus = "SHADOW" | "PROVISIONAL_BACKTEST" | "FORMAL";

export type PriceBar = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose?: number;
  dividend?: number;
  splitRatio?: number;
};

export type MarketSnapshot = {
  instrumentId: string;
  symbol: string;
  name: string;
  market: MarketCode;
  exchange: string;
  currency: string;
  assetType: AssetType;
  sector?: string;
  source: string;
  freshness: DataFreshness;
  capturedAt: string;
  bars: PriceBar[];
  price: number;
  previousClose: number;
  sourceWarnings?: string[];
};

export type FactorScores = {
  trend: number;
  momentum: number;
  relativeStrength: number;
  liquidity: number;
  risk: number;
  regime: number;
  structure?: number;
};

export type DataQuality = {
  completenessPct: number;
  sourceCount: number;
  warnings: unknown[];
  conflicts: unknown[];
  corporateActionAnomalies: unknown[];
  hardGates: string[];
};

export type TradePlan = {
  entryLow: number;
  entryHigh: number;
  invalidation: number;
  stop: number;
  target1: number;
  target2: number;
  trailingAtr: number;
  rewardRisk: number;
  maxWeightPct: number;
  riskBudgetPct: number;
};

export type RankedSecurity = {
  instrumentId: string;
  symbol: string;
  name: string;
  market: MarketCode;
  exchange: string;
  currency: string;
  assetType: AssetType;
  sector: string;
  price: number;
  changePct: number;
  score: number;
  confidence: number;
  action: SignalAction;
  status: SignalStatus;
  freshness: DataFreshness;
  source: string;
  capturedAt: string;
  factors: FactorScores;
  tradePlan: TradePlan;
  reasonCodes: string[];
  hardGates: string[];
  modelVersion: string;
  assetModel: AssetModel;
  validationStatus: ValidationStatus;
  configHash: string;
  dataQuality: DataQuality;
  selection: { eligibleBeforeCap: boolean; bucketRank: number; buyLimit: number; capped: boolean };
};

export const MARKETS: MarketCode[] = ["US", "CN", "HK", "TW", "JP", "KR", "SG"];

export const RISK_PLANS: Record<RiskPlanId, {
  id: RiskPlanId;
  riskBudgetPct: number;
  maxWeightPct: number;
  maxSectorPct: number;
  maxMarketPct: number;
  drawdownBreakerPct: number;
}> = {
  capital_first: { id: "capital_first", riskBudgetPct: 0.5, maxWeightPct: 5, maxSectorPct: 20, maxMarketPct: 35, drawdownBreakerPct: 10 },
  balanced: { id: "balanced", riskBudgetPct: 1, maxWeightPct: 8, maxSectorPct: 30, maxMarketPct: 45, drawdownBreakerPct: 15 },
  growth: { id: "growth", riskBudgetPct: 1.5, maxWeightPct: 12, maxSectorPct: 40, maxMarketPct: 60, drawdownBreakerPct: 20 },
};

export const MODEL_VERSION = "meridian-swing-v2.0.0";
export const LEGACY_MODEL_VERSION = "meridian-swing-v1.0.0";
