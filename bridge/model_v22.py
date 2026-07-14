"""Meridian v2.2 canonical market-profile model.

One scoring engine is shared by production and backtests.  Every market and
asset bucket resolves an immutable strategy-family and gate-preset profile.
Profiles may be evaluated during constrained walk-forward calibration without
creating divergent production algorithms.
"""
from __future__ import annotations

import hashlib
import json
import os
import statistics

try:
    from . import model_v21 as core
except ImportError:
    import model_v21 as core

CONFIG_PATH=os.path.join(os.path.dirname(__file__),"model.v2.2.json")
with open(CONFIG_PATH,"r",encoding="utf-8") as handle: CONFIG=json.load(handle)
with open(CONFIG_PATH,"rb") as handle: CONFIG_HASH=hashlib.sha256(handle.read()).hexdigest()

MODEL_VERSION=CONFIG["modelVersion"]
BENCHMARK_SYMBOLS=core.BENCHMARK_SYMBOLS
number=core.number
pct=core.pct
raw_factors_core=core.raw_factors


def _js_canonical_value(value):
    if isinstance(value,float) and value.is_integer():return int(value)
    if isinstance(value,dict):return {key:_js_canonical_value(item) for key,item in value.items()}
    if isinstance(value,list):return [_js_canonical_value(item) for item in value]
    return value
def _canonical(value): return json.dumps(_js_canonical_value(value),ensure_ascii=False,sort_keys=True,separators=(",",":"))
def _hash(value): return hashlib.sha256(_canonical(value).encode()).hexdigest()


def profile_candidates(market,asset_type):
    rows=[]
    for family,weights in CONFIG["strategyFamilies"][asset_type].items():
        for preset,gates in CONFIG["gatePresets"].items():
            merged={"modelVersion":MODEL_VERSION,"market":market,"assetType":asset_type,"strategyFamily":family,"gatePreset":preset,"weights":weights,"gates":gates,"minimumStopPct":CONFIG["minimumStopPct"],"maximumStopPct":CONFIG["maximumStopPct"]}
            merged["profileId"]=f"v2.2-{market}-{asset_type}-{family.lower()}-{preset.lower()}"
            merged["configHash"]=_hash(merged)
            rows.append(merged)
    return rows


def market_profile(market,asset_type,profile_id=None):
    candidates=profile_candidates(market,asset_type)
    if profile_id:
        selected=next((item for item in candidates if item["profileId"]==profile_id),None)
        if selected is None: raise ValueError(f"Unknown market profile: {profile_id}")
        return selected
    family,preset=CONFIG["profileSelection"][f"{market}:{asset_type}"]
    return next(item for item in candidates if item["strategyFamily"]==family and item["gatePreset"]==preset)


MARKET_PROFILES={(market,asset):market_profile(market,asset) for market in BENCHMARK_SYMBOLS for asset in ("STOCK","ETF")}


def choose_calibrated_profile(metrics_by_profile):
    """Select only evidence-eligible candidates with a reliability-first order."""
    eligible=[]
    for profile_id,metrics in metrics_by_profile.items():
        if number(metrics.get("expectancyPct"))<=0: continue
        eligible.append((profile_id,metrics))
    if not eligible:return None
    return min(eligible,key=lambda item:(abs(number(item[1].get("maxDrawdownPct"))),number(item[1].get("falseBreakout10dPct")),-number(item[1].get("profitFactor")),-number(item[1].get("sharpe")),item[0]))[0]


def raw_factors(snapshot):
    raw=raw_factors_core(snapshot); bars=core._valid_bars(snapshot); shocks=[]
    for index in range(max(1,len(bars)-6),len(bars)):
        atr=core._atr(bars[:index+1]); prior=bars[index-1]["close"]
        if atr: shocks.append({"age":len(bars)-1-index,"gapAtr":(bars[index]["open"]-prior)/atr,"rangeAtr":(bars[index]["high"]-bars[index]["low"])/atr})
    raw["recentShocks"]=shocks
    return raw


def build_market_context(snapshots,benchmark_snapshot=None,raw_by_id=None,benchmark_raw=None):
    base=core.build_market_context(snapshots,benchmark_snapshot,raw_by_id,benchmark_raw)
    if not benchmark_snapshot:return base
    benchmark=benchmark_raw if benchmark_raw is not None else raw_factors(benchmark_snapshot)
    return {**base,"benchmarkCurrent":benchmark.get("current",0),"benchmarkSma50":benchmark.get("sma50",0),"benchmarkSma200":benchmark.get("sma200",0),"benchmarkReturn20":benchmark.get("return20Current",0),"benchmarkVolatility":benchmark.get("volatility",0)}


