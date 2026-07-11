import { rankSnapshots } from "@/lib/algorithm";
import { scanPublicMarkets } from "@/lib/public-data";
import { persistRankings } from "@/lib/repository";
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
    const { snapshots, errors } = await scanPublicMarkets(markets, marketParam === "ALL" ? 2 : 10);
    const ranked = rankSnapshots(snapshots, riskPlan, false).filter((item) => assetType === "ALL" || item.assetType === assetType);
    let persistence = "available";
    try { await persistRankings(snapshots, ranked); } catch { persistence = "migration_pending"; }
    return Response.json({
      rankings: ranked, meta: { mode: "SHADOW", primaryFeed: "public_sources", ibkrConnected: false, persistence, markets, errors: errors.slice(0, 8), generatedAt: new Date().toISOString() },
    }, { headers: { "Cache-Control": "private, max-age=120" } });
  } catch (error) { return jsonError("Market scan failed", 502, error); }
}
