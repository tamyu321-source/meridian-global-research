import copy
import unittest

from bridge.model_v22 import (
    MARKET_PROFILES,
    MODEL_VERSION,
    choose_calibrated_profile,
    market_profile,
    profile_candidates,
    rank_snapshots,
    raw_factors,
)
from bridge.test_bridge import fixture


class ModelV22Tests(unittest.TestCase):
    def context(self):
        return {"available":True,"breadthPct":70,"benchmarkSymbol":"^GSPC","benchmarkCurrent":120,"benchmarkSma50":110,"benchmarkSma200":100,"benchmarkReturn20":3,"benchmarkReturn3m":4,"benchmarkReturn6m":8,"benchmarkVolatility":15}

    def test_fourteen_default_profiles_and_nine_locked_candidates_per_bucket(self):
        self.assertEqual(len(MARKET_PROFILES),14)
        for market in ("US","CN","HK","TW","JP","KR","SG"):
            for asset in ("STOCK","ETF"):
                candidates=profile_candidates(market,asset)
                self.assertEqual(len(candidates),9)
                self.assertEqual(len({item["configHash"] for item in candidates}),9)
                self.assertAlmostEqual(sum(market_profile(market,asset)["weights"].values()),1)

    def test_stock_and_etf_factor_weights_remain_isolated(self):
        stock=market_profile("US","STOCK")
        etf=market_profile("US","ETF")
        self.assertNotIn("structure",stock["weights"])
        self.assertIn("structure",etf["weights"])
        self.assertNotEqual(stock["profileId"],etf["profileId"])

    def test_calibration_selection_uses_reliability_first_tie_breaks(self):
        evidence={
            "high-sharpe":{"tradeCount":60,"expectancyPct":1,"profitFactor":2,"sharpe":1.8,"maxDrawdownPct":8,"falseBreakout10dPct":8},
            "low-drawdown":{"tradeCount":45,"expectancyPct":.4,"profitFactor":1.3,"sharpe":.9,"maxDrawdownPct":5,"falseBreakout10dPct":12},
            "invalid":{"tradeCount":80,"expectancyPct":-1,"profitFactor":3,"sharpe":2,"maxDrawdownPct":3,"falseBreakout10dPct":2},
        }
        self.assertEqual(choose_calibrated_profile(evidence),"low-drawdown")

    def test_profile_hash_and_ranking_are_reproducible(self):
        universe=[fixture(f"V22-{index}",.1+index*.01) for index in range(8)]
        first=rank_snapshots(copy.deepcopy(universe),market_contexts={"US":self.context()})
        raw={item["instrumentId"]:raw_factors(item) for item in universe}
        second=rank_snapshots(universe,market_contexts={"US":self.context()},raw_by_id=raw)
        self.assertEqual(first,second)
        self.assertEqual({item["modelVersion"] for item in first},{MODEL_VERSION})
        self.assertTrue(all(item["marketProfileHash"]==market_profile(item["market"],item["assetType"])["configHash"] for item in first))
        self.assertTrue(all(item["tradePlan"]["maxWeightPct"]==30 for item in first))
        self.assertTrue(all(item["tradePlan"]["positionSizeMultiplier"] in (.5,1) for item in first))


if __name__=="__main__":
    unittest.main()
