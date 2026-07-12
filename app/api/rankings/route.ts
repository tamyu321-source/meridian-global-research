import { rankSnapshots } from "@/lib/algorithm";
import { scanPublicMarkets } from "@/lib/public-data";
import { loadLatestScanRankings, persistRankings } from "@/lib/repository";
import { jsonError } from "@/lib/server";
import { MARKETS, RISK_PLANS, type AssetType, type MarketCode, type RiskPlanId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const marketParam = String(url.searchParams.get("market") ?? "ALL").toUpperCase();
  const riskPlan = String(url.searchParams.get("riskPlan") ?? "capital_first") as RiskPlanId;
  const assetType = String(url.searchParams.get("assetType") ?? "ALL").toUpperCase() as AssetType | "ALL";
  if (marketParam !== "ALL" && !MARKETS.includes(marketParam as MarketCode)) return jsonError("Unsupported market", 400);
  if (!RISK_PLANS[riskPlan]) return jsonError("Unsupported risk plan", 400);
  const markets = marketParam === "ALL" ? MARKETS : [marketParam as MarketCode];
  try {
    const persisted = await loadLatestScanRankings(markets, assetType, riskPlan);
    if (persisted) {
      const visiblePerMarket = marketParam === "ALL" ? 10 : 50;
      const perMarket = new Map<MarketCode, number>();
      const rankings = persisted.rankings.filter((item) => {
        const count = perMarket.get(item.market) ?? 0;
        if (count >= visiblePerMarket) return false;
        perMarket.set(item.market, count + 1);
        return true;
      });
      return Response.json({
        rankings, meta: { mode:"SHADOW", validationStatus:"SHADOW", backtestStatus:"PROVISIONAL_BACKTEST", formalEligible:false, primaryFeed:persisted.scan.provider, discovery:"full_universe_bridge", ibkrConnected:false, persistence:"available", markets, errors:[], generatedAt:persisted.scan.completedAt ?? persisted.scan.startedAt, scan:persisted.scan },
      }, { headers:{ "Cache-Control":"private, max-age=120" } });
    }
    const scanCount = marketParam === "ALL" ? 6 : 16;
    const visiblePerMarket = marketParam === "ALL" ? 3 : 10;
    const { snapshots, errors } = await scanPublicMarkets(markets, scanCount, assetType);
    const perMarket = new Map<MarketCode, number>();
    const ranked = rankSnapshots(snapshots, riskPlan, false).filter((item) => {
      const count = perMarket.get(item.market) ?? 0;
      if (count >= visiblePerMarket) return false;
      perMarket.set(item.market, count + 1);
      return true;
    });
    let persistence = "available";
    try { await persistRankings(snapshots, ranked); } catch { persistence = "migration_pending"; }
    return Response.json({
      rankings: ranked, meta: { mode: "SHADOW", validationStatus:"SHADOW", backtestStatus:"NOT_STARTED", formalEligible:false, primaryFeed: "public_sources", discovery: "limited_live_fallback_watch_only", ibkrConnected: false, persistence, markets, errors: errors.slice(0, 8), generatedAt: new Date().toISOString(), scan:null },
    }, { headers: { "Cache-Control": "private, max-age=120" } });
  } catch (error) { return jsonError("Market scan failed", 502, error); }
}
