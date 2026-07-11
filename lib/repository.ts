import { runtimeEnv } from "./server";
import type { MarketSnapshot, RankedSecurity } from "./types";

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
