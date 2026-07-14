import { MARKETS, RISK_PLANS, type MarketCode, type RiskPlanId } from "./types";

export const RISK_POLICY_LIMITS = {
  riskBudgetPct:[0.1,2], maxWeightPct:[1,30], maxSectorPct:[5,100], maxMarketPct:[10,100], drawdownBreakerPct:[5,30],
} as const;

export type RiskPolicy = {
  revisionId: string | null;
  planId: RiskPlanId;
  enabledMarkets: MarketCode[];
  riskBudgetPct: number;
  maxWeightPct: number;
  maxSectorPct: number;
  drawdownBreakerPct: number;
  marketLimits: Record<MarketCode, number>;
  allowMinimumLotException: boolean;
  customized: boolean;
  marketLimitsCustomized: boolean;
};

export type RiskPolicyInput = Partial<Omit<RiskPolicy,"revisionId"|"planId"|"customized"|"marketLimits">> & { marketLimits?:Partial<Record<MarketCode,number>> };

function within(value:number,[minimum,maximum]:readonly [number,number]) { return Number.isFinite(value) && value >= minimum && value <= maximum; }
function rounded(value:number) { return Math.round(value * 100) / 100; }

export function templateMarketLimit(planId:RiskPlanId, enabledMarkets:MarketCode[]) {
  const count=Math.max(1,enabledMarkets.length);
  return Math.min(100,Math.max(RISK_PLANS[planId].maxMarketPct,Math.ceil(100/count)));
}

export function defaultRiskPolicy(planId:RiskPlanId="capital_first", enabledMarkets:MarketCode[]=MARKETS):RiskPolicy {
  const plan=RISK_PLANS[planId] ?? RISK_PLANS.capital_first;
  const selected=enabledMarkets.length ? [...new Set(enabledMarkets)] : [...MARKETS];
  const automatic=templateMarketLimit(plan.id,selected);
  return {
    revisionId:null, planId:plan.id, enabledMarkets:selected, riskBudgetPct:plan.riskBudgetPct, maxWeightPct:plan.maxWeightPct,
    maxSectorPct:plan.maxSectorPct, drawdownBreakerPct:plan.drawdownBreakerPct,
    marketLimits:Object.fromEntries(MARKETS.map((market)=>[market,automatic])) as Record<MarketCode,number>,
    allowMinimumLotException:true, customized:false, marketLimitsCustomized:false,
  };
}

export function validateRiskPolicy(planId:RiskPlanId,input:RiskPolicyInput):{ ok:true; policy:RiskPolicy }|{ ok:false; code:string; params:Record<string,string|number> } {
  const base=defaultRiskPolicy(planId);
  const enabled=[...new Set((input.enabledMarkets ?? base.enabledMarkets).filter((market):market is MarketCode=>MARKETS.includes(market as MarketCode)))];
  if (!enabled.length) return {ok:false,code:"RISK_MARKETS_REQUIRED",params:{}};
  const values={
    riskBudgetPct:Number(input.riskBudgetPct ?? base.riskBudgetPct), maxWeightPct:Number(input.maxWeightPct ?? base.maxWeightPct),
    maxSectorPct:Number(input.maxSectorPct ?? base.maxSectorPct), drawdownBreakerPct:Number(input.drawdownBreakerPct ?? base.drawdownBreakerPct),
  };
  for (const key of Object.keys(values) as Array<keyof typeof values>) {
    if (!within(values[key],RISK_POLICY_LIMITS[key])) return {ok:false,code:"RISK_LIMIT_RANGE",params:{field:key,min:RISK_POLICY_LIMITS[key][0],max:RISK_POLICY_LIMITS[key][1]}};
  }
  const automatic=templateMarketLimit(planId,enabled);
  const marketLimits=Object.fromEntries(MARKETS.map((market)=>{
    const supplied=input.marketLimits?.[market];
    return [market,rounded(supplied == null ? automatic : Number(supplied))];
  })) as Record<MarketCode,number>;
  for (const market of enabled) if (!within(marketLimits[market],RISK_POLICY_LIMITS.maxMarketPct)) return {ok:false,code:"RISK_LIMIT_RANGE",params:{field:`marketLimits.${market}`,min:10,max:100}};
  if (values.maxWeightPct > values.maxSectorPct) return {ok:false,code:"RISK_LIMIT_RELATION",params:{field:"maxWeightPct",other:"maxSectorPct"}};
  const narrow=enabled.find((market)=>values.maxWeightPct>marketLimits[market]);
  if (narrow) return {ok:false,code:"RISK_LIMIT_RELATION",params:{field:"maxWeightPct",other:`marketLimits.${narrow}`}};
  const policy:RiskPolicy={revisionId:null,planId,enabledMarkets:enabled,riskBudgetPct:rounded(values.riskBudgetPct),maxWeightPct:rounded(values.maxWeightPct),maxSectorPct:rounded(values.maxSectorPct),drawdownBreakerPct:rounded(values.drawdownBreakerPct),marketLimits,allowMinimumLotException:input.allowMinimumLotException!==false,customized:true,marketLimitsCustomized:input.marketLimitsCustomized===true};
  return {ok:true,policy};
}

