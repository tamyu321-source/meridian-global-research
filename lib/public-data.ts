import { type AssetType, type MarketCode, type MarketSnapshot, type PriceBar } from "./types";

type MarketConfig = {
  currency: string;
  exchange: string;
  yahooExchanges: string[];
  minimumMarketCap: number;
  fallbackStocks: string[];
  fallbackEtfs: string[];
};

const MARKET: Record<MarketCode, MarketConfig> = {
  US: { currency: "USD", exchange: "NASDAQ/NYSE", yahooExchanges: ["NMS", "NYQ", "NGM", "NCM", "ASE"], minimumMarketCap: 2_000_000_000, fallbackStocks: ["NVDA", "MSFT", "AAPL", "AMZN", "META", "GOOGL"], fallbackEtfs: ["SPY", "QQQ", "IWM"] },
  CN: { currency: "CNY", exchange: "SSE/SZSE", yahooExchanges: ["SHH", "SHZ"], minimumMarketCap: 5_000_000_000, fallbackStocks: ["600519.SS", "601318.SS", "600036.SS", "000858.SZ", "000333.SZ", "300750.SZ"], fallbackEtfs: ["510300.SS", "510500.SS", "159919.SZ"] },
  HK: { currency: "HKD", exchange: "HKEX", yahooExchanges: ["HKG"], minimumMarketCap: 2_000_000_000, fallbackStocks: ["0700.HK", "9988.HK", "0005.HK", "1299.HK", "3690.HK", "2318.HK"], fallbackEtfs: ["2800.HK", "2828.HK", "3033.HK"] },
  TW: { currency: "TWD", exchange: "TWSE/TPEX", yahooExchanges: ["TAI", "TWO"], minimumMarketCap: 10_000_000_000, fallbackStocks: ["2330.TW", "2317.TW", "2454.TW", "2308.TW", "2881.TW", "2382.TW"], fallbackEtfs: ["0050.TW", "0056.TW", "006208.TW"] },
  JP: { currency: "JPY", exchange: "TSE", yahooExchanges: ["JPX"], minimumMarketCap: 50_000_000_000, fallbackStocks: ["7203.T", "6758.T", "9984.T", "8306.T", "6861.T", "6501.T"], fallbackEtfs: ["1306.T", "1321.T", "2558.T"] },
  KR: { currency: "KRW", exchange: "KRX", yahooExchanges: ["KSC", "KOE"], minimumMarketCap: 100_000_000_000, fallbackStocks: ["005930.KS", "000660.KS", "373220.KS", "207940.KS", "005380.KS", "035420.KS"], fallbackEtfs: ["069500.KS", "102110.KS", "229200.KS"] },
  SG: { currency: "SGD", exchange: "SGX", yahooExchanges: ["SES"], minimumMarketCap: 500_000_000, fallbackStocks: ["D05.SI", "O39.SI", "U11.SI", "C6L.SI", "Z74.SI", "BN4.SI"], fallbackEtfs: ["ES3.SI", "G3B.SI", "S27.SI"] },
};

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  Accept: "application/json",
};
const blockedProducts = /leveraged|inverse|ultra(?:pro|short)?|bear\s*[23]x|bull\s*[23]x|\b[23]x\b|warrant|callable\s+(?:bull|bear)|牛熊|權證|权证/i;

async function jsonFetch<T>(url: string, timeoutMs = 9_000, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, headers: { ...REQUEST_HEADERS, ...init?.headers }, signal: controller.signal });
    if (!response.ok) throw new Error(`provider-${response.status}`);
    return await response.json() as T;
  } finally { clearTimeout(timeout); }
}

export type YahooCandidate = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  quoteType?: string;
  exchange?: string;
  fullExchangeName?: string;
  currency?: string;
  sector?: string;
  industry?: string;
  discoverySource?: "yahoo-screener" | "market-fallback";
};

type YahooSession = { cookie: string; crumb: string };
let yahooSessionPromise: Promise<YahooSession> | null = null;

async function createYahooSession(): Promise<YahooSession> {
  const cookieResponse = await fetch("https://fc.yahoo.com", { headers: { ...REQUEST_HEADERS, Accept: "*/*" }, redirect: "manual" });
  const cookie = cookieResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  if (!cookie) throw new Error("Yahoo session cookie unavailable");
  const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { ...REQUEST_HEADERS, Accept: "*/*", Cookie: cookie } });
  if (!crumbResponse.ok) throw new Error(`Yahoo crumb unavailable (${crumbResponse.status})`);
  const crumb = await crumbResponse.text();
  if (!crumb || crumb.includes("Too Many Requests")) throw new Error("Yahoo crumb invalid");
  return { cookie, crumb };
}

