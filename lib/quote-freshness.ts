import type { DataFreshness } from "./types";

export const PAPER_QUOTE_REFRESH_MS = 15 * 60_000;

export function paperQuoteNeedsRefresh(capturedAt: string, freshness: DataFreshness | string, now = Date.now()) {
  const age = now - Date.parse(capturedAt);
  return freshness === "stale" || !Number.isFinite(age) || age > PAPER_QUOTE_REFRESH_MS;
}

export function paperQuoteIsExecutable(capturedAt: string, freshness: DataFreshness | string, now = Date.now()) {
  return !paperQuoteNeedsRefresh(capturedAt, freshness, now);
}
