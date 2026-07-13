"""Meridian v2.1 reliability-first research and entry-timing model.

The research score ranks durable strength.  A separate setup engine decides
whether the current close is an actionable breakout, an orderly pullback, or a
WATCH state.  Production scans and walk-forward backtests import this module.
"""
from __future__ import annotations

import hashlib
import bisect
import json
import math
import os
import statistics

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "model.v2.1.json")
with open(CONFIG_PATH, "r", encoding="utf-8") as _handle:
    CONFIG = json.load(_handle)
with open(CONFIG_PATH, "rb") as _handle:
    CONFIG_HASH = hashlib.sha256(_handle.read()).hexdigest()

MODEL_VERSION = CONFIG["modelVersion"]
UNKNOWN_SECTORS = {"", "unknown", "unclassified", "n/a", "none", "其他", "其它"}
BENCHMARK_SYMBOLS = {"US":"^GSPC", "CN":"000300.SS", "HK":"^HSI", "TW":"^TWII", "JP":"^N225", "KR":"^KS11", "SG":"^STI"}


def number(value, default=0.0):
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def mean(values): return statistics.fmean(values) if values else 0.0


def pct(current, previous): return (current / previous - 1) * 100 if previous and previous > 0 else 0.0


def percentile(values, target):
    if len(values) <= 1: return 50.0
    ordered = sorted(values); below = sum(value < target for value in ordered); equal = sum(value == target for value in ordered)
    return max(0.0, min(100.0, (below + max(0, equal - 1) / 2) / (len(ordered) - 1) * 100))


def winsor(values, value):
    if len(values) < 4: return value
    ordered = sorted(values); low = ordered[int((len(ordered) - 1) * .025)]; high = ordered[math.ceil((len(ordered) - 1) * .975)]
    return max(low, min(high, value))


def _percentile_sorted(ordered, target):
    if len(ordered) <= 1: return 50.0
    left=bisect.bisect_left(ordered,target); right=bisect.bisect_right(ordered,target)
    return max(0.0,min(100.0,(left+max(0,right-left-1)/2)/(len(ordered)-1)*100))


def _winsor_sorted(ordered, value):
    if len(ordered)<4: return value
    low=ordered[int((len(ordered)-1)*.025)]; high=ordered[math.ceil((len(ordered)-1)*.975)]
    return max(low,min(high,value))


def _valid_bars(snapshot):
    if snapshot.get("_barsValidated"):
        return snapshot.get("bars") or []
    bars, seen = [], set()
    for raw in snapshot.get("bars") or []:
        stamp, close = int(number(raw.get("timestamp"))), number(raw.get("close"))
        if not stamp or stamp in seen or close <= 0: continue
        seen.add(stamp); open_price = number(raw.get("open"), close); high = number(raw.get("high"), max(open_price, close)); low = number(raw.get("low"), min(open_price, close))
        bars.append({"timestamp":stamp,"open":open_price if open_price > 0 else close,"high":max(high,open_price,close),"low":min(value for value in (low,open_price,close) if value > 0),"close":close,"adjClose":number(raw.get("adjClose"),close),"volume":max(0.0,number(raw.get("volume"))),"dividend":max(0.0,number(raw.get("dividend"))),"splitRatio":number(raw.get("splitRatio"),1.0) or 1.0})
    return sorted(bars,key=lambda item:item["timestamp"])


def _sma(values, period, offset=0):
    end = len(values) - offset if offset else len(values); return mean(values[max(0,end-period):end])


def _atr(bars, period=14):
    sample = bars[-(period + 1):]
    if len(sample) < 2: return sample[-1]["close"] * .03 if sample else 0
    ranges=[]
    for index in range(1,len(sample)):
        bar,previous=sample[index],sample[index-1]
        ranges.append(max(bar["high"]-bar["low"],abs(bar["high"]-previous["close"]),abs(bar["low"]-previous["close"])))
    return mean(ranges)


def _maximum_drawdown(values):
    peak=0.0; maximum=0.0
    for value in values:
        peak=max(peak,value)
        if peak: maximum=min(maximum,value/peak-1)
    return abs(maximum*100)


