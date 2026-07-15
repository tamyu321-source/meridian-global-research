import copy
import os
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

import bridge.meridian_bridge as bridge
from bridge.cache import MarketCache
from bridge.meridian_bridge import ProgressReporter, _symbol_matches
from bridge.model_v2 import CONFIG_HASH, MODEL_VERSION, number, rank_snapshots, raw_factors
from bridge.model_v22 import MODEL_VERSION as CANDIDATE_MODEL_VERSION


def fixture(symbol, slope=.2, asset_type="STOCK", sector="Technology", volume_multiplier=1):
    bars=[]
    for i in range(300):
        close=100+i*slope
        volume=(1_000_000+i*1000)*volume_multiplier
        bars.append({"timestamp":1_700_000_000+i*86400,"open":close-.5,"high":close+1,"low":close-1,"close":close,"adjClose":close,"volume":volume,"dividend":0,"splitRatio":1})
    return {"instrumentId":f"US:{symbol}","symbol":symbol,"name":symbol,"market":"US","exchange":"NASDAQ","currency":"USD","assetType":asset_type,"sector":sector,"source":"fixture","sourceCount":2,"freshness":"delayed","capturedAt":"2026-07-12T00:00:00+00:00","bars":bars,"price":bars[-1]["close"],"previousClose":bars[-2]["close"],"sourceWarnings":[],"sourceConflicts":[],"corporateActionAnomalies":[],"etfStructure":{"score":70,"missingNonCritical":False,"excluded":False}}


