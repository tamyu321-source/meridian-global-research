import assert from "node:assert/strict";
import test from "node:test";
import { defaultRiskPolicy, effectivePositionLimit, estimateTradeRisk, templateMarketLimit, validateRiskPolicy } from "../lib/risk-policy";
import { defaultMarketProfileIdentity, marketProfileStatusAfterValidation } from "../lib/model-profiles";

test("TypeScript and Python share the same immutable profile hash", async () => {
  const profile=await defaultMarketProfileIdentity("US","STOCK");
  assert.equal(profile.configHash,"39ae5b3719713764b5cc63bfee8efd64cbafc333c0ed8c4fcd68a1f53b16e9e7");
});

test("one enabled market receives a 100 percent default limit", () => {
  assert.equal(templateMarketLimit("capital_first",["CN"]),100);
  const policy=defaultRiskPolicy("capital_first",["CN"]);
  assert.deepEqual(policy.enabledMarkets,["CN"]);
  assert.equal(policy.marketLimits.CN,100);
});

test("multi-market templates retain the safer plan floor", () => {
  assert.equal(templateMarketLimit("capital_first",["US","CN","HK"]),35);
  assert.equal(templateMarketLimit("balanced",["US","CN","HK"]),45);
  assert.equal(templateMarketLimit("growth",["US","CN"]),60);
});

test("custom policy ranges and relationships are enforced server-side", () => {
  assert.equal(validateRiskPolicy("capital_first",{enabledMarkets:[]}).ok,false);
  assert.equal(validateRiskPolicy("capital_first",{riskBudgetPct:2.1}).ok,false);
  assert.equal(validateRiskPolicy("capital_first",{maxWeightPct:20,maxSectorPct:10}).ok,false);
  assert.equal(validateRiskPolicy("capital_first",{enabledMarkets:["CN"],maxWeightPct:20,marketLimits:{CN:15}}).ok,false);
  const valid=validateRiskPolicy("capital_first",{enabledMarkets:["CN"],riskBudgetPct:.7,maxWeightPct:20,maxSectorPct:30,marketLimits:{CN:100},drawdownBreakerPct:12});
  assert.equal(valid.ok,true);
  if(valid.ok){assert.equal(valid.policy.marketLimits.CN,100);assert.equal(valid.policy.riskBudgetPct,.7);}
});

test("stop-based risk reports maximum quantity and minimum capital", () => {
  const risk=estimateTradeRisk(100,95,100,1,10,50_000,1);
  assert.equal(risk.riskBase,510);
  assert.equal(risk.riskPct,1.02);
  assert.equal(risk.maximumQuantity,98);
  assert.equal(risk.minimumCapital,51_000);
});

test("custom position limits remain effective and neutral regimes halve them", () => {
  assert.equal(effectivePositionLimit(20,30,1),20);
  assert.equal(effectivePositionLimit(20,30,.5),10);
  assert.equal(effectivePositionLimit(20,12,1),12);
});

test("bucket validation advances only after 30 valid trading days", () => {
  assert.equal(marketProfileStatusAfterValidation("BACKTEST_PASSED",1),"SHADOW_VALIDATING");
  assert.equal(marketProfileStatusAfterValidation("SHADOW_VALIDATING",29),"SHADOW_VALIDATING");
  assert.equal(marketProfileStatusAfterValidation("SHADOW_VALIDATING",30),"ACTIVE_SHADOW");
  assert.equal(marketProfileStatusAfterValidation("REJECTED",40),"REJECTED");
});
