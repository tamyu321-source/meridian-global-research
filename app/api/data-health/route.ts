import { runtimeEnv } from "@/lib/server";
import { githubWorkflowState } from "@/lib/github-actions";
import { reconcileAnalysisJob } from "@/lib/analysis-jobs";
import { MARKETS, MODEL_VERSION } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = runtimeEnv().DB;
  const fallback = MARKETS.map((market) => ({ market, status: "waiting", source: "public fallback", freshness: "unknown", lastCapturedAt: null, instruments: 0 }));
  if (!db) return Response.json({ ibkr: { connected: false, reason: "account_not_configured" }, storage: { d1: false, r2: Boolean(runtimeEnv().MARKET_ARCHIVE) }, markets: fallback, generatedAt: new Date().toISOString() });
  try {
    const result = await db.prepare(`SELECT s.market, COUNT(*) instruments, MAX(q.captured_at) last_captured_at,
      GROUP_CONCAT(DISTINCT q.source) sources FROM securities s LEFT JOIN latest_quotes q ON q.instrument_id=s.instrument_id GROUP BY s.market`).all();
    const rows = new Map((result.results ?? []).map((row: Record<string, unknown>) => [String(row.market), row]));
    const markets = MARKETS.map((market) => {
      const row = rows.get(market) as Record<string, unknown> | undefined;
      const capturedAt = row?.last_captured_at ? String(row.last_captured_at) : null;
      const age = capturedAt ? Date.now() - Date.parse(capturedAt) : Infinity;
      return { market, status: age < 36 * 60 * 60_000 ? "operational" : capturedAt ? "stale" : "waiting", source: row?.sources ?? "public fallback", freshness: age < 15 * 60_000 ? "delayed" : age < 36 * 60 * 60_000 ? "daily" : "stale", lastCapturedAt: capturedAt, instruments: Number(row?.instruments ?? 0) };
    });
    const scan = await db.prepare("SELECT * FROM scan_runs WHERE model_version=? AND status IN ('complete','partial') ORDER BY completed_at DESC LIMIT 1").bind(MODEL_VERSION).first<Record<string, unknown>>();
    const shadow = await db.prepare("SELECT COUNT(*) days,AVG(completeness_pct) completeness,AVG(freshness_pct) freshness,MIN(consistency_pct) consistency,SUM(major_incident) incidents FROM shadow_validation_days WHERE model_version=?").bind(MODEL_VERSION).first<Record<string, unknown>>();
    const artifacts = await db.prepare("SELECT COUNT(*) count,SUM(bytes) bytes FROM data_artifacts WHERE model_version=?").bind(MODEL_VERSION).first<Record<string, unknown>>();
    const [workflow,analysisRows] = await Promise.all([
      githubWorkflowState(),
      db.prepare("SELECT id FROM analysis_jobs ORDER BY created_at DESC LIMIT 10").all<{ id:string }>(),
    ]);
    const analysisJobs = await Promise.all((analysisRows.results ?? []).map((row) => reconcileAnalysisJob(db,row.id)));
    return Response.json({ ibkr: { connected: false, reason: "public_data_only" }, cloudAnalyzer:workflow, analysisJobs:analysisJobs.filter(Boolean), storage: { d1: true, r2: Boolean(runtimeEnv().MARKET_ARCHIVE), artifacts:Number(artifacts?.count ?? 0), artifactBytes:Number(artifacts?.bytes ?? 0) }, model:{ modelVersion:MODEL_VERSION, validationStatus:"SHADOW", formalEligible:false }, shadowValidation:{ days:Number(shadow?.days ?? 0), completenessPct:Number(shadow?.completeness ?? 0), freshnessPct:Number(shadow?.freshness ?? 0), consistencyPct:Number(shadow?.consistency ?? 0), incidents:Number(shadow?.incidents ?? 0), requiredDays:30 }, markets, fullScan:scan ? { id:scan.id, status:scan.status, completedAt:scan.completed_at, analyzedCount:Number(scan.analyzed_count), failedCount:Number(scan.failed_count), fallbackCount:Number(scan.fallback_count), qualityGatePassed:Boolean(scan.quality_gate_passed), sourceConflicts:Number(scan.source_conflicts), corporateActionAnomalies:Number(scan.corporate_action_anomalies), configHash:scan.config_hash, coverage:JSON.parse(String(scan.coverage_json ?? "{}")) } : null, generatedAt: new Date().toISOString() });
  } catch {
    return Response.json({ ibkr: { connected: false, reason: "account_not_configured" }, storage: { d1: true, r2: Boolean(runtimeEnv().MARKET_ARCHIVE), migration: "pending" }, markets: fallback, generatedAt: new Date().toISOString() });
  }
}
