"""Walk-forward v2.1 provisional backtest with an exact v2.0 control run."""
from __future__ import annotations

import argparse
import bisect
import hashlib
import hmac
import json
import math
import os
import statistics
import urllib.request
from datetime import datetime, timezone

try:
    from .cache import MarketCache
    from .meridian_bridge import MARKETS, YahooClient, _snapshot, discover_universe, enrich_candidate_profiles, fetch_benchmark_snapshot, load_local_env
    from .model_v2 import rank_snapshots as rank_v20
    from .model_v21 import CONFIG_HASH, MODEL_VERSION, build_market_context, rank_snapshots as rank_v21
except ImportError:
    from cache import MarketCache
    from meridian_bridge import MARKETS, YahooClient, _snapshot, discover_universe, enrich_candidate_profiles, fetch_benchmark_snapshot, load_local_env
    from model_v2 import rank_snapshots as rank_v20
    from model_v21 import CONFIG_HASH, MODEL_VERSION, build_market_context, rank_snapshots as rank_v21

MARKET_COSTS = {
    "US":{"commissionBps":5,"sellTaxBps":0.3,"slippageBps":8}, "CN":{"commissionBps":3,"sellTaxBps":50,"slippageBps":10},
    "HK":{"commissionBps":25,"sellTaxBps":10,"slippageBps":12}, "TW":{"commissionBps":14.25,"sellTaxBps":30,"slippageBps":10},
    "JP":{"commissionBps":8,"sellTaxBps":0,"slippageBps":8}, "KR":{"commissionBps":15,"sellTaxBps":18,"slippageBps":10},
    "SG":{"commissionBps":18,"sellTaxBps":0,"slippageBps":10},
}


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
    return {**public,"bars":bars,"historicalHigh5y":prefix[index],"price":bars[-1]["close"],"previousClose":bars[-2]["close"],"capturedAt":datetime.fromtimestamp(stamp,timezone.utc).isoformat()},future


def walk_forward(snapshots, benchmark, market, candidate=True):
    """Signals at close, next-open fills, and stop-first same-day ambiguity."""
    by_symbol={item["symbol"]:item for item in snapshots}; dates=sorted(set(bar["timestamp"] for item in snapshots for bar in item["bars"]))
    split=dates[max(0,len(dates)-504)] if dates else 0; positions,trades={},[]
    for stamp in dates:
        slices=[]; next_bars={}
        for symbol,item in by_symbol.items():
            sliced,future=_slice(item,stamp)
            if sliced: slices.append(sliced); next_bars[symbol]=future
        if not slices: continue
        if candidate:
            benchmark_slice,_=_slice(benchmark,stamp)
            context=build_market_context(slices,benchmark_slice) if benchmark_slice else build_market_context(slices,None)
            ranks=rank_v21(slices,allow_buy=True,market_contexts={market:context})
        else:
            ranks=rank_v20(slices,allow_buy=True)
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
                    trades.append({**position,"exitAt":next_bar["timestamp"],"exit":round(exit_price,4),"returnPct":round((gross-fees)*100,3),"exitReason":reason,"sample":"OOS" if next_bar["timestamp"]>=split else "IS"}); del positions[rank["symbol"]]
            elif rank["action"]=="BUY" and len(positions)<10:
                entry=next_bar["open"]*(1+costs["slippageBps"]/10000); setup=rank.get("setupMetrics") or {}
                positions[rank["symbol"]]={"market":market,"assetType":rank["assetType"],"symbol":rank["symbol"],"entryAt":next_bar["timestamp"],"signalAt":stamp,"entry":round(entry,4),"stop":rank["tradePlan"]["stop"],"target1":rank["tradePlan"]["target1"],"target2":rank["tradePlan"]["target2"],"entryState":rank.get("entryState","LEGACY_V2"),"extensionAtr":setup.get("extensionAtr",0),"setupMetrics":setup,"holdingSessions":0}
    return trades


def upload(endpoint,secret,token,result):
    body=json.dumps(result,separators=(",",":"),ensure_ascii=False).encode(); timestamp=datetime.now(timezone.utc).isoformat(); signature=hmac.new(secret.encode(),timestamp.encode()+b"."+body,hashlib.sha256).hexdigest()
    headers={"Content-Type":"application/json","X-Meridian-Timestamp":timestamp,"X-Meridian-Signature":signature,"X-Idempotency-Key":"backtest-"+hashlib.sha256(body).hexdigest()[:32]}
    if token: headers["OAI-Sites-Authorization"]="Bearer "+token
    with urllib.request.urlopen(urllib.request.Request(endpoint.rstrip("/")+"/api/ingest/backtests",data=body,method="POST",headers=headers),timeout=180) as response: return json.loads(response.read().decode())


