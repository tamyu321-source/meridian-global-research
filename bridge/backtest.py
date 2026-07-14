"""Resumable, market-sharded v2.2 market-profile comparison against v2.0."""
from __future__ import annotations

import argparse
import bisect
import glob
import hashlib
import hmac
import json
import math
import os
import statistics
import time
import urllib.request
import uuid
from datetime import datetime, timezone

try:
    from .cache import MarketCache
    from .meridian_bridge import (
        MARKETS,
        YahooClient,
        collect_history,
        discover_universe,
        enrich_candidate_profiles,
        fetch_benchmark_snapshot,
        load_local_env,
        restore_history_artifact,
    )
    from .model_v2 import rank_snapshots as rank_v20
    from .model_v2 import raw_factors as raw_v20
    from .model_v22 import CONFIG_HASH, MODEL_VERSION, MARKET_PROFILES, build_market_context, choose_calibrated_profile, market_profile, profile_candidates
    from .model_v22 import rank_snapshots as rank_v22
    from .model_v22 import raw_factors as raw_v22
except ImportError:
    from cache import MarketCache
    from meridian_bridge import (
        MARKETS,
        YahooClient,
        collect_history,
        discover_universe,
        enrich_candidate_profiles,
        fetch_benchmark_snapshot,
        load_local_env,
        restore_history_artifact,
    )
    from model_v2 import rank_snapshots as rank_v20
    from model_v2 import raw_factors as raw_v20
    from model_v22 import CONFIG_HASH, MODEL_VERSION, MARKET_PROFILES, build_market_context, choose_calibrated_profile, market_profile, profile_candidates
    from model_v22 import rank_snapshots as rank_v22
    from model_v22 import raw_factors as raw_v22

BASELINE_MODEL_VERSION = "meridian-swing-v2.0.0"
MARKET_COSTS = {
    "US":{"commissionBps":5,"sellTaxBps":0.3,"slippageBps":8}, "CN":{"commissionBps":3,"sellTaxBps":50,"slippageBps":10},
    "HK":{"commissionBps":25,"sellTaxBps":10,"slippageBps":12}, "TW":{"commissionBps":14.25,"sellTaxBps":30,"slippageBps":10},
    "JP":{"commissionBps":8,"sellTaxBps":0,"slippageBps":8}, "KR":{"commissionBps":15,"sellTaxBps":18,"slippageBps":10},
    "SG":{"commissionBps":18,"sellTaxBps":0,"slippageBps":10},
}


def _progress(stage, **details):
    print(json.dumps({"event":"BACKTEST_PROGRESS","stage":stage,"at":datetime.now(timezone.utc).isoformat(),**details}, ensure_ascii=False), flush=True)


def _metrics(trades, position_weight=.05):
    returns=[item["returnPct"]/100 for item in trades]; wins=[value for value in returns if value>0]; losses=[value for value in returns if value<0]
    equity=peak=1.0; drawdown=0.0
    for value in returns:
        equity*=1+value*position_weight; peak=max(peak,equity); drawdown=min(drawdown,equity/peak-1)
    average=statistics.fmean(returns) if returns else 0; deviation=statistics.stdev(returns) if len(returns)>1 else 0
    breakout_trades=[item for item in trades if item.get("entryState") in ("BREAKOUT_READY","LEGACY_V2")]
    false_breakouts=[item for item in breakout_trades if item.get("exitReason")=="STOP_FIRST" and item.get("holdingSessions",999)<=10]
    setups={state:len([item for item in trades if item.get("entryState")==state]) for state in ("BREAKOUT_READY","PULLBACK_READY","LEGACY_V2")}
    extension_buckets={label:len([item for item in trades if low<=float(item.get("extensionAtr",0))<high]) for label,low,high in (("<=0.5",-99,.5),("0.5-1",.5,1),("1-1.5",1,1.5),("1.5-2",1.5,2),(">=2",2,99))}
    return {"tradeCount":len(trades),"expectancyPct":round(average*100,3),"profitFactor":round(sum(wins)/abs(sum(losses)),3) if losses else None,"sharpe":round(average/deviation*math.sqrt(252/30),3) if deviation else 0,"maxDrawdownPct":round(drawdown*100,3),"netReturnPct":round((equity-1)*100,3),"positionWeightPct":round(position_weight*100,2),"falseBreakout10dPct":round(len(false_breakouts)/len(breakout_trades)*100,2) if breakout_trades else 0,"setupCounts":setups,"extensionAtrCounts":extension_buckets}


