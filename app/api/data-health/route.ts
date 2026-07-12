import { runtimeEnv } from "@/lib/server";
import { MARKETS } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = runtimeEnv().DB;
  const fallback = MARKETS.map((market) => ({ market, status: "waiting", source: "public fallback", freshness: "unknown", lastCapturedAt: null, instruments: 0 }));
  if (!db) return Response.json({ ibkr: { connected: false, reason: "account_not_configured" }, storage: { d1: false, r2: Boolean(runtimeEnv().MARKET_ARCHIVE) }, markets: fallback, generatedAt: new Date().toISOString() });
  try {
    const result = await db.prepare(`SELECT s.market, COUNT(*) instruments, MAX(q.captured_at) last_captured_at,
      GROUP_CONCAT(DISTINCT q.source) sources FROM securities s LEFT JOIN latest_quotes q ON q.instrument_id=s.instrument_id GROUP BY s.market`).all();
    const rows = new Map((result.results ?? []).map((row: Record<string, unknown>) => [String(row.market), row]));
    const markets = MARKETS.map((market) => {
      const row = rows.get(market) as Record<string, unknown> | undefined;
      const capturedAt = row?.last_captured_at ? String(row.last_captured_at) : null;
      const age = capturedAt ? Date.now() - Date.parse(capturedAt) : Infinity;
      return { market, status: age < 36 * 60 * 60_000 ? "operational" : capturedAt ? "stale" : "waiting", source: row?.sources ?? "public fallback", freshness: age < 15 * 60_000 ? "delayed" : age < 36 * 60 * 60_000 ? "daily" : "stale", lastCapturedAt: capturedAt, instruments: Number(row?.instruments ?? 0) };
    });
    const scan = await db.prepare("SELECT * FROM scan_runs WHERE status IN ('complete','partial') ORDER BY completed_at DESC LIMIT 1").first<Record<string, unknown>>();
    return Response.json({ ibkr: { connected: false, reason: "account_not_configured" }, storage: { d1: true, r2: Boolean(runtimeEnv().MARKET_ARCHIVE) }, markets, fullScan:scan ? { id:scan.id, status:scan.status, completedAt:scan.completed_at, analyzedCount:Number(scan.analyzed_count), failedCount:Number(scan.failed_count), fallbackCount:Number(scan.fallback_count), coverage:JSON.parse(String(scan.coverage_json ?? "{}")) } : null, generatedAt: new Date().toISOString() });
  } catch {
    return Response.json({ ibkr: { connected: false, reason: "account_not_configured" }, storage: { d1: true, r2: Boolean(runtimeEnv().MARKET_ARCHIVE), migration: "pending" }, markets: fallback, generatedAt: new Date().toISOString() });
  }
}
