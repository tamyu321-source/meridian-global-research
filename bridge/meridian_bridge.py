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
import random
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

try:
    from .cache import MarketCache
    from . import model_v2, model_v21, model_v22
    from .signed_request import is_retryable_request_error, signed_json as _signed_json
except ImportError:
    from cache import MarketCache
    import model_v2
    import model_v21
    import model_v22
    from signed_request import is_retryable_request_error, signed_json as _signed_json

SUPPORTED_MODELS = {
    model_v2.MODEL_VERSION: model_v2,
    model_v21.MODEL_VERSION: model_v21,
    model_v22.MODEL_VERSION: model_v22,
}
MODEL_MODULE = model_v22
BENCHMARK_SYMBOLS = model_v22.BENCHMARK_SYMBOLS
build_market_context = model_v22.build_market_context


def _select_model(model_version):
    """Select one canonical production model for the lifetime of this process."""
    global MODEL_MODULE, CONFIG, CONFIG_HASH, MODEL_VERSION, model_identity, number, rank_snapshots, raw_factors, build_market_context, BENCHMARK_SYMBOLS
    try:
        module = SUPPORTED_MODELS[model_version]
    except KeyError as exc:
        raise ValueError(f"Unsupported model version: {model_version}") from exc
    MODEL_MODULE = module
    CONFIG = module.CONFIG
    CONFIG_HASH = module.CONFIG_HASH
    MODEL_VERSION = module.MODEL_VERSION
    model_identity = module.model_identity
    number = module.number
    rank_snapshots = module.rank_snapshots
    raw_factors = module.raw_factors
    build_market_context = getattr(module,"build_market_context",model_v21.build_market_context)
    BENCHMARK_SYMBOLS = getattr(module,"BENCHMARK_SYMBOLS",model_v21.BENCHMARK_SYMBOLS)
    return module


_select_model(model_v22.MODEL_VERSION)

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
YAHOO_RETRYABLE_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})


