import { runtimeEnv } from "./server";
import { MODEL_VERSION, RISK_PLANS, type AssetType, type MarketCode, type MarketSnapshot, type RankedSecurity, type RiskPlanId } from "./types";

export type ScanSummary = {
  id: string; provider: string; modelVersion: string; status: string; startedAt: string; completedAt: string | null;
  requestedMarkets: MarketCode[]; targetStocksPerMarket: number; targetEtfsPerMarket: number; discoveredCount: number;
  analyzedCount: number; failedCount: number; fallbackCount: number; coverage: Record<string, unknown>;
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
    statements.push(db.prepare(`INSERT INTO signals (id,user_email,instrument_id,scan_id,model_version,risk_plan,status,action,score,confidence,trade_plan_json,reasons_json,hard_gates_json,source_captured_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET status=excluded.status,action=excluded.action,score=excluded.score,confidence=excluded.confidence,trade_plan_json=excluded.trade_plan_json,reasons_json=excluded.reasons_json,hard_gates_json=excluded.hard_gates_json,source_captured_at=excluded.source_captured_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(signalId, actor, rank.instrumentId, scanId, rank.modelVersion, "capital_first", rank.status, rank.action, rank.score, rank.confidence, JSON.stringify(rank.tradePlan), JSON.stringify(rank.reasonCodes), JSON.stringify(rank.hardGates), rank.capturedAt));
  }
  for (let index = 0; index < statements.length; index += 80) await db.batch(statements.slice(index, index + 80));
  return { persisted: true };
}

export async function upsertScanRun(scan: ScanSummary) {
  const db = runtimeEnv().DB;
  if (!db) return;
  await db.prepare(`INSERT INTO scan_runs (id,provider,model_version,status,started_at,completed_at,requested_markets,target_stocks_per_market,target_etfs_per_market,discovered_count,analyzed_count,failed_count,fallback_count,coverage_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status,completed_at=excluded.completed_at,discovered_count=excluded.discovered_count,analyzed_count=excluded.analyzed_count,failed_count=excluded.failed_count,fallback_count=excluded.fallback_count,coverage_json=excluded.coverage_json,updated_at=CURRENT_TIMESTAMP`)
    .bind(scan.id, scan.provider, scan.modelVersion, scan.status, scan.startedAt, scan.completedAt, JSON.stringify(scan.requestedMarkets), scan.targetStocksPerMarket, scan.targetEtfsPerMarket, scan.discoveredCount, scan.analyzedCount, scan.failedCount, scan.fallbackCount, JSON.stringify(scan.coverage)).run();
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; }
}

export async function loadLatestScanRankings(markets: MarketCode[], assetType: AssetType | "ALL", riskPlan: RiskPlanId) {
  const db = runtimeEnv().DB;
  if (!db) return null;
  const scanRow = await db.prepare(`SELECT * FROM scan_runs WHERE status IN ('complete','partial') ORDER BY completed_at DESC LIMIT 1`).first<Record<string, unknown>>();
  if (!scanRow) return null;
  const placeholders = markets.map(() => "?").join(",");
  const assetSql = assetType === "ALL" ? "" : " AND sec.asset_type=?";
  const bindings: unknown[] = [String(scanRow.id), ...markets];
  if (assetType !== "ALL") bindings.push(assetType);
  const result = await db.prepare(`SELECT sig.*,sec.symbol,sec.name,sec.market,sec.exchange,sec.currency,sec.asset_type,sec.sector,q.price,q.previous_close,q.source,q.freshness,q.captured_at,ds.factors_json
    FROM signals sig JOIN securities sec ON sec.instrument_id=sig.instrument_id
    JOIN latest_quotes q ON q.instrument_id=sig.instrument_id
    LEFT JOIN daily_scores ds ON ds.instrument_id=sig.instrument_id AND ds.model_version=sig.model_version AND ds.risk_plan='capital_first' AND ds.score_date=substr(sig.source_captured_at,1,10)
    WHERE sig.scan_id=? AND sec.market IN (${placeholders})${assetSql} ORDER BY sig.score DESC LIMIT 1200`).bind(...bindings).all<Record<string, unknown>>();
  const plan = RISK_PLANS[riskPlan];
  const rankings = (result.results ?? []).map((row) => {
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
    } satisfies RankedSecurity;
  });
  const scan: ScanSummary = {
    id:String(scanRow.id), provider:String(scanRow.provider), modelVersion:String(scanRow.model_version), status:String(scanRow.status),
    startedAt:String(scanRow.started_at), completedAt:scanRow.completed_at ? String(scanRow.completed_at) : null,
    requestedMarkets:parseJson(scanRow.requested_markets, []), targetStocksPerMarket:Number(scanRow.target_stocks_per_market), targetEtfsPerMarket:Number(scanRow.target_etfs_per_market),
    discoveredCount:Number(scanRow.discovered_count), analyzedCount:Number(scanRow.analyzed_count), failedCount:Number(scanRow.failed_count), fallbackCount:Number(scanRow.fallback_count), coverage:parseJson(scanRow.coverage_json, {}),
  };
  return { rankings, scan };
}
