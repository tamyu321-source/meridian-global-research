import { runtimeEnv } from "@/lib/server";
import { MARKETS } from "@/lib/types";

export const dynamic = "force-dynamic";

const acceptance = { minimumTrades: 500, minimumTradesPerMarket: 40, profitFactor: 1.2, sharpe: 0.8, outOfSampleYears: 2, shadowTradingDays: 30, completenessPct: 98, quoteFreshnessPct: 99, reproducibilityPct: 100 };

export async function GET(_request: Request, context: { params: Promise<{ modelVersion: string }> }) {
  const { modelVersion } = await context.params;
  const db = runtimeEnv().DB;
  if (!db) return Response.json({ modelVersion, status: "NOT_STARTED", acceptance, markets: MARKETS.map((market) => ({ market, status: "NOT_STARTED" })) });
  try {
    const result = await db.prepare("SELECT * FROM backtest_runs WHERE model_version=? ORDER BY created_at DESC").bind(modelVersion).all();
    const runs = (result.results ?? []).map((row: Record<string, unknown>) => ({ ...row, metrics: row.metrics_json ? JSON.parse(String(row.metrics_json)) : null }));
    return Response.json({ modelVersion, status: runs.length ? "PROVISIONAL_BACKTEST" : "NOT_STARTED", validationStatus:"PROVISIONAL_BACKTEST", formalEligible:false, survivorshipBias:true, acceptance, runs, markets: MARKETS.map((market) => runs.find((run: Record<string, unknown>) => String(run.market) === market) ?? { market, status: "NOT_STARTED" }) });
  } catch { return Response.json({ modelVersion, status: "MIGRATION_PENDING", acceptance, markets: MARKETS.map((market) => ({ market, status: "NOT_STARTED" })) }); }
}