def _profile_context(context,profile):
    if not context.get("available"):return {**context,"regime":"UNKNOWN"}
    gates=profile["gates"]; breadth=number(context.get("breadthPct")); crash=number(context.get("benchmarkReturn20"))<=gates["crashReturn20Pct"] and number(context.get("benchmarkVolatility"))>=gates["crashVolatilityPct"]
    risk_off=(number(context.get("benchmarkCurrent"))<number(context.get("benchmarkSma200")) and breadth<gates["riskOffBreadthPct"]) or crash
    risk_on=number(context.get("benchmarkCurrent"))>number(context.get("benchmarkSma200")) and number(context.get("benchmarkSma50"))>number(context.get("benchmarkSma200")) and breadth>=gates["riskOnBreadthPct"] and not crash
    return {**context,"regime":"RISK_OFF" if risk_off else "RISK_ON" if risk_on else "NEUTRAL"}


def _shock_age(raw,gates):
    values=[item["age"] for item in raw.get("recentShocks",[]) if item["age"]<gates["coolingSessions"] and (item["gapAtr"]>gates["maximumGapAtr"] or item["rangeAtr"]>gates["maximumRangeAtr"])]
    return min(values) if values else None


def _entry_setup(raw,context,profile):
    gates=profile["gates"]
    if not context.get("available"):return "BLOCKED_DATA"
    if context.get("regime")=="RISK_OFF":return "BLOCKED_REGIME"
    if raw["extensionAtr"]>gates["maximumExtensionAtr"] or _shock_age(raw,gates) is not None:return "OVEREXTENDED"
    breakout=raw["current"]>raw["previous55High"] and raw["volumeRatio"]>=gates["breakoutVolumeRatio"] and raw["closeLocation"]>=gates["breakoutCloseLocation"] and raw["gapAtr"]<=gates["maximumGapAtr"] and raw["rangeAtr"]<=gates["maximumRangeAtr"]
    if profile["strategyFamily"]!="DEFENSIVE_PULLBACK" and breakout and context.get("regime")=="RISK_ON":return "BREAKOUT_READY"
    reference=min(abs(raw["current"]-raw["sma20"]),abs(raw["current"]-raw["recentBreakoutLevel"]) if raw["recentBreakoutLevel"] else float("inf"))/max(raw["atr"],.000001)
    pullback=raw["recentBreakoutAge"] is not None and raw["recentBreakoutAge"]>=1 and reference<=gates["pullbackToleranceAtr"] and raw["current"]>raw["sma50"] and raw["drawdown20Pct"]<=gates["pullbackMaximumDrawdownPct"] and raw["current"]>raw["previousClose"] and raw["closeLocation"]>=gates["pullbackCloseLocation"] and raw["volumeRatio"]>=1
    if pullback:return "PULLBACK_READY"
    if raw["recentBreakoutAge"] is not None:return "WAIT_PULLBACK"
    return "NO_SETUP"


def _trade_plan(snapshot,raw,entry_state,context):
    current=number(snapshot.get("price"),raw["current"]); atr=raw["atr"] or current*.03; candidates=[raw["swingLow10"],current-2.2*atr]
    if raw["recentBreakoutLevel"]:candidates.append(raw["recentBreakoutLevel"]-.5*atr)
    stop=max(value for value in candidates if 0<value<current) if any(0<value<current for value in candidates) else current-2.2*atr
    risk=max(current-stop,current*.0001); rounded=lambda value:round(value,4)
    return {"entryLow":rounded(current-atr*.35),"entryHigh":rounded(current+atr*.20),"invalidation":rounded(min(raw["swingLow10"],raw["recentBreakoutLevel"] or raw["swingLow10"])),"stop":rounded(stop),"target1":rounded(current+risk*1.5),"target2":rounded(current+risk*2.5),"trailingAtr":2,"rewardRisk":2.5,"rewardRiskKind":"PLANNED_R_MULTIPLE","maxWeightPct":30,"positionSizeMultiplier":.5 if context.get("regime")=="NEUTRAL" else 1,"riskBudgetPct":.5,"setupType":entry_state,"breakoutLevel":rounded(raw["recentBreakoutLevel"] or raw["previous55High"]),"stopDistancePct":round(risk/current*100,2) if current else 0}


