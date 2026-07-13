"""Generate a versioned one-year trading-session snapshot for scheduled scans."""
from __future__ import annotations

import json
import re
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import exchange_calendars as xcals

CALENDARS = {"US":"XNYS","CN":"XSHG","HK":"XHKG","JP":"XTKS","KR":"XKRX","SG":"XSES"}
TWSE_URL = "https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule"


def _iso_date(value):
    text = str(value or "")
    match = re.search(r"(?<!\d)(\d{4})[/-]?(\d{2})[/-]?(\d{2})(?!\d)", text)
    if match: return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    roc = re.search(r"(?<!\d)(\d{3})[/-]?(\d{2})[/-]?(\d{2})(?!\d)", text)
    if roc: return f"{int(roc.group(1))+1911:04d}-{roc.group(2)}-{roc.group(3)}"
    return None


def tw_sessions(start, end):
    request = urllib.request.Request(TWSE_URL, headers={"User-Agent":"MeridianCalendar/2.0","Accept":"application/json"})
    with urllib.request.urlopen(request, timeout=45) as response: rows = json.loads(response.read().decode("utf-8-sig"))
    closures = set()
    for row in rows if isinstance(rows, list) else []:
        joined = " ".join(str(value) for value in row.values()) if isinstance(row, dict) else str(row)
        stamp = _iso_date(joined)
        if stamp and ("休" in joined or "holiday" in joined.lower() or "closed" in joined.lower()): closures.add(stamp)
    result, current = [], start
    while current <= end:
        if current.weekday() < 5 and current.isoformat() not in closures: result.append(current.isoformat())
        current += timedelta(days=1)
    return result


def main():
    today = date.today(); end = today + timedelta(days=365); markets, bounds = {}, {}
    for market, name in CALENDARS.items():
        calendar = xcals.get_calendar(name)
        market_end = min(end, calendar.last_session.date())
        markets[market] = [stamp.date().isoformat() for stamp in calendar.sessions_in_range(today.isoformat(), market_end.isoformat())]
        bounds[market] = {"start":today.isoformat(),"end":market_end.isoformat()}
    markets["TW"] = tw_sessions(today, end)
    bounds["TW"] = {"start":today.isoformat(),"end":end.isoformat()}
    payload = {"generatedAt":datetime.now(timezone.utc).isoformat(),"start":today.isoformat(),"end":end.isoformat(),"sources":{"TW":TWSE_URL,"others":"exchange_calendars pinned package"},"marketBounds":bounds,"markets":markets}
    path = Path(__file__).with_name("calendars") / "calendar-snapshot.json"; path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__": main()