def _comparison(candidate_metrics, baseline_metrics):
    return {
        "drawdownReductionPct":round((abs(baseline_metrics["maxDrawdownPct"])-abs(candidate_metrics["maxDrawdownPct"]))/max(abs(baseline_metrics["maxDrawdownPct"]),.0001)*100,2),
        "falseBreakoutReductionPct":round((baseline_metrics["falseBreakout10dPct"]-candidate_metrics["falseBreakout10dPct"])/max(baseline_metrics["falseBreakout10dPct"],.0001)*100,2),
    }


def _slice(item, stamp):
    stamps=item.setdefault("_backtestStamps",[bar["timestamp"] for bar in item["bars"]]); index=bisect.bisect_right(stamps,stamp)-1
    if index<0 or index+1>=len(item["bars"]): return None,None
    bars=item["bars"][max(0,index-299):index+1]; future=item["bars"][index+1]
    if len(bars)<252 or not future: return None,None
    prefix=item.get("_backtestHigh5y")
    if prefix is None:
        prefix=[]; high=0
        for bar in item["bars"]:
            adjusted_high=bar["high"]*bar.get("adjClose",bar["close"])/max(bar["close"],.000001); high=max(high,adjusted_high); prefix.append(high)
        item["_backtestHigh5y"]=prefix
    public={key:value for key,value in item.items() if not key.startswith("_backtest")}
    return {**public,"bars":bars,"_barsValidated":True,"historicalHigh5y":prefix[index],"price":bars[-1]["close"],"previousClose":bars[-2]["close"],"capturedAt":datetime.fromtimestamp(stamp,timezone.utc).isoformat()},future


def _advance_positions(ranks,next_bars,positions,trades,market,signal_stamp,entry_min_stamp,sample,entry_max_stamp=None):
    costs=MARKET_COSTS[market]
    for rank in ranks:
        next_bar=next_bars.get(rank["symbol"])
        if not next_bar: continue
        position=positions.get(rank["symbol"])
        if position:
            position["holdingSessions"]+=1; exit_price=None; reason=None
            if next_bar["low"]<=position["stop"]: exit_price,reason=position["stop"],"STOP_FIRST"
            elif next_bar["high"]>=position["target2"]: exit_price,reason=position["target2"],"TARGET_2"
            elif rank["score"]<50 or position["holdingSessions"]>=60: exit_price,reason=next_bar["open"],"MODEL_EXIT"
            if exit_price:
                exit_price*=1-costs["slippageBps"]/10000; gross=exit_price/position["entry"]-1; fees=(costs["commissionBps"]*2+costs["sellTaxBps"])/10000
                trades.append({**position,"exitAt":next_bar["timestamp"],"exit":round(exit_price,4),"returnPct":round((gross-fees)*100,3),"exitReason":reason}); del positions[rank["symbol"]]
        elif rank["action"]=="BUY" and len(positions)<10 and next_bar["timestamp"]>=entry_min_stamp and (entry_max_stamp is None or next_bar["timestamp"]<entry_max_stamp):
            entry=next_bar["open"]*(1+costs["slippageBps"]/10000); setup=rank.get("setupMetrics") or {}
            positions[rank["symbol"]]={"market":market,"assetType":rank["assetType"],"symbol":rank["symbol"],"marketProfileId":rank.get("marketProfileId"),"marketProfileHash":rank.get("marketProfileHash"),"strategyFamily":rank.get("strategyFamily"),"gatePreset":rank.get("gatePreset"),"entryAt":next_bar["timestamp"],"signalAt":signal_stamp,"entry":round(entry,4),"stop":rank["tradePlan"]["stop"],"target1":rank["tradePlan"]["target1"],"target2":rank["tradePlan"]["target2"],"entryState":rank.get("entryState","LEGACY_V2"),"extensionAtr":setup.get("extensionAtr",0),"setupMetrics":setup,"holdingSessions":0,"sample":sample}