class BridgeUnitTests(unittest.TestCase):
    def test_yahoo_request_retries_a_rate_limited_response(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self): return b'{"ok":true}'

        class FlakyOpener:
            def __init__(self): self.calls=0
            def open(self, *_args, **_kwargs):
                self.calls+=1
                if self.calls==1: raise urllib.error.HTTPError("https://query1.finance.yahoo.com",429,"rate limited",{"Retry-After":"0"},None)
                return Response()

        client=bridge.YahooClient(min_interval=0); opener=FlakyOpener(); client.local.opener=opener; client.local.crumb=""
        with patch.object(client,"_wait_for_slot"), patch.object(client,"_retry_delay",return_value=0), patch.object(client,"_defer") as defer:
            self.assertEqual(client.request("https://query1.finance.yahoo.com/test",attempts=2),{"ok":True})
        self.assertEqual(opener.calls,2); defer.assert_called_once_with(0)

    def test_bridge_selects_the_requested_canonical_model(self):
        try:
            selected=bridge._select_model(MODEL_VERSION)
            self.assertEqual(selected.MODEL_VERSION,MODEL_VERSION)
            self.assertEqual(bridge.MODEL_VERSION,MODEL_VERSION)
            self.assertEqual(bridge.model_identity()["modelVersion"],MODEL_VERSION)
            with self.assertRaisesRegex(ValueError,"Unsupported model version"):
                bridge._select_model("meridian-swing-v9.9.9")
        finally:
            bridge._select_model(CANDIDATE_MODEL_VERSION)

    def test_v22_keeps_the_source_conflict_quality_threshold(self):
        try:
            bridge._select_model(CANDIDATE_MODEL_VERSION)
            self.assertEqual(bridge.CONFIG["sourceConflictPct"],1)
        finally:
            bridge._select_model(CANDIDATE_MODEL_VERSION)

    def test_progress_reporter_never_decreases_durable_counts(self):
        reporter=ProgressReporter("https://example.test","secret","token","job","component")
        with patch("bridge.meridian_bridge._signed_json", return_value={"accepted":True}) as send:
            reporter.report("RUNNING","HISTORY",100,100,129,11,"scan")
            reporter.report("RUNNING","ENRICHMENT",100,100,100,11,"scan")
        payload=send.call_args.args[2]
        self.assertEqual(payload["processed"],100)
        self.assertEqual(payload["updated"],129)
        self.assertEqual(payload["failed"],11)

    def test_temporary_running_progress_failure_does_not_abort_scan(self):
        reporter=ProgressReporter("https://example.test","secret","token","job","component")
        temporary=urllib.error.HTTPError("https://example.test",500,"temporary",{},None)
        with patch("bridge.meridian_bridge._signed_json",side_effect=temporary), patch("builtins.print") as output:
            self.assertIsNone(reporter.report("RUNNING","HISTORY",500,25,20,0,"scan"))
        output.assert_called_once()

    def test_auth_progress_failure_remains_fatal(self):
        reporter=ProgressReporter("https://example.test","secret","token","job","component")
        unauthorized=urllib.error.HTTPError("https://example.test",401,"unauthorized",{},None)
        with patch("bridge.meridian_bridge._signed_json",side_effect=unauthorized):
            with self.assertRaises(urllib.error.HTTPError):
                reporter.report("RUNNING","HISTORY",500,25,20,0,"scan")

    def test_number_rejects_missing_and_nan(self):
        self.assertEqual(number(None), 0); self.assertEqual(number("nan"), 0); self.assertEqual(number("12.5"), 12.5)

    def test_market_contracts_reject_cross_market_symbols(self):
        self.assertTrue(_symbol_matches("TW", "2330.TW", "STOCK")); self.assertFalse(_symbol_matches("HK", "2330.TW", "STOCK")); self.assertFalse(_symbol_matches("CN", "510300.SS", "STOCK")); self.assertTrue(_symbol_matches("CN", "510300.SS", "ETF"))

    def test_real_ohlcv_and_adjusted_close_are_consumed(self):
        raw=raw_factors(fixture("REAL")); self.assertTrue(raw["realOhlcv"]); self.assertEqual(raw["barCount"],300)

    def test_unknown_sector_and_source_conflict_block_buy(self):
        unknown=fixture("UNKNOWN",sector="Unclassified"); conflict=fixture("CONFLICT"); conflict["sourceConflicts"]=[{"differencePct":1.2}]
        rows=rank_snapshots([unknown,conflict,fixture("PEER",.1)])
        by={row["symbol"]:row for row in rows}; self.assertIn("SECTOR_UNKNOWN",by["UNKNOWN"]["hardGates"]); self.assertIn("SOURCE_CONFLICT",by["CONFLICT"]["hardGates"]); self.assertNotEqual(by["UNKNOWN"]["action"],"BUY")

    def test_models_are_versioned_and_stock_etf_are_isolated(self):
        rows=rank_snapshots([fixture("STOCK",.25),fixture("ETF",.25,"ETF")]); self.assertEqual({row["modelVersion"] for row in rows},{MODEL_VERSION}); self.assertTrue(all(row["configHash"]==CONFIG_HASH for row in rows)); self.assertEqual({row["assetModel"] for row in rows},{"STOCK_V2","ETF_V2"})

    def test_daily_buy_cap_is_enforced(self):
        universe=[fixture(f"S{i}",.2+i*.005) for i in range(8)] + [fixture(f"E{i}",.2+i*.005,"ETF") for i in range(4)]
        rows=rank_snapshots(universe); self.assertLessEqual(sum(row["action"]=="BUY" and row["assetType"]=="STOCK" for row in rows),3); self.assertLessEqual(sum(row["action"]=="BUY" and row["assetType"]=="ETF" for row in rows),1)

    def test_precomputed_v2_factors_preserve_exact_ranking(self):
        universe=[fixture(f"P{i}",.12+i*.01) for i in range(6)]
        expected=rank_snapshots(copy.deepcopy(universe))
        optimized=copy.deepcopy(universe)
        for item in optimized: item["_barsValidated"]=True
        raw={item["instrumentId"]:raw_factors(item) for item in optimized}
        self.assertEqual(rank_snapshots(optimized,raw_by_id=raw),expected)

    def test_market_parquet_can_restore_asset_specific_history(self):
        with tempfile.TemporaryDirectory() as source_root, tempfile.TemporaryDirectory() as restore_root:
            source=MarketCache(source_root); restored=MarketCache(restore_root)
            try:
                snapshot=fixture("PARQUET")
                source.store_history(snapshot)
                path=source.export_market_parquet("US","scan-fixture","STOCK")
                self.assertTrue(os.path.exists(path))
                self.assertEqual(restored.import_history_parquet(path,"US","STOCK"),300)
                self.assertEqual(len(restored.load_history("US:PARQUET")),300)
            finally:
                source.close(); restored.close()

    def test_failed_profile_scan_keeps_identity_and_does_not_publish_empty_artifact(self):
        class EmptyCache:
            root="fixture"
            def store_universe(self,*_): pass
            def store_histories(self,*_): pass
            def export_market_parquet(self,market,scan_id,asset_type): return f"{market}-{asset_type}.parquet"
            def close(self): pass

        profile=bridge.model_v22.market_profile("SG","ETF","v2.2-SG-ETF-defensive_pullback-core")
        with patch.object(bridge,"MarketCache",return_value=EmptyCache()), \
             patch.object(bridge,"restore_history_artifact",return_value=0), \
             patch.object(bridge,"discover_universe",return_value=[]), \
             patch.object(bridge,"enrich_candidate_profiles",side_effect=lambda _client,_cache,rows:rows), \
             patch.object(bridge,"fetch_benchmark_snapshot",side_effect=RuntimeError("provider unavailable")), \
             patch.object(bridge,"build_market_context",return_value={"regime":"BLOCKED_DATA"}), \
             patch.object(bridge,"rank_snapshots",return_value=[]), \
             patch.object(bridge.ProgressReporter,"report",return_value={"accepted":True}), \
             patch.object(bridge,"upload_artifact") as artifact, \
             patch.object(bridge,"upload_rankings",return_value=1) as rankings:
            result=bridge.run_full_scan(["SG"],500,100,"https://example.test","secret",workers=1,asset_types=["ETF"],job_id="job",component_id="component",market_profile_id=profile["profileId"],market_profile_hash=profile["configHash"])
        scan=rankings.call_args.args[3]
        self.assertEqual(result["status"],"partial")
        self.assertEqual(scan["marketProfileId"],profile["profileId"])
        self.assertEqual(scan["marketProfileHash"],profile["configHash"])
        self.assertFalse(scan["qualityGatePassed"])
        artifact.assert_not_called()


if __name__ == "__main__": unittest.main()
