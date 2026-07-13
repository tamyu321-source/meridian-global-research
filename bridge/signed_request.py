"""Lightweight signed Sites requests shared by workflow orchestration and scans.

This module deliberately uses only the Python standard library so the GitHub
Actions prepare job can create or resume work before analytical dependencies
such as DuckDB are installed.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone
import urllib.request


USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MeridianResearchBridge/2.0"


def signed_json(url, secret, payload, key, token="", timeout=90):
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    timestamp = datetime.now(timezone.utc).isoformat()
    signature = hmac.new(
        secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256
    ).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-Meridian-Timestamp": timestamp,
        "X-Meridian-Signature": signature,
        "X-Idempotency-Key": key,
        "User-Agent": USER_AGENT,
    }
    if token:
        headers["OAI-Sites-Authorization"] = "Bearer " + token
    request = urllib.request.Request(url, data=body, method="POST", headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode())
