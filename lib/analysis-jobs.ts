import { MARKETS, isSupportedModelVersion, type AssetType, type MarketCode } from "./types";
import { ARCHIVED_CANDIDATE_MODEL_VERSION, CANDIDATE_MODEL_VERSION } from "./types";
import { defaultMarketProfileIdentity } from "./model-profiles";
import type { Locale } from "./types";
import { tx } from "./i18n";

export const ANALYSIS_PHASES = ["QUEUED", "DISCOVERY", "HISTORY", "ENRICHMENT", "SCORING", "UPLOADING", "COMPLETE"] as const;
export type AnalysisPhase = typeof ANALYSIS_PHASES[number];
export type AnalysisStatus = "QUEUED" | "DISPATCHED" | "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED" | "STALLED" | "SKIPPED";
const ACTIVE = new Set<AnalysisStatus>(["QUEUED", "DISPATCHED", "RUNNING"]);
const SUCCESS = new Set<AnalysisStatus>(["COMPLETE", "SKIPPED"]);

export type AnalysisComponentRow = Record<string, unknown> & { id: string; model_version: string; market: MarketCode; asset_type: AssetType; status: AnalysisStatus; phase: AnalysisPhase; market_profile_id?:string|null; market_profile_hash?:string|null };

export type ProgressCounts = { total:number; processed:number; updated:number; failed:number };

export function mergeProgressCounts(current: ProgressCounts, requested: ProgressCounts, status: string): ProgressCounts {
  if (status !== "FAILED") return requested;
  return {
    total:Math.max(current.total,requested.total),
    processed:Math.max(current.processed,requested.processed),
    updated:Math.max(current.updated,requested.updated),
    failed:Math.max(current.failed,requested.failed),
  };
}

export function expandAnalysisScope(market: string, assetType: string) {
  const normalizedMarket = market.toUpperCase();
  const normalizedAsset = assetType.toUpperCase();
  if (normalizedMarket !== "ALL" && !MARKETS.includes(normalizedMarket as MarketCode)) throw new Error("UNSUPPORTED_MARKET");
  if (!(["ALL", "STOCK", "ETF"] as const).includes(normalizedAsset as "ALL")) throw new Error("UNSUPPORTED_ASSET_TYPE");
  const markets = normalizedMarket === "ALL" ? MARKETS : [normalizedMarket as MarketCode];
  const assets: AssetType[] = normalizedAsset === "ALL" ? ["STOCK", "ETF"] : [normalizedAsset as AssetType];
  return { market: normalizedMarket, assetType: normalizedAsset, markets, assets, buckets: markets.flatMap((item) => assets.map((asset) => ({ market: item, assetType: asset }))) };
}

