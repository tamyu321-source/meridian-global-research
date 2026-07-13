import copy
import unittest

from bridge.model_v21 import MODEL_VERSION, _entry_setup, rank_snapshots, raw_factors
from bridge.test_bridge import fixture


class ModelV21Tests(unittest.TestCase):
    def context(self, regime="RISK_ON"):
        return {"available":True,"regime":regime,"breadthPct":72,"benchmarkSymbol":"^GSPC","benchmarkReturn3m":4,"benchmarkReturn6m":8}

    def test_recent_five_sessions_are_excluded_from_momentum(self):
        calm=fixture("CALM")
        noisy=copy.deepcopy(calm)
        for index,bar in enumerate(noisy["bars"][-5:],1):
            bar["close"]+=index*20; bar["adjClose"]=bar["close"]; bar["high"]=bar["close"]+1; bar["low"]=bar["close"]-1
        self.assertAlmostEqual(raw_factors(calm)["momentum"],raw_factors(noisy)["momentum"],places=8)

    def test_entry_engine_requires_market_context(self):
        raw=raw_factors(fixture("BLOCKED"))
        self.assertEqual(_entry_setup(raw,{"available":False}),"BLOCKED_DATA")
        self.assertEqual(_entry_setup(raw,self.context("RISK_OFF")),"BLOCKED_REGIME")

    def test_high_quality_breakout_and_overextension_are_separate(self):
        breakout=fixture("BREAKOUT")
        latest=breakout["bars"][-1]; previous=breakout["bars"][-2]["close"]
        latest["close"]=previous+1.2; latest["adjClose"]=latest["close"]; latest["open"]=previous+.1; latest["high"]=latest["close"]+.2; latest["low"]=latest["close"]-1; latest["volume"]*=2; breakout["price"]=latest["close"]
        self.assertEqual(_entry_setup(raw_factors(breakout),self.context()),"BREAKOUT_READY")
        self.assertEqual(_entry_setup(raw_factors(breakout),self.context("NEUTRAL")),"WAIT_PULLBACK")
        stretched=copy.deepcopy(breakout)
        prior=stretched["bars"][-2]["close"]; latest=stretched["bars"][-1]
        latest.update({"open":prior,"close":prior+12,"adjClose":prior+12,"high":prior+12.2,"low":prior-.2,"volume":latest["volume"]})
        stretched["price"]=latest["close"]
        self.assertEqual(_entry_setup(raw_factors(stretched),self.context()),"OVEREXTENDED")

    def test_candidate_records_preserve_versioned_setup_evidence(self):
        universe=[fixture(f"S{index}",.12+index*.01) for index in range(10)]
        rows=rank_snapshots(universe,market_contexts={"US":self.context()})
        self.assertTrue(rows)
        self.assertEqual({row["modelVersion"] for row in rows},{MODEL_VERSION})
        self.assertTrue(all(row["entryState"]==row["setupMetrics"]["entryState"] for row in rows))
        self.assertLessEqual(sum(row["action"]=="BUY" for row in rows),3)


if __name__=="__main__":
    unittest.main()
