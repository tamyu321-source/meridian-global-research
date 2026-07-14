import { jsonError, runtimeEnv, verifyHmac } from "@/lib/server";
import { marketProfileIdentity } from "@/lib/model-profiles";
import { CANDIDATE_MODEL_VERSION, MARKETS, type AssetType, type GatePreset, type MarketCode, type StrategyFamily } from "@/lib/types";

export const dynamic="force-dynamic";
const statuses=["CALIBRATING","BACKTEST_PASSED","SHADOW_VALIDATING","ACTIVE_SHADOW","REJECTED"] as const;

export async function POST(request:Request){
  const raw=await request.text(),verified=await verifyHmac(raw,request.headers.get("x-meridian-signature"),request.headers.get("x-meridian-timestamp"));
  if(!verified.ok)return jsonError(verified.reason??"Unauthorized",401);
  const key=request.headers.get("x-idempotency-key");if(!key||key.length>160)return jsonError("Valid X-Idempotency-Key required",400);
  let payload:{profile?:Record<string,unknown>;status?:typeof statuses[number];evidence?:unknown};try{payload=JSON.parse(raw) as typeof payload;}catch{return jsonError("Invalid JSON",400);}
  const profile=payload.profile??{},market=String(profile.market),asset=String(profile.assetType),status=String(payload.status??"CALIBRATING") as typeof statuses[number];
  if(profile.modelVersion!==CANDIDATE_MODEL_VERSION||!profile.profileId||!profile.configHash||!MARKETS.includes(market as typeof MARKETS[number])||!["STOCK","ETF"].includes(asset)||!statuses.includes(status))return jsonError("Invalid market profile",400);
  if(status!=="CALIBRATING")return jsonError("Profile promotion is derived from verified backtest and bucket shadow evidence",409);
  try{const expected=await marketProfileIdentity(market as MarketCode,asset as AssetType,String(profile.strategyFamily) as StrategyFamily,String(profile.gatePreset) as GatePreset);if(expected.profileId!==profile.profileId||expected.configHash!==profile.configHash)return jsonError("Market profile hash mismatch",409);}catch{return jsonError("Unsupported market profile configuration",400);}
  const runtime=runtimeEnv();if(!runtime.DB)return jsonError("D1 unavailable",503);
  const duplicate=await runtime.DB.prepare("SELECT idempotency_key FROM ingest_events WHERE idempotency_key=?").bind(key).first();if(duplicate)return Response.json({accepted:true,duplicate:true});
  const objectKey=`model-profiles/${CANDIDATE_MODEL_VERSION}/${market}/${asset}/${String(profile.configHash)}.json`;
  if(runtime.MARKET_ARCHIVE)await runtime.MARKET_ARCHIVE.put(objectKey,raw,{httpMetadata:{contentType:"application/json"}});
  await runtime.DB.batch([
    runtime.DB.prepare(`INSERT INTO model_market_profiles (profile_id,model_version,market,asset_type,strategy_family,gate_preset,config_json,config_hash,status,selected_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(profile_id) DO UPDATE SET config_json=excluded.config_json,config_hash=excluded.config_hash,status=excluded.status,selected_at=COALESCE(model_market_profiles.selected_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP`).bind(String(profile.profileId),CANDIDATE_MODEL_VERSION,market,asset,String(profile.strategyFamily),String(profile.gatePreset),JSON.stringify(profile),String(profile.configHash),status),
    runtime.DB.prepare("INSERT INTO ingest_events (idempotency_key,provider,captured_at,object_key,record_count,status,created_at) VALUES (?,'model-calibration',?,?,1,'accepted',CURRENT_TIMESTAMP)").bind(key,new Date().toISOString(),runtime.MARKET_ARCHIVE?objectKey:null),
  ]);
  return Response.json({accepted:true,duplicate:false,profileId:profile.profileId,status},{status:202});
}