def rank_snapshots(snapshots,allow_buy=True,market_contexts=None,raw_by_id=None,profile_overrides=None):
    market_contexts=market_contexts or {}; profile_overrides=profile_overrides or {}
    if raw_by_id is None:raw_by_id={item["instrumentId"]:raw_factors(item) for item in snapshots}
    groups={}
    for item in snapshots:groups.setdefault((item["market"],item["assetType"]),[]).append(item)
    def category(item):return (item.get("etfStructure") or {}).get("trackingCategory") if item["assetType"]=="ETF" else item.get("sector")
    peer_key_by_id={};peer_groups={}
    for group_key,broad in groups.items():
        counts={}
        for item in broad:counts[category(item)]=counts.get(category(item),0)+1
        for item in broad:peer_key_by_id[item["instrumentId"]]=(*group_key,category(item) if counts.get(category(item),0)>=8 else "__ALL__")
        for key in set(peer_key_by_id[item["instrumentId"]] for item in broad):peer_groups[key]=broad if key[-1]=="__ALL__" else [item for item in broad if category(item)==key[-1]]
    distributions={}
    for key,peers in peer_groups.items():
        peer_raw=[raw_by_id[item["instrumentId"]] for item in peers]; context=market_contexts.get(key[0],{}); median=statistics.median([item["return3m"] for item in peer_raw]) if peer_raw else 0; benchmark=number(context.get("benchmarkReturn3m")); relative=sorted(.6*(item["return3m"]-benchmark)+.4*(item["return3m"]-median) for item in peer_raw)
        distributions[key]={"industryMedian":median,"relative":relative,**{name:sorted(item[name] for item in peer_raw) for name in ("trend","momentum","liquidity","risk")}}
    rows=[]
    for snapshot in snapshots:
        key=(snapshot["market"],snapshot["assetType"]); profile=market_profile(*key,profile_overrides.get(key)); raw=raw_by_id[snapshot["instrumentId"]]; context=_profile_context(market_contexts.get(snapshot["market"],{}),profile); distribution=distributions[peer_key_by_id[snapshot["instrumentId"]]]
        relative_raw=.6*(raw["return3m"]-number(context.get("benchmarkReturn3m")))+.4*(raw["return3m"]-distribution["industryMedian"]); factors={}
        for name in ("trend","momentum","liquidity","risk"):factors[name]=round(core._percentile_sorted(distribution[name],core._winsor_sorted(distribution[name],raw[name])),1)
        factors["relativeStrength"]=round(core._percentile_sorted(distribution["relative"],core._winsor_sorted(distribution["relative"],relative_raw)),1); factors["regime"]=80 if context.get("regime")=="RISK_ON" else 55 if context.get("regime")=="NEUTRAL" else 25; factors["structure"]=round(raw["structure"],1)
        score=round(sum(factors[name]*weight for name,weight in profile["weights"].items()),1); quality=core._quality(snapshot,raw); structure_penalty=8 if snapshot["assetType"]=="ETF" and snapshot.get("etfStructure",{}).get("missingNonCritical") else 0; confidence=max(0,min(100,96-len(quality["hardGates"])*15-len(quality["warnings"])*3-structure_penalty-(10 if snapshot.get("freshness")=="fallback" else 4 if snapshot.get("freshness")=="delayed" else 0)))
        entry_state=_entry_setup(raw,context,profile); plan=_trade_plan(snapshot,raw,entry_state,context); gates=list(quality["hardGates"]); rules=profile["gates"]
        if not(raw["current"]>raw["sma20"] and raw["current"]>raw["sma50"] and raw["current"]>raw["sma200"]):gates.append("PRICE_NOT_ABOVE_MA_SET")
        if not(raw["sma50Rising"] and raw["sma200Rising"]):gates.append("LONG_TREND_NOT_RISING")
        if not(raw["return3m"]>0 and raw["return6m"]>0):gates.append("MOMENTUM_NOT_POSITIVE")
        if factors["relativeStrength"]<rules["minimumRelativeStrength"]:gates.append("RELATIVE_STRENGTH_BELOW_PROFILE")
        entry_gate={"BLOCKED_DATA":"MARKET_CONTEXT_MISSING","BLOCKED_REGIME":"MARKET_RISK_OFF","OVEREXTENDED":"PRICE_OVEREXTENDED","WAIT_PULLBACK":"WAITING_FOR_PULLBACK","NO_SETUP":"NO_ENTRY_SETUP"}.get(entry_state)
        if entry_gate:gates.append(entry_gate)
        if not CONFIG["minimumStopPct"]<=plan["stopDistancePct"]<=CONFIG["maximumStopPct"]:gates.append("STOP_DISTANCE_OUT_OF_RANGE")
        research=score>=rules["buyScore"] and confidence>=rules["buyConfidence"]; eligible=allow_buy and research and entry_state in ("BREAKOUT_READY","PULLBACK_READY") and not gates; shock=_shock_age(raw,rules)
        setup={"entryState":entry_state,"setupType":"BREAKOUT" if entry_state=="BREAKOUT_READY" else "PULLBACK" if entry_state=="PULLBACK_READY" else "NONE","distance52WeekHighPct":round(raw["distance52WeekHighPct"],2),"distance5YearHighPct":round(raw["distance5YearHighPct"],2),"extensionAtr":round(raw["extensionAtr"],2),"breakoutLevel":round(raw["recentBreakoutLevel"] or raw["previous55High"],4),"volumeRatio":round(raw["volumeRatio"],2),"closeLocation":round(raw["closeLocation"],2),"gapAtr":round(raw["gapAtr"],2),"rangeAtr":round(raw["rangeAtr"],2),"coolingSessionsRemaining":max(0,rules["coolingSessions"]-(shock or 0)) if shock is not None else 0,"marketRegime":context.get("regime","UNKNOWN"),"marketBreadthPct":round(number(context.get("breadthPct")),1),"benchmarkSymbol":context.get("benchmarkSymbol"),"researchEligible":research}
        reasons=["TREND_CONFIRMED" if factors["trend"]>=65 else "TREND_UNCONFIRMED","MOMENTUM_LEADERSHIP" if factors["momentum"]>=65 else "MOMENTUM_MIXED","RISK_CONTROLLED" if factors["risk"]>=55 else "VOLATILITY_ELEVATED",entry_state,"PUBLIC_DATA_SHADOW",f"PROFILE_{profile['strategyFamily']}",f"GATES_{profile['gatePreset']}"]
        rows.append({**{name:snapshot[name] for name in ("instrumentId","symbol","name","market","exchange","currency","assetType")},"sector":snapshot.get("sector") or "Unclassified","price":round(number(snapshot.get("price")),4),"changePct":round(pct(number(snapshot.get("price")),number(snapshot.get("previousClose"))),2),"score":score,"confidence":round(confidence,1),"action":"BUY" if eligible else "WATCH","status":"SHADOW","freshness":snapshot.get("freshness","delayed"),"source":snapshot.get("source","public"),"capturedAt":snapshot["capturedAt"],"factors":factors,"tradePlan":plan,"entryState":entry_state,"setupMetrics":setup,"reasonCodes":reasons,"hardGates":list(dict.fromkeys(gates)),"modelVersion":MODEL_VERSION,"assetModel":"ETF_V2_2" if snapshot["assetType"]=="ETF" else "STOCK_V2_2","validationStatus":"SHADOW","configHash":profile["configHash"],"marketProfileId":profile["profileId"],"marketProfileHash":profile["configHash"],"marketProfileStatus":"SHADOW_VALIDATING","strategyFamily":profile["strategyFamily"],"gatePreset":profile["gatePreset"],"dataQuality":quality,"selection":{"eligibleBeforeCap":eligible,"bucketRank":0,"buyLimit":CONFIG["etfBuyLimitPerMarket"] if snapshot["assetType"]=="ETF" else CONFIG["stockBuyLimitPerMarket"],"capped":False}})
    rows.sort(key=lambda item:(item["market"],item["assetType"],-item["score"],item["symbol"]))
    for key in groups:
        eligible_rank=0;limit=CONFIG["etfBuyLimitPerMarket"] if key[1]=="ETF" else CONFIG["stockBuyLimitPerMarket"]
        for rank,item in enumerate([row for row in rows if (row["market"],row["assetType"])==key],1):
            item["selection"]["bucketRank"]=rank
            if item["selection"]["eligibleBeforeCap"]:
                eligible_rank+=1
                if eligible_rank>limit:item["action"]="WATCH";item["selection"]["capped"]=True;item["hardGates"].append("DAILY_SELECTION_CAP")
    return sorted(rows,key=lambda item:item["score"],reverse=True)


def model_identity():return {"modelVersion":MODEL_VERSION,"configHash":CONFIG_HASH,"config":CONFIG,"profiles":list(MARKET_PROFILES.values())}