def raw_factors(snapshot):
    bars=_valid_bars(snapshot); adjusted=[bar["adjClose"] for bar in bars]; adjusted_highs=[bar["high"]*bar["adjClose"]/bar["close"] for bar in bars]; closes=[bar["close"] for bar in bars]; volumes=[bar["volume"] for bar in bars]
    current=adjusted[-1] if adjusted else number(snapshot.get("price")); sma20,sma50,sma200=_sma(adjusted,20),_sma(adjusted,50),_sma(adjusted,200)
    sma50_prior,sma200_prior=_sma(adjusted,50,20),_sma(adjusted,200,20)
    trend=pct(sma20,sma50)*.35+pct(sma50,sma200)*.35+pct(sma50,sma50_prior)*.15+pct(sma200,sma200_prior)*.15
    returns=[pct(value,adjusted[index]) for index,value in enumerate(adjusted[1:])]
    volatility=(statistics.pstdev(returns[-126:]) if len(returns[-126:])>1 else 0)*math.sqrt(252)
    signal_close=adjusted[-6] if len(adjusted)>6 else current
    return1=pct(signal_close,adjusted[-26]) if len(adjusted)>26 else 0; return3=pct(signal_close,adjusted[-68]) if len(adjusted)>68 else 0; return6=pct(signal_close,adjusted[-131]) if len(adjusted)>131 else 0
    momentum_sample=returns[-131:-5] if len(returns)>6 else []
    momentum_volatility=(statistics.pstdev(momentum_sample) if len(momentum_sample)>1 else 0)*math.sqrt(252)
    momentum=(return1*.30+return3*.40+return6*.30)/max(momentum_volatility,5)*20
    downside_returns=[value for value in returns[-126:] if value<0]; downside=(statistics.pstdev(downside_returns) if len(downside_returns)>1 else 0)*math.sqrt(252)
    atr=_atr(bars); atr_pct=atr/current*100 if current else 0; maximum_drawdown=_maximum_drawdown(adjusted[-252:])
    risk=-(volatility*.45+downside*.25+maximum_drawdown*.25+atr_pct*.05)
    traded_value=mean([bar["close"]*bar["volume"] for bar in bars[-60:]]); median20=statistics.median(volumes[-20:]) if volumes[-20:] else 0
    volume_ratio=volumes[-1]/median20 if median20 else 0; liquidity=math.log10(max(1,traded_value))+volume_ratio
    previous55=max(adjusted_highs[-56:-1]) if len(adjusted_highs)>=56 else max(adjusted_highs[:-1],default=current); high252=max(adjusted_highs[-252:],default=current); high5y=max(max(adjusted_highs,default=current),number(snapshot.get("historicalHigh5y")))
    latest=bars[-1] if bars else {"open":current,"high":current,"low":current,"close":current}; previous_close=bars[-2]["close"] if len(bars)>1 else current
    extension_atr=(current-sma20)/atr if atr else 0; close_location=(latest["close"]-latest["low"])/max(latest["high"]-latest["low"],.000001)
    gap_atr=(latest["open"]-previous_close)/atr if atr else 0; range_atr=(latest["high"]-latest["low"])/atr if atr else 0
    recent_breakout_level=0.0; recent_breakout_age=None
    for index in range(max(55,len(adjusted)-20),len(adjusted)):
        prior=max(adjusted_highs[index-55:index],default=0)
        if adjusted[index]>prior:
            recent_breakout_level=prior; recent_breakout_age=len(adjusted)-1-index
    shock_age=None
    for index in range(max(1,len(bars)-CONFIG["coolingSessions"]),len(bars)):
        local_atr=_atr(bars[:index+1]); prior=bars[index-1]["close"]
        if local_atr and ((bars[index]["open"]-prior)/local_atr>CONFIG["maximumGapAtr"] or (bars[index]["high"]-bars[index]["low"])/local_atr>CONFIG["maximumRangeAtr"]): shock_age=len(bars)-1-index
    high20=max(adjusted_highs[-20:],default=current); drawdown20=abs(min(0,pct(current,high20)))
    return {"trend":trend,"momentum":momentum,"relativeStrength":return3,"liquidity":liquidity,"risk":risk,"current":current,"sma20":sma20,"sma50":sma50,"sma200":sma200,"sma50Rising":sma50>sma50_prior,"sma200Rising":sma200>sma200_prior,"return1m":return1,"return3m":return3,"return6m":return6,"return20Current":pct(current,adjusted[-21]) if len(adjusted)>21 else 0,"latestVolume":volumes[-1] if volumes else 0,"medianVolume20":median20,"volumeRatio":volume_ratio,"atr":atr,"atrPct":atr_pct,"volatility":volatility,"downside":downside,"maximumDrawdown252Pct":maximum_drawdown,"barCount":len(bars),"realOhlcv":sum(1 for bar in bars[-60:] if bar["high"]>bar["low"] and bar["volume"]>0)>=min(40,len(bars[-60:])),"previous55High":previous55,"high252":high252,"high5y":high5y,"distance52WeekHighPct":pct(current,high252),"distance5YearHighPct":pct(current,high5y),"extensionAtr":extension_atr,"closeLocation":close_location,"gapAtr":gap_atr,"rangeAtr":range_atr,"recentBreakoutLevel":recent_breakout_level,"recentBreakoutAge":recent_breakout_age,"shockAge":shock_age,"drawdown20Pct":drawdown20,"previousClose":previous_close,"swingLow10":min((bar["low"] for bar in bars[-10:]),default=current),"structure":number((snapshot.get("etfStructure") or {}).get("score"),50)}


