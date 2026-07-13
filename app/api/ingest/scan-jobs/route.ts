import { createAnalysisJob, reconcileAnalysisJob } from "@/lib/analysis-jobs";
import { jsonError, runtimeEnv, verifyHmac } from "@/lib/server";
import { MARKETS, MODEL_VERSION } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  const verified = await verifyHmac(raw, request.headers.get("x-meridian-signature"), request.headers.get("x-meridian-timestamp"));
  if (!verified.ok) return jsonError(verified.reason ?? "Unauthorized", 401);
  const idempotencyKey = request.headers.get("x-idempotency-key");
  if (!idempotencyKey || idempotencyKey.length > 160) return jsonError("Valid X-Idempotency-Key required", 400);
  let body: { market?: string; assetType?: string; trigger?: string };
  try { body = JSON.parse(raw) as typeof body; } catch { return jsonError("Invalid JSON", 400); }
  const db = runtimeEnv().DB;
  if (!db) return jsonError("Analysis service unavailable", 503);
  const duplicate = await db.prepare("SELECT object_key FROM ingest_events WHERE idempotency_key=?").bind(idempotencyKey).first<{ object_key: string | null }>();
  if (duplicate?.object_key) return Response.json({ accepted: true, duplicate: true, jobId: duplicate.object_key });
  const configuredOwner = runtimeEnv().MERIDIAN_OWNER_EMAIL?.trim();
  const owner = configuredOwner || String((await db.prepare("SELECT user_email FROM user_settings ORDER BY updated_at DESC LIMIT 1").first<Record<string, unknown>>())?.user_email ?? "owner@meridian.system");
  try {
    const market = String(body.market ?? "ALL").toUpperCase();
    if (body.trigger === "SCHEDULED" && MARKETS.includes(market as typeof MARKETS[number])) {
      const zone:Record<string,string> = { US:"America/New_York", CN:"Asia/Shanghai", HK:"Asia/Hong_Kong", TW:"Asia/Taipei", JP:"Asia/Tokyo", KR:"Asia/Seoul", SG:"Asia/Singapore" };
      const today = new Intl.DateTimeFormat("en-CA", { timeZone:zone[market], year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
      const active = await db.prepare("SELECT analysis_captured_at FROM active_scan_outputs WHERE model_version=? AND market=?").bind(MODEL_VERSION, market).all<{ analysis_captured_at:string }>();
      const dates = (active.results ?? []).map((item) => new Intl.DateTimeFormat("en-CA", { timeZone:zone[market], year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(item.analysis_captured_at)));
      if (dates.length >= 2 && dates.every((value) => value === today)) {
        await db.prepare("INSERT INTO ingest_events (idempotency_key,provider,captured_at,object_key,record_count,status,created_at) VALUES (?,'github-schedule',?,?,0,'accepted',CURRENT_TIMESTAMP)").bind(idempotencyKey, new Date().toISOString(), `complete:${market}:${today}`).run();
        return Response.json({ accepted:true, duplicate:false, skipped:"already_complete", jobId:null, components:[] });
      }
    }
    const created = await createAnalysisJob(db, owner, "SCHEDULED", body.market ?? "ALL", body.assetType ?? "ALL");
    await db.prepare("INSERT INTO ingest_events (idempotency_key,provider,captured_at,object_key,record_count,status,created_at) VALUES (?,'github-schedule',?,?,?,'accepted',CURRENT_TIMESTAMP)")
      .bind(idempotencyKey, new Date().toISOString(), created.jobId, created.createdComponents.length).run();
    return Response.json({ accepted: true, duplicate: false, jobId: created.jobId, components: created.createdComponents.map((item) => ({ id: item.id, market: item.market, assetType: item.asset_type })), job: await reconcileAnalysisJob(db, created.jobId) }, { status: 202 });
  } catch (error) { return jsonError("Scheduled analysis job creation failed", 400, error); }
}
