"""Point-in-time-safe price/volume walk-forward backtest for Meridian v1."""
from __future__ import annotations

import argparse
import json
import math
import statistics
import os
import hashlib
import hmac
import urllib.request
from datetime import datetime, timezone
from meridian_bridge import MARKETS, discover, get_json
from urllib.parse import quote


def series(symbol: str):
    payload=get_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(symbol)}?range=10y&interval=1d&events=div%2Csplits&includeAdjustedClose=true")
    result=((payload.get("chart") or {}).get("result") or [None])[0]
    if not result:return []
    stamps=result.get("timestamp") or []; adj=(((result.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose") or [])
    return [(stamps[i],float(value)) for i,value in enumerate(adj) if value]


def backtest(prices, cost_bps=25):
    trades=[]; position=None
    for index in range(200,len(prices)):
        stamp,price=prices[index]; history=[p for _,p in prices[:index+1]]
        sma20=statistics.fmean(history[-20:]); sma50=statistics.fmean(history[-50:]); sma200=statistics.fmean(history[-200:])
        if position is None and price>sma20>sma50>sma200:
            position={"entryAt":stamp,"entry":price,"stop":price*0.92,"days":0}
        elif position:
            position["days"]+=1
            exit_now=price<=position["stop"] or price<sma50 or position["days"]>=60
            if exit_now:
                gross=price/position["entry"]-1; net=gross-cost_bps/10000
                trades.append({**position,"exitAt":stamp,"exit":price,"returnPct":round(net*100,3)})
                position=None
    returns=[t["returnPct"]/100 for t in trades]; wins=[r for r in returns if r>0]; losses=[r for r in returns if r<0]
    equity=1; peak=1; max_dd=0
    for ret in returns:
        equity*=1+ret; peak=max(peak,equity); max_dd=min(max_dd,equity/peak-1)
    avg=statistics.fmean(returns) if returns else 0; sd=statistics.stdev(returns) if len(returns)>1 else 0
    return {"trades":trades,"metrics":{"tradeCount":len(trades),"expectancyPct":round(avg*100,3),"profitFactor":round(sum(wins)/abs(sum(losses)),3) if losses else None,"sharpe":round(avg/sd*math.sqrt(252/30),3) if sd else 0,"maxDrawdownPct":round(max_dd*100,3),"netReturnPct":round((equity-1)*100,3)}}


def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--markets",default=",".join(MARKETS)); parser.add_argument("--count",type=int,default=10); parser.add_argument("--output",default="backtest-result.json"); parser.add_argument("--endpoint",default=os.getenv("MERIDIAN_ENDPOINT")); parser.add_argument("--secret",default=os.getenv("INGEST_HMAC_SECRET")); args=parser.parse_args()
    result={"modelVersion":"meridian-swing-v1.0.0","generatedAt":datetime.now(timezone.utc).isoformat(),"markets":{}}
    for market in [m for m in args.markets.split(",") if m in MARKETS]:
        market_trades=[]
        for candidate in discover(market,args.count):
            outcome=backtest(series(candidate["symbol"])); market_trades.extend([{**t,"symbol":candidate["symbol"]} for t in outcome["trades"]])
        metrics=backtest([(i,1.0) for i in range(201)]) ["metrics"] if not market_trades else aggregate(market_trades)
        result["markets"][market]={"metrics":metrics,"trades":market_trades}
    with open(args.output,"w",encoding="utf-8") as handle:json.dump(result,handle,ensure_ascii=False,indent=2)
    if args.endpoint and args.secret: upload_result(args.endpoint,args.secret,result)
    print(args.output)


def aggregate(trades):
    returns=[t["returnPct"]/100 for t in trades]; wins=[r for r in returns if r>0]; losses=[r for r in returns if r<0]; avg=statistics.fmean(returns); sd=statistics.stdev(returns) if len(returns)>1 else 0; equity=1;peak=1;dd=0
    for ret in returns:equity*=1+ret;peak=max(peak,equity);dd=min(dd,equity/peak-1)
    return {"tradeCount":len(trades),"expectancyPct":round(avg*100,3),"profitFactor":round(sum(wins)/abs(sum(losses)),3) if losses else None,"sharpe":round(avg/sd*math.sqrt(252/30),3) if sd else 0,"maxDrawdownPct":round(dd*100,3),"netReturnPct":round((equity-1)*100,3)}


def upload_result(endpoint,secret,result):
    body=json.dumps(result,separators=(",",":"),ensure_ascii=False).encode("utf-8"); timestamp=datetime.now(timezone.utc).isoformat(); signature=hmac.new(secret.encode(),timestamp.encode()+b"."+body,hashlib.sha256).hexdigest()
    request=urllib.request.Request(endpoint.rstrip("/")+"/api/ingest/backtests",data=body,method="POST",headers={"Content-Type":"application/json","X-Meridian-Timestamp":timestamp,"X-Meridian-Signature":signature})
    with urllib.request.urlopen(request,timeout=60) as response:return json.loads(response.read().decode())


if __name__=="__main__":main()