export async function createAnalysisJob(db: D1Database, ownerEmail: string, trigger: "MANUAL" | "SCHEDULED", market: string, assetType: string, modelVersion: string) {
  if (!isSupportedModelVersion(modelVersion) || modelVersion===ARCHIVED_CANDIDATE_MODEL_VERSION) throw new Error("UNSUPPORTED_MODEL_VERSION");
  const scope = expandAnalysisScope(market, assetType);
  const jobId = crypto.randomUUID();
  await db.prepare(`INSERT INTO analysis_jobs (id,user_email,trigger,market_scope,asset_scope,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'QUEUED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(jobId, ownerEmail, trigger, scope.market, scope.assetType).run();
  const components: AnalysisComponentRow[] = [];
  const createdIds = new Set<string>();
  for (const bucket of scope.buckets) {
    let profile=modelVersion===CANDIDATE_MODEL_VERSION?await defaultMarketProfileIdentity(bucket.market,bucket.assetType):null;
    if(profile){const stored=await db.prepare("SELECT profile_id,config_hash FROM model_market_profiles WHERE model_version=? AND market=? AND asset_type=? ORDER BY CASE status WHEN 'SHADOW_VALIDATING' THEN 0 WHEN 'BACKTEST_PASSED' THEN 1 WHEN 'ACTIVE_SHADOW' THEN 2 WHEN 'CALIBRATING' THEN 3 ELSE 4 END,COALESCE(selected_at,updated_at) DESC LIMIT 1").bind(modelVersion,bucket.market,bucket.assetType).first<{profile_id:string;config_hash:string}>();if(stored)profile={...profile,profileId:stored.profile_id,configHash:stored.config_hash};}
    const activeKey = `${modelVersion}:${bucket.market}:${bucket.assetType}:${profile?.profileId??"legacy"}`;
    let component = await db.prepare("SELECT * FROM analysis_components WHERE active_key=? LIMIT 1").bind(activeKey).first<AnalysisComponentRow>();
    if (!component) {
      const componentId = crypto.randomUUID();
      try {
        await db.prepare(`INSERT INTO analysis_components (id,active_key,model_version,market,asset_type,status,phase,heartbeat_at,market_profile_id,market_profile_hash,created_at,updated_at)
          VALUES (?,?,?,?,?,'QUEUED','QUEUED',CURRENT_TIMESTAMP,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(componentId, activeKey, modelVersion, bucket.market, bucket.assetType,profile?.profileId??null,profile?.configHash??null).run();
        component = await db.prepare("SELECT * FROM analysis_components WHERE id=?").bind(componentId).first<AnalysisComponentRow>();
        createdIds.add(componentId);
      } catch {
        component = await db.prepare("SELECT * FROM analysis_components WHERE active_key=? LIMIT 1").bind(activeKey).first<AnalysisComponentRow>();
      }
    }
    if (!component) throw new Error("ANALYSIS_COMPONENT_CREATE_FAILED");
    await db.prepare("INSERT OR IGNORE INTO analysis_job_components (job_id,component_id,created_at) VALUES (?,?,CURRENT_TIMESTAMP)").bind(jobId, component.id).run();
    components.push(component);
  }
  return { jobId, scope, modelVersion, components, createdComponents: components.filter((component) => createdIds.has(component.id)) };
}

