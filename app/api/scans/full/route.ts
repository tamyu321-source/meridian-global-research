import { attachGithubRun, createAnalysisJob, failDispatch, reconcileAnalysisJob } from "@/lib/analysis-jobs";
import { dispatchFullAnalysis } from "@/lib/github-actions";
import { apiUser, jsonError, runtimeEnv } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await apiUser(request);
  if (!user) return jsonError("Sign in required", 401);
  const db = runtimeEnv().DB;
  if (!db) return jsonError("Analysis service unavailable", 503);
  const url = new URL(request.url);
  const market = String(url.searchParams.get("market") ?? "ALL").toUpperCase();
  const assetType = String(url.searchParams.get("assetType") ?? "ALL").toUpperCase();
  const row = await db.prepare("SELECT id FROM analysis_jobs WHERE user_email=? AND market_scope=? AND asset_scope=? ORDER BY created_at DESC LIMIT 1").bind(user.email, market, assetType).first<{ id: string }>();
  if (!row) return Response.json({ job: null }, { headers: { "Cache-Control": "private, no-store" } });
  return Response.json({ job: await reconcileAnalysisJob(db, row.id) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const user = await apiUser(request);
  if (!user) return jsonError("Sign in required", 401);
  const db = runtimeEnv().DB;
  if (!db) return jsonError("Analysis service unavailable", 503);
  let body: { market?: string; assetType?: string };
  try { body = await request.json() as typeof body; }
  catch { return jsonError("Valid analysis request required", 400); }
  let created;
  try { created = await createAnalysisJob(db, user.email, "MANUAL", body.market ?? "ALL", body.assetType ?? "ALL"); }
  catch (error) { return jsonError(error instanceof Error ? error.message : "Invalid analysis scope", 400); }
  const newIds = created.createdComponents.map((component) => component.id);
  if (newIds.length) {
    const components = created.createdComponents.map((component) => ({ id: component.id, market: component.market, assetType: component.asset_type }));
    try {
      const dispatched = await dispatchFullAnalysis({
        job_id: created.jobId,
        market_scope: created.scope.market,
        asset_scope: created.scope.assetType,
        components_json: JSON.stringify(components),
      });
      await attachGithubRun(db, created.jobId, newIds, dispatched.runId, dispatched.runUrl);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await failDispatch(db, created.jobId, newIds, detail);
      return Response.json({ error: "Cloud analyzer is not connected", errorCode: detail, jobId: created.jobId }, { status: 503 });
    }
  }
  const job = await reconcileAnalysisJob(db, created.jobId);
  await db.prepare("INSERT INTO audit_logs (id,actor,action,resource,detail_json,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)")
    .bind(crypto.randomUUID(), user.email, "START_FULL_ANALYSIS", created.jobId, JSON.stringify({ market: created.scope.market, assetType: created.scope.assetType, newComponents: newIds.length })).run();
  return Response.json({ job, reused: newIds.length === 0 }, { status: newIds.length ? 202 : 200, headers: { "Cache-Control": "private, no-store" } });
}
