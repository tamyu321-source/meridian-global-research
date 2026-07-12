import assert from "node:assert/strict";
import test from "node:test";
import { rankSnapshots } from "../lib/algorithm";
import type { MarketSnapshot } from "../lib/types";

function snapshot(symbol: string, slope: number, freshness: MarketSnapshot["freshness"] = "delayed", count = 300): MarketSnapshot {
  const bars = Array.from({ length: count }, (_, index) => {
    const close = 100 + index * slope + Math.sin(index / 9);
    return { timestamp: 1_700_000_000 + index * 86400, open: close - .3, high: close + 1, low: close - 1, close, volume: 1_000_000 + index * 1000 };
  });
  return { instrumentId:`US:${symbol}`,symbol,name:symbol,market:"US",exchange:"NASDAQ",currency:"USD",assetType:"STOCK",source:"fixture",freshness,capturedAt:new Date().toISOString(),bars,price:bars.at(-1)!.close,previousClose:bars.at(-2)!.close };
}

test("ranking is deterministic and public data remains shadow", () => {
  const first = rankSnapshots([snapshot("UP", .2), snapshot("FLAT", 0), snapshot("DOWN", -.08)]);
  const second = rankSnapshots([snapshot("UP", .2), snapshot("FLAT", 0), snapshot("DOWN", -.08)]);
  assert.deepEqual(first.map(item => [item.symbol,item.score,item.status]), second.map(item => [item.symbol,item.score,item.status]));
  assert.equal(first[0].symbol, "UP");
  assert.ok(first.every(item => item.status === "SHADOW"));
  assert.ok(first.every(item => item.action === "WATCH"));
  assert.ok(first.every(item => item.hardGates.includes("SITE_FALLBACK_WATCH_ONLY")));
});

test("insufficient history and stale data create hard gates", () => {
  const [result] = rankSnapshots([snapshot("THIN", .1, "stale", 120)]);
  assert.ok(result.hardGates.includes("INSUFFICIENT_HISTORY"));
  assert.ok(result.hardGates.includes("STALE_DATA"));
  assert.notEqual(result.action, "BUY");
});

test("risk plans change the maximum position size", () => {
  const universe = [snapshot("A", .2), snapshot("B", .1), snapshot("C", 0)];
  assert.equal(rankSnapshots(universe, "capital_first")[0].tradePlan.maxWeightPct, 5);
  assert.equal(rankSnapshots(universe, "balanced")[0].tradePlan.maxWeightPct, 8);
  assert.equal(rankSnapshots(universe, "growth")[0].tradePlan.maxWeightPct, 12);
});
