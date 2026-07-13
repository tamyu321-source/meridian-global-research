import { jsonError, runtimeEnv, verifyHmacBytes } from "@/lib/server";
import { MARKETS, isSupportedModelVersion } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  const verification = await verifyHmacBytes(bytes, request.headers.get("x-meridian-signature"), request.headers.get("x-meridian-timestamp"));
  if (!verification.ok) return jsonError(verification.reason ?? "Unauthorized", 401);
  const objectKey = request.headers.get("x-meridian-object-key");
  const market = request.headers.get("x-meridian-market")?.toUpperCase() ?? null;
  const assetType = request.headers.get("x-meridian-asset-type")?.toUpperCase() ?? null;
  const scanId = request.headers.get("x-meridian-scan-id") ?? null;
  const modelVersion = request.headers.get("x-meridian-model-version") ?? "";
  const idempotencyKey = request.headers.get("x-idempotency-key");
  const expectedKey = `history/${modelVersion}/${scanId}/${market}/${assetType}.parquet`;
  if (!isSupportedModelVersion(modelVersion) || !scanId || !/^[\w-]{8,80}$/.test(scanId) || objectKey !== expectedKey || !idempotencyKey || idempotencyKey.length > 160 || !market || !MARKETS.includes(market as typeof MARKETS[number]) || !assetType || !["STOCK", "ETF"].includes(assetType)) return jsonError("Invalid artifact metadata", 400);
  const runtime = runtimeEnv();
  if (!runtime.DB || !runtime.MARKET_ARCHIVE) return jsonError("Archive unavailable", 503);
  const duplicate = await runtime.DB.prepare("SELECT idempotency_key FROM ingest_events WHERE idempotency_key=?").bind(idempotencyKey).first();
  if (duplicate) return Response.json({ accepted:true, duplicate:true, objectKey });
  await runtime.MARKET_ARCHIVE.put(objectKey, bytes, { httpMetadata:{ contentType:request.headers.get("content-type") ?? "application/octet-stream" } });
  const digest = await crypto.subtle.digest("SHA-256", bytes); const sha256 = [...new Uint8Array(digest)].map((value)=>value.toString(16).padStart(2,"0")).join("");
  await runtime.DB.batch([
    runtime.DB.prepare("INSERT INTO data_artifacts (object_key,model_version,kind,market,asset_type,scan_id,content_type,bytes,sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(object_key) DO NOTHING").bind(objectKey, modelVersion, "adjusted_history", market, assetType, scanId, request.headers.get("content-type") ?? "application/octet-stream", bytes.byteLength, sha256),
    runtime.DB.prepare("INSERT INTO ingest_events (idempotency_key,provider,captured_at,object_key,record_count,status,created_at) VALUES (?,'bridge-artifact',?,?,1,'accepted',CURRENT_TIMESTAMP)").bind(idempotencyKey, new Date().toISOString(), objectKey),
  ]);
  return Response.json({ accepted:true, duplicate:false, objectKey, bytes:bytes.byteLength }, { status:202 });
}
