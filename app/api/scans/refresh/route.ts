import { fetchLatestQuoteBatch, type RefreshedQuote } from "@/lib/public-data";
import { apiUser, jsonError, runtimeEnv } from "@/lib/server";
import { MARKETS, type AssetType, type MarketCode } from "@/lib/types";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 20;
type SecurityRow = { instrument_id: string; symbol: string };

function validScanId(value: unknown) {
  const scanId = String(value ?? "");
  return /^[a-zA-Z0-9-]{8,80}$/.test(scanId) ? scanId : crypto.randomUUID();
}

async function safeAudit(db:D1Database, actor:string, action:string, resource:string, detail:unknown) {
  try {
    await db.prepare("INSERT INTO audit_logs (id,actor,action,resource,detail_json,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)")
      .bind(crypto.randomUUID(), actor, action, resource, JSON.stringify(detail)).run();
  } catch { /* Audit failure must not block quote refresh. */ }
}

async function persistRefreshedQuotes(db:D1Database, quotes:RefreshedQuote[]) {
  let updated = 0;
  const failed:string[] = [];
  const statement = (quote:RefreshedQuote) => db.prepare(`INSERT INTO latest_quotes (instrument_id,price,previous_close,source,freshness,captured_at,updated_at)
    VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(instrument_id) DO UPDATE SET price=excluded.price,previous_close=excluded.previous_close,source=excluded.source,freshness=excluded.freshness,captured_at=excluded.captured_at,updated_at=CURRENT_TIMESTAMP`)
    .bind(quote.instrumentId, quote.price, quote.previousClose, quote.source, quote.freshness, quote.capturedAt);
  for (let index=0; index<quotes.length; index+=10) {
    const chunk=quotes.slice(index,index+10);
    try { await db.batch(chunk.map(statement)); updated+=chunk.length; }
    catch {
      for (const quote of chunk) {
        try { await statement(quote).run(); updated+=1; }
        catch { failed.push(quote.instrumentId); }
      }
    }
  }
  return { updated, failed };
}

export async function GET(request:Request) {
  const user=await apiUser(request);
  if(!user)return jsonError("Sign in required",401);
  const db=runtimeEnv().DB;
  if(!db)return jsonError("Quote refresh service unavailable",503);
  try {
    const [audit,quotes]=await Promise.all([
      db.prepare("SELECT action,resource,detail_json,created_at FROM audit_logs WHERE action LIKE '%SERVER_QUOTE_REFRESH%' ORDER BY created_at DESC LIMIT 12").all(),
      db.prepare("SELECT COUNT(*) instruments,MAX(captured_at) latest_captured_at FROM latest_quotes").first(),
    ]);
    return Response.json({ quotes, events:audit.results??[] },{headers:{"Cache-Control":"private, no-store"}});
  } catch(error){return jsonError("Quote refresh status unavailable",503,error);}
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
    await safeAudit(db,user.email,"START_SERVER_QUOTE_REFRESH",scanId,{ market, assetType, total:Number(totalRow?.count ?? 0) });
  }
  if (rows.length === 0) {
    if (cursor) {
      await safeAudit(db,user.email,"COMPLETE_SERVER_QUOTE_REFRESH",scanId,{ market, assetType, finalBatchUpdated:0, finalBatchFailed:0 });
    }
    return Response.json({ scanId, total:Number(totalRow?.count ?? 0), processed:0, updated:0, failed:0, nextCursor:null, done:true, capturedAt:new Date().toISOString() }, { headers:{ "Cache-Control":"private, no-store" } });
  }

  const nextCursor = rows.at(-1)?.instrument_id ?? null;
  const done = rows.length < BATCH_SIZE;
  let refreshed;
  try { refreshed = await fetchLatestQuoteBatch(rows.map((row) => ({ instrumentId:row.instrument_id, symbol:row.symbol }))); }
  catch (error) {
    await safeAudit(db,user.email,"SERVER_QUOTE_REFRESH_BATCH_FAILED",scanId,{ market, assetType, cursor, count:rows.length, error:error instanceof Error ? error.message : String(error) });
    if (done) {
      await safeAudit(db,user.email,"COMPLETE_SERVER_QUOTE_REFRESH",scanId,{ market, assetType, finalBatchUpdated:0, finalBatchFailed:rows.length });
    }
    return Response.json({ scanId, total:Number(totalRow?.count ?? 0), processed:rows.length, updated:0, failed:rows.length, nextCursor:done ? null : nextCursor, done, capturedAt:new Date().toISOString() }, { headers:{ "Cache-Control":"private, no-store" } });
  }

  try {
    const stored=await persistRefreshedQuotes(db,refreshed.quotes);
    const failedCount=refreshed.missing.length+stored.failed.length;
    if(refreshed.quotes.length>0&&stored.updated===0)throw new Error("All refreshed quotes failed D1 persistence");

    const archive = runtimeEnv().MARKET_ARCHIVE;
    if (archive) {
      const key = `server-quote-refresh/${new Date().toISOString().slice(0,10)}/${scanId}/${encodeURIComponent(cursor || "start")}.json`;
      try { await archive.put(key, JSON.stringify({ scanId, market, assetType, quotes:refreshed.quotes, missing:refreshed.missing, storageFailures:stored.failed, capturedAt:new Date().toISOString() }), { httpMetadata:{ contentType:"application/json" } }); }
      catch { /* Quote persistence in D1 remains authoritative when optional raw archival is unavailable. */ }
    }
    if (done) {
      await safeAudit(db,user.email,"COMPLETE_SERVER_QUOTE_REFRESH",scanId,{ market, assetType, finalBatchUpdated:stored.updated, finalBatchFailed:failedCount });
    }
    return Response.json({
      scanId, total:Number(totalRow?.count ?? 0), processed:rows.length, updated:stored.updated,
      failed:failedCount, nextCursor:done ? null : nextCursor, done, capturedAt:refreshed.quotes[0]?.capturedAt ?? new Date().toISOString(),
    }, { headers:{ "Cache-Control":"private, no-store" } });
  } catch (error) {
    await safeAudit(db,user.email,"SERVER_QUOTE_REFRESH_STORAGE_FAILED",scanId,{market,assetType,cursor,count:rows.length,error:error instanceof Error?error.message:String(error)});
    return jsonError("Public quote refresh failed", 502, error);
  }
}