def build_market_context(snapshots, benchmark_snapshot=None, raw_by_id=None, benchmark_raw=None):
    if not snapshots or not benchmark_snapshot: return {"available":False,"regime":"UNKNOWN","breadthPct":0,"benchmarkSymbol":None,"benchmarkReturn3m":0,"benchmarkReturn6m":0}
    benchmark=benchmark_raw if benchmark_raw is not None else raw_factors(benchmark_snapshot)
    if benchmark["barCount"]<CONFIG["minimumTradingDays"]: return {"available":False,"regime":"UNKNOWN","breadthPct":0,"benchmarkSymbol":benchmark_snapshot.get("symbol"),"benchmarkReturn3m":0,"benchmarkReturn6m":0}
    raw=[raw_by_id[item["instrumentId"]] if raw_by_id is not None else raw_factors(item) for item in snapshots]; breadth=sum(item["current"]>item["sma50"] for item in raw)/max(1,len(raw))*100
    crash=benchmark["return20Current"]<=-8 and benchmark["volatility"]>=30
    risk_off=(benchmark["current"]<benchmark["sma200"] and breadth<40) or crash
    risk_on=benchmark["current"]>benchmark["sma200"] and benchmark["sma50"]>benchmark["sma200"] and breadth>=50 and not crash
    regime="RISK_OFF" if risk_off else "RISK_ON" if risk_on else "NEUTRAL"
    return {"available":True,"regime":regime,"breadthPct":round(breadth,1),"benchmarkSymbol":benchmark_snapshot.get("symbol"),"benchmarkReturn3m":benchmark["return3m"],"benchmarkReturn6m":benchmark["return6m"],"benchmarkVolatility":round(benchmark["volatility"],2),"benchmarkAbove200":benchmark["current"]>benchmark["sma200"]}


def _quality(snapshot,raw):
    warnings=list(snapshot.get("sourceWarnings") or []); conflicts=list(snapshot.get("sourceConflicts") or []); actions=list(snapshot.get("corporateActionAnomalies") or []); missing=[]
    if raw["barCount"]<CONFIG["minimumTradingDays"]: missing.append("INSUFFICIENT_HISTORY")
    if not raw["realOhlcv"]: missing.append("NON_GENUINE_OHLCV")
    if number(snapshot.get("price"))<=0: missing.append("INVALID_PRICE")
    if snapshot.get("freshness")=="stale": missing.append("STALE_DATA")
    if snapshot.get("assetType")=="STOCK" and str(snapshot.get("sector") or "").strip().lower() in UNKNOWN_SECTORS: missing.append("SECTOR_UNKNOWN")
    if conflicts: missing.append("SOURCE_CONFLICT")
    if actions: missing.append("CORPORATE_ACTION_ANOMALY")
    if snapshot.get("assetType")=="ETF" and snapshot.get("etfStructure",{}).get("excluded"): missing.append("ETF_STRUCTURE_EXCLUDED")
    source_count=max(1,int(number(snapshot.get("sourceCount"),1))); completeness=max(0.0,100.0-len(missing)*12.5-len(warnings)*3)
    return {"completenessPct":round(completeness,1),"sourceCount":source_count,"warnings":warnings,"conflicts":conflicts,"corporateActionAnomalies":actions,"hardGates":missing}


