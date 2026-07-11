import assert from "node:assert/strict";
import test from "node:test";
import { marketSymbolMatches } from "../lib/public-data";
import type { MarketCode } from "../lib/types";

const marketSamples: Record<MarketCode, string> = {
  US: "NVDA",
  CN: "600519.SS",
  HK: "0700.HK",
  TW: "2330.TW",
  JP: "7203.T",
  KR: "005930.KS",
  SG: "D05.SI",
};

test("every market accepts its own symbol format and rejects every other market", () => {
  for (const [market, symbol] of Object.entries(marketSamples) as Array<[MarketCode, string]>) {
    assert.equal(marketSymbolMatches(market, symbol), true, `${market} should accept ${symbol}`);
    for (const other of Object.keys(marketSamples) as MarketCode[]) {
      if (other !== market) assert.equal(marketSymbolMatches(other, symbol), false, `${other} must reject ${symbol}`);
    }
  }
});

test("stock validation excludes common fund, warrant, and leveraged symbol patterns", () => {
  assert.equal(marketSymbolMatches("CN", "510300.SS", "STOCK"), false);
  assert.equal(marketSymbolMatches("HK", "55526.HK", "STOCK"), false);
  assert.equal(marketSymbolMatches("TW", "00631L.TW", "ETF"), false);
  assert.equal(marketSymbolMatches("TW", "0050.TW", "ETF"), true);
});