export async function loadRiskPolicy(db:D1Database,userEmail:string,planId:RiskPlanId):Promise<RiskPolicy> {
  const fallback=defaultRiskPolicy(planId);
  try {
    const row=await db.prepare("SELECT * FROM user_risk_policies WHERE user_email=?").bind(userEmail).first<Record<string,unknown>>();
    if(!row)return fallback;
    const markets=await db.prepare("SELECT market,max_market_pct,enabled FROM user_market_limits WHERE user_email=?").bind(userEmail).all<Record<string,unknown>>();
    const enabled=(markets.results??[]).filter((item)=>Boolean(item.enabled)).map((item)=>String(item.market) as MarketCode).filter((market)=>MARKETS.includes(market));
    const marketLimits={...fallback.marketLimits};
    for(const item of markets.results??[]){const market=String(item.market) as MarketCode;if(MARKETS.includes(market))marketLimits[market]=Number(item.max_market_pct);}
    return {revisionId:String(row.revision_id),planId:(RISK_PLANS[String(row.plan_id) as RiskPlanId]?.id??planId),enabledMarkets:enabled.length?enabled:fallback.enabledMarkets,riskBudgetPct:Number(row.risk_budget_pct),maxWeightPct:Number(row.max_weight_pct),maxSectorPct:Number(row.max_sector_pct),drawdownBreakerPct:Number(row.drawdown_breaker_pct),marketLimits,allowMinimumLotException:Boolean(row.allow_minimum_lot_exception),customized:Boolean(row.customized),marketLimitsCustomized:Boolean(row.customized)};
  } catch { return fallback; }
}

export function marketLimitFor(policy:RiskPolicy,market:MarketCode){return policy.marketLimits[market] ?? RISK_PLANS[policy.planId].maxMarketPct;}

export function effectivePositionLimit(policyMaximum:number,modelMaximum=policyMaximum,multiplier=1){
  return Number((Math.min(policyMaximum,modelMaximum)*Math.min(1,Math.max(0,multiplier))).toFixed(2));
}

export function estimateTradeRisk(price:number,stop:number,quantity:number,fxRate:number,roundTripCostsBase:number,equity:number,riskBudgetPct:number){
  const riskBase=Math.max(0,price-stop)*quantity*fxRate+Math.max(0,roundTripCostsBase);
  const riskPct=equity>0?riskBase/equity*100:Infinity;
  const budgetBase=equity*Math.max(0,riskBudgetPct)/100;
  return {riskBase:Number(riskBase.toFixed(2)),riskPct:Number(riskPct.toFixed(3)),maximumQuantity:price>stop&&budgetBase>roundTripCostsBase?Math.max(0,Math.floor((budgetBase-roundTripCostsBase)/(Math.max(.000001,(price-stop)*fxRate)))):0,minimumCapital:riskBudgetPct>0?Number((riskBase/(riskBudgetPct/100)).toFixed(2)):Infinity};
}
