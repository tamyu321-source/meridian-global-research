import { reconcileAnalysisJob } from "@/lib/analysis-jobs";
import { apiUser, jsonError, runtimeEnv } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  const user = await apiUser(request);
  if (!user) return jsonError("Sign in required", 401);
  const db = runtimeEnv().DB;
  if (!db) return jsonError("Analysis service unavailable", 503);
  const { jobId } = await context.params;
  const owned = await db.prepare("SELECT id FROM analysis_jobs WHERE id=? AND user_email=?").bind(jobId, user.email).first();
  if (!owned) return jsonError("Analysis job not found", 404);
  return Response.json({ job: await reconcileAnalysisJob(db, jobId) }, { headers: { "Cache-Control": "private, no-store" } });
}
