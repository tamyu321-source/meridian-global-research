import unittest

from bridge.meridian_bridge import _symbol_matches
from bridge.model_v2 import CONFIG_HASH, MODEL_VERSION, number, rank_snapshots, raw_factors


def fixture(symbol, slope=.2, asset_type="STOCK", sector="Technology", volume_multiplier=1):
    bars=[]
    for i in range(300):
        close=100+i*slope
        volume=(1_000_000+i*1000)*volume_multiplier
        bars.append({"timestamp":1_700_000_000+i*86400,"open":close-.5,"high":close+1,"low":close-1,"close":close,"adjClose":close,"volume":volume,"dividend":0,"splitRatio":1})
    return {"instrumentId":f"US:{symbol}","symbol":symbol,"name":symbol,"market":"US","exchange":"NASDAQ","currency":"USD","assetType":asset_type,"sector":sector,"source":"fixture","sourceCount":2,"freshness":"delayed","capturedAt":"2026-07-12T00:00:00+00:00","bars":bars,"price":bars[-1]["close"],"previousClose":bars[-2]["close"],"sourceWarnings":[],"sourceConflicts":[],"corporateActionAnomalies":[],"etfStructure":{"score":70,"missingNonCritical":False,"excluded":False}}


class BridgeUnitTests(unittest.TestCase):
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


if __name__ == "__main__": unittest.main()