class InsufficientHistoryError(ValueError):
    """The instrument is valid but cannot enter the 252-session universe."""


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
    def __init__(self, min_interval=.25):
        self.local = threading.local()
        self.min_interval = max(0.0, float(min_interval))
        self.rate_lock = threading.Lock()
        self.session_lock = threading.Lock()
        self.next_request_at = 0.0

    def _wait_for_slot(self):
        with self.rate_lock:
            now = time.monotonic()
            wait = max(0.0, self.next_request_at - now)
            self.next_request_at = max(now, self.next_request_at) + self.min_interval + random.uniform(0, .04)
        if wait:
            time.sleep(wait)

    def _defer(self, seconds):
        with self.rate_lock:
            self.next_request_at = max(self.next_request_at, time.monotonic() + max(0.0, float(seconds)))

    @staticmethod
    def _retryable(exc):
        if isinstance(exc, urllib.error.HTTPError):
            return exc.code in YAHOO_RETRYABLE_STATUSES
        return isinstance(exc, (urllib.error.URLError, TimeoutError, json.JSONDecodeError))

    @staticmethod
    def _retry_delay(exc, attempt):
        retry_after = exc.headers.get("Retry-After") if isinstance(exc, urllib.error.HTTPError) and exc.headers else None
        try:
            explicit = max(0.0, float(retry_after))
        except (TypeError, ValueError):
            explicit = 0.0
        base = 2.0 if isinstance(exc, urllib.error.HTTPError) and exc.code == 429 else .75
        return min(30.0, max(explicit, base * (2 ** attempt)) + random.uniform(0, .35))

    def opener(self):
        if not hasattr(self.local, "opener"):
            jar = http.cookiejar.CookieJar()
            self.local.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
            self.local.crumb = ""
        return self.local.opener

    def request(self, url, data=None, timeout=35, attempts=6):
        headers = {"User-Agent":USER_AGENT,"Accept":"application/json"}
        if data is not None: headers["Content-Type"] = "application/json"
        for attempt in range(max(1, attempts)):
            try:
                self._wait_for_slot()
                req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
                with self.opener().open(req, timeout=timeout) as response:
                    return json.loads(response.read().decode("utf-8-sig"))
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
                if attempt + 1 >= max(1, attempts) or not self._retryable(exc):
                    raise
                delay = self._retry_delay(exc, attempt)
                if isinstance(exc, urllib.error.HTTPError) and exc.code == 429:
                    self._defer(delay)
                else:
                    time.sleep(delay)

    def session(self):
        self.opener()
        if self.local.crumb: return self.local.crumb
        # Yahoo associates the crumb with a cookie. Serialize session creation
        # so worker threads do not stampede the public session endpoints.
        with self.session_lock:
            if self.local.crumb: return self.local.crumb
            for attempt in range(6):
                try:
                    self._wait_for_slot()
                    try:
                        self.local.opener.open(urllib.request.Request("https://fc.yahoo.com", headers={"User-Agent":USER_AGENT}), timeout=15).close()
                    except urllib.error.HTTPError as exc:
                        if exc.code not in (400, 404): raise
                    self._wait_for_slot()
                    with self.local.opener.open(urllib.request.Request("https://query1.finance.yahoo.com/v1/test/getcrumb", headers={"User-Agent":USER_AGENT}), timeout=20) as response:
                        crumb = response.read().decode().strip()
                    if not crumb or "<" in crumb: raise ValueError("invalid Yahoo crumb")
                    self.local.crumb = crumb
                    return crumb
                except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as exc:
                    if attempt + 1 >= 6 or not (isinstance(exc, ValueError) or self._retryable(exc)): raise
                    delay = self._retry_delay(exc, attempt)
                    if isinstance(exc, urllib.error.HTTPError) and exc.code == 429:
                        self._defer(delay)
                    else:
                        time.sleep(delay)
        raise RuntimeError("Yahoo session unavailable")

    def screener_page(self, market, quote_type, size=250, offset=0, market_cap=True):
        cfg = MARKET[market]
        operands = [{"operator":"OR","operands":[{"operator":"EQ","operands":["exchange", code]} for code in cfg["codes"]]}]
        if quote_type == "EQUITY" and market_cap: operands.append({"operator":"GT","operands":["intradaymarketcap",cfg["cap"]]})
        body = {"size":size,"offset":offset,"sortField":"dayvolume","sortType":"DESC","quoteType":quote_type,"query":{"operator":"AND","operands":operands},"userId":"","userIdType":"guid"}
        url = "https://query2.finance.yahoo.com/v1/finance/screener?formatted=false&lang=en-US&region=US&crumb=" + urllib.parse.quote(self.session())
        payload = self.request(url, json.dumps(body, separators=(",", ":")).encode())
        result = (((payload.get("finance") or {}).get("result") or [{}])[0])
        return result.get("quotes") or [], int(result.get("total") or 0)

    def chart(self, symbol, period1=None, attempts=6):
        params = {"interval":"1d","events":"div,splits","includeAdjustedClose":"true"}
        if period1: params.update({"period1":str(period1),"period2":str(int(time.time()) + 86400)})
        else: params["range"] = "5y"
        return self.request("https://query1.finance.yahoo.com/v8/finance/chart/" + urllib.parse.quote(symbol) + "?" + urllib.parse.urlencode(params), attempts=attempts)

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


def fetch_benchmark_snapshot(client, market):
    symbol = BENCHMARK_SYMBOLS[market]
    candidate = {"symbol":symbol,"shortName":f"{market} benchmark","quoteType":"STOCK","sector":"Market benchmark","currency":MARKET[market]["currency"],"fullExchangeName":MARKET[market]["exchange"]}
    return _snapshot(market, candidate, client.chart(symbol))


