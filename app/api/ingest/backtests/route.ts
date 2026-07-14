import { jsonError, runtimeEnv, verifyHmac } from "@/lib/server";
import { marketProfileIdentity } from "@/lib/model-profiles";
import { CANDIDATE_MODEL_VERSION, MARKETS, type AssetType, type GatePreset, type MarketCode, type StrategyFamily } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  const timestamp = request.headers.get("x-meridian-timestamp");
  const verification = await verifyHmac(body, request.headers.get("x-meridian-signature"), timestamp);
  if (!verification.ok) return jsonError(verification.reason ?? "Unauthorized", 401);
  let payload: { modelVersion?: string; baselineModelVersion?:string; configHash?:string; validationStatus?:string; survivorshipBias?:boolean; generatedAt?: string; markets?: Record<string, { metrics?: Record<string, unknown>; baselineMetrics?:Record<string,unknown>; comparison?:Record<string,unknown>; assetBuckets?:Record<string,{profileId?:string;configHash?:string;strategyFamily?:string;gatePreset?:string;calibrationPassed?:boolean;calibration?:unknown;metrics?:Record<string,unknown>;baselineMetrics?:Record<string,unknown>;comparison?:Record<string,unknown>}>;trades?: unknown[] }>; overall?:Record<string,unknown>; baselineOverall?:Record<string,unknown>; comparison?:Record<string,unknown> };
  try { payload = JSON.parse(body) as typeof payload; } catch { return jsonError("Invalid JSON", 400); }
  if (payload.modelVersion !== CANDIDATE_MODEL_VERSION || payload.validationStatus !== "PROVISIONAL_BACKTEST" || !payload.survivorshipBias || !payload.generatedAt || !payload.markets) return jsonError("Invalid provisional v2.2 backtest artifact", 400);
  const runtime = runtimeEnv();
  if (!runtime.DB) return jsonError("D1 unavailable", 503);
  const artifactKey = `backtests/${payload.modelVersion}/${payload.generatedAt.replaceAll(":", "-")}.json`;
  const statements: D1PreparedStatement[] = [];
  for (const market of MARKETS) {
    const item = payload.markets[market];
    if (!item?.metrics) continue;
    const metrics = item.metrics;
    const passed = Number(metrics.tradeCount ?? 0) >= 40 && Number(metrics.profitFactor ?? 0) >= 1.2 && Number(metrics.sharpe ?? 0) >= .8 && Number(metrics.expectancyPct ?? 0) > 0 && Math.abs(Number(metrics.maxDrawdownPct ?? 100)) <= 10;
    statements.push(runtime.DB.prepare("INSERT INTO backtest_runs (id,model_version,market,risk_plan,status,started_at,completed_at,metrics_json,artifact_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(), payload.modelVersion, market, "capital_first", passed ? "PROVISIONAL_PASSED" : "PROVISIONAL_FAILED_GATE", payload.generatedAt, new Date().toISOString(), JSON.stringify({ ...metrics, baselineMetrics:item.baselineMetrics, comparison:item.comparison, validationStatus:"PROVISIONAL_BACKTEST", survivorshipBias:true, formalEligible:false }), runtime.MARKET_ARCHIVE ? artifactKey : null));
    for(const assetType of ["STOCK","ETF"] as const){
      const bucket=item.assetBuckets?.[assetType];if(!bucket?.profileId||!bucket.metrics||!bucket.configHash)continue;
      let expectedProfile;try{expectedProfile=await marketProfileIdentity(market as MarketCode,assetType as AssetType,String(bucket.strategyFamily) as StrategyFamily,String(bucket.gatePreset) as GatePreset);}catch{return jsonError("Unsupported calibrated market profile",400);}if(expectedProfile.profileId!==bucket.profileId||expectedProfile.configHash!==bucket.configHash)return jsonError("Calibrated market profile hash mismatch",409);
      const comparison=bucket.comparison??{},metrics=bucket.metrics;
      const bucketPassed=bucket.calibrationPassed===true&&Number(metrics.tradeCount??0)>=40&&Number(metrics.profitFactor??0)>=1.2&&Number(metrics.sharpe??0)>=.8&&Number(metrics.expectancyPct??0)>0&&Math.abs(Number(metrics.maxDrawdownPct??100))<=10&&Number(comparison.drawdownReductionPct??0)>=15&&Number(comparison.falseBreakoutReductionPct??0)>=15;
      const runId=crypto.randomUUID();
      statements.push(runtime.DB.prepare("INSERT INTO backtest_runs (id,model_version,market,risk_plan,status,started_at,completed_at,metrics_json,artifact_key,asset_type,market_profile_id,config_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(runId,payload.modelVersion,market,"capital_first",bucketPassed?"PROVISIONAL_PASSED":"PROVISIONAL_FAILED_GATE",payload.generatedAt,new Date().toISOString(),JSON.stringify({...metrics,baselineMetrics:bucket.baselineMetrics,comparison,calibrationPassed:bucket.calibrationPassed,calibration:bucket.calibration,validationStatus:"PROVISIONAL_BACKTEST",survivorshipBias:true,formalEligible:false}),runtime.MARKET_ARCHIVE?artifactKey:null,assetType,bucket.profileId,bucket.configHash));
      statements.push(runtime.DB.prepare(`INSERT INTO model_market_profiles (profile_id,model_version,market,asset_type,strategy_family,gate_preset,config_json,config_hash,status,backtest_run_id,selected_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?, ?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(profile_id) DO UPDATE SET status=CASE WHEN model_market_profiles.status IN ('ACTIVE_SHADOW','SHADOW_VALIDATING') AND excluded.status='BACKTEST_PASSED' THEN model_market_profiles.status ELSE excluded.status END,backtest_run_id=excluded.backtest_run_id,config_hash=excluded.config_hash,selected_at=CASE WHEN model_market_profiles.status IN ('BACKTEST_PASSED','SHADOW_VALIDATING','ACTIVE_SHADOW') AND model_market_profiles.config_hash=excluded.config_hash THEN model_market_profiles.selected_at ELSE CURRENT_TIMESTAMP END,updated_at=CURRENT_TIMESTAMP`).bind(bucket.profileId,payload.modelVersion,market,assetType,String(bucket.strategyFamily??"BALANCED"),String(bucket.gatePreset??"CORE"),"{}",bucket.configHash,bucketPassed?"BACKTEST_PASSED":"REJECTED",runId));
    }
  }
  if (payload.overall && payload.comparison) {
    const overall=payload.overall,comparison=payload.comparison;
    const passed=Number(overall.tradeCount??0)>=500&&Number(overall.profitFactor??0)>=1.2&&Number(overall.sharpe??0)>=.8&&Number(overall.expectancyPct??0)>0&&Math.abs(Number(overall.maxDrawdownPct??100))<=10&&Number(comparison.drawdownReductionPct??0)>=15&&Number(comparison.falseBreakoutReductionPct??0)>=15;
    statements.push(runtime.DB.prepare("INSERT INTO backtest_runs (id,model_version,market,risk_plan,status,started_at,completed_at,metrics_json,artifact_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(),payload.modelVersion,"ALL","capital_first",passed?"PROVISIONAL_PASSED":"PROVISIONAL_FAILED_GATE",payload.generatedAt,new Date().toISOString(),JSON.stringify({...overall,baselineMetrics:payload.baselineOverall,comparison,validationStatus:"PROVISIONAL_BACKTEST",survivorshipBias:true,formalEligible:false}),runtime.MARKET_ARCHIVE?artifactKey:null));
  }
  if (runtime.MARKET_ARCHIVE) await runtime.MARKET_ARCHIVE.put(artifactKey, body, { httpMetadata: { contentType: "application/json" } });
  if (statements.length) await runtime.DB.batch(statements);
  return Response.json({ accepted: true, artifactKey: runtime.MARKET_ARCHIVE ? artifactKey : null, markets: statements.length }, { status: 202 });
}
