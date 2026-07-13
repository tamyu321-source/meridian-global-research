import { ANALYSIS_PHASES, isTerminalComponent, mergeProgressCounts, phaseIndex, reconcileAnalysisJob } from "@/lib/analysis-jobs";
import { jsonError, runtimeEnv, verifyHmac } from "@/lib/server";

export const dynamic = "force-dynamic";
const STATUSES = new Set(["QUEUED", "DISPATCHED", "RUNNING", "COMPLETE", "FAILED", "STALLED", "SKIPPED"]);

export async function POST(request: Request) {
  const raw = await request.text();
  const verified = await verifyHmac(raw, request.headers.get("x-meridian-signature"), request.headers.get("x-meridian-timestamp"));
  if (!verified.ok) return jsonError(verified.reason ?? "Unauthorized", 401);
  const idempotencyKey = request.headers.get("x-idempotency-key");
  if (!idempotencyKey || idempotencyKey.length > 160) return jsonError("Valid X-Idempotency-Key required", 400);
  let body: { jobId?: string; componentId?: string; status?: string; phase?: string; total?: number; processed?: number; updated?: number; failed?: number; scanId?: string; githubRunId?: string; githubRunUrl?: string; errorCode?: string; errorDetail?: string };
  try { body = JSON.parse(raw) as typeof body; } catch { return jsonError("Invalid JSON", 400); }
  if (!body.jobId || !body.componentId || !STATUSES.has(String(body.status)) || !ANALYSIS_PHASES.includes(String(body.phase) as typeof ANALYSIS_PHASES[number])) return jsonError("Invalid progress payload", 400);
  const db = runtimeEnv().DB;
  if (!db) return jsonError("Analysis service unavailable", 503);
  const duplicate = await db.prepare("SELECT idempotency_key FROM ingest_events WHERE idempotency_key=?").bind(idempotencyKey).first();
  if (duplicate) return Response.json({ accepted: true, duplicate: true });
  const component = await db.prepare(`SELECT c.* FROM analysis_components c JOIN analysis_job_components jc ON jc.component_id=c.id WHERE jc.job_id=? AND c.id=?`).bind(body.jobId, body.componentId).first<Record<string, unknown>>();
  if (!component) return jsonError("Analysis component not found", 404);
  const currentPhase = phaseIndex(String(component.phase));
  const nextPhase = phaseIndex(String(body.phase));
  const currentCounts = { total:Number(component.total_count ?? 0),processed:Number(component.processed_count ?? 0),updated:Number(component.updated_count ?? 0),failed:Number(component.failed_count ?? 0) };
  const requestedCounts = { total:Number(body.total ?? 0),processed:Number(body.processed ?? 0),updated:Number(body.updated ?? 0),failed:Number(body.failed ?? 0) };
  const counts = mergeProgressCounts(currentCounts,requestedCounts,String(body.status));
  if (nextPhase < currentPhase || (String(body.status) !== "FAILED" && (counts.total < currentCounts.total || counts.processed < currentCounts.processed || counts.updated < currentCounts.updated || counts.failed < currentCounts.failed))) return jsonError("Progress must be monotonic", 409);
  if (isTerminalComponent(String(component.status)) && String(body.status) !== String(component.status)) return jsonError("Terminal component cannot be changed", 409);
  const terminal = isTerminalComponent(String(body.status));
  await db.batch([
    db.prepare(`UPDATE analysis_components SET status=?,phase=?,total_count=?,processed_count=?,updated_count=?,failed_count=?,scan_id=COALESCE(?,scan_id),github_run_id=COALESCE(?,github_run_id),github_run_url=COALESCE(?,github_run_url),heartbeat_at=CURRENT_TIMESTAMP,started_at=COALESCE(started_at,CURRENT_TIMESTAMP),completed_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END,active_key=CASE WHEN ? THEN NULL ELSE active_key END,error_code=?,error_detail=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(body.status, body.phase, counts.total, counts.processed, counts.updated, counts.failed, body.scanId ?? null, body.githubRunId ?? null, body.githubRunUrl ?? null, terminal ? 1 : 0, terminal ? 1 : 0, body.errorCode ?? null, body.errorDetail?.slice(0, 800) ?? null, body.componentId),
    db.prepare("UPDATE analysis_jobs SET github_run_id=COALESCE(?,github_run_id),github_run_url=COALESCE(?,github_run_url),updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.githubRunId ?? null, body.githubRunUrl ?? null, body.jobId),
    db.prepare("INSERT INTO ingest_events (idempotency_key,provider,captured_at,object_key,record_count,status,created_at) VALUES (?,'github-progress',?,?,1,'accepted',CURRENT_TIMESTAMP)").bind(idempotencyKey, new Date().toISOString(), body.componentId),
  ]);
  return Response.json({ accepted: true, duplicate: false, job: await reconcileAnalysisJob(db, body.jobId) }, { status: 202 });
}