def collect_history(client, cache, market, candidates, scan_id, workers=6, progress=None):
    snapshots, errors_by_symbol, failed_candidates = [], {}, []
    def history_error(candidate, exc):
        insufficient = isinstance(exc, InsufficientHistoryError)
        return {"market":market,"symbol":candidate["symbol"],"assetType":candidate["quoteType"],"stage":"history","error":type(exc).__name__,"code":"INSUFFICIENT_HISTORY" if insufficient else "HISTORY_FETCH_FAILED"}
    def load(candidate, attempts=6):
        instrument_id = f"{market}:{candidate['symbol']}"; latest = cache.latest_timestamp(instrument_id)
        period1 = max(0, latest - 86400 * 7) if latest else None
        prior = cache.load_history(instrument_id) if latest else []
        def cached_snapshot(warning):
            asset_type = candidate["quoteType"]; symbol = candidate["symbol"]
            return {"instrumentId":instrument_id,"symbol":symbol,"name":candidate.get("shortName") or candidate.get("longName") or symbol,"market":market,"exchange":candidate.get("fullExchangeName") or MARKET[market]["exchange"],"currency":candidate.get("currency") or MARKET[market]["currency"],"assetType":asset_type,"sector":candidate.get("sector") or candidate.get("industry") or "Unclassified","source":"DuckDB cached Yahoo adjusted OHLCV","sourceCount":1,"freshness":"delayed","capturedAt":datetime.fromtimestamp(latest,timezone.utc).isoformat(),"bars":prior,"price":prior[-1]["close"],"previousClose":prior[-2]["close"],"sourceWarnings":[warning],"sourceConflicts":[],"corporateActionAnomalies":[],"etfStructure":{"score":50,"missingNonCritical":asset_type == "ETF","excluded":False},"_cacheOnly":True}
        try:
            payload = client.chart(candidate["symbol"], period1, attempts=attempts)
            cache.save_raw(market, candidate["symbol"], payload, scan_id)
            fresh = _snapshot(market, candidate, payload)
        except Exception:
            if len(prior) < CONFIG["minimumTradingDays"]: raise
            fresh = cached_snapshot("DOWNLOAD_RETRY_USING_CACHE"); fresh["freshness"] = "fallback"
        if latest and fresh["bars"] is not prior:
            by_stamp = {bar["timestamp"]:bar for bar in prior}
            by_stamp.update({bar["timestamp"]:bar for bar in fresh["bars"]}); fresh["bars"] = [by_stamp[key] for key in sorted(by_stamp)]
        if len(fresh["bars"]) < CONFIG["minimumTradingDays"]: raise InsufficientHistoryError("insufficient history")
        return fresh
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(load, candidate):candidate for candidate in candidates}
        completed = 0
        for future in as_completed(futures):
            candidate = futures[future]
            try:
                item = future.result(); snapshots.append(item)
            except Exception as exc:
                errors_by_symbol[candidate["symbol"]] = history_error(candidate, exc)
                failed_candidates.append(candidate)
            completed += 1
            # Do not persist provisional first-pass failures. The calm retry
            # below determines whether a symbol is truly unavailable, merely
            # too new for the model, or fully recovered.
            if progress and (completed % 25 == 0 or completed == len(candidates)): progress(completed, len(candidates), len(snapshots), 0)
    # A calm sequential pass recovers transient provider throttles without
    # repeating the original burst. The global cooldown also pauses threads
    # that may still be waiting for a Yahoo slot.
    recovered = set()
    if failed_candidates:
        client._defer(5.0)
    for candidate in failed_candidates:
        try:
            time.sleep(.08 + random.uniform(0, .08))
            item = load(candidate, attempts=3); snapshots.append(item); recovered.add(candidate["symbol"])
        except Exception as exc:
            # Preserve the final calm-pass reason. A first-pass 429 followed by
            # a valid short history is an eligibility rejection, not a provider
            # outage; the reverse remains a real coverage failure.
            errors_by_symbol[candidate["symbol"]] = history_error(candidate, exc)
    for symbol in recovered:
        errors_by_symbol.pop(symbol, None)
    final_errors = list(errors_by_symbol.values())
    if progress:
        progress(len(candidates), len(candidates), len(snapshots), sum(item.get("code") != "INSUFFICIENT_HISTORY" for item in final_errors))
    return snapshots, final_errors


def coverage_summary(candidates, snapshots, history_errors, stock_target, etf_target):
    raw = {asset:sum(item["quoteType"] == asset for item in candidates) for asset in ("STOCK","ETF")}
    rejected = {asset:sum(item.get("assetType") == asset and item.get("code") == "INSUFFICIENT_HISTORY" for item in history_errors) for asset in ("STOCK","ETF")}
    discovered = {
        "STOCK":min(stock_target, max(0, raw["STOCK"] - rejected["STOCK"])),
        "ETF":min(etf_target, max(0, raw["ETF"] - rejected["ETF"])),
    }
    analyzed = {asset:sum(item["assetType"] == asset for item in snapshots) for asset in ("STOCK","ETF")}
    discovered_count = discovered["STOCK"] + discovered["ETF"]
    ratio = len(snapshots) / discovered_count * 100 if discovered_count else 0
    provider_failures = sum(item.get("code") != "INSUFFICIENT_HISTORY" for item in history_errors)
    return {"stocksDiscovered":discovered["STOCK"],"etfsDiscovered":discovered["ETF"],"rawStocksDiscovered":raw["STOCK"],"rawEtfsDiscovered":raw["ETF"],"stocksAnalyzed":analyzed["STOCK"],"etfsAnalyzed":analyzed["ETF"],"historyRejected":rejected["STOCK"]+rejected["ETF"],"failed":provider_failures,"candidateCount":len(candidates),"coveragePct":round(ratio,2),"qualityGatePassed":discovered_count > 0 and ratio >= CONFIG["completionCoveragePct"]}


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


