import { fetchLatestQuoteBatch } from "@/lib/public-data";
import { apiUser, jsonError, runtimeEnv } from "@/lib/server";
import { MARKETS, type AssetType, type MarketCode } from "@/lib/types";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 50;
type SecurityRow = { instrument_id: string; symbol: string };

function validScanId(value: unknown) {
  const scanId = String(value ?? "");
  return /^[a-zA-Z0-9-]{8,80}$/.test(scanId) ? scanId : crypto.randomUUID();
}

export async function POST(request: Request) {
  const user = await apiUser(request);
  if (!user) return jsonError("Sign in required", 401);
  const db = runtimeEnv().DB;
  if (!db) return jsonError("Quote refresh service unavailable", 503);

  let body: { market?: string; assetType?: string; cursor?: string; scanId?: string };
  try { body = await request.json() as typeof body; }
  catch { return jsonError("Valid refresh request required", 400); }

  const market = String(body.market ?? "ALL").toUpperCase();
  const assetType = String(body.assetType ?? "ALL").toUpperCase();
  if (market !== "ALL" && !MARKETS.includes(market as MarketCode)) return jsonError("Unsupported market", 400);
  if (assetType !== "ALL" && assetType !== "STOCK" && assetType !== "ETF") return jsonError("Unsupported asset type", 400);

  const scanId = validScanId(body.scanId);
  const cursor = String(body.cursor ?? "");
  const clauses = ["active=1"];
  const bindings: unknown[] = [];
  if (market !== "ALL") { clauses.push("market=?"); bindings.push(market); }
  if (assetType !== "ALL") { clauses.push("asset_type=?"); bindings.push(assetType as AssetType); }
  if (cursor) { clauses.push("instrument_id>?"); bindings.push(cursor); }
  const where = clauses.join(" AND ");

  const totalRow = await db.prepare(`SELECT COUNT(*) count FROM securities WHERE ${where.replace(" AND instrument_id>?", "")}`)
    .bind(...bindings.slice(0, cursor ? -1 : undefined)).first<{ count: number }>();
  const result = await db.prepare(`SELECT instrument_id,symbol FROM securities WHERE ${where} ORDER BY instrument_id LIMIT ${BATCH_SIZE}`)
    .bind(...bindings).all<SecurityRow>();
  const rows = result.results ?? [];
  if (!cursor) {
    await db.prepare("INSERT INTO audit_logs (id,actor,action,resource,detail_json,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(), user.email, "START_SERVER_QUOTE_REFRESH", scanId, JSON.stringify({ market, assetType, total:Number(totalRow?.count ?? 0) })).run();
  }
  if (rows.length === 0) {
    if (cursor) {
      await db.prepare("INSERT INTO audit_logs (id,actor,action,resource,detail_json,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)")
        .bind(crypto.randomUUID(), user.email, "COMPLETE_SERVER_QUOTE_REFRESH", scanId, JSON.stringify({ market, assetType, finalBatchUpdated:0, finalBatchFailed:0 })).run();
    }
    return Response.json({ scanId, total:Number(totalRow?.count ?? 0), processed:0, updated:0, failed:0, nextCursor:null, done:true, capturedAt:new Date().toISOString() }, { headers:{ "Cache-Control":"private, no-store" } });
  }

  const nextCursor = rows.at(-1)?.instrument_id ?? null;
  const done = rows.length < BATCH_SIZE;
  let refreshed;
  try { refreshed = await fetchLatestQuoteBatch(rows.map((row) => ({ instrumentId:row.instrument_id, symbol:row.symbol }))); }
  catch (error) {
    await db.prepare("INSERT INTO audit_logs (id,actor,action,resource,detail_json,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(), user.email, "SERVER_QUOTE_REFRESH_BATCH_FAILED", scanId, JSON.stringify({ market, assetType, cursor, count:rows.length, error:error instanceof Error ? error.message : String(error) })).run();
    if (done) {
      await db.prepare("INSERT INTO audit_logs (id,actor,action,resource,detail_json,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)")
        .bind(crypto.randomUUID(), user.email, "COMPLETE_SERVER_QUOTE_REFRESH", scanId, JSON.stringify({ market, assetType, finalBatchUpdated:0, finalBatchFailed:rows.length })).run();
    }
    return Response.json({ scanId, total:Number(totalRow?.count ?? 0), processed:rows.length, updated:0, failed:rows.length, nextCursor:done ? null : nextCursor, done, capturedAt:new Date().toISOString() }, { headers:{ "Cache-Control":"private, no-store" } });
  }

  try {
    const statements = refreshed.quotes.map((quote) => db.prepare(`INSERT INTO latest_quotes (instrument_id,price,previous_close,source,freshness,captured_at,updated_at)
      VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(instrument_id) DO UPDATE SET price=excluded.price,previous_close=excluded.previous_close,source=excluded.source,freshness=excluded.freshness,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(quote.instrumentId, quote.price, quote.previousClose, quote.source, quote.freshness, quote.capturedAt));
    if (statements.length) await db.batch(statements);

    const archive = runtimeEnv().MARKET_ARCHIVE;
    if (archive) {
      const key = `server-quote-refresh/${new Date().toISOString().slice(0,10)}/${scanId}/${encodeURIComponent(cursor || "start")}.json`;
      try { await archive.put(key, JSON.stringify({ scanId, market, assetType, quotes:refreshed.quotes, missing:refreshed.missing, capturedAt:new Date().toISOString() }), { httpMetadata:{ contentType:"application/json" } }); }
      catch { /* Quote persistence in D1 remains authoritative when optional raw archival is unavailable. */ }
    }
    if (done) {
      await db.prepare("INSERT INTO audit_logs (id,actor,action,resource,detail_json,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)")
        .bind(crypto.randomUUID(), user.email, "COMPLETE_SERVER_QUOTE_REFRESH", scanId, JSON.stringify({ market, assetType, finalBatchUpdated:refreshed.quotes.length, finalBatchFailed:refreshed.missing.length })).run();
    }
    return Response.json({
      scanId, total:Number(totalRow?.count ?? 0), processed:rows.length, updated:refreshed.quotes.length,
      failed:refreshed.missing.length, nextCursor:done ? null : nextCursor, done, capturedAt:refreshed.quotes[0]?.capturedAt ?? new Date().toISOString(),
    }, { headers:{ "Cache-Control":"private, no-store" } });
  } catch (error) { return jsonError("Public quote refresh failed", 502, error); }
}