def _entry_setup(raw,context):
    if not context.get("available"): return "BLOCKED_DATA"
    if context.get("regime")=="RISK_OFF": return "BLOCKED_REGIME"
    if raw["extensionAtr"]>CONFIG["maximumExtensionAtr"] or raw["shockAge"] is not None: return "OVEREXTENDED"
    breakout=raw["current"]>raw["previous55High"] and raw["volumeRatio"]>=CONFIG["breakoutVolumeRatio"] and raw["closeLocation"]>=CONFIG["breakoutCloseLocation"] and raw["gapAtr"]<=CONFIG["maximumGapAtr"] and raw["rangeAtr"]<=CONFIG["maximumRangeAtr"]
    if breakout and context.get("regime")=="RISK_ON": return "BREAKOUT_READY"
    reference_distance=min(abs(raw["current"]-raw["sma20"]),abs(raw["current"]-raw["recentBreakoutLevel"]) if raw["recentBreakoutLevel"] else float("inf"))/max(raw["atr"],.000001)
    pullback=raw["recentBreakoutAge"] is not None and raw["recentBreakoutAge"]>=1 and reference_distance<=CONFIG["pullbackToleranceAtr"] and raw["current"]>raw["sma50"] and raw["drawdown20Pct"]<=CONFIG["pullbackMaximumDrawdownPct"] and raw["current"]>raw["previousClose"] and raw["closeLocation"]>=CONFIG["pullbackCloseLocation"] and raw["volumeRatio"]>=1
    if pullback: return "PULLBACK_READY"
    if raw["recentBreakoutAge"] is not None: return "WAIT_PULLBACK"
    return "NO_SETUP"


def _trade_plan(snapshot,raw,entry_state,context):
    current=number(snapshot.get("price"),raw["current"]); atr=raw["atr"] or current*.03; candidates=[raw["swingLow10"],current-2.2*atr]
    if raw["recentBreakoutLevel"]: candidates.append(raw["recentBreakoutLevel"]-.5*atr)
    stop=max(value for value in candidates if 0<value<current) if any(0<value<current for value in candidates) else current-2.2*atr
    risk=max(current-stop,current*.0001); rounded=lambda value:round(value,4); max_weight=2.5 if context.get("regime")=="NEUTRAL" else 5
    return {"entryLow":rounded(current-atr*.35),"entryHigh":rounded(current+atr*.20),"invalidation":rounded(min(raw["swingLow10"],raw["recentBreakoutLevel"] or raw["swingLow10"])),"stop":rounded(stop),"target1":rounded(current+risk*1.5),"target2":rounded(current+risk*2.5),"trailingAtr":2,"rewardRisk":2.5,"rewardRiskKind":"PLANNED_R_MULTIPLE","maxWeightPct":max_weight,"riskBudgetPct":.5,"setupType":entry_state,"breakoutLevel":rounded(raw["recentBreakoutLevel"] or raw["previous55High"]),"stopDistancePct":round(risk/current*100,2) if current else 0}


