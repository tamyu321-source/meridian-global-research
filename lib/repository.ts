import { runtimeEnv } from "./server";
import { MODEL_VERSION, RISK_PLANS, type AssetType, type MarketCode, type MarketSnapshot, type RankedSecurity, type RiskPlanId } from "./types";

export type ScanSummary = {
  id: string; provider: string; modelVersion: string; status: string; startedAt: string; completedAt: string | null;
  requestedMarkets: MarketCode[]; targetStocksPerMarket: number; targetEtfsPerMarket: number; discoveredCount: number;
  analyzedCount: number; failedCount: number; fallbackCount: number; coverage: Record<string, unknown>;
  configHash?: string; validationStatus?: string; sourceConflicts?: number; corporateActionAnomalies?: number;
  qualityGatePassed?: boolean; universeSnapshotDate?: string; requestedAssetTypes?: AssetType[]; jobId?: string; componentId?: string;
};

export async function persistRankings(snapshots: MarketSnapshot[], rankings: RankedSecurity[], actor = "system") {
  const db = runtimeEnv().DB;
  if (!db || snapshots.length === 0) return { persisted: false };
  const scoreDate = new Date().toISOString().slice(0, 10);
  const rankById = new Map(rankings.map((item) => [item.instrumentId, item]));
  const statements: D1PreparedStatement[] = [];
  for (const snapshot of snapshots) {
    const rank = rankById.get(snapshot.instrumentId);
    if (!rank) continue;
    statements.push(db.prepare(`INSERT INTO securities (instrument_id,symbol,name,market,exchange,currency,asset_type,sector,active,updated_at)
      VALUES (?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(instrument_id) DO UPDATE SET symbol=excluded.symbol,name=excluded.name,market=excluded.market,exchange=excluded.exchange,currency=excluded.currency,asset_type=excluded.asset_type,sector=excluded.sector,active=1,updated_at=CURRENT_TIMESTAMP`)
      .bind(snapshot.instrumentId, snapshot.symbol, snapshot.name, snapshot.market, snapshot.exchange, snapshot.currency, snapshot.assetType, snapshot.sector ?? null));
    statements.push(db.prepare(`INSERT INTO latest_quotes (instrument_id,price,previous_close,source,freshness,captured_at,updated_at)
      VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(instrument_id) DO UPDATE SET price=excluded.price,previous_close=excluded.previous_close,source=excluded.source,freshness=excluded.freshness,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(snapshot.instrumentId, snapshot.price, snapshot.previousClose, snapshot.source, snapshot.freshness, snapshot.capturedAt));
    statements.push(db.prepare(`INSERT INTO daily_scores (instrument_id,model_version,risk_plan,score_date,score,confidence,factors_json,created_at)
      VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(instrument_id,model_version,risk_plan,score_date) DO UPDATE SET score=excluded.score,confidence=excluded.confidence,factors_json=excluded.factors_json`)
      .bind(rank.instrumentId, rank.modelVersion, "capital_first", scoreDate, rank.score, rank.confidence, JSON.stringify(rank.factors)));
    const signalId = `${rank.modelVersion}:${rank.instrumentId}:${scoreDate}`;
    statements.push(db.prepare(`INSERT INTO signals (id,user_email,instrument_id,model_version,risk_plan,status,action,score,confidence,trade_plan_json,reasons_json,hard_gates_json,source_captured_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET status=excluded.status,action=excluded.action,score=excluded.score,confidence=excluded.confidence,trade_plan_json=excluded.trade_plan_json,reasons_json=excluded.reasons_json,hard_gates_json=excluded.hard_gates_json,source_captured_at=excluded.source_captured_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(signalId, actor, rank.instrumentId, rank.modelVersion, "capital_first", rank.status, rank.action, rank.score, rank.confidence, JSON.stringify(rank.tradePlan), JSON.stringify(rank.reasonCodes), JSON.stringify(rank.hardGates), rank.capturedAt));
  }
  for (let index = 0; index < statements.length; index += 80) await db.batch(statements.slice(index, index + 80));
  return { persisted: true };
}

export async function recordAudit(actor: string, action: string, resource: string, detail: unknown) {
  const db = runtimeEnv().DB;
  if (!db) return;
  await db.prepare("INSERT INTO audit_logs (id,actor,action,resource,detail_json,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)")
    .bind(crypto.randomUUID(), actor, action, resource, JSON.stringify(detail)).run();
}

export async function persistCompactRankings(records: RankedSecurity[], scanId: string, actor = "bridge") {
  const db = runtimeEnv().DB;
  if (!db || records.length === 0) return { persisted: false };
  const statements: D1PreparedStatement[] = [];
  for (const rank of records) {
    const scoreDate = rank.capturedAt.slice(0, 10);
    statements.push(db.prepare(`INSERT INTO securities (instrument_id,symbol,name,market,exchange,currency,asset_type,sector,active,updated_at)
      VALUES (?,?,?,?,?,?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(instrument_id) DO UPDATE SET symbol=excluded.symbol,name=excluded.name,market=excluded.market,exchange=excluded.exchange,currency=excluded.currency,asset_type=excluded.asset_type,sector=excluded.sector,active=1,updated_at=CURRENT_TIMESTAMP`)
      .bind(rank.instrumentId, rank.symbol, rank.name, rank.market, rank.exchange, rank.currency, rank.assetType, rank.sector ?? null));
    statements.push(db.prepare(`INSERT INTO latest_quotes (instrument_id,price,previous_close,source,freshness,captured_at,updated_at)
      VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(instrument_id) DO UPDATE SET price=excluded.price,previous_close=excluded.previous_close,source=excluded.source,freshness=excluded.freshness,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(rank.instrumentId, rank.price, rank.price / Math.max(0.0001, 1 + rank.changePct / 100), rank.source, rank.freshness, rank.capturedAt));
    statements.push(db.prepare(`INSERT INTO daily_scores (instrument_id,model_version,risk_plan,score_date,score,confidence,factors_json,created_at)
      VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(instrument_id,model_version,risk_plan,score_date) DO UPDATE SET score=excluded.score,confidence=excluded.confidence,factors_json=excluded.factors_json`)
      .bind(rank.instrumentId, rank.modelVersion, "capital_first", scoreDate, rank.score, rank.confidence, JSON.stringify(rank.factors)));
    const signalId = `${scanId}:${rank.instrumentId}`;
    statements.push(db.prepare(`INSERT INTO signals (id,user_email,instrument_id,scan_id,model_version,risk_plan,status,action,score,confidence,trade_plan_json,reasons_json,hard_gates_json,source_captured_at,analysis_price,asset_model,validation_status,config_hash,data_quality_json,selection_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET status=excluded.status,action=excluded.action,score=excluded.score,confidence=excluded.confidence,trade_plan_json=excluded.trade_plan_json,reasons_json=excluded.reasons_json,hard_gates_json=excluded.hard_gates_json,source_captured_at=excluded.source_captured_at,analysis_price=excluded.analysis_price,asset_model=excluded.asset_model,validation_status=excluded.validation_status,config_hash=excluded.config_hash,data_quality_json=excluded.data_quality_json,selection_json=excluded.selection_json,updated_at=CURRENT_TIMESTAMP`)
      .bind(signalId, actor, rank.instrumentId, scanId, rank.modelVersion, "capital_first", rank.status, rank.action, rank.score, rank.confidence, JSON.stringify(rank.tradePlan), JSON.stringify(rank.reasonCodes), JSON.stringify(rank.hardGates), rank.capturedAt, rank.price, rank.assetModel, rank.validationStatus, rank.configHash, JSON.stringify(rank.dataQuality), JSON.stringify(rank.selection)));
  }
  for (let index = 0; index < statements.length; index += 80) await db.batch(statements.slice(index, index + 80));
  return { persisted: true };
}

export async function upsertScanRun(scan: ScanSummary, model?: { modelVersion:string; configHash:string; config:unknown }) {
  const db = runtimeEnv().DB;
  if (!db) return;
  await db.prepare(`INSERT INTO scan_runs (id,provider,model_version,status,started_at,completed_at,requested_markets,target_stocks_per_market,target_etfs_per_market,discovered_count,analyzed_count,failed_count,fallback_count,coverage_json,config_hash,validation_status,source_conflicts,corporate_action_anomalies,quality_gate_passed,universe_snapshot_date,job_id,component_id,requested_asset_types,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status,completed_at=excluded.completed_at,discovered_count=excluded.discovered_count,analyzed_count=excluded.analyzed_count,failed_count=excluded.failed_count,fallback_count=excluded.fallback_count,coverage_json=excluded.coverage_json,config_hash=excluded.config_hash,validation_status=excluded.validation_status,source_conflicts=excluded.source_conflicts,corporate_action_anomalies=excluded.corporate_action_anomalies,quality_gate_passed=excluded.quality_gate_passed,universe_snapshot_date=excluded.universe_snapshot_date,job_id=excluded.job_id,component_id=excluded.component_id,requested_asset_types=excluded.requested_asset_types,updated_at=CURRENT_TIMESTAMP`)
    .bind(scan.id, scan.provider, scan.modelVersion, scan.status, scan.startedAt, scan.completedAt, JSON.stringify(scan.requestedMarkets), scan.targetStocksPerMarket, scan.targetEtfsPerMarket, scan.discoveredCount, scan.analyzedCount, scan.failedCount, scan.fallbackCount, JSON.stringify(scan.coverage), scan.configHash ?? "", scan.validationStatus ?? "SHADOW", scan.sourceConflicts ?? 0, scan.corporateActionAnomalies ?? 0, scan.qualityGatePassed ? 1 : 0, scan.universeSnapshotDate ?? null, scan.jobId ?? null, scan.componentId ?? null, JSON.stringify(scan.requestedAssetTypes ?? ["STOCK", "ETF"])).run();
  if (model) await db.prepare(`INSERT INTO model_versions (model_version,config_hash,config_json,validation_status,activated_at,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(model_version) DO UPDATE SET config_hash=excluded.config_hash,config_json=excluded.config_json,validation_status=excluded.validation_status,activated_at=COALESCE(model_versions.activated_at,excluded.activated_at)`)
    .bind(model.modelVersion, model.configHash, JSON.stringify(model.config), scan.validationStatus ?? "SHADOW", scan.qualityGatePassed ? scan.completedAt : null).run();
  if (scan.status !== "running") {
    const rows = Object.entries(scan.coverage ?? {}).map(([market, raw]) => {
      const value = raw as Record<string, unknown>; return db.prepare(`INSERT INTO universe_snapshots (snapshot_date,market,scan_id,discovered_count,analyzed_count,source,coverage_pct,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(snapshot_date,market,scan_id) DO UPDATE SET discovered_count=excluded.discovered_count,analyzed_count=excluded.analyzed_count,source=excluded.source,coverage_pct=excluded.coverage_pct`)
        .bind(scan.universeSnapshotDate ?? scan.startedAt.slice(0,10), market, scan.id, Number(value.stocksDiscovered ?? 0)+Number(value.etfsDiscovered ?? 0), Number(value.stocksAnalyzed ?? 0)+Number(value.etfsAnalyzed ?? 0), String(value.universeSource ?? scan.provider), Number(value.coveragePct ?? 0));
    });
    if (rows.length) await db.batch(rows);
    const completeness = scan.discoveredCount ? scan.analyzedCount / scan.discoveredCount * 100 : 0;
    await db.prepare(`INSERT INTO shadow_validation_days (model_version,validation_date,scan_id,completeness_pct,freshness_pct,consistency_pct,major_incident,created_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(model_version,validation_date) DO UPDATE SET scan_id=excluded.scan_id,completeness_pct=excluded.completeness_pct,freshness_pct=excluded.freshness_pct,consistency_pct=excluded.consistency_pct,major_incident=excluded.major_incident`)
      .bind(scan.modelVersion, (scan.completedAt ?? scan.startedAt).slice(0,10), scan.id, completeness, 100, 100, scan.corporateActionAnomalies ? 1 : 0).run();
  }
}

export async function activateScanOutputs(scan: ScanSummary) {
  const db = runtimeEnv().DB;
  if (!db || scan.status !== "complete" || !scan.qualityGatePassed || scan.corporateActionAnomalies) return { activated: false, buckets: 0 };
  const assets = scan.requestedAssetTypes?.length ? scan.requestedAssetTypes : (["STOCK", "ETF"] as AssetType[]);
  const capturedAt = scan.completedAt ?? scan.startedAt;
  const statements = scan.requestedMarkets.flatMap((market) => assets.map((asset) => db.prepare(`INSERT INTO active_scan_outputs (id,model_version,market,asset_type,scan_id,analysis_captured_at,activated_at)
    VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(model_version,market,asset_type) DO UPDATE SET scan_id=excluded.scan_id,analysis_captured_at=excluded.analysis_captured_at,activated_at=CURRENT_TIMESTAMP`)
    .bind(`${scan.modelVersion}:${market}:${asset}`, scan.modelVersion, market, asset, scan.id, capturedAt)));
  if (statements.length) await db.batch(statements);
  return { activated: true, buckets: statements.length };
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; }
}

export async function loadLatestScanRankings(markets: MarketCode[], assetType: AssetType | "ALL", riskPlan: RiskPlanId) {
  const db = runtimeEnv().DB;
  if (!db) return null;
  const assets: AssetType[] = assetType === "ALL" ? ["STOCK", "ETF"] : [assetType];
  const bucketRows: Array<Record<string, unknown> & { bucket_market: string; bucket_asset_type: string; bucket_scan_id: string }> = [];
  const signalRows: Record<string, unknown>[] = [];
  for (const market of markets) for (const asset of assets) {
    let scanRow = await db.prepare(`SELECT sr.*,o.scan_id bucket_scan_id,o.analysis_captured_at bucket_analysis_at,o.market bucket_market,o.asset_type bucket_asset_type
      FROM active_scan_outputs o JOIN scan_runs sr ON sr.id=o.scan_id WHERE o.model_version=? AND o.market=? AND o.asset_type=? LIMIT 1`).bind(MODEL_VERSION, market, asset).first<typeof bucketRows[number]>();
    if (!scanRow) scanRow = await db.prepare(`SELECT sr.*,sr.id bucket_scan_id,COALESCE(sr.completed_at,sr.started_at) bucket_analysis_at,? bucket_market,? bucket_asset_type
      FROM scan_runs sr WHERE sr.model_version=? AND sr.status='complete' AND sr.quality_gate_passed=1 AND EXISTS (
        SELECT 1 FROM signals sig JOIN securities sec ON sec.instrument_id=sig.instrument_id WHERE sig.scan_id=sr.id AND sec.market=? AND sec.asset_type=?)
      ORDER BY sr.completed_at DESC LIMIT 1`).bind(market, asset, MODEL_VERSION, market, asset).first<typeof bucketRows[number]>();
    if (!scanRow) continue;
    bucketRows.push(scanRow);
    const rows = await db.prepare(`SELECT sig.*,sec.symbol,sec.name,sec.market,sec.exchange,sec.currency,sec.asset_type,sec.sector,q.price,q.previous_close,q.source,q.freshness,q.captured_at,ds.factors_json
      FROM signals sig JOIN securities sec ON sec.instrument_id=sig.instrument_id JOIN latest_quotes q ON q.instrument_id=sig.instrument_id
      LEFT JOIN daily_scores ds ON ds.instrument_id=sig.instrument_id AND ds.model_version=sig.model_version AND ds.risk_plan='capital_first' AND ds.score_date=substr(sig.source_captured_at,1,10)
      WHERE sig.scan_id=? AND sec.market=? AND sec.asset_type=? ORDER BY sig.score DESC LIMIT 600`).bind(String(scanRow.bucket_scan_id), market, asset).all<Record<string, unknown>>();
    signalRows.push(...(rows.results ?? []));
  }
  if (!bucketRows.length) return null;
  const plan = RISK_PLANS[riskPlan];
  const rankings = signalRows.map((row) => {
    const tradePlan = parseJson<RankedSecurity["tradePlan"]>(row.trade_plan_json, { entryLow:0, entryHigh:0, invalidation:0, stop:0, target1:0, target2:0, trailingAtr:0, rewardRisk:0, maxWeightPct:0, riskBudgetPct:0 });
    tradePlan.maxWeightPct = plan.maxWeightPct;
    tradePlan.riskBudgetPct = plan.riskBudgetPct;
    const price = Number(row.price ?? 0);
    const previous = Number(row.previous_close ?? price);
    return {
      instrumentId:String(row.instrument_id), symbol:String(row.symbol), name:String(row.name), market:String(row.market) as MarketCode,
      exchange:String(row.exchange), currency:String(row.currency), assetType:String(row.asset_type) as AssetType, sector:String(row.sector ?? "Unclassified"),
      price, changePct:previous > 0 ? Number(((price / previous - 1) * 100).toFixed(2)) : 0, score:Number(row.score), confidence:Number(row.confidence),
      action:String(row.action) as RankedSecurity["action"], status:String(row.status) as RankedSecurity["status"], freshness:String(row.freshness) as RankedSecurity["freshness"], source:String(row.source), capturedAt:String(row.captured_at),
      factors:parseJson<RankedSecurity["factors"]>(row.factors_json, { trend:0, momentum:0, relativeStrength:0, liquidity:0, risk:0, regime:0 }), tradePlan,
      reasonCodes:parseJson<string[]>(row.reasons_json, []), hardGates:parseJson<string[]>(row.hard_gates_json, []), modelVersion:String(row.model_version ?? MODEL_VERSION),
      assetModel:String(row.asset_model ?? "LEGACY_V1") as RankedSecurity["assetModel"], validationStatus:String(row.validation_status ?? "SHADOW") as RankedSecurity["validationStatus"],
      configHash:String(row.config_hash ?? ""), dataQuality:parseJson<RankedSecurity["dataQuality"]>(row.data_quality_json, { completenessPct:0, sourceCount:1, warnings:[], conflicts:[], corporateActionAnomalies:[], hardGates:[] }),
      selection:parseJson<RankedSecurity["selection"]>(row.selection_json, { eligibleBeforeCap:false, bucketRank:0, buyLimit:0, capped:false }),
      analysisCapturedAt:String(row.source_captured_at), analysisPrice:Number(row.analysis_price ?? 0), analysisScanId:String(row.scan_id),
      tradePlanState:price >= tradePlan.entryLow && price <= tradePlan.entryHigh ? "CURRENT" : "REANALYSIS_REQUIRED",
    } satisfies RankedSecurity;
  }).sort((a,b) => b.score-a.score);
  const scanRow = [...bucketRows].sort((a,b) => Date.parse(String(b.completed_at ?? b.started_at))-Date.parse(String(a.completed_at ?? a.started_at)))[0];
  const scan: ScanSummary = {
    id:String(scanRow.id), provider:String(scanRow.provider), modelVersion:String(scanRow.model_version), status:String(scanRow.status),
    startedAt:String(scanRow.started_at), completedAt:scanRow.completed_at ? String(scanRow.completed_at) : null,
    requestedMarkets:parseJson(scanRow.requested_markets, []), targetStocksPerMarket:Number(scanRow.target_stocks_per_market), targetEtfsPerMarket:Number(scanRow.target_etfs_per_market),
    discoveredCount:Number(scanRow.discovered_count), analyzedCount:Number(scanRow.analyzed_count), failedCount:Number(scanRow.failed_count), fallbackCount:Number(scanRow.fallback_count), coverage:parseJson(scanRow.coverage_json, {}),
    configHash:String(scanRow.config_hash ?? ""), validationStatus:String(scanRow.validation_status ?? "SHADOW"), sourceConflicts:Number(scanRow.source_conflicts ?? 0), corporateActionAnomalies:Number(scanRow.corporate_action_anomalies ?? 0), qualityGatePassed:Boolean(scanRow.quality_gate_passed), universeSnapshotDate:scanRow.universe_snapshot_date ? String(scanRow.universe_snapshot_date) : undefined,
  };
  const buckets = bucketRows.map((row) => ({ market:String(row.bucket_market), assetType:String(row.bucket_asset_type), scanId:String(row.bucket_scan_id), completedAt:String(row.completed_at ?? row.started_at), qualityGatePassed:Boolean(row.quality_gate_passed) }));
  return { rankings, scan, buckets, mixedAnalysisTimes:new Set(buckets.map((item)=>item.completedAt)).size>1 };
}
