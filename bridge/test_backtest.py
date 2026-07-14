import copy
import json
import os
import tempfile
import unittest

from bridge.backtest import _base_result, _slice, calibrate_market_profiles, merge_shards, walk_forward
from bridge.model_v21 import raw_factors
from bridge.test_bridge import fixture


class BacktestShardTests(unittest.TestCase):
    def test_validated_slice_keeps_canonical_factor_output(self):
        source=fixture("SLICE")
        sliced,_=_slice(source,source["bars"][-2]["timestamp"])
        self.assertTrue(sliced["_barsValidated"])
        ordinary=copy.deepcopy(sliced); ordinary.pop("_barsValidated")
        self.assertEqual(raw_factors(sliced),raw_factors(ordinary))

    def test_locked_oos_walk_forward_finishes_a_small_fixture(self):
        universe=[fixture(f"W{index}",.1+index*.01) for index in range(4)]
        benchmark=fixture("BENCH",.08)
        candidate=walk_forward(copy.deepcopy(universe),copy.deepcopy(benchmark),"US",True,evaluation_sessions=8,progress_every=0)
        baseline=walk_forward(copy.deepcopy(universe),copy.deepcopy(benchmark),"US",False,evaluation_sessions=8,progress_every=0)
        self.assertIsInstance(candidate,list); self.assertIsInstance(baseline,list)
        self.assertTrue(all(item["sample"]=="OOS" for item in candidate+baseline))

    def test_calibration_keeps_all_nine_candidates_before_the_oos_split(self):
        universe=[fixture(f"C{index}",.1+index*.01) for index in range(4)]
        selected,evidence=calibrate_market_profiles(copy.deepcopy(universe),fixture("BENCH",.08),"US",evaluation_sessions=8,progress_every=0)
        self.assertEqual(set(selected),{("US","STOCK"),("US","ETF")})
        self.assertEqual(len(evidence["STOCK"]["candidates"]),9)
        self.assertEqual(len(evidence["ETF"]["candidates"]),9)
        self.assertIn(selected[("US","STOCK")],evidence["STOCK"]["candidates"])

    def test_market_shards_merge_without_losing_trade_evidence(self):
        with tempfile.TemporaryDirectory() as root:
            paths=[]
            for market,value in (("US",1.5),("CN",-0.5)):
                shard=_base_result("2026-07-13T00:00:00+00:00")
                trade={"market":market,"returnPct":value,"entryState":"BREAKOUT_READY","exitReason":"MODEL_EXIT","holdingSessions":12,"extensionAtr":1,"sample":"OOS"}
                shard["markets"][market]={"metrics":{},"baselineMetrics":{},"comparison":{},"allPeriodMetrics":{},"trades":[trade],"baselineTrades":[{**trade,"returnPct":value/2}]}
                path=os.path.join(root,f"market-{market}.json")
                with open(path,"w",encoding="utf-8") as handle: json.dump(shard,handle)
                paths.append(path)
            merged=merge_shards(paths)
            self.assertEqual(set(merged["markets"]),{"US","CN"})
            self.assertEqual(merged["overall"]["tradeCount"],2)
            self.assertFalse(merged["shards"]["complete"])


if __name__=="__main__": unittest.main()
