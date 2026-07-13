import assert from "node:assert/strict";
import test from "node:test";
import { paperQuoteIsExecutable, paperQuoteNeedsRefresh } from "../lib/quote-freshness";

test("daily or weekend-close quotes are refreshed before paper execution", () => {
  const now = Date.parse("2026-07-13T01:00:00.000Z");
  assert.equal(paperQuoteNeedsRefresh("2026-07-10T20:00:00.000Z", "delayed", now), true);
  assert.equal(paperQuoteIsExecutable("2026-07-10T20:00:00.000Z", "delayed", now), false);
});

test("a just-refreshed delayed quote is executable but stale data never is", () => {
  const now = Date.parse("2026-07-13T01:00:00.000Z");
  assert.equal(paperQuoteIsExecutable("2026-07-13T00:55:00.000Z", "delayed", now), true);
  assert.equal(paperQuoteIsExecutable("2026-07-13T00:59:59.000Z", "stale", now), false);
  assert.equal(paperQuoteIsExecutable("not-a-date", "delayed", now), false);
});
