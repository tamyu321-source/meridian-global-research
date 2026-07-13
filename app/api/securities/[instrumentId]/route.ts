import { rankSnapshots } from "@/lib/algorithm";
import { fetchSymbolSnapshot } from "@/lib/public-data";
import { loadLatestScanRankings } from "@/lib/repository";
import { jsonError } from "@/lib/server";
import { MARKETS, type AssetType, type MarketCode, type RiskPlanId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ instrumentId: string }> }) {
  const { instrumentId } = await context.params;
  const decoded = decodeURIComponent(instrumentId);
  const separator = decoded.indexOf(":");
  if (separator < 1) return jsonError("instrumentId must be MARKET:SYMBOL", 400);
  const market = decoded.slice(0, separator).toUpperCase() as MarketCode;
  const symbol = decoded.slice(separator + 1).toUpperCase();
  if (!MARKETS.includes(market) || !symbol) return jsonError("Invalid instrumentId", 400);
  const url = new URL(request.url);
  const assetType = (url.searchParams.get("assetType") === "ETF" ? "ETF" : "STOCK") as AssetType;
  const riskPlan = (url.searchParams.get("riskPlan") ?? "capital_first") as RiskPlanId;
  try {
    const persisted = await loadLatestScanRankings([market], "ALL", riskPlan);
    const security = persisted?.rankings.find((item) => item.instrumentId === decoded);
    if (security) {
      try {
        const live = await fetchSymbolSnapshot(symbol, market, security.name, security.assetType);
        const price = live.price;
        const tradePlanState = price >= security.tradePlan.entryLow && price <= security.tradePlan.entryHigh ? "CURRENT" : "REANALYSIS_REQUIRED";
        return Response.json({ security:{ ...security, price, changePct:live.previousClose ? Number((((price-live.previousClose)/live.previousClose)*100).toFixed(2)) : 0, source:live.source, freshness:live.freshness, capturedAt:live.capturedAt, tradePlanState }, bars:live.bars.slice(-260), scan:persisted?.scan });
      } catch { return Response.json({ security, bars:[], scan:persisted?.scan }); }
    }
    const snapshot = await fetchSymbolSnapshot(symbol, market, symbol, assetType);
    return Response.json({ security: rankSnapshots([snapshot], riskPlan, false)[0], bars: snapshot.bars.slice(-260) });
  } catch (error) { return jsonError("Security data unavailable", 502, error); }
}
