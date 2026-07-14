import { apiUser, jsonError, runtimeEnv } from "@/lib/server";
import { defaultMarketProfileIdentity, profileConfigFor } from "@/lib/model-profiles";
import { CANDIDATE_MODEL_VERSION, MARKETS, type AssetType, type GatePreset, type StrategyFamily } from "@/lib/types";

export const dynamic="force-dynamic";

export async function GET(request:Request){
  const user=await apiUser(request);if(!user)return jsonError("Sign in required",401);
  const db=runtimeEnv().DB;if(!db)return jsonError("D1 unavailable",503);
  const url=new URL(request.url),market=String(url.searchParams.get("market")??"ALL").toUpperCase(),assetType=String(url.searchParams.get("assetType")??"ALL").toUpperCase();
  if(market!=="ALL"&&!MARKETS.includes(market as typeof MARKETS[number]))return jsonError("Unsupported market",400);
  if(!["ALL","STOCK","ETF"].includes(assetType))return jsonError("Unsupported asset type",400);
  const clauses=["mp.model_version=?"],values:unknown[]=[CANDIDATE_MODEL_VERSION];
  if(market!=="ALL"){clauses.push("mp.market=?");values.push(market);}if(assetType!=="ALL"){clauses.push("mp.asset_type=?");values.push(assetType);}
  const result=await db.prepare(`SELECT mp.profile_id profileId,mp.model_version modelVersion,mp.market,mp.asset_type assetType,mp.strategy_family strategyFamily,mp.gate_preset gatePreset,mp.config_hash configHash,mp.status,mp.backtest_run_id backtestRunId,mp.shadow_days shadowDays,mp.selected_at selectedAt,mp.activated_at activatedAt,mp.updated_at updatedAt,br.metrics_json backtestEvidence FROM model_market_profiles mp LEFT JOIN backtest_runs br ON br.id=mp.backtest_run_id WHERE ${clauses.join(" AND ")} ORDER BY mp.market,mp.asset_type,mp.updated_at DESC`).bind(...values).all<Record<string,unknown>>();
  const stored=new Map<string,Record<string,unknown>>(),statusPriority:Record<string,number>={SHADOW_VALIDATING:0,BACKTEST_PASSED:1,ACTIVE_SHADOW:2,CALIBRATING:3,REJECTED:4};for(const item of result.results??[]){const key=`${item.market}:${item.assetType}`,current=stored.get(key),priority=(value:unknown)=>statusPriority[String(value)]??5;if(!current||priority(item.status)<priority(current.status))stored.set(key,item);}
  const selectedMarkets=market==="ALL"?MARKETS:[market as typeof MARKETS[number]],selectedAssets=(assetType==="ALL"?["STOCK","ETF"]:[assetType]) as AssetType[];
  const defaults=await Promise.all(selectedMarkets.flatMap(item=>selectedAssets.map(async asset=>{const identity=await defaultMarketProfileIdentity(item,asset);return {...identity,config:profileConfigFor(identity.strategyFamily,identity.gatePreset,asset),status:"CALIBRATING",shadowDays:0,backtestRunId:null,selectedAt:null,activatedAt:null,updatedAt:null};})));
  const profiles=defaults.map(item=>{const merged:Record<string,unknown>={...item,...(stored.get(`${item.market}:${item.assetType}`)??{})};let evidence=null;try{evidence=merged.backtestEvidence?JSON.parse(String(merged.backtestEvidence)):null;}catch{}return {...merged,backtestEvidence:evidence,config:profileConfigFor(String(merged.strategyFamily) as StrategyFamily,String(merged.gatePreset) as GatePreset,String(merged.assetType) as AssetType)};});
  return Response.json({modelVersion:CANDIDATE_MODEL_VERSION,profiles,formalEligible:false},{headers:{"Cache-Control":"private, no-store"}});
}
