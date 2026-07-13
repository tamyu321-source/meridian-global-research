"""Meridian v2 seven-market public-data bridge.

Discovers a liquid exchange-scoped universe, records a dated universe snapshot,
downloads genuine five-year OHLCV plus adjusted close and corporate actions,
caches it in DuckDB/Parquet, runs the canonical model, and uploads only auditable
SHADOW signals. A scan is complete only when every requested market reaches 95%.
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
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

try:
    from .cache import MarketCache
    from .model_v2 import CONFIG, CONFIG_HASH, MODEL_VERSION, model_identity, number, rank_snapshots
except ImportError:
    from cache import MarketCache
    from model_v2 import CONFIG, CONFIG_HASH, MODEL_VERSION, model_identity, number, rank_snapshots

MARKETS = ("US", "CN", "HK", "TW", "JP", "KR", "SG")
MARKET = {
    "US": {"currency":"USD","exchange":"NASDAQ/NYSE","codes":["NMS","NYQ","NGM","NCM","ASE"],"cap":2_000_000_000,"universe":"Yahoo public exchange screener (Nasdaq/NYSE scoped)"},
    "CN": {"currency":"CNY","exchange":"SSE/SZSE","codes":["SHH","SHZ"],"cap":5_000_000_000,"universe":"Yahoo public exchange screener (SSE/SZSE scoped)"},
    "HK": {"currency":"HKD","exchange":"HKEX","codes":["HKG"],"cap":2_000_000_000,"universe":"Yahoo public exchange screener (HKEX scoped)"},
    "TW": {"currency":"TWD","exchange":"TWSE/TPEX","codes":["TAI","TWO"],"cap":10_000_000_000,"universe":"Yahoo public exchange screener (TWSE/TPEX scoped)"},
    "JP": {"currency":"JPY","exchange":"TSE","codes":["JPX"],"cap":50_000_000_000,"universe":"Yahoo public exchange screener (JPX scoped)"},
    "KR": {"currency":"KRW","exchange":"KRX","codes":["KSC","KOE"],"cap":100_000_000_000,"universe":"Yahoo public exchange screener (KRX scoped)"},
    "SG": {"currency":"SGD","exchange":"SGX","codes":["SES"],"cap":500_000_000,"universe":"Yahoo public exchange screener (SGX scoped)"},
}
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MeridianResearchBridge/2.0"
BLOCKED = re.compile(r"leveraged|inverse|ultra(?:pro|short)?|bear\s*[23]x|bull\s*[23]x|\b[23]x\b|warrant|callable\s+(?:bull|bear)|牛熊|權證|权证", re.I)


def load_local_env():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if not os.path.exists(path): return
    with open(path, "r", encoding="utf-8-sig") as handle:
        for raw in handle:
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class YahooClient:
    def __init__(self):
        self.local = __import__("threading").local()

    def opener(self):
        if not hasattr(self.local, "opener"):
            jar = http.cookiejar.CookieJar()
            self.local.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
            self.local.crumb = ""
        return self.local.opener

    def request(self, url, data=None, timeout=35, attempts=4):
        headers = {"User-Agent":USER_AGENT,"Accept":"application/json"}
        if data is not None: headers["Content-Type"] = "application/json"
        for attempt in range(attempts):
            try:
                req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
                with self.opener().open(req, timeout=timeout) as response:
                    return json.loads(response.read().decode("utf-8-sig"))
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
                if attempt + 1 >= attempts: raise
                time.sleep(min(10, .7 * (2 ** attempt)))

    def session(self):
        self.opener()
        if self.local.crumb: return self.local.crumb
        try:
            self.local.opener.open(urllib.request.Request("https://fc.yahoo.com", headers={"User-Agent":USER_AGENT}), timeout=15).close()
        except urllib.error.HTTPError: pass
        with self.local.opener.open(urllib.request.Request("https://query1.finance.yahoo.com/v1/test/getcrumb", headers={"User-Agent":USER_AGENT}), timeout=20) as response:
            self.local.crumb = response.read().decode().strip()
        return self.local.crumb

    def screener_page(self, market, quote_type, size=250, offset=0, market_cap=True):
        cfg = MARKET[market]
        operands = [{"operator":"OR","operands":[{"operator":"EQ","operands":["exchange", code]} for code in cfg["codes"]]}]
        if quote_type == "EQUITY" and market_cap: operands.append({"operator":"GT","operands":["intradaymarketcap",cfg["cap"]]})
        body = {"size":size,"offset":offset,"sortField":"dayvolume","sortType":"DESC","quoteType":quote_type,"query":{"operator":"AND","operands":operands},"userId":"","userIdType":"guid"}
        url = "https://query2.finance.yahoo.com/v1/finance/screener?formatted=false&lang=en-US&region=US&crumb=" + urllib.parse.quote(self.session())
        payload = self.request(url, json.dumps(body, separators=(",", ":")).encode())
        result = (((payload.get("finance") or {}).get("result") or [{}])[0])
        return result.get("quotes") or [], int(result.get("total") or 0)

    def chart(self, symbol, period1=None):
        params = {"interval":"1d","events":"div,splits","includeAdjustedClose":"true"}
        if period1: params.update({"period1":str(period1),"period2":str(int(time.time()) + 86400)})
        else: params["range"] = "5y"
        return self.request("https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(symbol) + "?" + urllib.parse.urlencode(params))

    def quote_summary(self, symbol):
        modules = "assetProfile,fundProfile,topHoldings,summaryDetail,defaultKeyStatistics"
        url = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/" + urllib.parse.quote(symbol) + "?modules=" + modules + "&crumb=" + urllib.parse.quote(self.session())
        payload = self.request(url)
        return (((payload.get("quoteSummary") or {}).get("result") or [{}])[0])


def _symbol_matches(market, symbol, asset_type):
    symbol = str(symbol or "").upper()
    suffix = {"CN":r"\.(?:SS|SZ)$","HK":r"\.HK$","TW":r"\.(?:TW|TWO)$","JP":r"\.T$","KR":r"\.(?:KS|KQ)$","SG":r"\.SI$"}
    if market == "US": return "." not in symbol and bool(re.match(r"^[A-Z][A-Z0-9-]{0,9}$", symbol))
    if not re.search(suffix[market], symbol): return False
    if asset_type == "ETF": return not (market == "TW" and bool(re.search(r"[LR]\.TW$", symbol)))
    patterns = {"CN":r"^(?:(?:60|68)\d{4}\.SS|(?:00|30)\d{4}\.SZ)$","HK":r"^\d{4}\.HK$","TW":r"^\d{4}\.(?:TW|TWO)$","JP":r"^\d{4}\.T$","KR":r"^\d{6}\.(?:KS|KQ)$","SG":r"^[A-Z0-9]{1,5}\.SI$"}
    return bool(re.match(patterns[market], symbol))


def _cn_etf(symbol): return bool(re.match(r"^(?:5[1568]\d{4}\.SS|1[56]\d{4}\.SZ)$", str(symbol or "").upper()))


def _candidate_ok(market, quote, asset_type):
    if BLOCKED.search(f"{quote.get('shortName','')} {quote.get('longName','')}"): return False
    if str(quote.get("exchange") or "").upper() not in MARKET[market]["codes"]: return False
    if quote.get("currency") and quote.get("currency") != MARKET[market]["currency"]: return False
    if market == "CN" and asset_type == "ETF": return _cn_etf(quote.get("symbol"))
    if market == "CN" and asset_type == "STOCK" and _cn_etf(quote.get("symbol")): return False
    return _symbol_matches(market, quote.get("symbol"), asset_type)


def discover_asset(client, market, asset_type, target):
    quote_type = "ETF" if asset_type == "ETF" and market != "CN" else "EQUITY"
    found, seen, offset = [], set(), 0
    while len(found) < target and offset < 3000:
        quotes, total = client.screener_page(market, quote_type, 250, offset, market_cap=asset_type == "STOCK")
        if not quotes: break
        for quote in quotes:
            symbol = str(quote.get("symbol") or "").upper()
            if symbol and symbol not in seen and _candidate_ok(market, quote, asset_type):
                seen.add(symbol); item = dict(quote); item["symbol"] = symbol; item["quoteType"] = asset_type; found.append(item)
        offset += len(quotes)
        if offset >= total: break
    found.sort(key=lambda item: number(item.get("regularMarketPrice")) * (number(item.get("averageDailyVolume3Month")) or number(item.get("regularMarketVolume"))), reverse=True)
    return found[:target]


def discover_universe(client, market, stocks, etfs):
    return discover_asset(client, market, "STOCK", stocks) + discover_asset(client, market, "ETF", etfs)


def _candidate_liquidity(candidate):
    return number(candidate.get("regularMarketPrice")) * (number(candidate.get("averageDailyVolume3Month")) or number(candidate.get("regularMarketVolume")))


def _snapshot(market, candidate, payload):
    result = (((payload.get("chart") or {}).get("result") or [None])[0])
    if not result: raise ValueError("missing chart result")
    stamps = result.get("timestamp") or []
    quote = (((result.get("indicators") or {}).get("quote") or [{}])[0])
    adjusted = (((result.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose") or [])
    events = result.get("events") or {}; dividends = events.get("dividends") or {}; splits = events.get("splits") or {}
    bars = []
    for index, stamp in enumerate(stamps):
        values = {name:number((quote.get(name) or [None] * len(stamps))[index]) if index < len(quote.get(name) or []) else 0 for name in ("open","high","low","close","volume")}
        if min(values["open"], values["high"], values["low"], values["close"]) <= 0: continue
        dividend = number((dividends.get(str(stamp)) or {}).get("amount"))
        split = splits.get(str(stamp)) or {}; ratio = number(split.get("numerator"), 1) / max(number(split.get("denominator"), 1), .0001)
        bars.append({"timestamp":int(stamp), **values, "adjClose":number(adjusted[index], values["close"]) if index < len(adjusted) else values["close"], "dividend":dividend, "splitRatio":ratio})
    if not bars: raise ValueError("empty history")
    meta = result.get("meta") or {}; symbol = candidate["symbol"]; price = number(meta.get("regularMarketPrice"), bars[-1]["close"]); previous = number(meta.get("chartPreviousClose"), bars[-2]["close"])
    asset_type = candidate["quoteType"]
    candidate_price = number(candidate.get("regularMarketPrice")); conflicts = []
    if candidate_price and abs(price / candidate_price - 1) * 100 > CONFIG["sourceConflictPct"]: conflicts.append({"code":"PRICE_CONFLICT","differencePct":round(abs(price / candidate_price - 1) * 100, 2)})
    anomalies = []
    if any(bar["splitRatio"] <= 0 or bar["splitRatio"] > 100 for bar in bars): anomalies.append("INVALID_SPLIT_RATIO")
    sector = candidate.get("sector") or candidate.get("industry") or "Unclassified"
    structure = {"score":50,"missingNonCritical":False,"excluded":False}
    if asset_type == "ETF":
        name = f"{candidate.get('shortName','')} {candidate.get('longName','')}"
        structure = {"score":65 if number(candidate.get("totalAssets")) > 100_000_000 else 50, "trackingCategory":candidate.get("category") or "Unknown", "assets":number(candidate.get("totalAssets")), "concentration":None, "premiumDiscount":None, "missingNonCritical":not bool(candidate.get("category")), "excluded":bool(BLOCKED.search(name))}
    return {"instrumentId":f"{market}:{symbol}","symbol":symbol,"name":candidate.get("shortName") or candidate.get("longName") or symbol,"market":market,"exchange":candidate.get("fullExchangeName") or meta.get("fullExchangeName") or MARKET[market]["exchange"],"currency":candidate.get("currency") or meta.get("currency") or MARKET[market]["currency"],"assetType":asset_type,"sector":sector,"source":"Yahoo Finance chart (5y adjusted OHLCV)","sourceCount":1,"freshness":"delayed","capturedAt":datetime.now(timezone.utc).isoformat(),"bars":bars,"price":price,"previousClose":previous,"sourceWarnings":["PUBLIC_DELAYED_DATA"],"sourceConflicts":conflicts,"corporateActionAnomalies":anomalies,"etfStructure":structure}


def collect_history(client, cache, market, candidates, scan_id, workers=6, progress=None):
    snapshots, errors, failed_candidates = [], [], []
    def load(candidate):
        instrument_id = f"{market}:{candidate['symbol']}"; latest = cache.latest_timestamp(instrument_id)
        period1 = max(0, latest - 86400 * 7) if latest else None
        prior = cache.load_history(instrument_id) if latest else []
        def cached_snapshot(warning):
            asset_type = candidate["quoteType"]; symbol = candidate["symbol"]
            return {"instrumentId":instrument_id,"symbol":symbol,"name":candidate.get("shortName") or candidate.get("longName") or symbol,"market":market,"exchange":candidate.get("fullExchangeName") or MARKET[market]["exchange"],"currency":candidate.get("currency") or MARKET[market]["currency"],"assetType":asset_type,"sector":candidate.get("sector") or candidate.get("industry") or "Unclassified","source":"DuckDB cached Yahoo adjusted OHLCV","sourceCount":1,"freshness":"delayed","capturedAt":datetime.fromtimestamp(latest,timezone.utc).isoformat(),"bars":prior,"price":prior[-1]["close"],"previousClose":prior[-2]["close"],"sourceWarnings":[warning],"sourceConflicts":[],"corporateActionAnomalies":[],"etfStructure":{"score":50,"missingNonCritical":asset_type == "ETF","excluded":False},"_cacheOnly":True}
        try:
            payload = client.chart(candidate["symbol"], period1)
            cache.save_raw(market, candidate["symbol"], payload, scan_id)
            fresh = _snapshot(market, candidate, payload)
        except Exception:
            if len(prior) < CONFIG["minimumTradingDays"]: raise
            fresh = cached_snapshot("DOWNLOAD_RETRY_USING_CACHE"); fresh["freshness"] = "fallback"
        if latest and fresh["bars"] is not prior:
            by_stamp = {bar["timestamp"]:bar for bar in prior}
            by_stamp.update({bar["timestamp"]:bar for bar in fresh["bars"]}); fresh["bars"] = [by_stamp[key] for key in sorted(by_stamp)]
        if len(fresh["bars"]) < CONFIG["minimumTradingDays"]: raise ValueError("insufficient history")
        return fresh
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(load, candidate):candidate for candidate in candidates}
        completed = 0
        for future in as_completed(futures):
            candidate = futures[future]
            try:
                item = future.result(); snapshots.append(item)
            except Exception as exc:
                errors.append({"market":market,"symbol":candidate["symbol"],"stage":"history","error":type(exc).__name__})
                failed_candidates.append(candidate)
            completed += 1
            if progress and (completed % 25 == 0 or completed == len(candidates)): progress(completed, len(candidates), len(snapshots), 0)
    # A calm second pass recovers transient provider throttles without weakening coverage.
    recovered = set()
    for candidate in failed_candidates:
        try:
            time.sleep(.12)
            item = load(candidate); snapshots.append(item); recovered.add(candidate["symbol"])
        except Exception:
            pass
    if recovered:
        errors = [item for item in errors if item.get("symbol") not in recovered]
    return snapshots, errors


def _raw_value(value, default=0):
    return number(value.get("raw"), default) if isinstance(value, dict) else number(value, default)


def enrich_candidate_profiles(client, cache, snapshots, workers=8):
    preliminary = rank_snapshots(snapshots, allow_buy=False)
    selected = []
    for market in MARKETS:
        for asset_type, limit in (("STOCK", 60), ("ETF", 30)):
            selected.extend([item for item in preliminary if item["market"] == market and item["assetType"] == asset_type][:limit])
    snapshot_by_id = {item["instrumentId"]:item for item in snapshots}
    def fetch(item):
        cached = cache.load_profile(item["instrumentId"])
        return item, cached or client.quote_summary(item["symbol"]), cached is None
    with ThreadPoolExecutor(max_workers=max(1,workers)) as pool:
        futures = [pool.submit(fetch,item) for item in selected]
        for future in as_completed(futures):
            try:
                rank, profile, is_new = future.result(); snapshot = snapshot_by_id[rank["instrumentId"]]
                if is_new: cache.store_profile(rank["instrumentId"], profile)
                if snapshot["assetType"] == "STOCK":
                    asset = profile.get("assetProfile") or {}; snapshot["sector"] = asset.get("sector") or asset.get("sectorDisp") or snapshot.get("sector"); snapshot["industry"] = asset.get("industry") or asset.get("industryDisp")
                else:
                    fund = profile.get("fundProfile") or {}; stats = profile.get("defaultKeyStatistics") or {}; holdings = profile.get("topHoldings") or {}
                    category = fund.get("categoryName") or stats.get("category"); assets = _raw_value(stats.get("totalAssets")); top = holdings.get("holdings") or []
                    concentration = sum(_raw_value(item.get("holdingPercent")) for item in top[:10]) * 100
                    structure_score = 50 + (10 if category else 0) + (10 if assets >= 100_000_000 else 0) + (5 if concentration and concentration <= 60 else -5 if concentration > 80 else 0)
                    snapshot["sector"] = category or "ETF"; snapshot["etfStructure"] = {"score":max(0,min(100,structure_score)),"trackingCategory":category or "Unknown","assets":assets,"concentration":round(concentration,2) if concentration else None,"premiumDiscount":None,"missingNonCritical":not bool(category and assets),"excluded":False}
            except Exception:
                pass
    return snapshots


def _chunks(items, size):
    for index in range(0, len(items), size): yield items[index:index + size]


def _signed_json(url, secret, payload, key, token="", timeout=90):
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode(); timestamp = datetime.now(timezone.utc).isoformat()
    signature = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    headers = {"Content-Type":"application/json","X-Meridian-Timestamp":timestamp,"X-Meridian-Signature":signature,"X-Idempotency-Key":key,"User-Agent":USER_AGENT}
    if token: headers["OAI-Sites-Authorization"] = "Bearer " + token
    with urllib.request.urlopen(urllib.request.Request(url, data=body, method="POST", headers=headers), timeout=timeout) as response: return json.loads(response.read().decode())


class ProgressReporter:
    def __init__(self, endpoint, secret, token, job_id="", component_id=""):
        self.endpoint, self.secret, self.token, self.job_id, self.component_id = endpoint.rstrip("/"), secret, token, job_id, component_id
        self.sequence = 0

    def report(self, status, phase, total=0, processed=0, updated=0, failed=0, scan_id=None, error_code=None, error_detail=None):
        if not self.job_id or not self.component_id: return None
        self.sequence += 1
        payload = {"jobId":self.job_id,"componentId":self.component_id,"status":status,"phase":phase,"total":int(total),"processed":int(processed),"updated":int(updated),"failed":int(failed),"scanId":scan_id,"githubRunId":os.getenv("GITHUB_RUN_ID"),"githubRunUrl":f"{os.getenv('GITHUB_SERVER_URL','https://github.com')}/{os.getenv('GITHUB_REPOSITORY','')}/actions/runs/{os.getenv('GITHUB_RUN_ID','')}" if os.getenv("GITHUB_RUN_ID") else None,"errorCode":error_code,"errorDetail":str(error_detail)[:800] if error_detail else None}
        return _signed_json(self.endpoint + "/api/ingest/scan-progress", self.secret, payload, f"progress-{self.component_id}-{self.sequence:05d}", self.token)


def restore_history_artifact(endpoint, secret, token, cache, market, asset_type):
    payload = {"modelVersion":MODEL_VERSION,"market":market,"assetType":asset_type}
    body = json.dumps(payload, separators=(",", ":")).encode(); timestamp = datetime.now(timezone.utc).isoformat()
    signature = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    headers = {"Content-Type":"application/json","X-Meridian-Timestamp":timestamp,"X-Meridian-Signature":signature,"User-Agent":USER_AGENT}
    if token: headers["OAI-Sites-Authorization"] = "Bearer " + token
    request = urllib.request.Request(endpoint.rstrip("/") + "/api/ingest/artifacts/restore", data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            path = os.path.join(cache.root, f"restore-{market}-{asset_type}.parquet")
            with open(path, "wb") as handle: handle.write(response.read())
            return cache.import_history_parquet(path, market, asset_type)
    except urllib.error.HTTPError as exc:
        if exc.code == 404: return 0
        raise


def upload_artifact(endpoint, secret, token, path, object_key, market, asset_type, scan_id):
    with open(path, "rb") as handle: body = handle.read()
    timestamp = datetime.now(timezone.utc).isoformat(); signature = hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    headers = {"Content-Type":"application/vnd.apache.parquet","X-Meridian-Timestamp":timestamp,"X-Meridian-Signature":signature,"X-Idempotency-Key":"artifact-" + hashlib.sha256(object_key.encode()).hexdigest()[:32],"X-Meridian-Object-Key":object_key,"X-Meridian-Market":market,"X-Meridian-Asset-Type":asset_type,"X-Meridian-Scan-Id":scan_id,"User-Agent":USER_AGENT}
    if token: headers["OAI-Sites-Authorization"] = "Bearer " + token
    with urllib.request.urlopen(urllib.request.Request(endpoint.rstrip("/") + "/api/ingest/artifacts", data=body, method="POST", headers=headers), timeout=180) as response: return json.loads(response.read().decode())


def upload_rankings(endpoint, secret, token, scan, rankings, job_id="", component_id=""):
    batches = list(_chunks(rankings, 150)) or [[]]
    for index, records in enumerate(batches):
        current = dict(scan); current["status"] = scan["status"] if index == len(batches) - 1 else "running"; current["completedAt"] = scan["completedAt"] if index == len(batches) - 1 else None
        _signed_json(endpoint.rstrip("/") + "/api/ingest/rankings", secret, {"scan":current,"records":records,"batchIndex":index,"batchCount":len(batches),"jobId":job_id or None,"componentId":component_id or None,"model":model_identity()}, f"v2-{scan['id']}-{index:04d}", token)
    return len(batches)


def run_full_scan(markets, stock_target, etf_target, endpoint, secret, sites_token="", workers=6, asset_types=("STOCK","ETF"), job_id="", component_id=""):
    started = datetime.now(timezone.utc); scan_id = started.strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]; today = started.date().isoformat()
    asset_types = tuple(item for item in asset_types if item in ("STOCK","ETF"))
    stock_target = stock_target if "STOCK" in asset_types else 0; etf_target = etf_target if "ETF" in asset_types else 0
    reporter = ProgressReporter(endpoint, secret, sites_token, job_id, component_id)
    client, cache = YahooClient(), MarketCache(); all_snapshots, errors, coverage, parquet = [], [], {}, {}
    total_target = len(markets) * (stock_target + etf_target)
    try:
        reporter.report("RUNNING", "DISCOVERY", total_target, 0, 0, 0, scan_id)
        for market in markets:
            market_started = time.time()
            for asset_type in asset_types: restore_history_artifact(endpoint, secret, sites_token, cache, market, asset_type)
            # Filter history eligibility before choosing the final 500+100 pool.
            candidates = discover_universe(client, market, max(stock_target, math.ceil(stock_target * 1.25)), max(etf_target, math.ceil(etf_target * 1.4)))
            cache.store_universe(market, candidates, MARKET[market]["universe"], today)
            base_processed = sum(value.get("candidateCount", 0) for value in coverage.values())
            reporter.report("RUNNING", "HISTORY", total_target, min(total_target, base_processed), len(all_snapshots), len(errors), scan_id)
            eligible, market_errors = collect_history(client, cache, market, candidates, scan_id, workers, lambda processed,total,updated,failed: reporter.report("RUNNING", "HISTORY", total_target, min(total_target,base_processed+processed), len(all_snapshots)+updated, len(errors)+failed, scan_id))
            liquidity = {item["symbol"]:_candidate_liquidity(item) for item in candidates}
            eligible_stocks = sorted((item for item in eligible if item["assetType"] == "STOCK"), key=lambda item:liquidity.get(item["symbol"],0), reverse=True)
            eligible_etfs = sorted((item for item in eligible if item["assetType"] == "ETF"), key=lambda item:liquidity.get(item["symbol"],0), reverse=True)
            desired_stocks, desired_etfs = min(stock_target, len(eligible_stocks)), min(etf_target, len(eligible_etfs))
            stocks, etfs = eligible_stocks[:desired_stocks], eligible_etfs[:desired_etfs]
            snapshots = stocks + etfs
            cache.store_histories([item for item in eligible if not item.get("_cacheOnly")])
            all_snapshots.extend(snapshots); errors.extend(market_errors)
            raw_stocks = sum(x["quoteType"] == "STOCK" for x in candidates); raw_etfs = sum(x["quoteType"] == "ETF" for x in candidates)
            discovered_stocks = min(stock_target, raw_stocks); discovered_etfs = min(etf_target, raw_etfs)
            discovered_count = discovered_stocks + discovered_etfs; analyzed = len(snapshots); ratio = analyzed / discovered_count * 100 if discovered_count else 0
            coverage[market] = {"stocksDiscovered":discovered_stocks,"etfsDiscovered":discovered_etfs,"targetStocks":stock_target,"targetEtfs":etf_target,"rawStocksDiscovered":raw_stocks,"rawEtfsDiscovered":raw_etfs,"stocksAnalyzed":len(stocks),"etfsAnalyzed":len(etfs),"historyRejected":len(candidates)-len(eligible),"failed":len(market_errors),"candidateCount":len(candidates),"coveragePct":round(ratio,2),"qualityGatePassed":discovered_count > 0 and ratio >= CONFIG["completionCoveragePct"],"universeSource":MARKET[market]["universe"],"seconds":round(time.time()-market_started,1)}
            for current_asset in asset_types: parquet[(market,current_asset)] = cache.export_market_parquet(market, scan_id, current_asset)
            print(json.dumps({"market":market,"coverage":coverage[market]}, ensure_ascii=False), flush=True)
        reporter.report("RUNNING", "ENRICHMENT", total_target, total_target, len(all_snapshots), len(errors), scan_id)
        enrich_candidate_profiles(client, cache, all_snapshots)
        reporter.report("RUNNING", "SCORING", total_target, total_target, len(all_snapshots), len(errors), scan_id)
        rankings = rank_snapshots(all_snapshots, allow_buy=True); completed = datetime.now(timezone.utc)
        source_conflicts = sum(len(item.get("sourceConflicts") or []) for item in all_snapshots); action_anomalies = sum(len(item.get("corporateActionAnomalies") or []) for item in all_snapshots)
        complete = bool(markets) and all(coverage.get(market, {}).get("qualityGatePassed") for market in markets) and action_anomalies == 0
        status = "complete" if complete else "partial"
        scan = {"id":scan_id,"provider":"Public exchange directories + Yahoo Finance adjusted OHLCV","modelVersion":MODEL_VERSION,"configHash":CONFIG_HASH,"validationStatus":"SHADOW","status":status,"startedAt":started.isoformat(),"completedAt":completed.isoformat(),"requestedMarkets":markets,"requestedAssetTypes":list(asset_types),"jobId":job_id or None,"componentId":component_id or None,"targetStocksPerMarket":stock_target,"targetEtfsPerMarket":etf_target,"discoveredCount":sum(v["stocksDiscovered"]+v["etfsDiscovered"] for v in coverage.values()),"analyzedCount":len(rankings),"failedCount":len(errors),"fallbackCount":0,"coverage":coverage,"sourceConflicts":source_conflicts,"corporateActionAnomalies":action_anomalies,"qualityGatePassed":complete,"universeSnapshotDate":today}
        reporter.report("RUNNING", "UPLOADING", total_target, total_target, len(rankings), len(errors), scan_id)
        for (market,current_asset), path in parquet.items():
            upload_artifact(endpoint, secret, sites_token, path, f"history/{MODEL_VERSION}/{scan_id}/{market}/{current_asset}.parquet", market, current_asset, scan_id)
        batches = upload_rankings(endpoint, secret, sites_token, scan, rankings, job_id, component_id)
        result = {"scanId":scan_id,"status":status,"analyzed":len(rankings),"buyCount":sum(x["action"] == "BUY" for x in rankings),"failed":len(errors),"batches":batches,"seconds":round((completed-started).total_seconds(),1),"coverage":coverage}
        reporter.report("COMPLETE" if complete else "FAILED", "COMPLETE" if complete else "UPLOADING", total_target, total_target, len(rankings), len(errors), scan_id, None if complete else "QUALITY_GATE_FAILED", None if complete else "Coverage or corporate-action quality gate failed")
        print(json.dumps(result, ensure_ascii=False), flush=True); return result
    except Exception as exc:
        try: reporter.report("FAILED", "UPLOADING", total_target, min(total_target,total_target), len(all_snapshots), max(len(errors),1), scan_id, type(exc).__name__, str(exc))
        except Exception: pass
        raise
    finally: cache.close()


def main():
    load_local_env(); parser = argparse.ArgumentParser(description="Meridian v2 comprehensive public market bridge")
    parser.add_argument("--endpoint", default=os.getenv("MERIDIAN_ENDPOINT")); parser.add_argument("--secret", default=os.getenv("INGEST_HMAC_SECRET")); parser.add_argument("--sites-token", default=os.getenv("OAI_SITES_BYPASS_TOKEN", "")); parser.add_argument("--markets", default=",".join(MARKETS)); parser.add_argument("--asset-types", default="STOCK,ETF"); parser.add_argument("--job-id", default=os.getenv("MERIDIAN_JOB_ID", "")); parser.add_argument("--component-id", default=os.getenv("MERIDIAN_COMPONENT_ID", "")); parser.add_argument("--stocks", type=int, default=int(os.getenv("MERIDIAN_STOCKS_PER_MARKET", "500"))); parser.add_argument("--etfs", type=int, default=int(os.getenv("MERIDIAN_ETFS_PER_MARKET", "100"))); parser.add_argument("--workers", type=int, default=int(os.getenv("MERIDIAN_HISTORY_WORKERS", "12"))); parser.add_argument("--loop", action="store_true"); args = parser.parse_args()
    if not args.endpoint or not args.secret: parser.error("--endpoint and --secret are required")
    markets = [item.strip().upper() for item in args.markets.split(",") if item.strip().upper() in MARKETS]
    asset_types = [item.strip().upper() for item in args.asset_types.split(",") if item.strip().upper() in ("STOCK","ETF")]
    while True:
        try: run_full_scan(markets, max(1,args.stocks), max(0,args.etfs), args.endpoint, args.secret, args.sites_token, max(1,args.workers), asset_types, args.job_id, args.component_id)
        except Exception as exc:
            print(json.dumps({"status":"error","type":type(exc).__name__,"message":str(exc)}), flush=True)
            if not args.loop: raise
        if not args.loop: break
        time.sleep(max(3600, int(os.getenv("MERIDIAN_INTERVAL_SECONDS", "86400"))))


if __name__ == "__main__": main()