def walk_forward(snapshots, benchmark, market, candidate=True, evaluation_sessions=504, progress_every=50, profile_overrides=None):
    """Run locked OOS sessions with close signals, next-open fills and stop-first ambiguity."""
    by_symbol={item["symbol"]:item for item in snapshots}; dates=sorted(set(bar["timestamp"] for item in snapshots for bar in item["bars"]))
    if not dates: return []
    split_index=max(0,len(dates)-max(1,evaluation_sessions)); split=dates[split_index]
    start=max(0,split_index-1); evaluation_dates=dates[start:]
    positions,trades={},[]; label=MODEL_VERSION if candidate else BASELINE_MODEL_VERSION
    _progress("SIMULATION_START",market=market,modelVersion=label,sessions=max(0,len(evaluation_dates)-1),securities=len(snapshots))
    for date_index,stamp in enumerate(evaluation_dates):
        slices=[]; next_bars={}
        for symbol,item in by_symbol.items():
            sliced,future=_slice(item,stamp)
            if sliced: slices.append(sliced); next_bars[symbol]=future
        if not slices: continue
        if candidate:
            raw_by_id={item["instrumentId"]:raw_v22(item) for item in slices}
            benchmark_slice,_=_slice(benchmark,stamp)
            benchmark_raw=raw_v22(benchmark_slice) if benchmark_slice else None
            context=build_market_context(slices,benchmark_slice,raw_by_id,benchmark_raw)
            ranks=rank_v22(slices,allow_buy=True,market_contexts={market:context},raw_by_id=raw_by_id,profile_overrides=profile_overrides)
        else:
            raw_by_id={item["instrumentId"]:raw_v20(item) for item in slices}
            ranks=rank_v20(slices,allow_buy=True,raw_by_id=raw_by_id)
        _advance_positions(ranks,next_bars,positions,trades,market,stamp,split,"OOS")
        if progress_every and (date_index%progress_every==0 or date_index==len(evaluation_dates)-1):
            _progress("SIMULATION",market=market,modelVersion=label,sessionsProcessed=min(date_index+1,len(evaluation_dates)-1),sessionsTotal=max(0,len(evaluation_dates)-1),trades=len(trades),openPositions=len(positions))
    _progress("SIMULATION_COMPLETE",market=market,modelVersion=label,trades=len(trades),openPositions=len(positions))
    return trades


