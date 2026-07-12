import assert from "node:assert/strict";
import test from "node:test";
import { estimateMarketCosts, marketSessionState, MARKET_RULE_VERSION, validateMarketQuantity, validatePositionQuantity } from "../lib/market-rules";

test("China A-share buys require board lots while sells allow residual quantities", () => {
  assert.match(validateMarketQuantity("CN", "STOCK", "BUY", 99) ?? "", /multiple of 100/);
  assert.equal(validateMarketQuantity("CN", "STOCK", "BUY", 100), null);
  assert.equal(validateMarketQuantity("CN", "STOCK", "SELL", 37), null);
  assert.equal(validatePositionQuantity("CN", "SELL", 37, 137), null);
  assert.match(validatePositionQuantity("CN", "SELL", 36, 137) ?? "", /odd-lot remainder/);
});

test("Japan stocks and ETFs keep separate quantity rules", () => {
  assert.match(validateMarketQuantity("JP", "STOCK", "BUY", 1) ?? "", /multiple of 100/);
  assert.equal(validateMarketQuantity("JP", "STOCK", "BUY", 100), null);
  assert.equal(validateMarketQuantity("JP", "ETF", "BUY", 1), null);
});

test("Taiwan applies the lower ETF sell tax and records the rule version", () => {
  const stock = estimateMarketCosts("TW", "STOCK", "SELL", 100_000, 1_000);
  const etf = estimateMarketCosts("TW", "ETF", "SELL", 100_000, 1_000);
  assert.equal(stock.sellTax, 300);
  assert.equal(etf.sellTax, 100);
  assert.equal(stock.ruleVersion, MARKET_RULE_VERSION);
});

test("Hong Kong ETF orders do not accrue estimated stamp duty", () => {
  const stock = estimateMarketCosts("HK", "STOCK", "BUY", 100_000, 1_000);
  const etf = estimateMarketCosts("HK", "ETF", "BUY", 100_000, 1_000);
  assert.equal(stock.stampDuty, 100);
  assert.equal(etf.stampDuty, 0);
});

test("US commission uses per-share pricing with a minimum", () => {
  assert.equal(estimateMarketCosts("US", "STOCK", "BUY", 1_000, 1).commission, .35);
  assert.equal(estimateMarketCosts("US", "STOCK", "BUY", 100_000, 1_000).commission, 3.5);
});

test("market session labels are explicitly estimates", () => {
  assert.match(marketSessionState("US", new Date("2026-07-13T14:00:00Z")).state, /_ESTIMATE$/);
  assert.equal(marketSessionState("US", new Date("2026-07-12T14:00:00Z")).state, "CLOSED_ESTIMATE");
});
