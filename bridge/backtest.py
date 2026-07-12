"""Walk-forward provisional backtest using the exact Meridian v2 model."""
from __future__ import annotations

import argparse
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
    from .meridian_bridge import MARKETS, YahooClient, _snapshot, discover_universe, enrich_candidate_profiles, load_local_env
    from .model_v2 import CONFIG_HASH, MODEL_VERSION, rank_snapshots
except ImportError:
    from cache import MarketCache
    from meridian_bridge import MARKETS, YahooClient, _snapshot, discover_universe, enrich_candidate_profiles, load_local_env
    from model_v2 import CONFIG_HASH, MODEL_VERSION, rank_snapshots

MARKET_COSTS = {
    "US":{"commissionBps":5,"sellTaxBps":0.3,"slippageBps":8}, "CN":{"commissionBps":3,"sellTaxBps":50,"slippageBps":10},
    "HK":{"commissionBps":25,"sellTaxBps":10,"slippageBps":12}, "TW":{"commissionBps":14.25,"sellTaxBps":30,"slippageBps":10},
    "JP":{"commissionBps":8,"sellTaxBps":0,"slippageBps":8}, "KR":{"commissionBps":15,"sellTaxBps":18,"slippageBps":10},
    "SG":{"commissionBps":18,"sellTaxBps":0,"slippageBps":10},
}


def _metrics(trades, position_weight=.05):
    returns = [item["returnPct"] / 100 for item in trades]; wins = [value for value in returns if value > 0]; losses = [value for value in returns if value < 0]
    equity = peak = 1.0; drawdown = 0.0
    # Capital-first portfolio path: each completed trade contributes at most 5%.
    for value in returns: equity *= 1 + value * position_weight; peak = max(peak, equity); drawdown = min(drawdown, equity / peak - 1)
    average = statistics.fmean(returns) if returns else 0; deviation = statistics.stdev(returns) if len(returns) > 1 else 0
    return {"tradeCount":len(trades),"expectancyPct":round(average*100,3),"profitFactor":round(sum(wins)/abs(sum(losses)),3) if losses else None,"sharpe":round(average/deviation*math.sqrt(252/30),3) if deviation else 0,"maxDrawdownPct":round(drawdown*100,3),"netReturnPct":round((equity-1)*100,3),"positionWeightPct":round(position_weight*100,2)}


def walk_forward(snapshots, market):
    """Signals at close, executions at next open; stop wins same-day ambiguity."""
    by_symbol = {item["symbol"]:item for item in snapshots}; dates = sorted(set(bar["timestamp"] for item in snapshots for bar in item["bars"]))
    split = dates[max(0, len(dates) - 504)] if dates else 0; positions, trades = {}, []
    for stamp in dates:
        slices, next_bars = [], {}
        for symbol, item in by_symbol.items():
            bars = [bar for bar in item["bars"] if bar["timestamp"] <= stamp]
            future = next((bar for bar in item["bars"] if bar["timestamp"] > stamp), None)
            if len(bars) >= 252 and future:
                slices.append({**item,"bars":bars,"price":bars[-1]["close"],"previousClose":bars[-2]["close"],"capturedAt":datetime.fromtimestamp(stamp, timezone.utc).isoformat()}); next_bars[symbol] = future
        if not slices: continue
        ranks = rank_snapshots(slices, allow_buy=True); costs = MARKET_COSTS[market]
        for rank in ranks:
            next_bar = next_bars.get(rank["symbol"])
            if not next_bar: continue
            position = positions.get(rank["symbol"])
            if position:
                # Conservative ordering: if stop and target are both touched, stop fills first.
                exit_price = None; reason = None
                if next_bar["low"] <= position["stop"]: exit_price, reason = position["stop"], "STOP_FIRST"
                elif next_bar["high"] >= position["target2"]: exit_price, reason = position["target2"], "TARGET_2"
                elif rank["score"] < 50 or next_bar["timestamp"] - position["entryAt"] >= 84 * 86400: exit_price, reason = next_bar["open"], "MODEL_EXIT"
                if exit_price:
                    exit_price *= 1 - costs["slippageBps"] / 10000; gross = exit_price / position["entry"] - 1; fees = (costs["commissionBps"] * 2 + costs["sellTaxBps"]) / 10000
                    trades.append({**position,"exitAt":next_bar["timestamp"],"exit":round(exit_price,4),"returnPct":round((gross-fees)*100,3),"exitReason":reason,"sample":"OOS" if next_bar["timestamp"] >= split else "IS"}); del positions[rank["symbol"]]
            elif rank["action"] == "BUY" and len(positions) < 10:
                entry = next_bar["open"] * (1 + costs["slippageBps"] / 10000)
                positions[rank["symbol"]] = {"market":market,"assetType":rank["assetType"],"symbol":rank["symbol"],"entryAt":next_bar["timestamp"],"signalAt":stamp,"entry":round(entry,4),"stop":rank["tradePlan"]["stop"],"target1":rank["tradePlan"]["target1"],"target2":rank["tradePlan"]["target2"]}
    return trades