def main():
    load_local_env(); parser=argparse.ArgumentParser(); parser.add_argument("--markets",default=",".join(MARKETS)); parser.add_argument("--stocks",type=int,default=30); parser.add_argument("--etfs",type=int,default=10); parser.add_argument("--output",default="backtest-result-v2.1.json"); parser.add_argument("--endpoint",default=os.getenv("MERIDIAN_ENDPOINT")); parser.add_argument("--secret",default=os.getenv("INGEST_HMAC_SECRET")); parser.add_argument("--sites-token",default=os.getenv("OAI_SITES_BYPASS_TOKEN","")); args=parser.parse_args()
    client=YahooClient(); cache=MarketCache(); generated=datetime.now(timezone.utc).isoformat(); result={"modelVersion":MODEL_VERSION,"baselineModelVersion":"meridian-swing-v2.0.0","configHash":CONFIG_HASH,"validationStatus":"PROVISIONAL_BACKTEST","survivorshipBias":True,"generatedAt":generated,"executionPolicy":"signal-close_next-open_stop-first","markets":{}}
    candidate_all=[]; baseline_all=[]
    for market in [item for item in args.markets.split(",") if item in MARKETS]:
        candidates=discover_universe(client,market,args.stocks,args.etfs); snapshots=[]
        for item in candidates:
            try: snapshots.append(_snapshot(market,item,client.chart(item["symbol"])))
            except Exception: pass
        enrich_candidate_profiles(client,cache,snapshots,workers=6); benchmark=fetch_benchmark_snapshot(client,market)
        candidate_trades=walk_forward(snapshots,benchmark,market,True); baseline_trades=walk_forward(snapshots,benchmark,market,False)
        candidate_all.extend(candidate_trades); baseline_all.extend(baseline_trades); candidate_oos=[item for item in candidate_trades if item.get("sample")=="OOS"]; baseline_oos=[item for item in baseline_trades if item.get("sample")=="OOS"]
        metrics=_metrics(candidate_oos); baseline_metrics=_metrics(baseline_oos)
        result["markets"][market]={"metrics":metrics,"baselineMetrics":baseline_metrics,"comparison":{"drawdownReductionPct":round((abs(baseline_metrics["maxDrawdownPct"])-abs(metrics["maxDrawdownPct"]))/max(abs(baseline_metrics["maxDrawdownPct"]),.0001)*100,2),"falseBreakoutReductionPct":round((baseline_metrics["falseBreakout10dPct"]-metrics["falseBreakout10dPct"])/max(baseline_metrics["falseBreakout10dPct"],.0001)*100,2)},"allPeriodMetrics":_metrics(candidate_trades),"trades":candidate_trades,"baselineTrades":baseline_trades}
    candidate_oos=[item for item in candidate_all if item.get("sample")=="OOS"]; baseline_oos=[item for item in baseline_all if item.get("sample")=="OOS"]
    result["overall"]=_metrics(candidate_oos); result["baselineOverall"]=_metrics(baseline_oos); result["allPeriodOverall"]=_metrics(candidate_all)
    result["comparison"]={"drawdownReductionPct":round((abs(result["baselineOverall"]["maxDrawdownPct"])-abs(result["overall"]["maxDrawdownPct"]))/max(abs(result["baselineOverall"]["maxDrawdownPct"]),.0001)*100,2),"falseBreakoutReductionPct":round((result["baselineOverall"]["falseBreakout10dPct"]-result["overall"]["falseBreakout10dPct"])/max(result["baselineOverall"]["falseBreakout10dPct"],.0001)*100,2)}
    with open(args.output,"w",encoding="utf-8") as handle: json.dump(result,handle,ensure_ascii=False,indent=2)
    cache.close()
    if args.endpoint and args.secret: upload(args.endpoint,args.secret,args.sites_token,result)
    print(json.dumps({"output":args.output,"overall":result["overall"],"comparison":result["comparison"]},ensure_ascii=False))


if __name__=="__main__": main()
