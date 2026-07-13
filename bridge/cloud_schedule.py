"""Prepare scheduled GitHub jobs and report workflow failures without exposing secrets."""
from __future__ import annotations

import argparse
import json
import os
import urllib.error
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from .signed_request import signed_json
except ImportError:
    from signed_request import signed_json

SCHEDULES = {
    "47 14 * * 1-5": ("TW", "Asia/Taipei"),
    "47 16 * * 1-5": ("JP", "Asia/Tokyo"),
    "49 16 * * 1-5": ("KR", "Asia/Seoul"),
    "51 16 * * 1-5": ("CN", "Asia/Shanghai"),
    "53 17 * * 1-5": ("HK", "Asia/Hong_Kong"),
    "55 18 * * 1-5": ("SG", "Asia/Singapore"),
    "57 17 * * 1-5": ("US", "America/New_York"),
}


def _output(name, value):
    target = os.getenv("GITHUB_OUTPUT")
    text = json.dumps(value, separators=(",", ":")) if isinstance(value, (list, dict)) else str(value)
    if target:
        with open(target, "a", encoding="utf-8") as handle: handle.write(f"{name}={text}\n")
    else: print(f"{name}={text}")


def _calendar_sessions(market, session_date=None):
    path = Path(__file__).with_name("calendars") / "calendar-snapshot.json"
    if not path.exists(): return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8")); bounds = (payload.get("marketBounds") or {}).get(market) or {}
        if session_date and (session_date < bounds.get("start", session_date) or session_date > bounds.get("end", session_date)): return None
        return set((payload.get("markets") or {}).get(market) or [])
    except (OSError, json.JSONDecodeError): return None


def prepare(args):
    if args.manual_job_id:
        components = json.loads(args.manual_components_json or "[]")
        components = [{**item, "jobId": item.get("jobId") or args.manual_job_id} for item in components]
        _output("job_id", args.manual_job_id); _output("components_json", components); _output("skip", "false")
        return
    primary, _ = SCHEDULES.get(args.cron, (None, None))
    if not primary: raise SystemExit("Unknown schedule")
    components, job_ids = [], []
    for cron, (market, time_zone) in SCHEDULES.items():
        local_now = datetime.now(ZoneInfo(time_zone)); local_date = local_now.date().isoformat()
        minute, hour = (int(value) for value in cron.split()[:2])
        if (local_now.hour, local_now.minute) < (hour, minute): continue
        sessions = _calendar_sessions(market, local_date)
        if sessions is not None and local_date not in sessions: continue
        payload = {"trigger":"SCHEDULED","market":market,"assetType":"ALL"}
        key = f"schedule-{market}-{local_date}-{os.getenv('GITHUB_RUN_ID','local')}-{os.getenv('GITHUB_RUN_ATTEMPT','1')}"
        result = signed_json(args.endpoint.rstrip("/") + "/api/ingest/scan-jobs", args.secret, payload, key, args.token)
        job_id = result.get("jobId", "")
        if job_id: job_ids.append(job_id)
        components.extend([{**item, "jobId": job_id} for item in (result.get("components") or [])])
    _output("job_id", job_ids[0] if job_ids else ""); _output("components_json", components); _output("skip", "false" if components else "true")


def _report_failure(args, job_id, component_id):
    payload = {"jobId":job_id,"componentId":component_id,"status":"FAILED","phase":"UPLOADING","total":args.total,"processed":args.processed,"updated":args.updated,"failed":max(1,args.failed),"githubRunId":os.getenv("GITHUB_RUN_ID"),"errorCode":"GITHUB_JOB_FAILED","errorDetail":"The GitHub analysis job stopped before producing an activatable result."}
    try:
        signed_json(args.endpoint.rstrip("/") + "/api/ingest/scan-progress", args.secret, payload, f"workflow-failure-{component_id}-{os.getenv('GITHUB_RUN_ATTEMPT','1')}", args.token)
        return True
    except urllib.error.HTTPError as exc:
        # A successful or already-failed terminal component must not make the
        # workflow finalizer fail while releasing other matrix work.
        if exc.code == 409: return False
        raise


def fail(args):
    _report_failure(args, args.job_id, args.component_id)


def fail_components(args):
    components = json.loads(args.manual_components_json or "[]")
    reported = sum(bool(_report_failure(args, item.get("jobId") or args.manual_job_id, item["id"])) for item in components if item.get("id"))
    print(json.dumps({"failedComponentsReported":reported,"componentCount":len(components)}, separators=(",", ":")), flush=True)


def main():
    parser = argparse.ArgumentParser(); sub = parser.add_subparsers(dest="command", required=True)
    common = argparse.ArgumentParser(add_help=False); common.add_argument("--endpoint", required=True); common.add_argument("--secret", required=True); common.add_argument("--token", default="")
    prepare_parser = sub.add_parser("prepare", parents=[common]); prepare_parser.add_argument("--cron", default=""); prepare_parser.add_argument("--manual-job-id", default=""); prepare_parser.add_argument("--manual-components-json", default="[]")
    fail_parser = sub.add_parser("fail", parents=[common]); fail_parser.add_argument("--job-id", required=True); fail_parser.add_argument("--component-id", required=True); fail_parser.add_argument("--total", type=int, default=0); fail_parser.add_argument("--processed", type=int, default=0); fail_parser.add_argument("--updated", type=int, default=0); fail_parser.add_argument("--failed", type=int, default=1)
    fail_many = sub.add_parser("fail-components", parents=[common]); fail_many.add_argument("--manual-job-id", required=True); fail_many.add_argument("--manual-components-json", default="[]"); fail_many.add_argument("--total", type=int, default=0); fail_many.add_argument("--processed", type=int, default=0); fail_many.add_argument("--updated", type=int, default=0); fail_many.add_argument("--failed", type=int, default=1)
    args = parser.parse_args()
    if args.command == "prepare": prepare(args)
    elif args.command == "fail": fail(args)
    else: fail_components(args)


if __name__ == "__main__": main()
