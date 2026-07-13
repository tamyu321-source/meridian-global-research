import { jsonError, runtimeEnv, verifyHmac } from "@/lib/server";
import { MARKETS, MODEL_VERSION } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  const verified = await verifyHmac(raw, request.headers.get("x-meridian-signature"), request.headers.get("x-meridian-timestamp"));
  if (!verified.ok) return jsonError(verified.reason ?? "Unauthorized", 401);
  let body: { market?: string; assetType?: string; modelVersion?: string };
  try { body = JSON.parse(raw) as typeof body; } catch { return jsonError("Invalid JSON", 400); }
  const market = String(body.market ?? "").toUpperCase();
  const assetType = String(body.assetType ?? "").toUpperCase();
  if (!MARKETS.includes(market as typeof MARKETS[number]) || !["STOCK", "ETF"].includes(assetType) || body.modelVersion !== MODEL_VERSION) return jsonError("Invalid artifact restore scope", 400);
  const runtime = runtimeEnv();
  if (!runtime.DB || !runtime.MARKET_ARCHIVE) return jsonError("Archive unavailable", 503);
  const row = await runtime.DB.prepare(`SELECT da.object_key,da.sha256 FROM data_artifacts da JOIN scan_runs sr ON sr.id=da.scan_id
    WHERE da.model_version=? AND da.kind='adjusted_history' AND da.market=? AND da.asset_type=? AND sr.status='complete' AND sr.quality_gate_passed=1
    ORDER BY da.created_at DESC LIMIT 1`).bind(MODEL_VERSION, market, assetType).first<{ object_key: string; sha256: string }>();
  if (!row) return jsonError("No cached history available", 404);
  const object = await runtime.MARKET_ARCHIVE.get(row.object_key);
  if (!object) return jsonError("Cached history object missing", 404);
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream", "X-Meridian-Object-Key": row.object_key, "X-Meridian-SHA256": row.sha256, "Cache-Control": "private, no-store" } });
}
