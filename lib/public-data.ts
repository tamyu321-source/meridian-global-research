import { type AssetType, type MarketCode, type MarketSnapshot, type PriceBar } from "./types";

const REGION: Record<MarketCode, { region: string; currency: string; exchange: string }> = {
  US: { region: "US", currency: "USD", exchange: "NASDAQ/NYSE" }, CN: { region: "CN", currency: "CNY", exchange: "SSE/SZSE" },
  HK: { region: "HK", currency: "HKD", exchange: "HKEX" }, TW: { region: "TW", currency: "TWD", exchange: "TWSE/TPEX" },
  JP: { region: "JP", currency: "JPY", exchange: "TSE" }, KR: { region: "KR", currency: "KRW", exchange: "KRX" },
  SG: { region: "SG", currency: "SGD", exchange: "SGX" },
};

const REQUEST_HEADERS = { "User-Agent": "Mozilla/5.0 MeridianResearch/1.0", Accept: "application/json" };
const blockedProducts = /leveraged|inverse|bear\s*[23]x|bull\s*[23]x|warrant|權證|反向|槓桿/i;

async function jsonFetch<T>(url: string, timeoutMs = 9000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: REQUEST_HEADERS, signal: controller.signal });
    if (!response.ok) throw new Error(`provider-${response.status}`);
    return await response.json() as T;
  } finally { clearTimeout(timeout); }
}

export type YahooCandidate = { symbol?: string; shortName?: string; longName?: string; quoteType?: string; exchange?: string; fullExchangeName?: string; currency?: string };

export async function discoverMarket(market: MarketCode, count = 12): Promise<YahooCandidate[]> {
  const config = REGION[market];
  const url = `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&lang=en-US&region=${config.region}&scrIds=most_actives&count=${Math.min(50, count * 2)}&start=0`;
  const payload = await jsonFetch<{ finance?: { result?: Array<{ quotes?: YahooCandidate[] }> } }>(url);
  return (payload.finance?.result?.[0]?.quotes ?? [])
    .filter((item) => item.symbol && ["EQUITY", "ETF"].includes(String(item.quoteType).toUpperCase()))
    .filter((item) => !blockedProducts.test(`${item.shortName ?? ""} ${item.longName ?? ""}`))
    .slice(0, count);
}

export async function fetchSnapshot(candidate: YahooCandidate, market: MarketCode): Promise<MarketSnapshot> {
  const symbol = String(candidate.symbol).toUpperCase();
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
  const payload = await jsonFetch<{ chart?: { result?: Array<{ meta?: Record<string, unknown>; timestamp?: number[]; indicators?: { quote?: Array<Record<string, Array<number | null>>>; adjclose?: Array<{ adjclose?: Array<number | null> }> } }>; error?: unknown } }>(url);
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const bars: PriceBar[] = timestamps.map((timestamp, index) => ({
    timestamp, open: Number(quote.open?.[index] ?? adjusted[index] ?? 0), high: Number(quote.high?.[index] ?? adjusted[index] ?? 0),
    low: Number(quote.low?.[index] ?? adjusted[index] ?? 0), close: Number(adjusted[index] ?? quote.close?.[index] ?? 0), volume: Number(quote.volume?.[index] ?? 0),
  })).filter((bar) => bar.close > 0);
  if (bars.length < 20) throw new Error(`Insufficient chart data for ${symbol}`);
  const meta = result.meta ?? {};
  const price = Number(meta.regularMarketPrice ?? bars.at(-1)?.close ?? 0);
  const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? bars.at(-2)?.close ?? price);
  const config = REGION[market];
  const assetType: AssetType = String(candidate.quoteType).toUpperCase() === "ETF" ? "ETF" : "STOCK";
  return {
    instrumentId: `${market}:${symbol}`, symbol, name: candidate.shortName ?? candidate.longName ?? symbol, market,
    exchange: candidate.fullExchangeName ?? candidate.exchange ?? config.exchange, currency: candidate.currency ?? String(meta.currency ?? config.currency),
    assetType, source: "Yahoo Finance public chart", freshness: "delayed", capturedAt: new Date().toISOString(), bars,
    price, previousClose,
  };
}

export async function fetchSymbolSnapshot(symbol: string, market: MarketCode, name = symbol, assetType: AssetType = "STOCK") {
  return fetchSnapshot({ symbol, shortName: name, quoteType: assetType === "ETF" ? "ETF" : "EQUITY" }, market);
}

export async function scanPublicMarkets(markets: MarketCode[], countPerMarket = 4) {
  const discovered = await Promise.allSettled(markets.map(async (market) => ({ market, candidates: await discoverMarket(market, countPerMarket) })));
  const candidates = discovered.flatMap((result) => result.status === "fulfilled" ? result.value.candidates.map((candidate) => ({ market: result.value.market, candidate })) : []);
  const snapshots = await Promise.allSettled(candidates.map(({ market, candidate }) => fetchSnapshot(candidate, market)));
  return {
    snapshots: snapshots.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
    errors: [...discovered.filter((result) => result.status === "rejected").map((result) => String(result.reason)), ...snapshots.filter((result) => result.status === "rejected").map((result) => String(result.reason))],
  };
}
