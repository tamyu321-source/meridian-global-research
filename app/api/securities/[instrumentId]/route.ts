import { rankSnapshots } from "@/lib/algorithm";
import { fetchSymbolSnapshot } from "@/lib/public-data";
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
    const snapshot = await fetchSymbolSnapshot(symbol, market, symbol, assetType);
    return Response.json({ security: rankSnapshots([snapshot], riskPlan, false)[0], bars: snapshot.bars.slice(-260) });
  } catch (error) { return jsonError("Security data unavailable", 502, error); }
}
