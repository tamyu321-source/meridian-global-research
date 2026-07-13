import assert from "node:assert/strict";
import test from "node:test";
import { deriveHoldingAdvice, type HoldingAdviceInput } from "../lib/holding-advice";

const now = Date.parse("2026-07-13T08:00:00.000Z");
const base:HoldingAdviceInput = {
  market:"US",assetType:"STOCK",sector:"Technology",quantity:100,sellableQuantity:100,price:110,averageCost:100,fxRate:1,
  baseMarketValue:11_000,equity:200_000,marketExposure:40_000,sectorExposure:30_000,riskPlan:"balanced",
  quoteFreshness:"delayed",quoteCapturedAt:"2026-07-13T07:55:00.000Z",recentScores:[{score:72,confidence:82,scoreDate:"2026-07-13"}],now,
  signal:{action:"WATCH",score:72,confidence:82,analysisCapturedAt:"2026-07-13T01:00:00.000Z",analysisPrice:108,modelVersion:"v2",assetModel:"STOCK_V2",validationStatus:"SHADOW",
    tradePlan:{entryLow:104,entryHigh:112,invalidation:96,stop:98,target1:120,target2:135,trailingAtr:2,rewardRisk:2.5,maxWeightPct:8,riskBudgetPct:1},reasonCodes:[],hardGates:[],conflicts:[],corporateActionAnomalies:[]},
};

test("current holding with a valid plan receives HOLD", () => {
  const advice=deriveHoldingAdvice(base);
  assert.equal(advice.action,"HOLD");
  assert.equal(advice.recommendedSellQuantity,0);
  assert.equal(advice.returnPct,10);
});

test("stale quote requires review instead of fabricating an exit", () => {
  const advice=deriveHoldingAdvice({...base,quoteCapturedAt:"2026-07-13T07:00:00.000Z",price:90});
  assert.equal(advice.action,"REVIEW");
  assert.deepEqual(advice.reasonCodes,["HOLDING_QUOTE_STALE"]);
});

test("stop and consecutive sub-50 scores produce EXIT", () => {
  const advice=deriveHoldingAdvice({...base,price:97,recentScores:[{score:49,confidence:70,scoreDate:"2026-07-13"},{score:48,confidence:71,scoreDate:"2026-07-12"}]});
  assert.equal(advice.action,"EXIT");
  assert.equal(advice.recommendedSellQuantity,100);
  assert.ok(advice.reasonCodes.includes("HOLDING_STOP_TRIGGERED"));
  assert.ok(advice.reasonCodes.includes("HOLDING_SCORE_BELOW_50_TWO_DAYS"));
});

test("target and exposure triggers produce a market-valid REDUCE quantity", () => {
  const advice=deriveHoldingAdvice({...base,market:"CN",quantity:137,sellableQuantity:137,price:130,baseMarketValue:17_810,equity:100_000,marketExposure:50_000,sectorExposure:30_000,riskPlan:"capital_first"});
  assert.equal(advice.action,"REDUCE");
  assert.equal(advice.recommendedSellQuantity%100,0);
  assert.ok(advice.reasonCodes.includes("HOLDING_TARGET1_REACHED"));
  assert.ok(advice.reasonCodes.includes("HOLDING_POSITION_LIMIT_EXCEEDED"));
});

test("China EXIT can clear an odd-lot remainder", () => {
  const advice=deriveHoldingAdvice({...base,market:"CN",quantity:137,sellableQuantity:137,price:95,signal:{...base.signal!,action:"EXIT"}});
  assert.equal(advice.action,"EXIT");
  assert.equal(advice.recommendedSellQuantity,137);
});