function yahooSession() {
  yahooSessionPromise ??= createYahooSession().catch((error) => {
    yahooSessionPromise = null;
    throw error;
  });
  return yahooSessionPromise;
}

function cleanSymbol(symbol: string) {
  return symbol.trim().toUpperCase();
}

export function marketSymbolMatches(market: MarketCode, symbolInput: string, assetType: AssetType = "STOCK") {
  const symbol = cleanSymbol(symbolInput);
  const suffixMatches: Record<Exclude<MarketCode, "US">, RegExp> = {
    CN: /\.(?:SS|SZ)$/,
    HK: /\.HK$/,
    TW: /\.(?:TW|TWO)$/,
    JP: /\.T$/,
    KR: /\.(?:KS|KQ)$/,
    SG: /\.SI$/,
  };
  if (market === "US") return !symbol.includes(".") && /^[A-Z][A-Z0-9-]{0,9}$/.test(symbol);
  if (!suffixMatches[market].test(symbol)) return false;
  if (assetType === "ETF") return !(market === "TW" && /[LR]\.TW$/.test(symbol));
  if (market === "CN") return /^(?:(?:60|68)\d{4}\.SS|(?:00|30)\d{4}\.SZ)$/.test(symbol);
  if (market === "HK") return /^\d{4}\.HK$/.test(symbol);
  if (market === "TW") return /^\d{4}\.(?:TW|TWO)$/.test(symbol);
  if (market === "JP") return /^\d{4}\.T$/.test(symbol);
  if (market === "KR") return /^\d{6}\.(?:KS|KQ)$/.test(symbol);
  return /^[A-Z0-9]{1,5}\.SI$/.test(symbol);
}

function candidateIsInMarket(candidate: YahooCandidate, market: MarketCode, assetType: AssetType) {
  const config = MARKET[market];
  const text = `${candidate.shortName ?? ""} ${candidate.longName ?? ""}`;
  return Boolean(candidate.symbol)
    && config.yahooExchanges.includes(String(candidate.exchange).toUpperCase())
    && (!candidate.currency || candidate.currency === config.currency)
    && marketSymbolMatches(market, String(candidate.symbol), assetType)
    && !blockedProducts.test(text);
}