def calibrate_market_profiles(snapshots,benchmark,market,evaluation_sessions=504,progress_every=40):
    """Evaluate the locked 3x3 candidate grid only before the OOS split."""
    dates=sorted(set(bar["timestamp"] for item in snapshots for bar in item["bars"])); split_index=max(0,len(dates)-max(1,evaluation_sessions))
    if split_index<=252:return {},{asset:{"selectedProfileId":None,"passed":False,"candidates":{}} for asset in ("STOCK","ETF")}
    split=dates[split_index]; calibration_dates=dates[251:split_index]
    selected={}; evidence={}
    for asset_type in ("STOCK","ETF"):
        asset_snapshots=[item for item in snapshots if item["assetType"]==asset_type]
        candidates=profile_candidates(market,asset_type); positions={item["profileId"]:{} for item in candidates}; trades={item["profileId"]:[] for item in candidates}
        _progress("CALIBRATION_START",market=market,assetType=asset_type,candidates=len(candidates),sessions=len(calibration_dates),securities=len(asset_snapshots))
        for date_index,stamp in enumerate(calibration_dates):
            slices=[];next_bars={}
            for item in asset_snapshots:
                sliced,future=_slice(item,stamp)
                if sliced:slices.append(sliced);next_bars[item["symbol"]]=future
            if not slices:continue
            raw_by_id={item["instrumentId"]:raw_v22(item) for item in slices}; benchmark_slice,_=_slice(benchmark,stamp);benchmark_raw=raw_v22(benchmark_slice) if benchmark_slice else None;context=build_market_context(slices,benchmark_slice,raw_by_id,benchmark_raw)
            for profile in candidates:
                ranks=rank_v22(slices,allow_buy=True,market_contexts={market:context},raw_by_id=raw_by_id,profile_overrides={(market,asset_type):profile["profileId"]})
                _advance_positions(ranks,next_bars,positions[profile["profileId"]],trades[profile["profileId"]],market,stamp,calibration_dates[0],"CALIBRATION",split)
            if progress_every and (date_index%progress_every==0 or date_index==len(calibration_dates)-1):_progress("CALIBRATION",market=market,assetType=asset_type,sessionsProcessed=date_index+1,sessionsTotal=len(calibration_dates))
        metrics={profile_id:_metrics(values) for profile_id,values in trades.items()}; selected_id=choose_calibrated_profile(metrics); passed=selected_id is not None
        selected_profile=market_profile(market,asset_type,selected_id) if selected_id else MARKET_PROFILES[(market,asset_type)];selected[(market,asset_type)]=selected_profile["profileId"]
        evidence[asset_type]={"selectedProfileId":selected_profile["profileId"],"passed":passed,"selectionOrder":["POSITIVE_EXPECTANCY","LOWEST_DRAWDOWN","LOWEST_FALSE_BREAKOUT_10D","HIGHEST_PROFIT_FACTOR","HIGHEST_SHARPE"],"candidates":metrics}
        _progress("CALIBRATION_COMPLETE",market=market,assetType=asset_type,selectedProfileId=selected_profile["profileId"],passed=passed)
    return selected,evidence


def _average_traded_value(snapshot):
    bars=(snapshot.get("bars") or [])[-60:]
    return statistics.fmean([float(item["close"])*float(item.get("volume") or 0) for item in bars]) if bars else 0


def _restore_cache(endpoint, secret, token, cache, market):
    if not endpoint or not secret: return 0
    restored=0
    for asset_type in ("STOCK","ETF"):
        try:
            restored+=restore_history_artifact(endpoint,secret,token,cache,market,asset_type)
        except Exception as exc:
            _progress("CACHE_RESTORE_WARNING",market=market,assetType=asset_type,error=type(exc).__name__)
    return restored


def _load_market(client, cache, market, stocks, etfs, workers, endpoint, secret, token, scan_id):
    _progress("DISCOVERY",market=market,targetStocks=stocks,targetEtfs=etfs)
    candidates=discover_universe(client,market,max(stocks,math.ceil(stocks*1.25)),max(etfs,math.ceil(etfs*1.4)))
    restored=_restore_cache(endpoint,secret,token,cache,market)
    _progress("HISTORY_START",market=market,candidates=len(candidates),restoredRows=restored,workers=workers)
    def history_progress(processed,total,updated,failed):
        _progress("HISTORY",market=market,processed=processed,total=total,updated=updated,failed=failed)
    eligible,errors=collect_history(client,cache,market,candidates,scan_id,workers,history_progress)
    eligible.sort(key=_average_traded_value,reverse=True)
    selected_stocks=[item for item in eligible if item["assetType"]=="STOCK"][:stocks]
    selected_etfs=[item for item in eligible if item["assetType"]=="ETF"][:etfs]
    snapshots=selected_stocks+selected_etfs
    if not snapshots: raise RuntimeError(f"No eligible {market} history")
    _progress("ENRICHMENT",market=market,securities=len(snapshots),historyErrors=len(errors))
    enrich_candidate_profiles(client,cache,snapshots,workers=min(8,workers))
    benchmark=fetch_benchmark_snapshot(client,market)
    _progress("HISTORY_COMPLETE",market=market,securities=len(snapshots),stocks=len(selected_stocks),etfs=len(selected_etfs),historyErrors=len(errors))
    return snapshots,benchmark,errors


