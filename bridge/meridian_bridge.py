"""Meridian market bridge.

Uses the same public market interfaces proven in stock-picker (Yahoo chart and
screener endpoints) but emits a new normalized contract. Public data is always
labelled delayed. An IBKR adapter can replace it later without changing Sites.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone

MARKETS = ("US", "CN", "HK", "TW", "JP", "KR", "SG")
REGIONS = {market: market for market in MARKETS}
CURRENCIES = {"US":"USD","CN":"CNY","HK":"HKD","TW":"TWD","JP":"JPY","KR":"KRW","SG":"SGD"}
EXCHANGES = {"US":"NASDAQ/NYSE","CN":"SSE/SZSE","HK":"HKEX","TW":"TWSE/TPEX","JP":"TSE","KR":"KRX","SG":"SGX"}
USER_AGENT = "Mozilla/5.0 MeridianResearchBridge/1.0"


def get_json(url: str, timeout: int = 12):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8-sig"))


def discover(market: str, count: int):
    query = urllib.parse.urlencode({"formatted":"false","lang":"en-US","region":REGIONS[market],"scrIds":"most_actives","count":min(50,count*2),"start":0})
    payload = get_json(f"https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?{query}")
    quotes = (((payload.get("finance") or {}).get("result") or [{}])[0].get("quotes") or [])
    result = []
    for quote in quotes:
        if quote.get("symbol") and str(quote.get("quoteType") or "").upper() in {"EQUITY","ETF"}:
            name = str(quote.get("shortName") or quote.get("longName") or quote["symbol"])
            blocked = any(term in name.lower() for term in ("leveraged","inverse","warrant","2x","3x"))
            if not blocked:
                result.append(quote)
        if len(result) >= count:
            break
    return result


def snapshot(market: str, candidate: dict):
    symbol = str(candidate["symbol"]).upper()
    encoded = urllib.parse.quote(symbol)
    payload = get_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?range=2y&interval=1d&events=div%2Csplits&includeAdjustedClose=true")
    result = (((payload.get("chart") or {}).get("result") or [None])[0])
    if not result:
        raise ValueError(f"No chart data for {symbol}")
    meta = result.get("meta") or {}
    timestamps = result.get("timestamp") or []
    quote = (((result.get("indicators") or {}).get("quote") or [{}])[0])
    adjusted = ((((result.get("indicators") or {}).get("adjclose") or [{}])[0]).get("adjclose") or [])
    bars = []
    for index, stamp in enumerate(timestamps):
        close = _number(adjusted[index] if index < len(adjusted) else None) or _at(quote.get("close"), index)
        if not close:
            continue
        bars.append({"timestamp":int(stamp),"open":_at(quote.get("open"),index) or close,"high":_at(quote.get("high"),index) or close,"low":_at(quote.get("low"),index) or close,"close":close,"volume":_at(quote.get("volume"),index) or 0})
    if len(bars) < 20:
        raise ValueError(f"Insufficient history for {symbol}")
    price = _number(meta.get("regularMarketPrice")) or bars[-1]["close"]
    previous = _number(meta.get("chartPreviousClose")) or (bars[-2]["close"] if len(bars)>1 else price)
    asset = "ETF" if str(candidate.get("quoteType")).upper()=="ETF" else "STOCK"
    return {"instrumentId":f"{market}:{symbol}","symbol":symbol,"name":candidate.get("shortName") or candidate.get("longName") or symbol,"market":market,"exchange":candidate.get("fullExchangeName") or candidate.get("exchange") or EXCHANGES[market],"currency":candidate.get("currency") or meta.get("currency") or CURRENCIES[market],"assetType":asset,"source":"Yahoo Finance public chart","freshness":"delayed","capturedAt":datetime.now(timezone.utc).isoformat(),"bars":bars,"price":price,"previousClose":previous}


def _number(value):
    try:
        result = float(value)
        return result if result == result else 0.0
    except (TypeError, ValueError):
        return 0.0


def _at(values, index):
    return _number(values[index]) if values and index < len(values) else 0.0


def collect(markets, count):
    snapshots, errors = [], []
    for market in markets:
        try:
            candidates = discover(market, count)
        except Exception as exc:  # provider failures are isolated by market
            errors.append({"market":market,"stage":"discover","error":type(exc).__name__})
            continue
        for candidate in candidates:
            try:
                snapshots.append(snapshot(market, candidate))
            except Exception as exc:
                errors.append({"market":market,"symbol":candidate.get("symbol"),"stage":"snapshot","error":type(exc).__name__})
    return snapshots, errors


def upload(endpoint, secret, snapshots, errors):
    captured_at = datetime.now(timezone.utc).isoformat()
    body = json.dumps({"provider":"public-market-bridge","capturedAt":captured_at,"snapshots":snapshots,"errors":errors}, separators=(",",":"), ensure_ascii=False).encode("utf-8")
    timestamp = captured_at
    signature = hmac.new(secret.encode("utf-8"), timestamp.encode("utf-8")+b"."+body, hashlib.sha256).hexdigest()
    request = urllib.request.Request(endpoint.rstrip("/")+"/api/ingest/snapshots", data=body, method="POST", headers={"Content-Type":"application/json","X-Meridian-Timestamp":timestamp,"X-Meridian-Signature":signature,"X-Idempotency-Key":f"public-{datetime.now(timezone.utc):%Y%m%dT%H%M}-{uuid.uuid4().hex[:8]}","User-Agent":USER_AGENT})
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.loads(response.read().decode("utf-8"))


def run_once(markets, count, endpoint, secret):
    snapshots, errors = collect(markets, count)
    if not snapshots:
        raise RuntimeError(f"No snapshots collected: {errors}")
    result = upload(endpoint, secret, snapshots, errors)
    print(json.dumps({"collected":len(snapshots),"errors":len(errors),"upload":result}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description="Meridian public market bridge")
    parser.add_argument("--endpoint", default=os.getenv("MERIDIAN_ENDPOINT"))
    parser.add_argument("--secret", default=os.getenv("INGEST_HMAC_SECRET"))
    parser.add_argument("--markets", default=",".join(MARKETS))
    parser.add_argument("--count", type=int, default=int(os.getenv("MERIDIAN_COUNT_PER_MARKET","12")))
    parser.add_argument("--loop", action="store_true", help="repeat every MERIDIAN_INTERVAL_SECONDS")
    args = parser.parse_args()
    if not args.endpoint or not args.secret:
        parser.error("--endpoint and --secret (or environment variables) are required")
    markets = [item.strip().upper() for item in args.markets.split(",") if item.strip().upper() in MARKETS]
    interval = max(300, int(os.getenv("MERIDIAN_INTERVAL_SECONDS","300")))
    while True:
        try:
            run_once(markets, args.count, args.endpoint, args.secret)
        except Exception as exc:
            print(json.dumps({"status":"error","type":type(exc).__name__,"message":str(exc)}))
        if not args.loop:
            break
        time.sleep(interval)


if __name__ == "__main__":
    main()