async function customScreener(market: MarketCode, assetType: AssetType, count: number): Promise<YahooCandidate[]> {
  const config = MARKET[market];
  const session = await yahooSession();
  const body = {
    size: Math.min(50, Math.max(count * 3, 10)), offset: 0, sortField: "dayvolume", sortType: "DESC",
    quoteType: assetType === "ETF" ? "ETF" : "EQUITY",
    query: { operator: "AND", operands: [
      { operator: "OR", operands: config.yahooExchanges.map((exchange) => ({ operator: "EQ", operands: ["exchange", exchange] })) },
      ...(assetType === "STOCK" ? [{ operator: "GT", operands: ["intradaymarketcap", config.minimumMarketCap] }] : []),
    ] },
    userId: "", userIdType: "guid",
  };
  const url = `https://query2.finance.yahoo.com/v1/finance/screener?formatted=false&lang=en-US&region=US&crumb=${encodeURIComponent(session.crumb)}`;
  const payload = await jsonFetch<{ finance?: { result?: Array<{ quotes?: YahooCandidate[] }>; error?: { description?: string } } }>(url, 12_000, {
    method: "POST", headers: { Cookie: session.cookie, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (payload.finance?.error) throw new Error(payload.finance.error.description ?? "Yahoo screener failed");
  return (payload.finance?.result?.[0]?.quotes ?? [])
    .filter((candidate) => candidateIsInMarket(candidate, market, assetType))
    .map((candidate) => ({ ...candidate, quoteType: assetType === "ETF" ? "ETF" : "EQUITY", discoverySource: "yahoo-screener" as const }))
    .slice(0, count);
}

function fallbackCandidates(market: MarketCode, assetType: AssetType, count: number): YahooCandidate[] {
  const config = MARKET[market];
  const symbols = assetType === "ETF" ? config.fallbackEtfs : config.fallbackStocks;
  return symbols.slice(0, count).map((symbol) => ({ symbol, quoteType: assetType === "ETF" ? "ETF" : "EQUITY", currency: config.currency, discoverySource: "market-fallback" }));
}

async function discoverAsset(market: MarketCode, assetType: AssetType, count: number) {
  if (count <= 0) return [];
  try {
    const live = await customScreener(market, assetType, count);
    if (live.length >= count) return live;
    const seen = new Set(live.map((item) => item.symbol));
    return [...live, ...fallbackCandidates(market, assetType, count).filter((item) => !seen.has(item.symbol))].slice(0, count);
  } catch {
    return fallbackCandidates(market, assetType, count);
  }
}

export async function discoverMarket(market: MarketCode, count = 12, assetType: AssetType | "ALL" = "ALL"): Promise<YahooCandidate[]> {
  if (assetType !== "ALL") return discoverAsset(market, assetType, count);
  const etfCount = count >= 5 ? Math.max(1, Math.floor(count * 0.2)) : 0;
  const stockCount = count - etfCount;
  const [stocks, etfs] = await Promise.all([discoverAsset(market, "STOCK", stockCount), discoverAsset(market, "ETF", etfCount)]);
  return [...stocks, ...etfs];
}

export async function fetchSnapshot(candidate: YahooCandidate, market: MarketCode): Promise<MarketSnapshot> {
  const symbol = cleanSymbol(String(candidate.symbol));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
  const payload = await jsonFetch<{ chart?: { result?: Array<{ meta?: Record<string, unknown>; timestamp?: number[]; indicators?: { quote?: Array<Record<string, Array<number | null>>>; adjclose?: Array<{ adjclose?: Array<number | null> }> } }>; error?: unknown } }>(url);
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const bars: PriceBar[] = timestamps.map((timestamp, index) => ({
    timestamp, open: Number(quote.open?.[index] ?? adjusted[index] ?? 0), high: Number(quote.high?.[index] ?? adjusted[index] ?? 0),
    low: Number(quote.low?.[index] ?? adjusted[index] ?? 0), close: Number(quote.close?.[index] ?? adjusted[index] ?? 0), adjClose:Number(adjusted[index] ?? quote.close?.[index] ?? 0), volume: Number(quote.volume?.[index] ?? 0),
  })).filter((bar) => bar.close > 0 && bar.open > 0 && bar.high > 0 && bar.low > 0);
  if (bars.length < 20) throw new Error(`Insufficient chart data for ${symbol}`);
  const meta = result.meta ?? {};
  const price = Number(meta.regularMarketPrice ?? bars.at(-1)?.close ?? 0);
  const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? bars.at(-2)?.close ?? price);
  const config = MARKET[market];
  const assetType: AssetType = String(candidate.quoteType).toUpperCase() === "ETF" ? "ETF" : "STOCK";
  if (!marketSymbolMatches(market, symbol, assetType)) throw new Error(`Market mismatch for ${market}:${symbol}`);
  const fallback = candidate.discoverySource === "market-fallback";
  const metaName = String(meta.shortName ?? meta.longName ?? "");
  return {
    instrumentId: `${market}:${symbol}`, symbol, name: candidate.shortName ?? candidate.longName ?? (metaName || symbol), market,
    exchange: candidate.fullExchangeName ?? String(meta.fullExchangeName ?? candidate.exchange ?? config.exchange), currency: candidate.currency ?? String(meta.currency ?? config.currency),
    assetType, sector:candidate.sector ?? candidate.industry ?? "Unclassified", source: fallback ? "Yahoo Finance market fallback + public chart" : "Yahoo Finance exchange screener + public chart",
    freshness: fallback ? "fallback" : "delayed", capturedAt: new Date().toISOString(), bars, price, previousClose,
    sourceWarnings: fallback ? ["SCREENER_DISCOVERY_FALLBACK"] : undefined,
  };
}

export async function fetchSymbolSnapshot(symbol: string, market: MarketCode, name = symbol, assetType: AssetType = "STOCK") {
  return fetchSnapshot({ symbol, shortName: name, quoteType: assetType === "ETF" ? "ETF" : "EQUITY", discoverySource: "market-fallback" }, market);
}

export async function scanPublicMarkets(markets: MarketCode[], countPerMarket = 8, assetType: AssetType | "ALL" = "ALL") {
  const discovered = await Promise.allSettled(markets.map(async (market) => ({ market, candidates: await discoverMarket(market, countPerMarket, assetType) })));
  const candidates = discovered.flatMap((result) => result.status === "fulfilled" ? result.value.candidates.map((candidate) => ({ market: result.value.market, candidate })) : []);
  const snapshots = await Promise.allSettled(candidates.map(({ market, candidate }) => fetchSnapshot(candidate, market)));
  return {
    snapshots: snapshots.flatMap((result) => result.status === "fulfilled" ? [result.value] : []),
    errors: [...discovered.filter((result) => result.status === "rejected").map((result) => String(result.reason)), ...snapshots.filter((result) => result.status === "rejected").map((result) => String(result.reason))],
  };
}