def _base_result(generated=None):
    return {"modelVersion":MODEL_VERSION,"baselineModelVersion":BASELINE_MODEL_VERSION,"configHash":CONFIG_HASH,"validationStatus":"PROVISIONAL_BACKTEST","survivorshipBias":True,"generatedAt":generated or datetime.now(timezone.utc).isoformat(),"executionPolicy":"signal-close_next-open_stop-first","evaluationWindow":"LOCKED_OOS_LAST_504_SESSIONS","markets":{}}


def _market_result(market, snapshots, candidate_trades, baseline_trades, errors, seconds, selected_profiles=None, calibration=None):
    candidate_oos=[item for item in candidate_trades if item.get("sample")=="OOS"]; baseline_oos=[item for item in baseline_trades if item.get("sample")=="OOS"]
    metrics=_metrics(candidate_oos); baseline_metrics=_metrics(baseline_oos)
    asset_buckets={}
    for asset in ("STOCK","ETF"):
        current=[item for item in candidate_oos if item.get("assetType")==asset]; baseline=[item for item in baseline_oos if item.get("assetType")==asset]; profile=market_profile(market,asset,(selected_profiles or {}).get((market,asset)))
        asset_buckets[asset]={"profileId":profile["profileId"],"configHash":profile["configHash"],"strategyFamily":profile["strategyFamily"],"gatePreset":profile["gatePreset"],"calibration":(calibration or {}).get(asset),"calibrationPassed":bool((calibration or {}).get(asset,{}).get("passed")),"metrics":_metrics(current),"baselineMetrics":_metrics(baseline),"comparison":_comparison(_metrics(current),_metrics(baseline))}
    return {"metrics":metrics,"baselineMetrics":baseline_metrics,"comparison":_comparison(metrics,baseline_metrics),"assetBuckets":asset_buckets,"allPeriodMetrics":_metrics(candidate_trades),"trades":candidate_trades,"baselineTrades":baseline_trades,"dataQuality":{"securities":len(snapshots),"historyErrors":len(errors)},"durationSeconds":round(seconds,1)}


def _finalize(result):
    candidate_all=[]; baseline_all=[]
    for item in result["markets"].values():
        candidate_all.extend(item.get("trades") or []); baseline_all.extend(item.get("baselineTrades") or [])
    candidate_oos=[item for item in candidate_all if item.get("sample")=="OOS"]; baseline_oos=[item for item in baseline_all if item.get("sample")=="OOS"]
    result["overall"]=_metrics(candidate_oos); result["baselineOverall"]=_metrics(baseline_oos); result["allPeriodOverall"]=_metrics(candidate_all); result["comparison"]=_comparison(result["overall"],result["baselineOverall"])
    return result


def merge_shards(paths):
    result=_base_result(); seen=set()
    for path in sorted(paths):
        with open(path,"r",encoding="utf-8") as handle: shard=json.load(handle)
        if shard.get("modelVersion")!=MODEL_VERSION or shard.get("baselineModelVersion")!=BASELINE_MODEL_VERSION: raise ValueError(f"Incompatible shard: {path}")
        for market,item in (shard.get("markets") or {}).items():
            if market in seen: raise ValueError(f"Duplicate market shard: {market}")
            if market not in MARKETS: raise ValueError(f"Unknown market shard: {market}")
            seen.add(market); result["markets"][market]=item
    if not seen: raise ValueError("No market shards found")
    result["shards"]={"completedMarkets":sorted(seen),"expectedMarkets":list(MARKETS),"complete":seen==set(MARKETS)}
    return _finalize(result)