class ProgressReporter:
    def __init__(self, endpoint, secret, token, job_id="", component_id=""):
        self.endpoint, self.secret, self.token, self.job_id, self.component_id = endpoint.rstrip("/"), secret, token, job_id, component_id
        self.sequence = 0
        self.counts = {"total": 0, "processed": 0, "updated": 0, "failed": 0}

    def report(self, status, phase, total=0, processed=0, updated=0, failed=0, scan_id=None, error_code=None, error_detail=None):
        if not self.job_id or not self.component_id: return None
        self.sequence += 1
        requested = {"total": int(total), "processed": int(processed), "updated": int(updated), "failed": int(failed)}
        self.counts = {key: max(self.counts[key], value) for key, value in requested.items()}
        payload = {"jobId":self.job_id,"componentId":self.component_id,"status":status,"phase":phase,**self.counts,"scanId":scan_id,"githubRunId":os.getenv("GITHUB_RUN_ID"),"githubRunUrl":f"{os.getenv('GITHUB_SERVER_URL','https://github.com')}/{os.getenv('GITHUB_REPOSITORY','')}/actions/runs/{os.getenv('GITHUB_RUN_ID','')}" if os.getenv("GITHUB_RUN_ID") else None,"errorCode":error_code,"errorDetail":str(error_detail)[:800] if error_detail else None}
        try:
            return _signed_json(self.endpoint + "/api/ingest/scan-progress", self.secret, payload, f"progress-{self.component_id}-{self.sequence:05d}", self.token)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            # A temporary heartbeat outage must not discard an otherwise valid,
            # expensive scan. Rankings uploads and terminal reports stay strict.
            if status != "RUNNING" or not is_retryable_request_error(exc):
                raise
            print(json.dumps({"status":"warning","stage":"progress","phase":phase,"type":type(exc).__name__,"message":str(exc)}, ensure_ascii=False), flush=True)
            return None


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
    headers = {"Content-Type":"application/vnd.apache.parquet","X-Meridian-Timestamp":timestamp,"X-Meridian-Signature":signature,"X-Idempotency-Key":"artifact-" + hashlib.sha256(object_key.encode()).hexdigest()[:32],"X-Meridian-Object-Key":object_key,"X-Meridian-Market":market,"X-Meridian-Asset-Type":asset_type,"X-Meridian-Scan-Id":scan_id,"X-Meridian-Model-Version":MODEL_VERSION,"User-Agent":USER_AGENT}
    if token: headers["OAI-Sites-Authorization"] = "Bearer " + token
    with urllib.request.urlopen(urllib.request.Request(endpoint.rstrip("/") + "/api/ingest/artifacts", data=body, method="POST", headers=headers), timeout=180) as response: return json.loads(response.read().decode())


def upload_rankings(endpoint, secret, token, scan, rankings, job_id="", component_id=""):
    batches = list(_chunks(rankings, 150)) or [[]]
    identity=model_identity()
    if MODEL_MODULE is model_v22:
        selected={}
        for item in rankings:
            profile_id=item.get("marketProfileId")
            if profile_id:selected[(item["market"],item["assetType"])]=model_v22.market_profile(item["market"],item["assetType"],profile_id)
        identity={**identity,"profiles":list(selected.values())}
    for index, records in enumerate(batches):
        current = dict(scan); current["status"] = scan["status"] if index == len(batches) - 1 else "running"; current["completedAt"] = scan["completedAt"] if index == len(batches) - 1 else None
        _signed_json(endpoint.rstrip("/") + "/api/ingest/rankings", secret, {"scan":current,"records":records,"batchIndex":index,"batchCount":len(batches),"jobId":job_id or None,"componentId":component_id or None,"model":identity}, f"v2-{scan['id']}-{index:04d}", token)
    return len(batches)


