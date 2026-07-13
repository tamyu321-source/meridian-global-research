import assert from "node:assert/strict";
import test from "node:test";
import { marketSymbolMatches, normalizeSparkQuotes } from "../lib/public-data";
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

test("server quote refresh maps a multi-symbol response by symbol and rejects invalid prices", () => {
  const result = normalizeSparkQuotes({ spark:{ result:[
    { symbol:"MSFT", response:[{ meta:{ regularMarketPrice:420, chartPreviousClose:390, regularMarketTime:1_720_000_000 }, indicators:{ quote:[{ close:[410,415,420] }] } }] },
    { symbol:"AAPL", response:[{ meta:{ regularMarketPrice:0, chartPreviousClose:200 } }] },
  ] } }, [
    { instrumentId:"US:AAPL", symbol:"AAPL" },
    { instrumentId:"US:MSFT", symbol:"MSFT" },
  ], "2026-07-13T01:00:00.000Z");
  assert.equal(result.quotes.length, 1);
  assert.equal(result.quotes[0].instrumentId, "US:MSFT");
  assert.equal(result.quotes[0].previousClose, 415);
  assert.equal(result.quotes[0].capturedAt, "2026-07-13T01:00:00.000Z");
  assert.deepEqual(result.missing, [{ instrumentId:"US:AAPL", symbol:"AAPL" }]);
});