def upload(endpoint,secret,token,result):
    if set(result.get("markets") or {})!=set(MARKETS): raise ValueError("Refusing to publish an incomplete seven-market backtest")
    body=json.dumps(result,separators=(",",":"),ensure_ascii=False).encode(); timestamp=datetime.now(timezone.utc).isoformat(); signature=hmac.new(secret.encode(),timestamp.encode()+b"."+body,hashlib.sha256).hexdigest()
    headers={"Content-Type":"application/json","X-Meridian-Timestamp":timestamp,"X-Meridian-Signature":signature,"X-Idempotency-Key":"backtest-"+hashlib.sha256(body).hexdigest()[:32]}
    if token: headers["OAI-Sites-Authorization"]="Bearer "+token
    with urllib.request.urlopen(urllib.request.Request(endpoint.rstrip("/")+"/api/ingest/backtests",data=body,method="POST",headers=headers),timeout=180) as response: return json.loads(response.read().decode())


def _write_result(path,result):
    parent=os.path.dirname(os.path.abspath(path)); os.makedirs(parent,exist_ok=True)
    with open(path,"w",encoding="utf-8") as handle: json.dump(result,handle,ensure_ascii=False,indent=2)


def main():
    load_local_env(); parser=argparse.ArgumentParser()
    parser.add_argument("--markets",default=",".join(MARKETS)); parser.add_argument("--stocks",type=int,default=30); parser.add_argument("--etfs",type=int,default=10); parser.add_argument("--workers",type=int,default=12); parser.add_argument("--evaluation-sessions",type=int,default=504)
    parser.add_argument("--output",default="backtest-result-v2.2.json"); parser.add_argument("--aggregate-dir"); parser.add_argument("--no-upload",action="store_true")
    parser.add_argument("--endpoint",default=os.getenv("MERIDIAN_ENDPOINT")); parser.add_argument("--secret",default=os.getenv("INGEST_HMAC_SECRET")); parser.add_argument("--sites-token",default=os.getenv("OAI_SITES_BYPASS_TOKEN","")); args=parser.parse_args()
    if args.aggregate_dir:
        paths=glob.glob(os.path.join(args.aggregate_dir,"**","market-*.json"),recursive=True); _progress("AGGREGATING",files=len(paths)); result=merge_shards(paths)
    else:
        requested=[item.strip().upper() for item in args.markets.split(",") if item.strip().upper() in MARKETS]
        if not requested: parser.error("--markets must contain at least one supported market")
        result=_base_result(); client=YahooClient(); cache=MarketCache(); scan_id=f"backtest-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
        try:
            for market in requested:
                started=time.perf_counter(); snapshots,benchmark,errors=_load_market(client,cache,market,max(1,args.stocks),max(0,args.etfs),max(1,args.workers),args.endpoint,args.secret,args.sites_token,scan_id)
                selected_profiles,calibration=calibrate_market_profiles(snapshots,benchmark,market,max(1,args.evaluation_sessions));candidate_trades=walk_forward(snapshots,benchmark,market,True,max(1,args.evaluation_sessions),profile_overrides=selected_profiles); baseline_trades=walk_forward(snapshots,benchmark,market,False,max(1,args.evaluation_sessions))
                result["markets"][market]=_market_result(market,snapshots,candidate_trades,baseline_trades,errors,time.perf_counter()-started,selected_profiles,calibration); _progress("MARKET_COMPLETE",market=market,seconds=result["markets"][market]["durationSeconds"],candidateTrades=len(candidate_trades),baselineTrades=len(baseline_trades))
            _finalize(result)
        finally:
            cache.close()
    _write_result(args.output,result)
    if args.endpoint and args.secret and not args.no_upload:
        _progress("UPLOADING",markets=sorted(result["markets"])); upload(args.endpoint,args.secret,args.sites_token,result); _progress("UPLOAD_COMPLETE",markets=len(result["markets"]))
    print(json.dumps({"output":args.output,"markets":sorted(result["markets"]),"overall":result["overall"],"comparison":result["comparison"]},ensure_ascii=False),flush=True)


if __name__=="__main__": main()
