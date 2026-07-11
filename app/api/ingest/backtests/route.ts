import { jsonError, runtimeEnv, verifyHmac } from "@/lib/server";
import { MARKETS } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  const timestamp = request.headers.get("x-meridian-timestamp");
  const verification = await verifyHmac(body, request.headers.get("x-meridian-signature"), timestamp);
  if (!verification.ok) return jsonError(verification.reason ?? "Unauthorized", 401);
  let payload: { modelVersion?: string; generatedAt?: string; markets?: Record<string, { metrics?: Record<string, unknown>; trades?: unknown[] }> };
  try { payload = JSON.parse(body) as typeof payload; } catch { return jsonError("Invalid JSON", 400); }
  if (!payload.modelVersion || !payload.generatedAt || !payload.markets) return jsonError("Invalid backtest artifact", 400);
  const runtime = runtimeEnv();
  if (!runtime.DB) return jsonError("D1 unavailable", 503);
  const artifactKey = `backtests/${payload.modelVersion}/${payload.generatedAt.replaceAll(":", "-")}.json`;
  if (runtime.MARKET_ARCHIVE) await runtime.MARKET_ARCHIVE.put(artifactKey, body, { httpMetadata: { contentType: "application/json" } });
  const statements: D1PreparedStatement[] = [];
  for (const market of MARKETS) {
    const item = payload.markets[market];
    if (!item?.metrics) continue;
    const metrics = item.metrics;
    const passed = Number(metrics.tradeCount ?? 0) >= 40 && Number(metrics.profitFactor ?? 0) >= 1.2 && Number(metrics.sharpe ?? 0) >= .8 && Number(metrics.expectancyPct ?? 0) > 0;
    statements.push(runtime.DB.prepare("INSERT INTO backtest_runs (id,model_version,market,risk_plan,status,started_at,completed_at,metrics_json,artifact_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(), payload.modelVersion, market, "capital_first", passed ? "PASSED_BACKTEST" : "FAILED_GATE", payload.generatedAt, new Date().toISOString(), JSON.stringify(metrics), runtime.MARKET_ARCHIVE ? artifactKey : null));
  }
  if (statements.length) await runtime.DB.batch(statements);
  return Response.json({ accepted: true, artifactKey: runtime.MARKET_ARCHIVE ? artifactKey : null, markets: statements.length }, { status: 202 });
}
