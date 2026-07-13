import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSetupMetrics } from "../lib/setup-metrics";

const completeSetup = {
  entryState:"WAIT_PULLBACK",
  setupType:"NONE",
  distance52WeekHighPct:-2.4,
  distance5YearHighPct:-8.1,
  extensionAtr:1.2,
  breakoutLevel:100,
  volumeRatio:1.1,
  closeLocation:0.72,
  gapAtr:0.2,
  rangeAtr:1.4,
  coolingSessionsRemaining:0,
  marketRegime:"RISK_ON",
  marketBreadthPct:63.5,
  benchmarkSymbol:"SPY",
  researchEligible:true,
} as const;

test("legacy empty setup payload is normalized away", () => {
  assert.equal(normalizeSetupMetrics({}), undefined);
  assert.equal(normalizeSetupMetrics(null), undefined);
});

test("partial v2.1 setup payload cannot reach the detail renderer", () => {
  assert.equal(normalizeSetupMetrics({ entryState:"WAIT_PULLBACK" }), undefined);
  assert.equal(normalizeSetupMetrics({ ...completeSetup, extensionAtr:undefined }), undefined);
});

test("complete v2.1 setup payload remains available", () => {
  assert.deepEqual(normalizeSetupMetrics(completeSetup), completeSetup);
});
