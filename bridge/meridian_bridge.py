"""Meridian full-universe public market bridge.

Discovers exchange-scoped securities, keeps the most liquid 500 stocks and
100 ETFs per market, downloads two years of adjusted daily closes in batches,
computes the versioned Meridian factors, and uploads compact auditable ranking
batches. Public data is always delayed and every signal remains SHADOW.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import http.cookiejar
import json
import math
import os
import re
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

MARKETS = ("US", "CN", "HK", "TW", "JP", "KR", "SG")
MODEL_VERSION = "meridian-swing-v1.0.0"
MARKET = {
    "US": {"currency":"USD","exchange":"NASDAQ/NYSE","codes":["NMS","NYQ","NGM","NCM","ASE"],"cap":2_000_000_000},
    "CN": {"currency":"CNY","exchange":"SSE/SZSE","codes":["SHH","SHZ"],"cap":5_000_000_000},
    "HK": {"currency":"HKD","exchange":"HKEX","codes":["HKG"],"cap":2_000_000_000},
    "TW": {"currency":"TWD","exchange":"TWSE/TPEX","codes":["TAI","TWO"],"cap":10_000_000_000},
    "JP": {"currency":"JPY","exchange":"TSE","codes":["JPX"],"cap":50_000_000_000},
    "KR": {"currency":"KRW","exchange":"KRX","codes":["KSC","KOE"],"cap":100_000_000_000},
    "SG": {"currency":"SGD","exchange":"SGX","codes":["SES"],"cap":500_000_000},
}
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MeridianResearchBridge/2.0"
BLOCKED = re.compile(r"leveraged|inverse|ultra(?:pro|short)?|bear\s*[23]x|bull\s*[23]x|\b[23]x\b|warrant|callable\s+(?:bull|bear)|牛熊|權證|权证", re.I)


def load_local_env():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8-sig") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class YahooClient:
    def __init__(self):
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.crumb = ""

    def request(self, url, data=None, timeout=25, attempts=4):
        headers = {"User-Agent":USER_AGENT,"Accept":"application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        for attempt in range(attempts):
            try:
                req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
                with self.opener.open(req, timeout=timeout) as response:
                    return json.loads(response.read().decode("utf-8-sig"))
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
                if attempt + 1 >= attempts:
                    raise
                time.sleep(min(8, 0.8 * (2 ** attempt)))

    def session(self):
        if self.crumb:
            return self.crumb
        try:
            self.opener.open(urllib.request.Request("https://fc.yahoo.com", headers={"User-Agent":USER_AGENT,"Accept":"*/*"}), timeout=20).close()
        except urllib.error.HTTPError:
            pass
        req = urllib.request.Request("https://query1.finance.yahoo.com/v1/test/getcrumb", headers={"User-Agent":USER_AGENT,"Accept":"*/*"})
        with self.opener.open(req, timeout=20) as response:
            self.crumb = response.read().decode("utf-8").strip()
        if not self.crumb:
            raise RuntimeError("Yahoo session crumb unavailable")
        return self.crumb

    def screener_page(self, market, quote_type, size=250, offset=0, market_cap=True):
        config = MARKET[market]
        operands = [{"operator":"OR","operands":[{"operator":"EQ","operands":["exchange", code]} for code in config["codes"]]}]
        if quote_type == "EQUITY" and market_cap:
            operands.append({"operator":"GT","operands":["intradaymarketcap",config["cap"]]})
        body = {"size":size,"offset":offset,"sortField":"dayvolume","sortType":"DESC","quoteType":quote_type,
                "query":{"operator":"AND","operands":operands},"userId":"","userIdType":"guid"}
        url = "https://query2.finance.yahoo.com/v1/finance/screener?formatted=false&lang=en-US&region=US&crumb=" + urllib.parse.quote(self.session())
        payload = self.request(url, json.dumps(body, separators=(",", ":")).encode("utf-8"))
        finance = payload.get("finance") or {}
        if finance.get("error"):
            raise RuntimeError(str(finance["error"]))
        result = (finance.get("result") or [{}])[0]
        return result.get("quotes") or [], int(result.get("total") or 0)

    def spark(self, symbols):
        query = urllib.parse.urlencode({"symbols":",".join(symbols),"range":"2y","interval":"1d"})
        return self.request("https://query1.finance.yahoo.com/v7/finance/spark?" + query, timeout=35)


def _number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else 0.0
    except (TypeError, ValueError):
        return 0.0


def _at(values, index):
    return _number(values[index]) if values and index < len(values) else 0.0


def _symbol_matches(market, symbol, asset_type):
    symbol = str(symbol or "").upper()
    suffix = {"CN":r"\.(?:SS|SZ)$","HK":r"\.HK$","TW":r"\.(?:TW|TWO)$","JP":r"\.T$","KR":r"\.(?:KS|KQ)$","SG":r"\.SI$"}
    if market == "US":
        return "." not in symbol and bool(re.match(r"^[A-Z][A-Z0-9-]{0,9}$", symbol))
    if not re.search(suffix[market], symbol):
        return False
    if asset_type == "ETF":
        return not (market == "TW" and bool(re.search(r"[LR]\.TW$", symbol)))
    patterns = {"CN":r"^(?:(?:60|68)\d{4}\.SS|(?:00|30)\d{4}\.SZ)$","HK":r"^\d{4}\.HK$","TW":r"^\d{4}\.(?:TW|TWO)$","JP":r"^\d{4}\.T$","KR":r"^\d{6}\.(?:KS|KQ)$","SG":r"^[A-Z0-9]{1,5}\.SI$"}
    return bool(re.match(patterns[market], symbol))


def _cn_etf_symbol(symbol):
    return bool(re.match(r"^(?:5[1568]\d{4}\.SS|1[56]\d{4}\.SZ)$", str(symbol or "").upper()))


def _candidate_ok(market, quote, asset_type):
    name = f"{quote.get('shortName','')} {quote.get('longName','')}"
    if BLOCKED.search(name):
        return False
    if str(quote.get("exchange") or "").upper() not in MARKET[market]["codes"]:
        return False
    if quote.get("currency") and quote.get("currency") != MARKET[market]["currency"]:
        return False
    if market == "CN" and asset_type == "ETF":
        return _cn_etf_symbol(quote.get("symbol"))
    if market == "CN" and asset_type == "STOCK" and _cn_etf_symbol(quote.get("symbol")):
        return False
    return _symbol_matches(market, quote.get("symbol"), asset_type)


def _liquidity(quote):
    price = _number(quote.get("regularMarketPrice"))
    volume = _number(quote.get("averageDailyVolume3Month")) or _number(quote.get("regularMarketVolume"))
    return price * volume


def discover_asset(client, market, asset_type, target):
    quote_type = "ETF" if asset_type == "ETF" and market != "CN" else "EQUITY"
    found, seen, offset = [], set(), 0
    max_pages = 12 if market == "CN" and asset_type == "ETF" else 6
    while len(found) < target and offset < 250 * max_pages:
        quotes, total = client.screener_page(market, quote_type, 250, offset, market_cap=(asset_type == "STOCK"))
        if not quotes:
            break
        for quote in quotes:
            symbol = str(quote.get("symbol") or "").upper()
            if symbol and symbol not in seen and _candidate_ok(market, quote, asset_type):
                seen.add(symbol)
                quote = dict(quote)
                quote["symbol"] = symbol
                quote["quoteType"] = "ETF" if asset_type == "ETF" else "EQUITY"
                found.append(quote)
        offset += len(quotes)
        if offset >= total:
            break
    found.sort(key=_liquidity, reverse=True)
    return found[:target]


def discover_universe(client, market, stock_target=500, etf_target=100):
    stocks = discover_asset(client, market, "STOCK", stock_target)
    etfs = discover_asset(client, market, "ETF", etf_target)
    return stocks, etfs


def _chunks(items, size):
    for index in range(0, len(items), size):
        yield items[index:index + size]


def _snapshot_from_spark(market, candidate, spark_result):
    response = ((spark_result.get("response") or [None])[0])
    if not response:
        raise ValueError("missing spark response")
    timestamps = response.get("timestamp") or []
    closes = ((((response.get("indicators") or {}).get("quote") or [{}])[0]).get("close") or [])
    meta = response.get("meta") or {}
    average_volume = _number(candidate.get("averageDailyVolume3Month")) or _number(candidate.get("regularMarketVolume"))
    bars = []
    for index, stamp in enumerate(timestamps):
        close = _at(closes, index)
        if close:
            volume = _number(candidate.get("regularMarketVolume")) if index == len(timestamps) - 1 else average_volume
            bars.append({"timestamp":int(stamp),"open":close,"high":close,"low":close,"close":close,"volume":volume})
    if len(bars) < 252:
        raise ValueError("insufficient history")
    symbol = str(candidate["symbol"]).upper()
    price = _number(meta.get("regularMarketPrice")) or _number(candidate.get("regularMarketPrice")) or bars[-1]["close"]
    previous = _number(meta.get("chartPreviousClose")) or (bars[-2]["close"] if len(bars) > 1 else price)
    asset_type = "ETF" if str(candidate.get("quoteType")).upper() == "ETF" else "STOCK"
    return {"instrumentId":f"{market}:{symbol}","symbol":symbol,"name":candidate.get("shortName") or candidate.get("longName") or meta.get("shortName") or symbol,
            "market":market,"exchange":candidate.get("fullExchangeName") or meta.get("fullExchangeName") or MARKET[market]["exchange"],
            "currency":candidate.get("currency") or meta.get("currency") or MARKET[market]["currency"],"assetType":asset_type,"sector":"Unclassified",
            "source":"Yahoo Finance full-universe screener + batch history","freshness":"delayed","capturedAt":datetime.now(timezone.utc).isoformat(),
            "bars":bars,"price":price,"previousClose":previous}


def collect_history(client, market, candidates, workers=4):
    snapshots, errors = [], []
    candidate_by_symbol = {item["symbol"]:item for item in candidates}
    batches = list(_chunks(list(candidate_by_symbol), 20))
    def load(symbols):
        return symbols, client.spark(symbols)
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = [pool.submit(load, symbols) for symbols in batches]
        for future in as_completed(futures):
            try:
                symbols, payload = future.result()
                results = {str(item.get("symbol") or "").upper():item for item in ((payload.get("spark") or {}).get("result") or [])}
                for symbol in symbols:
                    try:
                        snapshots.append(_snapshot_from_spark(market, candidate_by_symbol[symbol], results.get(symbol) or {}))
                    except Exception as exc:
                        errors.append({"market":market,"symbol":symbol,"stage":"history","error":type(exc).__name__})
            except Exception as exc:
                errors.append({"market":market,"stage":"history_batch","error":type(exc).__name__})
    return snapshots, errors


def _mean(values):
    return sum(values) / len(values) if values else 0.0


def _pct(current, previous):
    return (current / previous - 1) * 100 if previous > 0 else 0.0


def _raw(snapshot):
    closes = [bar["close"] for bar in snapshot["bars"] if bar["close"] > 0]
    volumes = [bar["volume"] for bar in snapshot["bars"]]
    current = closes[-1]
    sma20, sma50, sma200 = _mean(closes[-20:]), _mean(closes[-50:]), _mean(closes[-200:])
    slope20 = _pct(sma20, _mean(closes[-40:-20])) if len(closes) >= 40 else 0
    trend = (current / max(sma20, .0001) - 1) * 100 + (sma20 / max(sma50, .0001) - 1) * 80 + (sma50 / max(sma200, .0001) - 1) * 60 + slope20
    returns = [_pct(value, closes[index]) for index, value in enumerate(closes[1:])]
    volatility = (statistics.pstdev(returns[-126:]) if len(returns[-126:]) > 1 else 0) * math.sqrt(252)
    r1 = _pct(current, closes[-26]) if len(closes) > 26 else 0
    r3 = _pct(current, closes[-68]) if len(closes) > 68 else r1
    r6 = _pct(closes[-6], closes[-131]) if len(closes) > 131 else r3
    momentum = (r1 * .3 + r3 * .4 + r6 * .3) / max(volatility, 5) * 20
    high252 = max(closes[-252:])
    drawdown = _pct(current, high252)
    downside_values = [value for value in returns[-126:] if value < 0]
    downside = (statistics.pstdev(downside_values) if len(downside_values) > 1 else 0) * math.sqrt(252)
    risk = -(volatility * .65 + abs(drawdown) * .25 + downside * .1)
    volume20, volume60 = _mean(volumes[-20:]), _mean(volumes[-60:])
    traded = _mean([bar["close"] * bar["volume"] for bar in snapshot["bars"][-60:]])
    liquidity = math.log10(max(1, traded)) + (volume20 / volume60 if volume60 else 1)
    regime = 1 if current > sma200 and sma50 > sma200 else 0 if current > sma200 else -1
    return {"trend":trend,"momentum":momentum,"relativeStrength":r3,"liquidity":liquidity,"risk":risk,"regime":regime}


def _percentile(values, target):
    if len(values) <= 1:
        return 50.0
    ordered = sorted(values)
    below = sum(value < target for value in ordered)
    equal = sum(value == target for value in ordered)
    return max(0, min(100, (below + max(0, equal - 1) / 2) / (len(ordered) - 1) * 100))


def _winsor(values, value):
    if len(values) < 4:
        return value
    ordered = sorted(values)
    low = ordered[int((len(ordered) - 1) * .025)]
    high = ordered[math.ceil((len(ordered) - 1) * .975)]
    return max(low, min(high, value))


def _trade_plan(snapshot):
    closes = [bar["close"] for bar in snapshot["bars"]]
    current = snapshot["price"]
    moves = [abs(value - closes[index]) for index, value in enumerate(closes[1:])][-14:]
    atr = _mean(moves) or current * .03
    support = min(closes[-20:])
    stop = max(current * .88, max(support, current - atr * 2.2))
    risk = max(current - stop, current * .015)
    rnd = lambda value: round(value, 4)
    return {"entryLow":rnd(current - atr * .35),"entryHigh":rnd(current + atr * .2),"invalidation":rnd(min(stop,support)),"stop":rnd(stop),
            "target1":rnd(current + risk * 1.5),"target2":rnd(current + risk * 2.5),"trailingAtr":2,"rewardRisk":2.5,"maxWeightPct":5,"riskBudgetPct":.5}


def rank_snapshots(snapshots):
    groups = {}
    raws = {}
    for snapshot in snapshots:
        key = (snapshot["market"], snapshot["assetType"])
        groups.setdefault(key, []).append(snapshot)
        raws[snapshot["instrumentId"]] = _raw(snapshot)
    ranked = []
    for snapshot in snapshots:
        peer_raws = [raws[item["instrumentId"]] for item in groups[(snapshot["market"], snapshot["assetType"])]]
        raw = raws[snapshot["instrumentId"]]
        factors = {}
        for key in ("trend","momentum","relativeStrength","liquidity","risk"):
            values = [item[key] for item in peer_raws]
            factors[key] = round(_percentile(values, _winsor(values, raw[key])), 1)
        factors["regime"] = 80 if raw["regime"] > 0 else 55 if raw["regime"] == 0 else 25
        score = round(factors["trend"]*.25 + factors["momentum"]*.25 + factors["relativeStrength"]*.15 + factors["liquidity"]*.1 + factors["risk"]*.15 + factors["regime"]*.1, 1)
        hard = [] if len(snapshot["bars"]) >= 252 else ["INSUFFICIENT_HISTORY"]
        confidence = max(0, min(100, 94 - len(hard) * 18))
        plan = _trade_plan(snapshot)
        buy = score >= 80 and confidence >= 75 and factors["regime"] >= 55 and not hard
        action = "BUY" if buy else "WATCH" if score >= 65 else "EXIT" if score < 50 else "REDUCE" if score < 55 else "HOLD"
        reasons = ["TREND_CONFIRMED" if factors["trend"] >= 65 else "TREND_UNCONFIRMED","MOMENTUM_LEADERSHIP" if factors["momentum"] >= 65 else "MOMENTUM_MIXED",
                   "RISK_CONTROLLED" if factors["risk"] >= 55 else "VOLATILITY_ELEVATED","LIQUIDITY_ACCEPTABLE" if factors["liquidity"] >= 50 else "LIQUIDITY_THIN","IBKR_NOT_CONNECTED"]
        ranked.append({"instrumentId":snapshot["instrumentId"],"symbol":snapshot["symbol"],"name":snapshot["name"],"market":snapshot["market"],"exchange":snapshot["exchange"],
                       "currency":snapshot["currency"],"assetType":snapshot["assetType"],"sector":snapshot["sector"],"price":round(snapshot["price"],4),
                       "changePct":round(_pct(snapshot["price"],snapshot["previousClose"]),2),"score":score,"confidence":confidence,"action":action,"status":"SHADOW",
                       "freshness":"delayed","source":snapshot["source"],"capturedAt":snapshot["capturedAt"],"factors":factors,"tradePlan":plan,"reasonCodes":reasons,"hardGates":hard,"modelVersion":MODEL_VERSION})
    return sorted(ranked, key=lambda item:item["score"], reverse=True)


def _signed_request(url, secret, payload, idempotency_key, sites_token="", timeout=60):
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    timestamp = datetime.now(timezone.utc).isoformat()
    signature = hmac.new(secret.encode("utf-8"), timestamp.encode("utf-8") + b"." + body, hashlib.sha256).hexdigest()
    headers = {"Content-Type":"application/json","X-Meridian-Timestamp":timestamp,"X-Meridian-Signature":signature,"X-Idempotency-Key":idempotency_key,"User-Agent":USER_AGENT}
    if sites_token:
        headers["OAI-Sites-Authorization"] = "Bearer " + sites_token
    request = urllib.request.Request(url, data=body, method="POST", headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def upload_rankings(endpoint, secret, sites_token, scan, rankings, batch_size=150):
    batches = list(_chunks(rankings, batch_size)) or [[]]
    responses = []
    for index, records in enumerate(batches):
        current = dict(scan)
        current["status"] = scan["status"] if index == len(batches) - 1 else "running"
        if current["status"] == "running":
            current["completedAt"] = None
        payload = {"scan":current,"records":records,"batchIndex":index,"batchCount":len(batches)}
        key = f"full-{scan['id']}-{index:04d}"
        responses.append(_signed_request(endpoint.rstrip("/") + "/api/ingest/rankings", secret, payload, key, sites_token))
    return responses


def run_full_scan(markets, stock_target, etf_target, endpoint, secret, sites_token="", workers=4):
    started = datetime.now(timezone.utc)
    scan_id = started.strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    client = YahooClient()
    all_snapshots, errors, coverage = [], [], {}
    for market in markets:
        market_started = time.time()
        stocks, etfs = discover_universe(client, market, stock_target, etf_target)
        market_snapshots, market_errors = collect_history(client, market, stocks + etfs, workers)
        all_snapshots.extend(market_snapshots)
        errors.extend(market_errors)
        coverage[market] = {"stocksDiscovered":len(stocks),"etfsDiscovered":len(etfs),"stocksAnalyzed":sum(item["assetType"]=="STOCK" for item in market_snapshots),
                            "etfsAnalyzed":sum(item["assetType"]=="ETF" for item in market_snapshots),"failed":len(market_errors),"seconds":round(time.time()-market_started,1)}
        print(json.dumps({"market":market,"coverage":coverage[market]}, ensure_ascii=False), flush=True)
    rankings = rank_snapshots(all_snapshots)
    completed = datetime.now(timezone.utc)
    status = "complete" if all(coverage.get(market,{}).get("stocksAnalyzed",0) > 0 for market in markets) else "partial"
    scan = {"id":scan_id,"provider":"Yahoo Finance public full-universe bridge","modelVersion":MODEL_VERSION,"status":status,"startedAt":started.isoformat(),"completedAt":completed.isoformat(),
            "requestedMarkets":markets,"targetStocksPerMarket":stock_target,"targetEtfsPerMarket":etf_target,"discoveredCount":sum(v["stocksDiscovered"]+v["etfsDiscovered"] for v in coverage.values()),
            "analyzedCount":len(rankings),"failedCount":len(errors),"fallbackCount":0,"coverage":coverage}
    responses = upload_rankings(endpoint, secret, sites_token, scan, rankings)
    result = {"scanId":scan_id,"status":status,"analyzed":len(rankings),"failed":len(errors),"batches":len(responses),"seconds":round((completed-started).total_seconds(),1),"coverage":coverage}
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return result


def main():
    load_local_env()
    parser = argparse.ArgumentParser(description="Meridian comprehensive market bridge")
    parser.add_argument("--endpoint", default=os.getenv("MERIDIAN_ENDPOINT"))
    parser.add_argument("--secret", default=os.getenv("INGEST_HMAC_SECRET"))
    parser.add_argument("--sites-token", default=os.getenv("OAI_SITES_BYPASS_TOKEN", ""))
    parser.add_argument("--markets", default=",".join(MARKETS))
    parser.add_argument("--stocks", type=int, default=int(os.getenv("MERIDIAN_STOCKS_PER_MARKET", "500")))
    parser.add_argument("--etfs", type=int, default=int(os.getenv("MERIDIAN_ETFS_PER_MARKET", "100")))
    parser.add_argument("--workers", type=int, default=int(os.getenv("MERIDIAN_HISTORY_WORKERS", "4")))
    parser.add_argument("--loop", action="store_true", help="repeat after MERIDIAN_INTERVAL_SECONDS")
    args = parser.parse_args()
    if not args.endpoint or not args.secret:
        parser.error("--endpoint and --secret (or environment variables) are required")
    markets = [item.strip().upper() for item in args.markets.split(",") if item.strip().upper() in MARKETS]
    interval = max(3600, int(os.getenv("MERIDIAN_INTERVAL_SECONDS", "86400")))
    while True:
        try:
            run_full_scan(markets, max(1,args.stocks), max(0,args.etfs), args.endpoint, args.secret, args.sites_token, max(1,args.workers))
        except Exception as exc:
            print(json.dumps({"status":"error","type":type(exc).__name__,"message":str(exc)}), flush=True)
        if not args.loop:
            break
        time.sleep(interval)


if __name__ == "__main__":
    main()
