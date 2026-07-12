import unittest
from bridge.meridian_bridge import _at, _number, _symbol_matches, rank_snapshots


class BridgeUnitTests(unittest.TestCase):
    def test_number_rejects_missing_and_nan(self):
        self.assertEqual(_number(None), 0)
        self.assertEqual(_number("nan"), 0)
        self.assertEqual(_number("12.5"), 12.5)

    def test_at_handles_sparse_provider_arrays(self):
        self.assertEqual(_at([1, None, 3], 1), 0)
        self.assertEqual(_at([1, 2, 3], 2), 3)

    def test_market_contracts_reject_cross_market_symbols(self):
        self.assertTrue(_symbol_matches("TW", "2330.TW", "STOCK"))
        self.assertFalse(_symbol_matches("HK", "2330.TW", "STOCK"))
        self.assertFalse(_symbol_matches("CN", "510300.SS", "STOCK"))
        self.assertTrue(_symbol_matches("CN", "510300.SS", "ETF"))

    def test_full_peer_ranking_is_deterministic(self):
        def item(symbol, slope):
            bars = [{"timestamp":1_700_000_000+i*86400,"open":100+i*slope,"high":100+i*slope,"low":100+i*slope,"close":100+i*slope,"volume":1_000_000} for i in range(300)]
            return {"instrumentId":f"US:{symbol}","symbol":symbol,"name":symbol,"market":"US","exchange":"NASDAQ","currency":"USD","assetType":"STOCK","sector":"Unclassified","source":"fixture","freshness":"delayed","capturedAt":"2026-07-12T00:00:00+00:00","bars":bars,"price":bars[-1]["close"],"previousClose":bars[-2]["close"]}
        universe = [item("UP", .2), item("FLAT", 0), item("DOWN", -.05)]
        self.assertEqual([row["symbol"] for row in rank_snapshots(universe)], [row["symbol"] for row in rank_snapshots(universe)])


if __name__ == "__main__":
    unittest.main()
