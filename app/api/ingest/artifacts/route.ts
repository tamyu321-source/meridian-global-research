import { jsonError, runtimeEnv, verifyHmacBytes } from "@/lib/server";
import { MODEL_VERSION } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const bytes = new Uint8Array(await request.arrayBuffer());
  const verification = await verifyHmacBytes(bytes, request.headers.get("x-meridian-signature"), request.headers.get("x-meridian-timestamp"));
  if (!verification.ok) return jsonError(verification.reason ?? "Unauthorized", 401);
  const objectKey = request.headers.get("x-meridian-object-key");
  const idempotencyKey = request.headers.get("x-idempotency-key");
  if (!objectKey?.startsWith(`history/${MODEL_VERSION}/`) || objectKey.includes("..") || !idempotencyKey) return jsonError("Invalid artifact metadata", 400);
  const runtime = runtimeEnv();
  if (!runtime.DB || !runtime.MARKET_ARCHIVE) return jsonError("Archive unavailable", 503);
  const duplicate = await runtime.DB.prepare("SELECT idempotency_key FROM ingest_events WHERE idempotency_key=?").bind(idempotencyKey).first();
  if (duplicate) return Response.json({ accepted:true, duplicate:true, objectKey });
  await runtime.MARKET_ARCHIVE.put(objectKey, bytes, { httpMetadata:{ contentType:request.headers.get("content-type") ?? "application/octet-stream" } });
  const digest = await crypto.subtle.digest("SHA-256", bytes); const sha256 = [...new Uint8Array(digest)].map((value)=>value.toString(16).padStart(2,"0")).join("");
  await runtime.DB.batch([
    runtime.DB.prepare("INSERT INTO data_artifacts (object_key,model_version,kind,content_type,bytes,sha256,created_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(object_key) DO NOTHING").bind(objectKey, MODEL_VERSION, "adjusted_history", request.headers.get("content-type") ?? "application/octet-stream", bytes.byteLength, sha256),
    runtime.DB.prepare("INSERT INTO ingest_events (idempotency_key,provider,captured_at,object_key,record_count,status,created_at) VALUES (?,'bridge-artifact',?,?,1,'accepted',CURRENT_TIMESTAMP)").bind(idempotencyKey, new Date().toISOString(), objectKey),
  ]);
  return Response.json({ accepted:true, duplicate:false, objectKey, bytes:bytes.byteLength }, { status:202 });
}
