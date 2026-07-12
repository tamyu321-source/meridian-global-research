import assert from "node:assert/strict";
import test from "node:test";
import { calculateCapitalAdjustment } from "../lib/portfolio-capital";

test("increasing paper capital adds only the difference to cash", () => {
  assert.deepEqual(calculateCapitalAdjustment({startingCapital:5_000,cash:2_000,highWatermark:5_500},8_000), {
    ok:true, previousCapital:5_000, capital:8_000, delta:3_000, cash:5_000, highWatermark:8_500,
  });
});

test("reducing paper capital preserves holdings and deducts the difference from cash", () => {
  assert.deepEqual(calculateCapitalAdjustment({startingCapital:8_000,cash:5_000,highWatermark:8_500},6_000), {
    ok:true, previousCapital:8_000, capital:6_000, delta:-2_000, cash:3_000, highWatermark:6_500,
  });
});

test("capital cannot be reduced below the currently invested amount", () => {
  assert.deepEqual(calculateCapitalAdjustment({startingCapital:8_000,cash:1_000,highWatermark:8_000},5_000), {
    ok:false, reason:"CAPITAL_REDUCTION_BLOCKED", minimumCapital:7_000,
  });
});
