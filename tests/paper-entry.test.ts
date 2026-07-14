import assert from "node:assert/strict";
import test from "node:test";
import { evaluateEntryZone } from "../lib/paper-entry";

test("the displayed CNY quote is inside its analyzed entry zone", () => {
  assert.deepEqual(evaluateEntryZone(24.73,{ entryLow:23.9457,entryHigh:25.1781 }),{
    price:24.73,entryLow:23.9457,entryHigh:25.1781,configured:true,inside:true,
  });
});

test("entry-zone validation includes both boundaries and rejects invalid plans", () => {
  assert.equal(evaluateEntryZone(23.9457,{ entryLow:23.9457,entryHigh:25.1781 }).inside,true);
  assert.equal(evaluateEntryZone(25.1781,{ entryLow:23.9457,entryHigh:25.1781 }).inside,true);
  assert.equal(evaluateEntryZone(25.19,{ entryLow:23.9457,entryHigh:25.1781 }).inside,false);
  assert.equal(evaluateEntryZone(24.73,{ entryLow:0,entryHigh:0 }).configured,false);
});