def run_full_scan(markets, stock_target, etf_target, endpoint, secret, sites_token="", workers=6, asset_types=("STOCK","ETF"), job_id="", component_id="", market_profile_id="", market_profile_hash=""):
    started = datetime.now(timezone.utc); scan_id = started.strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]; today = started.date().isoformat()
    asset_types = tuple(item for item in asset_types if item in ("STOCK","ETF"))
    stock_target = stock_target if "STOCK" in asset_types else 0; etf_target = etf_target if "ETF" in asset_types else 0
    reporter = ProgressReporter(endpoint, secret, sites_token, job_id, component_id)
    client, cache = YahooClient(), MarketCache(); all_snapshots, errors, coverage, parquet = [], [], {}, {}
    requested_profile = None
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
            all_snapshots.extend(snapshots)
            # Short histories are auditable universe exclusions, not failed
            # downloads. Keep them in coverage.historyRejected without
            # polluting scan failedCount or the durable job failure counter.
            errors.extend(item for item in market_errors if item.get("code") != "INSUFFICIENT_HISTORY")
            coverage[market] = coverage_summary(candidates, snapshots, market_errors, stock_target, etf_target)
            coverage[market].update({"targetStocks":stock_target,"targetEtfs":etf_target,"universeSource":MARKET[market]["universe"],"seconds":round(time.time()-market_started,1)})
            market_latest=max((item["bars"][-1]["timestamp"] for item in snapshots),default=0);coverage[market]["tradingSessionDate"]=datetime.fromtimestamp(market_latest,timezone.utc).date().isoformat() if market_latest else None;coverage[market]["freshnessPct"]=round(sum(item["bars"][-1]["timestamp"]==market_latest for item in snapshots)/len(snapshots)*100,2) if snapshots else 0
            for current_asset in asset_types:
                parquet[(market,current_asset)] = {
                    "path": cache.export_market_parquet(market, scan_id, current_asset),
                    "records": sum(item["assetType"] == current_asset for item in snapshots),
                }
            print(json.dumps({"market":market,"coverage":coverage[market]}, ensure_ascii=False), flush=True)
        reporter.report("RUNNING", "ENRICHMENT", total_target, total_target, len(all_snapshots), len(errors), scan_id)
        enrich_candidate_profiles(client, cache, all_snapshots)
        reporter.report("RUNNING", "SCORING", total_target, total_target, len(all_snapshots), len(errors), scan_id)
        raw_by_id = {item["instrumentId"]:raw_factors(item) for item in all_snapshots}
        market_contexts = {}
        if hasattr(MODEL_MODULE,"build_market_context"):
            for market in markets:
                market_pool = [item for item in all_snapshots if item["market"] == market]
                try:
                    benchmark = fetch_benchmark_snapshot(client, market)
                    market_contexts[market] = build_market_context(market_pool, benchmark, raw_by_id)
                except Exception as exc:
                    market_contexts[market] = build_market_context(market_pool, None, raw_by_id)
                    errors.append({"market":market,"symbol":BENCHMARK_SYMBOLS[market],"stage":"regime","error":type(exc).__name__})
            if MODEL_MODULE is model_v22 and market_profile_id and len(markets)==1 and len(asset_types)==1:
                requested_profile=model_v22.market_profile(markets[0],asset_types[0],market_profile_id)
                if market_profile_hash and requested_profile["configHash"]!=market_profile_hash: raise ValueError("Market profile hash mismatch")
                rankings = rank_snapshots(all_snapshots, allow_buy=True, market_contexts=market_contexts, raw_by_id=raw_by_id,profile_overrides={(markets[0],asset_types[0]):market_profile_id})
            else: rankings = rank_snapshots(all_snapshots, allow_buy=True, market_contexts=market_contexts, raw_by_id=raw_by_id)
        else:
            rankings = rank_snapshots(all_snapshots, allow_buy=True, raw_by_id=raw_by_id)
        completed = datetime.now(timezone.utc)
        source_conflicts = sum(len(item.get("sourceConflicts") or []) for item in all_snapshots); action_anomalies = sum(len(item.get("corporateActionAnomalies") or []) for item in all_snapshots)
        complete = bool(markets) and all(coverage.get(market, {}).get("qualityGatePassed") for market in markets) and action_anomalies == 0
        status = "complete" if complete else "partial"
        provider = "Public exchange directories + Yahoo Finance adjusted OHLCV + benchmark breadth"
        profile_ids=sorted(set(item.get("marketProfileId") for item in rankings if item.get("marketProfileId"))); profile_hashes=sorted(set(item.get("marketProfileHash") for item in rankings if item.get("marketProfileHash")))
        scan_profile_id = requested_profile["profileId"] if requested_profile else profile_ids[0] if len(profile_ids)==1 else None
        scan_profile_hash = requested_profile["configHash"] if requested_profile else profile_hashes[0] if len(profile_hashes)==1 else None
        latest_session_timestamp=max((item["bars"][-1]["timestamp"] for item in all_snapshots),default=0);trading_session_date=datetime.fromtimestamp(latest_session_timestamp,timezone.utc).date().isoformat() if latest_session_timestamp else None
        freshness_pct=round(sum(item["bars"][-1]["timestamp"]==latest_session_timestamp for item in all_snapshots)/len(all_snapshots)*100,2) if all_snapshots else 0
        scan = {"id":scan_id,"provider":provider,"modelVersion":MODEL_VERSION,"configHash":CONFIG_HASH,"marketProfileId":scan_profile_id,"marketProfileHash":scan_profile_hash,"validationStatus":"SHADOW","status":status,"startedAt":started.isoformat(),"completedAt":completed.isoformat(),"requestedMarkets":markets,"requestedAssetTypes":list(asset_types),"jobId":job_id or None,"componentId":component_id or None,"targetStocksPerMarket":stock_target,"targetEtfsPerMarket":etf_target,"discoveredCount":sum(v["stocksDiscovered"]+v["etfsDiscovered"] for v in coverage.values()),"analyzedCount":len(rankings),"failedCount":len(errors),"fallbackCount":0,"coverage":coverage,"marketContexts":market_contexts,"sourceConflicts":source_conflicts,"corporateActionAnomalies":action_anomalies,"qualityGatePassed":complete,"universeSnapshotDate":today,"tradingSessionDate":trading_session_date,"dataFreshnessPct":freshness_pct,"recomputationConsistencyPct":100}
        reporter.report("RUNNING", "UPLOADING", total_target, total_target, len(rankings), len(errors), scan_id)
        # Never replace the last recoverable history artifact with an empty or
        # quality-gate-failing snapshot. The partial scan summary is still
        # uploaded below for audit and component failure reporting.
        if complete:
            for (market,current_asset), artifact in parquet.items():
                if artifact["records"]:
                    upload_artifact(endpoint, secret, sites_token, artifact["path"], f"history/{MODEL_VERSION}/{scan_id}/{market}/{current_asset}.parquet", market, current_asset, scan_id)
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
    load_local_env(); parser = argparse.ArgumentParser(description="Meridian version-selected public market bridge")
    parser.add_argument("--endpoint", default=os.getenv("MERIDIAN_ENDPOINT")); parser.add_argument("--secret", default=os.getenv("INGEST_HMAC_SECRET")); parser.add_argument("--sites-token", default=os.getenv("OAI_SITES_BYPASS_TOKEN", "")); parser.add_argument("--markets", default=",".join(MARKETS)); parser.add_argument("--asset-types", default="STOCK,ETF"); parser.add_argument("--model-version", default=os.getenv("MERIDIAN_MODEL_VERSION", model_v22.MODEL_VERSION)); parser.add_argument("--job-id", default=os.getenv("MERIDIAN_JOB_ID", "")); parser.add_argument("--component-id", default=os.getenv("MERIDIAN_COMPONENT_ID", "")); parser.add_argument("--market-profile-id",default=os.getenv("MERIDIAN_MARKET_PROFILE_ID","")); parser.add_argument("--market-profile-hash",default=os.getenv("MERIDIAN_MARKET_PROFILE_HASH","")); parser.add_argument("--stocks", type=int, default=int(os.getenv("MERIDIAN_STOCKS_PER_MARKET", "500"))); parser.add_argument("--etfs", type=int, default=int(os.getenv("MERIDIAN_ETFS_PER_MARKET", "100"))); parser.add_argument("--workers", type=int, default=int(os.getenv("MERIDIAN_HISTORY_WORKERS", "4"))); parser.add_argument("--loop", action="store_true"); args = parser.parse_args()
    if not args.endpoint or not args.secret: parser.error("--endpoint and --secret are required")
    try: _select_model(args.model_version)
    except ValueError as exc: parser.error(str(exc))
    markets = [item.strip().upper() for item in args.markets.split(",") if item.strip().upper() in MARKETS]
    asset_types = [item.strip().upper() for item in args.asset_types.split(",") if item.strip().upper() in ("STOCK","ETF")]
    while True:
        try: run_full_scan(markets, max(1,args.stocks), max(0,args.etfs), args.endpoint, args.secret, args.sites_token, max(1,args.workers), asset_types, args.job_id, args.component_id,args.market_profile_id,args.market_profile_hash)
        except Exception as exc:
            print(json.dumps({"status":"error","type":type(exc).__name__,"message":str(exc)}), flush=True)
            if not args.loop: raise
        if not args.loop: break
        time.sleep(max(3600, int(os.getenv("MERIDIAN_INTERVAL_SECONDS", "86400"))))


if __name__ == "__main__": main()
