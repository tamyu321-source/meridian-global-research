const cache = new Map<string, { rate:number; capturedAt:string; expiresAt:number }>();
const HEADERS = { "User-Agent":"Mozilla/5.0 MeridianPaperPortfolio/1.0", Accept:"application/json" };

async function yahooPair(from:string, to:string) {
  const symbol = `${from}${to}=X`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, { headers:HEADERS, signal:controller.signal });
    if (!response.ok) throw new Error(`fx-${response.status}`);
    const payload = await response.json() as { chart?:{ result?:Array<{ meta?:Record<string,unknown>; indicators?:{ quote?:Array<{ close?:Array<number|null> }> } }> } };
    const result = payload.chart?.result?.[0];
    const closes = result?.indicators?.quote?.[0]?.close?.filter((value): value is number => typeof value === "number" && value > 0) ?? [];
    const rate = Number(result?.meta?.regularMarketPrice ?? closes.at(-1) ?? 0);
    if (!(rate > 0)) throw new Error(`fx-missing-${symbol}`);
    return rate;
  } finally { clearTimeout(timeout); }
}

export async function fetchFxRate(fromInput:string, toInput:string) {
  const from = fromInput.toUpperCase(), to = toInput.toUpperCase();
  if (from === to) return { rate:1, source:"identity", capturedAt:new Date().toISOString() };
  const key = `${from}:${to}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return { rate:hit.rate, source:"Yahoo Finance FX", capturedAt:hit.capturedAt };
  let rate = 0;
  try { rate = await yahooPair(from, to); }
  catch {
    try { rate = 1 / await yahooPair(to, from); }
    catch {
      const fromUsd = from === "USD" ? 1 : await yahooPair(from, "USD");
      const toUsd = to === "USD" ? 1 : await yahooPair(to, "USD");
      rate = fromUsd / toUsd;
    }
  }
  const capturedAt = new Date().toISOString();
  cache.set(key, { rate, capturedAt, expiresAt:Date.now() + 5 * 60_000 });
  return { rate, source:"Yahoo Finance FX", capturedAt };
}
