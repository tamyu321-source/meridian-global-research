import { persistCompactRankings, recordAudit, upsertScanRun, type ScanSummary } from "@/lib/repository";
import { jsonError, runtimeEnv, verifyHmac } from "@/lib/server";
import { MARKETS, MODEL_VERSION, type RankedSecurity } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();
  const timestamp = request.headers.get("x-meridian-timestamp");
  const verification = await verifyHmac(body, request.headers.get("x-meridian-signature"), timestamp);
  if (!verification.ok) return jsonError(verification.reason ?? "Unauthorized", 401);
  const idempotencyKey = request.headers.get("x-idempotency-key");
  if (!idempotencyKey || idempotencyKey.length > 160) return jsonError("Valid X-Idempotency-Key required", 400);
  let payload: { scan?: ScanSummary; records?: RankedSecurity[]; batchIndex?: number; batchCount?: number; model?: { modelVersion:string; configHash:string; config:unknown } };
  try { payload = JSON.parse(body) as typeof payload; } catch { return jsonError("Invalid JSON", 400); }
  const records = Array.isArray(payload.records) ? payload.records.slice(0, 250) : [];
  const scan = payload.scan;
  if (!scan?.id || !scan.provider || !scan.startedAt || !Array.isArray(scan.requestedMarkets)) return jsonError("Valid scan metadata required", 400);
  if (!['running','complete','partial','failed'].includes(scan.status)) return jsonError("Invalid scan status", 400);
  if (scan.requestedMarkets.some((market) => !MARKETS.includes(market))) return jsonError("Invalid scan market", 400);
  if (scan.modelVersion !== MODEL_VERSION || records.some((item) => !item.instrumentId || !MARKETS.includes(item.market) || item.modelVersion !== MODEL_VERSION || item.status !== "SHADOW" || !item.assetModel || !item.configHash)) return jsonError("Invalid v2 ranking record", 400);
  if (scan.status === "complete" && (!scan.qualityGatePassed || scan.corporateActionAnomalies)) return jsonError("Complete scan must pass v2 quality gates", 400);
  const runtime = runtimeEnv();
  if (!runtime.DB) return jsonError("D1 unavailable", 503);
  const duplicate = await runtime.DB.prepare("SELECT idempotency_key FROM ingest_events WHERE idempotency_key=?").bind(idempotencyKey).first();
  if (duplicate) return Response.json({ accepted:true, duplicate:true, idempotencyKey });
  const objectKey = `rankings/${scan.id}/${String(payload.batchIndex ?? 0).padStart(4, "0")}.json`;
  if (runtime.MARKET_ARCHIVE) await runtime.MARKET_ARCHIVE.put(objectKey, body, { httpMetadata:{ contentType:"application/json" }, customMetadata:{ provider:scan.provider, scanId:scan.id } });
  try {
    await runtime.DB.prepare("INSERT INTO ingest_events (idempotency_key,provider,captured_at,object_key,record_count,status,created_at) VALUES (?,?,?,?,?,'accepted',CURRENT_TIMESTAMP)")
      .bind(idempotencyKey, scan.provider, scan.completedAt ?? scan.startedAt, runtime.MARKET_ARCHIVE ? objectKey : null, records.length).run();
    await upsertScanRun(scan, payload.model);
    await persistCompactRankings(records, scan.id, "bridge");
    if (scan.status !== "running") await recordAudit("bridge", "COMPLETE_FULL_SCAN", scan.id, { status:scan.status, records:scan.analyzedCount, failed:scan.failedCount, coverage:scan.coverage });
    return Response.json({ accepted:true, duplicate:false, idempotencyKey, scanId:scan.id, batchIndex:payload.batchIndex ?? 0, batchCount:payload.batchCount ?? 1, records:records.length }, { status:202 });
  } catch (error) { return jsonError("Ranking ingest failed", 500, error); }
}
