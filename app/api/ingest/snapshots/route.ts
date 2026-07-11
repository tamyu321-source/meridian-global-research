import { rankSnapshots } from "@/lib/algorithm";
import { persistRankings, recordAudit } from "@/lib/repository";
import { jsonError, runtimeEnv, verifyHmac } from "@/lib/server";
import { MARKETS, type MarketSnapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  const timestamp = request.headers.get("x-meridian-timestamp");
  const verification = await verifyHmac(body, request.headers.get("x-meridian-signature"), timestamp);
  if (!verification.ok) return jsonError(verification.reason ?? "Unauthorized", 401);
  const idempotencyKey = request.headers.get("x-idempotency-key");
  if (!idempotencyKey || idempotencyKey.length > 160) return jsonError("Valid X-Idempotency-Key required", 400);
  let payload: { provider?: string; capturedAt?: string; snapshots?: MarketSnapshot[] };
  try { payload = JSON.parse(body) as typeof payload; } catch { return jsonError("Invalid JSON", 400); }
  const snapshots = Array.isArray(payload.snapshots) ? payload.snapshots.slice(0, 500) : [];
  if (!payload.provider || !payload.capturedAt || snapshots.length === 0) return jsonError("provider, capturedAt and snapshots are required", 400);
  if (snapshots.some((item) => !MARKETS.includes(item.market) || !item.instrumentId || !Array.isArray(item.bars))) return jsonError("Invalid snapshot shape", 400);
  const runtime = runtimeEnv();
  if (!runtime.DB) return jsonError("D1 unavailable", 503);
  const duplicate = await runtime.DB.prepare("SELECT idempotency_key FROM ingest_events WHERE idempotency_key=?").bind(idempotencyKey).first();
  if (duplicate) return Response.json({ accepted: true, duplicate: true, idempotencyKey });
  const day = payload.capturedAt.slice(0, 10);
  const objectKey = `snapshots/${day}/${idempotencyKey}.json`;
  if (runtime.MARKET_ARCHIVE) await runtime.MARKET_ARCHIVE.put(objectKey, body, { httpMetadata: { contentType: "application/json" }, customMetadata: { provider: payload.provider, capturedAt: payload.capturedAt } });
  const rankings = rankSnapshots(snapshots, "capital_first", payload.provider.toLowerCase().includes("ibkr"));
  try {
    await runtime.DB.prepare("INSERT INTO ingest_events (idempotency_key,provider,captured_at,object_key,record_count,status,created_at) VALUES (?,?,?,?,?,'accepted',CURRENT_TIMESTAMP)")
      .bind(idempotencyKey, payload.provider, payload.capturedAt, runtime.MARKET_ARCHIVE ? objectKey : null, snapshots.length).run();
    await persistRankings(snapshots, rankings, "bridge");
    await recordAudit("bridge", "INGEST_SNAPSHOTS", payload.provider, { idempotencyKey, recordCount: snapshots.length, objectKey });
    return Response.json({ accepted: true, duplicate: false, idempotencyKey, recordCount: snapshots.length, rankings: rankings.length }, { status: 202 });
  } catch (error) { return jsonError("Ingest persistence failed", 500, error); }
}