def rank_snapshots(snapshots,allow_buy=True,market_contexts=None,raw_by_id=None):
    market_contexts=market_contexts or {}
    if raw_by_id is None: raw_by_id={item["instrumentId"]:raw_factors(item) for item in snapshots}
    groups={}
    for item in snapshots: groups.setdefault((item["market"],item["assetType"]),[]).append(item)
    def category(item): return (item.get("etfStructure") or {}).get("trackingCategory") if item["assetType"]=="ETF" else item.get("sector")
    peer_key_by_id={}; peer_groups={}
    for group_key,broad in groups.items():
        counts={}
        for item in broad: counts[category(item)]=counts.get(category(item),0)+1
        for item in broad:
            peer_key=(*group_key,category(item) if counts.get(category(item),0)>=8 else "__ALL__")
            peer_key_by_id[item["instrumentId"]]=peer_key
        for peer_key in set(peer_key_by_id[item["instrumentId"]] for item in broad):
            peer_groups[peer_key]=broad if peer_key[-1]=="__ALL__" else [item for item in broad if category(item)==peer_key[-1]]
    distributions={}
    for peer_key,peers in peer_groups.items():
        peer_raw=[raw_by_id[item["instrumentId"]] for item in peers]; context=market_contexts.get(peer_key[0],{})
        industry_median=statistics.median([item["return3m"] for item in peer_raw]) if peer_raw else 0
        benchmark=number(context.get("benchmarkReturn3m")); relative_values=sorted(.6*(item["return3m"]-benchmark)+.4*(item["return3m"]-industry_median) for item in peer_raw)
        distributions[peer_key]={"industryMedian":industry_median,"relative":relative_values,**{name:sorted(item[name] for item in peer_raw) for name in ("trend","momentum","liquidity","risk")}}
    rows=[]
    for snapshot in snapshots:
        raw=raw_by_id[snapshot["instrumentId"]]; context=market_contexts.get(snapshot["market"],{"available":False,"regime":"UNKNOWN","breadthPct":0,"benchmarkReturn3m":0,"benchmarkReturn6m":0}); distribution=distributions[peer_key_by_id[snapshot["instrumentId"]]]
        relative_raw=.6*(raw["return3m"]-number(context.get("benchmarkReturn3m")))+.4*(raw["return3m"]-distribution["industryMedian"])
        factors={}
        for name in ("trend","momentum","liquidity","risk"):
            values=distribution[name]; factors[name]=round(_percentile_sorted(values,_winsor_sorted(values,raw[name])),1)
        factors["relativeStrength"]=round(_percentile_sorted(distribution["relative"],_winsor_sorted(distribution["relative"],relative_raw)),1)
        factors["regime"]=80 if context.get("regime")=="RISK_ON" else 55 if context.get("regime")=="NEUTRAL" else 25
        factors["structure"]=round(raw["structure"],1)
        weights=CONFIG["etfWeights"] if snapshot["assetType"]=="ETF" else CONFIG["stockWeights"]; score=round(sum(factors[name]*weight for name,weight in weights.items()),1)
        structure_penalty=8 if snapshot["assetType"]=="ETF" and snapshot.get("etfStructure",{}).get("missingNonCritical") else 0
        quality=_quality(snapshot,raw); confidence=max(0.0,min(100.0,96-len(quality["hardGates"])*15-len(quality["warnings"])*3-structure_penalty-(10 if snapshot.get("freshness")=="fallback" else 4 if snapshot.get("freshness")=="delayed" else 0)))
        entry_state=_entry_setup(raw,context); plan=_trade_plan(snapshot,raw,entry_state,context); gates=list(quality["hardGates"])
        if not (raw["current"]>raw["sma20"] and raw["current"]>raw["sma50"] and raw["current"]>raw["sma200"]): gates.append("PRICE_NOT_ABOVE_MA_SET")
        if not (raw["sma50Rising"] and raw["sma200Rising"]): gates.append("LONG_TREND_NOT_RISING")
        if not (raw["return3m"]>0 and raw["return6m"]>0): gates.append("MOMENTUM_NOT_POSITIVE")
        if factors["relativeStrength"]<CONFIG["minimumRelativeStrength"]: gates.append("RELATIVE_STRENGTH_BELOW_70")
        entry_gate={"BLOCKED_DATA":"MARKET_CONTEXT_MISSING","BLOCKED_REGIME":"MARKET_RISK_OFF","OVEREXTENDED":"PRICE_OVEREXTENDED","WAIT_PULLBACK":"WAITING_FOR_PULLBACK","NO_SETUP":"NO_ENTRY_SETUP"}.get(entry_state)
        if entry_gate: gates.append(entry_gate)
        if not CONFIG["minimumStopPct"]<=plan["stopDistancePct"]<=CONFIG["maximumStopPct"]: gates.append("STOP_DISTANCE_OUT_OF_RANGE")
        research_eligible=score>=CONFIG["buyScore"] and confidence>=CONFIG["buyConfidence"]
        ready=entry_state in ("BREAKOUT_READY","PULLBACK_READY"); eligible=allow_buy and research_eligible and ready and not gates
        action="BUY" if eligible else "WATCH"; setup={"entryState":entry_state,"setupType":"BREAKOUT" if entry_state=="BREAKOUT_READY" else "PULLBACK" if entry_state=="PULLBACK_READY" else "NONE","distance52WeekHighPct":round(raw["distance52WeekHighPct"],2),"distance5YearHighPct":round(raw["distance5YearHighPct"],2),"extensionAtr":round(raw["extensionAtr"],2),"breakoutLevel":round(raw["recentBreakoutLevel"] or raw["previous55High"],4),"volumeRatio":round(raw["volumeRatio"],2),"closeLocation":round(raw["closeLocation"],2),"gapAtr":round(raw["gapAtr"],2),"rangeAtr":round(raw["rangeAtr"],2),"coolingSessionsRemaining":max(0,CONFIG["coolingSessions"]-(raw["shockAge"] or 0)) if raw["shockAge"] is not None else 0,"marketRegime":context.get("regime","UNKNOWN"),"marketBreadthPct":round(number(context.get("breadthPct")),1),"benchmarkSymbol":context.get("benchmarkSymbol"),"researchEligible":research_eligible}
        reasons=["TREND_CONFIRMED" if factors["trend"]>=65 else "TREND_UNCONFIRMED","MOMENTUM_LEADERSHIP" if factors["momentum"]>=65 else "MOMENTUM_MIXED","RISK_CONTROLLED" if factors["risk"]>=55 else "VOLATILITY_ELEVATED",entry_state,"PUBLIC_DATA_SHADOW"]
        if raw["current"]>raw["previous55High"] and raw["volumeRatio"]<CONFIG["breakoutVolumeRatio"]: reasons.append("BREAKOUT_VOLUME_INSUFFICIENT")
        if structure_penalty: reasons.append("ETF_STRUCTURE_INCOMPLETE")
        rows.append({**{key:snapshot[key] for key in ("instrumentId","symbol","name","market","exchange","currency","assetType")},"sector":snapshot.get("sector") or "Unclassified","price":round(number(snapshot.get("price")),4),"changePct":round(pct(number(snapshot.get("price")),number(snapshot.get("previousClose"))),2),"score":score,"confidence":round(confidence,1),"action":action,"status":"SHADOW","freshness":snapshot.get("freshness","delayed"),"source":snapshot.get("source","public"),"capturedAt":snapshot["capturedAt"],"factors":factors,"tradePlan":plan,"entryState":entry_state,"setupMetrics":setup,"reasonCodes":reasons,"hardGates":list(dict.fromkeys(gates)),"modelVersion":MODEL_VERSION,"assetModel":"ETF_V2_1" if snapshot["assetType"]=="ETF" else "STOCK_V2_1","validationStatus":"SHADOW","configHash":CONFIG_HASH,"dataQuality":quality,"selection":{"eligibleBeforeCap":eligible,"bucketRank":0,"buyLimit":CONFIG["etfBuyLimitPerMarket"] if snapshot["assetType"]=="ETF" else CONFIG["stockBuyLimitPerMarket"],"capped":False}})
    rows.sort(key=lambda item:(item["market"],item["assetType"],-item["score"],item["symbol"]))
    for key in groups:
        bucket=[item for item in rows if (item["market"],item["assetType"])==key]; eligible_rank=0; limit=CONFIG["etfBuyLimitPerMarket"] if key[1]=="ETF" else CONFIG["stockBuyLimitPerMarket"]
        for overall_rank,item in enumerate(bucket,1):
            item["selection"]["bucketRank"]=overall_rank
            if item["selection"]["eligibleBeforeCap"]:
                eligible_rank+=1
                if eligible_rank>limit: item["action"]="WATCH"; item["selection"]["capped"]=True; item["hardGates"].append("DAILY_SELECTION_CAP")
    return sorted(rows,key=lambda item:item["score"],reverse=True)


def model_identity(): return {"modelVersion":MODEL_VERSION,"configHash":CONFIG_HASH,"config":CONFIG}