def upload(endpoint, secret, token, result):
    body = json.dumps(result, separators=(",", ":"), ensure_ascii=False).encode(); timestamp = datetime.now(timezone.utc).isoformat(); signature = hmac.new(secret.encode(), timestamp.encode()+b"."+body, hashlib.sha256).hexdigest()
    headers = {"Content-Type":"application/json","X-Meridian-Timestamp":timestamp,"X-Meridian-Signature":signature,"X-Idempotency-Key":"backtest-"+hashlib.sha256(body).hexdigest()[:32]}
    if token: headers["OAI-Sites-Authorization"] = "Bearer " + token
    with urllib.request.urlopen(urllib.request.Request(endpoint.rstrip("/")+"/api/ingest/backtests",data=body,method="POST",headers=headers),timeout=180) as response: return json.loads(response.read().decode())


def main():
    load_local_env(); parser = argparse.ArgumentParser(); parser.add_argument("--markets",default=",".join(MARKETS)); parser.add_argument("--stocks",type=int,default=30); parser.add_argument("--etfs",type=int,default=10); parser.add_argument("--output",default="backtest-result.json"); parser.add_argument("--endpoint",default=os.getenv("MERIDIAN_ENDPOINT")); parser.add_argument("--secret",default=os.getenv("INGEST_HMAC_SECRET")); parser.add_argument("--sites-token",default=os.getenv("OAI_SITES_BYPASS_TOKEN", "")); args=parser.parse_args()
    client = YahooClient(); cache = MarketCache(); result = {"modelVersion":MODEL_VERSION,"configHash":CONFIG_HASH,"validationStatus":"PROVISIONAL_BACKTEST","survivorshipBias":True,"generatedAt":datetime.now(timezone.utc).isoformat(),"executionPolicy":"signal-close_next-open_stop-first","markets":{}}
    all_trades=[]
    for market in [item for item in args.markets.split(",") if item in MARKETS]:
        candidates=discover_universe(client,market,args.stocks,args.etfs); snapshots=[]
        for candidate in candidates:
            try: snapshots.append(_snapshot(market,candidate,client.chart(candidate["symbol"])))
            except Exception: pass
        enrich_candidate_profiles(client,cache,snapshots,workers=6)
        trades=walk_forward(snapshots,market); all_trades.extend(trades); oos=[item for item in trades if item.get("sample") == "OOS"]
        result["markets"][market]={"metrics":_metrics(oos),"allPeriodMetrics":_metrics(trades),"trades":trades}
    result["overall"]=_metrics([item for item in all_trades if item.get("sample") == "OOS"]); result["allPeriodOverall"]=_metrics(all_trades)
    with open(args.output,"w",encoding="utf-8") as handle: json.dump(result,handle,ensure_ascii=False,indent=2)
    cache.close()
    if args.endpoint and args.secret: upload(args.endpoint,args.secret,args.sites_token,result)
    print(json.dumps({"output":args.output,"overall":result["overall"]},ensure_ascii=False))


if __name__ == "__main__": main()
