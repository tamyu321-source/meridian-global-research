"""Lightweight signed Sites requests shared by workflow orchestration and scans.

This module deliberately uses only the Python standard library so the GitHub
Actions prepare job can create or resume work before analytical dependencies
such as DuckDB are installed.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
import urllib.error
import urllib.request


USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) MeridianResearchBridge/2.0"
RETRYABLE_HTTP_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})


def is_retryable_request_error(exc):
    """Return whether an idempotent signed request may be attempted again."""
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code in RETRYABLE_HTTP_STATUSES
    return isinstance(exc, (urllib.error.URLError, TimeoutError))


def _retry_delay(exc, attempt, backoff):
    retry_after = exc.headers.get("Retry-After") if isinstance(exc, urllib.error.HTTPError) and exc.headers else None
    try:
        return min(30.0, max(0.0, float(retry_after)))
    except (TypeError, ValueError):
        return min(30.0, backoff * (2 ** attempt))


def signed_json(url, secret, payload, key, token="", timeout=90, attempts=4, backoff=0.75):
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    attempts = max(1, int(attempts))
    for attempt in range(attempts):
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
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode())
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
            if attempt + 1 >= attempts or not is_retryable_request_error(exc):
                raise
            time.sleep(_retry_delay(exc, attempt, backoff))