export async function attachGithubRun(db: D1Database, jobId: string, componentIds: string[], runId: string | null, runUrl: string | null) {
  await db.prepare("UPDATE analysis_jobs SET status='DISPATCHED',github_run_id=?,github_run_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(runId, runUrl, jobId).run();
  if (!componentIds.length) return;
  const placeholders = componentIds.map(() => "?").join(",");
  await db.prepare(`UPDATE analysis_components SET status='DISPATCHED',github_run_id=?,github_run_url=?,heartbeat_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id IN (${placeholders})`)
    .bind(runId, runUrl, ...componentIds).run();
}

export async function failDispatch(db: D1Database, jobId: string, componentIds: string[], detail: string) {
  await db.prepare("UPDATE analysis_jobs SET status='FAILED',error_code='DISPATCH_FAILED',error_detail=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(detail.slice(0, 800), jobId).run();
  for (const id of componentIds) await db.prepare("UPDATE analysis_components SET status='FAILED',active_key=NULL,error_code='DISPATCH_FAILED',error_detail=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(detail.slice(0, 800), id).run();
}

function componentView(row: AnalysisComponentRow) {
  return {
    id: String(row.id), modelVersion: String(row.model_version), market: String(row.market), assetType: String(row.asset_type), marketProfileId:row.market_profile_id?String(row.market_profile_id):null,marketProfileHash:row.market_profile_hash?String(row.market_profile_hash):null,status: String(row.status), phase: String(row.phase),
    total: Number(row.total_count ?? 0), processed: Number(row.processed_count ?? 0), updated: Number(row.updated_count ?? 0), failed: Number(row.failed_count ?? 0),
    scanId: row.scan_id ? String(row.scan_id) : null, githubRunId: row.github_run_id ? String(row.github_run_id) : null, githubRunUrl: row.github_run_url ? String(row.github_run_url) : null,
    heartbeatAt: row.heartbeat_at ? String(row.heartbeat_at) : null, startedAt: row.started_at ? String(row.started_at) : null, completedAt: row.completed_at ? String(row.completed_at) : null,
    errorCode: row.error_code ? String(row.error_code) : null, errorDetail: row.error_detail ? String(row.error_detail) : null,
  };
}

export async function reconcileAnalysisJob(db: D1Database, jobId: string) {
  const job = await db.prepare("SELECT * FROM analysis_jobs WHERE id=?").bind(jobId).first<Record<string, unknown>>();
  if (!job) return null;
  const result = await db.prepare(`SELECT c.* FROM analysis_components c JOIN analysis_job_components jc ON jc.component_id=c.id WHERE jc.job_id=? ORDER BY c.market,c.asset_type`).bind(jobId).all<AnalysisComponentRow>();
  let components = result.results ?? [];
  const now = Date.now();
  for (const component of components) {
    const status = String(component.status) as AnalysisStatus;
    const stamp = Date.parse(String(component.heartbeat_at ?? component.updated_at ?? component.created_at ?? ""));
    const threshold = status === "QUEUED" || status === "DISPATCHED" ? 90 * 60_000 : 30 * 60_000;
    if (ACTIVE.has(status) && Number.isFinite(stamp) && now - stamp > threshold) {
      await db.prepare("UPDATE analysis_components SET status='STALLED',active_key=NULL,error_code='HEARTBEAT_TIMEOUT',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(component.id).run();
      component.status = "STALLED";
      component.active_key = null;
      component.error_code = "HEARTBEAT_TIMEOUT";
    }
  }
  const statuses = components.map((component) => String(component.status) as AnalysisStatus);
  let status: AnalysisStatus = statuses.some((value) => ACTIVE.has(value)) ? "RUNNING"
    : statuses.length && statuses.every((value) => SUCCESS.has(value)) ? "COMPLETE"
      : statuses.some((value) => SUCCESS.has(value)) ? "PARTIAL" : "FAILED";
  if (!statuses.length) status = "FAILED";
  const oldStatus = String(job.status);
  const terminal = ["COMPLETE", "PARTIAL", "FAILED"].includes(status);
  if (oldStatus !== status) {
    await db.prepare(`UPDATE analysis_jobs SET status=?,completed_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(status, terminal ? 1 : 0, jobId).run();
    if (terminal) {
      const settings = await db.prepare("SELECT locale,alert_email,email_alerts FROM user_settings WHERE user_email=?").bind(String(job.user_email)).first<Record<string, unknown>>();
      const locale = (["en", "zh-CN", "zh-TW", "ja", "ko"].includes(String(settings?.locale)) ? String(settings?.locale) : "zh-TW") as Locale;
      const title = `${tx(locale,"fullAnalysis")} · ${status === "COMPLETE" ? tx(locale,"phaseComplete") : status === "PARTIAL" ? tx(locale,"partial") : tx(locale,"failed")}`;
      const body = status === "COMPLETE" ? tx(locale,"analysisComplete") : status === "PARTIAL" ? tx(locale,"analysisPartial") : tx(locale,"analysisFailed");
      const inserted = await db.prepare("INSERT OR IGNORE INTO notifications (id,user_email,kind,title,body,delivery_status,created_at) VALUES (?,?,?,?,?,'in_app',CURRENT_TIMESTAMP)").bind(`${jobId}:${status}`, String(job.user_email), "analysis", title, body).run();
      if (Number(inserted.meta.changes ?? 0) > 0 && settings?.email_alerts) {
        const { sendEmail } = await import("./server");
        const delivery = await sendEmail(String(settings.alert_email ?? job.user_email), title, body);
        await db.prepare("UPDATE notifications SET delivery_status=? WHERE id=?").bind(delivery.ok ? "email_sent" : String(delivery.reason ?? "email_failed"), `${jobId}:${status}`).run();
      }
    }
  }
  components = components.map((component) => component);
  return {
    jobId, trigger: String(job.trigger), modelVersion: components.length ? String(components[0].model_version) : null, marketScope: String(job.market_scope), assetScope: String(job.asset_scope), status,
    githubRunId: job.github_run_id ? String(job.github_run_id) : null, githubRunUrl: job.github_run_url ? String(job.github_run_url) : null,
    createdAt: String(job.created_at), completedAt: job.completed_at ? String(job.completed_at) : null,
    errorCode: job.error_code ? String(job.error_code) : null, errorDetail: job.error_detail ? String(job.error_detail) : null,
    components: components.map(componentView),
  };
}

export function phaseIndex(phase: string) { return ANALYSIS_PHASES.indexOf(phase as AnalysisPhase); }
export function isTerminalComponent(status: string) { return ["COMPLETE", "FAILED", "STALLED", "SKIPPED"].includes(status); }
