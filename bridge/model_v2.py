"""Canonical Meridian v2 production and backtest model.

Only this module decides factors, scores, hard gates and signal actions. Both
the live bridge and walk-forward backtest import it to prevent model drift.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import statistics
from dataclasses import dataclass

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "model.v2.json")
with open(CONFIG_PATH, "r", encoding="utf-8") as _handle:
    CONFIG = json.load(_handle)
with open(CONFIG_PATH, "rb") as _handle:
    CONFIG_HASH = hashlib.sha256(_handle.read()).hexdigest()

MODEL_VERSION = CONFIG["modelVersion"]
UNKNOWN_SECTORS = {"", "unknown", "unclassified", "n/a", "none", "其他", "其它"}


def number(value, default=0.0):
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def mean(values):
    return statistics.fmean(values) if values else 0.0


def pct(current, previous):
    return (current / previous - 1) * 100 if previous and previous > 0 else 0.0


def percentile(values, target):
    if len(values) <= 1:
        return 50.0
    ordered = sorted(values)
    below = sum(value < target for value in ordered)
    equal = sum(value == target for value in ordered)
    return max(0.0, min(100.0, (below + max(0, equal - 1) / 2) / (len(ordered) - 1) * 100))


def winsor(values, value):
    if len(values) < 4:
        return value
    ordered = sorted(values)
    low = ordered[int((len(ordered) - 1) * .025)]
    high = ordered[math.ceil((len(ordered) - 1) * .975)]
    return max(low, min(high, value))


def _valid_bars(snapshot):
    bars = []
    seen = set()
    for raw in snapshot.get("bars") or []:
        stamp = int(number(raw.get("timestamp")))
        close = number(raw.get("close"))
        if not stamp or stamp in seen or close <= 0:
            continue
        seen.add(stamp)
        open_price = number(raw.get("open"), close)
        high = number(raw.get("high"), max(open_price, close))
        low = number(raw.get("low"), min(open_price, close))
        bars.append({
            "timestamp": stamp,
            "open": open_price if open_price > 0 else close,
            "high": max(high, open_price, close),
            "low": min(value for value in (low, open_price, close) if value > 0),
            "close": close,
            "adjClose": number(raw.get("adjClose"), close),
            "volume": max(0.0, number(raw.get("volume"))),
            "dividend": max(0.0, number(raw.get("dividend"))),
            "splitRatio": number(raw.get("splitRatio"), 1.0) or 1.0,
        })
    return sorted(bars, key=lambda item: item["timestamp"])


def _sma(values, period, offset=0):
    end = len(values) - offset if offset else len(values)
    start = max(0, end - period)
    return mean(values[start:end])


def _atr(bars, period=14):
    sample = bars[-(period + 1):]
    if len(sample) < 2:
        return sample[-1]["close"] * .03 if sample else 0
    ranges = []
    for index in range(1, len(sample)):
        bar, previous = sample[index], sample[index - 1]
        ranges.append(max(bar["high"] - bar["low"], abs(bar["high"] - previous["close"]), abs(bar["low"] - previous["close"])))
    return mean(ranges)


def raw_factors(snapshot):
    bars = _valid_bars(snapshot)
    adjusted = [bar["adjClose"] for bar in bars]
    closes = [bar["close"] for bar in bars]
    volumes = [bar["volume"] for bar in bars]
    current = adjusted[-1] if adjusted else number(snapshot.get("price"))
    sma20, sma50, sma200 = _sma(adjusted, 20), _sma(adjusted, 50), _sma(adjusted, 200)
    sma50_prior, sma200_prior = _sma(adjusted, 50, 20), _sma(adjusted, 200, 20)
    trend = pct(current, sma20) + pct(sma20, sma50) * .8 + pct(sma50, sma200) * .6 + pct(sma50, sma50_prior) + pct(sma200, sma200_prior)
    returns = [pct(value, adjusted[index]) for index, value in enumerate(adjusted[1:])]
    volatility = (statistics.pstdev(returns[-126:]) if len(returns[-126:]) > 1 else 0) * math.sqrt(252)
    return1 = pct(current, adjusted[-26]) if len(adjusted) > 26 else 0
    return3 = pct(current, adjusted[-68]) if len(adjusted) > 68 else 0
    return6 = pct(adjusted[-6], adjusted[-131]) if len(adjusted) > 131 else 0
    momentum = (return1 * .30 + return3 * .40 + return6 * .30) / max(volatility, 5) * 20
    high252 = max(adjusted[-252:]) if adjusted else current
    drawdown = pct(current, high252)
    downside_returns = [value for value in returns[-126:] if value < 0]
    downside = (statistics.pstdev(downside_returns) if len(downside_returns) > 1 else 0) * math.sqrt(252)
    risk = -(volatility * .65 + abs(drawdown) * .25 + downside * .10)
    traded_value = mean([bar["close"] * bar["volume"] for bar in bars[-60:]])
    volume20 = mean(volumes[-20:])
    median20 = statistics.median(volumes[-20:]) if volumes[-20:] else 0
    liquidity = math.log10(max(1, traded_value)) + (volumes[-1] / median20 if median20 else 0)
    regime = 1 if current > sma200 and sma50 > sma200 else 0 if current > sma200 else -1
    structure = number((snapshot.get("etfStructure") or {}).get("score"), 50)
    return {
        "trend": trend, "momentum": momentum, "relativeStrength": return3,
        "liquidity": liquidity, "risk": risk, "regime": regime, "structure": structure,
        "current": current, "sma20": sma20, "sma50": sma50, "sma200": sma200,
        "sma50Rising": sma50 > sma50_prior, "sma200Rising": sma200 > sma200_prior,
        "return3m": return3, "return6m": return6, "latestVolume": volumes[-1] if volumes else 0,
        "medianVolume20": median20, "atr": _atr(bars), "barCount": len(bars),
        "realOhlcv": sum(1 for bar in bars[-60:] if bar["high"] > bar["low"] and bar["volume"] > 0) >= min(40, len(bars[-60:])),
    }


def _quality(snapshot, raw):
    warnings = list(snapshot.get("sourceWarnings") or [])
    conflicts = list(snapshot.get("sourceConflicts") or [])
    actions = list(snapshot.get("corporateActionAnomalies") or [])
    missing = []
    if raw["barCount"] < CONFIG["minimumTradingDays"]:
        missing.append("INSUFFICIENT_HISTORY")
    if not raw["realOhlcv"]:
        missing.append("NON_GENUINE_OHLCV")
    if number(snapshot.get("price")) <= 0:
        missing.append("INVALID_PRICE")
    if snapshot.get("freshness") == "stale":
        missing.append("STALE_DATA")
    if snapshot.get("assetType") == "STOCK" and str(snapshot.get("sector") or "").strip().lower() in UNKNOWN_SECTORS:
        missing.append("SECTOR_UNKNOWN")
    if conflicts:
        missing.append("SOURCE_CONFLICT")
    if actions:
        missing.append("CORPORATE_ACTION_ANOMALY")
    if snapshot.get("assetType") == "ETF" and snapshot.get("etfStructure", {}).get("excluded"):
        missing.append("ETF_STRUCTURE_EXCLUDED")
    source_count = max(1, int(number(snapshot.get("sourceCount"), 1)))
    completeness = max(0.0, 100.0 - len(missing) * 12.5 - len(warnings) * 3)
    return {"completenessPct": round(completeness, 1), "sourceCount": source_count, "warnings": warnings, "conflicts": conflicts, "corporateActionAnomalies": actions, "hardGates": missing}


def _trade_plan(snapshot, raw):
    bars = _valid_bars(snapshot)
    current = number(snapshot.get("price"), bars[-1]["close"] if bars else 0)
    average_range = raw["atr"] or current * .03
    lows = [bar["low"] for bar in bars[-20:] if bar["low"] > 0]
    support = min(lows) if lows else current * .92
    stop = max(current * .88, min(current * .985, max(support, current - average_range * 2.2)))
    risk = max(current - stop, current * .015)
    rounded = lambda value: round(value, 4)
    return {"entryLow": rounded(current - average_range * .35), "entryHigh": rounded(current + average_range * .20), "invalidation": rounded(min(stop, support)), "stop": rounded(stop), "target1": rounded(current + risk * 1.5), "target2": rounded(current + risk * 2.5), "trailingAtr": 2, "rewardRisk": 2.5, "maxWeightPct": 5, "riskBudgetPct": .5}


def rank_snapshots(snapshots, allow_buy=True):
    rows = []
    raw_by_id = {item["instrumentId"]: raw_factors(item) for item in snapshots}
    groups = {}
    for item in snapshots:
        groups.setdefault((item["market"], item["assetType"]), []).append(item)
    for snapshot in snapshots:
        raw = raw_by_id[snapshot["instrumentId"]]
        peers = [raw_by_id[item["instrumentId"]] for item in groups[(snapshot["market"], snapshot["assetType"])]]
        factor_names = ("trend", "momentum", "relativeStrength", "liquidity", "risk")
        factors = {}
        for name in factor_names:
            values = [item[name] for item in peers]
            factors[name] = round(percentile(values, winsor(values, raw[name])), 1)
        factors["regime"] = 80 if raw["regime"] > 0 else 55 if raw["regime"] == 0 else 25
        factors["structure"] = round(raw["structure"], 1)
        weights = CONFIG["etfWeights"] if snapshot["assetType"] == "ETF" else CONFIG["stockWeights"]
        score = round(sum(factors[name] * weight for name, weight in weights.items()), 1)
        quality = _quality(snapshot, raw)
        confidence = max(0.0, min(100.0, 96 - len(quality["hardGates"]) * 15 - len(quality["warnings"]) * 3 - (10 if snapshot.get("freshness") == "fallback" else 4 if snapshot.get("freshness") == "delayed" else 0)))
        plan = _trade_plan(snapshot, raw)
        absolute_gates = []
        if not (raw["current"] > raw["sma20"] and raw["current"] > raw["sma50"] and raw["current"] > raw["sma200"]): absolute_gates.append("PRICE_NOT_ABOVE_MA_SET")
        if not (raw["sma50Rising"] and raw["sma200Rising"]): absolute_gates.append("LONG_TREND_NOT_RISING")
        if not (raw["return3m"] > 0 and raw["return6m"] > 0): absolute_gates.append("MOMENTUM_NOT_POSITIVE")
        if factors["relativeStrength"] < CONFIG["minimumRelativeStrength"]: absolute_gates.append("RELATIVE_STRENGTH_BELOW_70")
        if raw["latestVolume"] < raw["medianVolume20"]: absolute_gates.append("VOLUME_CONFIRMATION_PENDING")
        if raw["regime"] < 0: absolute_gates.append("RISK_OFF")
        if snapshot["assetType"] == "ETF" and snapshot.get("etfStructure", {}).get("missingNonCritical"): absolute_gates.append("ETF_STRUCTURE_INCOMPLETE")
        all_gates = quality["hardGates"] + absolute_gates
        eligible = allow_buy and score >= CONFIG["buyScore"] and confidence >= CONFIG["buyConfidence"] and plan["rewardRisk"] >= CONFIG["minimumRewardRisk"] and not all_gates
        action = "BUY" if eligible else "WATCH"
        reasons = ["TREND_CONFIRMED" if factors["trend"] >= 65 else "TREND_UNCONFIRMED", "MOMENTUM_LEADERSHIP" if factors["momentum"] >= 65 else "MOMENTUM_MIXED", "RISK_CONTROLLED" if factors["risk"] >= 55 else "VOLATILITY_ELEVATED", "LIQUIDITY_ACCEPTABLE" if factors["liquidity"] >= 50 else "LIQUIDITY_THIN", "PUBLIC_DATA_SHADOW"]
        rows.append({**{key: snapshot[key] for key in ("instrumentId", "symbol", "name", "market", "exchange", "currency", "assetType")}, "sector": snapshot.get("sector") or "Unclassified", "price": round(number(snapshot.get("price")), 4), "changePct": round(pct(number(snapshot.get("price")), number(snapshot.get("previousClose"))), 2), "score": score, "confidence": round(confidence, 1), "action": action, "status": "SHADOW", "freshness": snapshot.get("freshness", "delayed"), "source": snapshot.get("source", "public"), "capturedAt": snapshot["capturedAt"], "factors": factors, "tradePlan": plan, "reasonCodes": reasons, "hardGates": all_gates, "modelVersion": MODEL_VERSION, "assetModel": "ETF_V2" if snapshot["assetType"] == "ETF" else "STOCK_V2", "validationStatus": "SHADOW", "configHash": CONFIG_HASH, "dataQuality": quality, "selection": {"eligibleBeforeCap": eligible, "bucketRank": 0, "buyLimit": CONFIG["etfBuyLimitPerMarket"] if snapshot["assetType"] == "ETF" else CONFIG["stockBuyLimitPerMarket"], "capped": False}})
    rows.sort(key=lambda item: (item["market"], item["assetType"], -item["score"], item["symbol"]))
    for key in groups:
        bucket = [item for item in rows if (item["market"], item["assetType"]) == key]
        eligible_rank = 0
        limit = CONFIG["etfBuyLimitPerMarket"] if key[1] == "ETF" else CONFIG["stockBuyLimitPerMarket"]
        for overall_rank, item in enumerate(bucket, 1):
            item["selection"]["bucketRank"] = overall_rank
            if item["selection"]["eligibleBeforeCap"]:
                eligible_rank += 1
                if eligible_rank > limit:
                    item["action"] = "WATCH"
                    item["selection"]["capped"] = True
                    item["hardGates"].append("DAILY_SELECTION_CAP")
    return sorted(rows, key=lambda item: item["score"], reverse=True)


def model_identity():
    return {"modelVersion": MODEL_VERSION, "configHash": CONFIG_HASH, "config": CONFIG}

