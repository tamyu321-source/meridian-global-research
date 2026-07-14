import config from "@/bridge/model.v2.2.json";
import { CANDIDATE_MODEL_VERSION, type AssetType, type GatePreset, type MarketCode, type StrategyFamily } from "./types";

type Selection=Record<string,[StrategyFamily,GatePreset]>;

function hex(buffer:ArrayBuffer){return [...new Uint8Array(buffer)].map((value)=>value.toString(16).padStart(2,"0")).join("");}
function canonical(value:unknown):string{if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;if(value&&typeof value==="object")return `{${Object.entries(value as Record<string,unknown>).sort(([left],[right])=>left.localeCompare(right)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;return JSON.stringify(value);}

export async function marketProfileIdentity(market:MarketCode,assetType:AssetType,strategyFamily:StrategyFamily,gatePreset:GatePreset){
  const weights=config.strategyFamilies[assetType]?.[strategyFamily],gates=config.gatePresets[gatePreset];if(!weights||!gates)throw new Error("UNSUPPORTED_MARKET_PROFILE");
  const profileId=`v2.2-${market}-${assetType}-${strategyFamily.toLowerCase()}-${gatePreset.toLowerCase()}`;
  const configuration={modelVersion:CANDIDATE_MODEL_VERSION,market,assetType,strategyFamily,gatePreset,weights,gates,minimumStopPct:config.minimumStopPct,maximumStopPct:config.maximumStopPct,profileId};
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical(configuration)));
  return {profileId,modelVersion:CANDIDATE_MODEL_VERSION,market,assetType,strategyFamily,gatePreset,configHash:hex(digest)};
}

export async function defaultMarketProfileIdentity(market:MarketCode,assetType:AssetType){
  const [strategyFamily,gatePreset]=(config.profileSelection as unknown as Selection)[`${market}:${assetType}`];
  return marketProfileIdentity(market,assetType,strategyFamily,gatePreset);
}

export function profileConfigFor(strategyFamily:StrategyFamily,gatePreset:GatePreset,assetType:AssetType){
  return {weights:config.strategyFamilies[assetType][strategyFamily],gates:config.gatePresets[gatePreset],minimumStopPct:config.minimumStopPct,maximumStopPct:config.maximumStopPct};
}

export function marketProfileStatusAfterValidation(status:string,validTradingDays:number){
  if(!["BACKTEST_PASSED","SHADOW_VALIDATING"].includes(status))return status;
  return validTradingDays>=30?"ACTIVE_SHADOW":"SHADOW_VALIDATING";
}
