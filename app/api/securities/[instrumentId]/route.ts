import { rankSnapshots } from "@/lib/algorithm";
import { fetchSymbolSnapshot } from "@/lib/public-data";
import { loadLatestScanRankings } from "@/lib/repository";
import { defaultRiskPolicy, loadRiskPolicy } from "@/lib/risk-policy";
import { apiUser, jsonError, runtimeEnv } from "@/lib/server";
import { ACTIVE_MODEL_VERSION, CANDIDATE_MODEL_VERSION, MARKETS, isSupportedModelVersion, type AssetType, type MarketCode, type RiskPlanId } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ instrumentId: string }> }) {
  const user=await apiUser(request);if(!user)return jsonError("Sign in required",401);
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
  const modelVersion = url.searchParams.get("modelVersion") ?? ACTIVE_MODEL_VERSION;
  if (!isSupportedModelVersion(modelVersion)) return jsonError("Unsupported model version", 400);
  try {
    const db=runtimeEnv().DB,policy=db?await loadRiskPolicy(db,user.email,riskPlan):defaultRiskPolicy(riskPlan);
    const persisted = await loadLatestScanRankings([market], "ALL", riskPlan, modelVersion,policy);
    const security = persisted?.rankings.find((item) => item.instrumentId === decoded);
    if (security) {
      try {
        const live = await fetchSymbolSnapshot(symbol, market, security.name, security.assetType);
        const price = live.price;
        const tradePlanState = price >= security.tradePlan.entryLow && price <= security.tradePlan.entryHigh ? "CURRENT" : "REANALYSIS_REQUIRED";
        return Response.json({ security:{ ...security, price, changePct:live.previousClose ? Number((((price-live.previousClose)/live.previousClose)*100).toFixed(2)) : 0, source:live.source, freshness:live.freshness, capturedAt:live.capturedAt, tradePlanState }, bars:live.bars.slice(-1260), scan:persisted?.scan });
      } catch { return Response.json({ security, bars:[], scan:persisted?.scan }); }
    }
    if (modelVersion === CANDIDATE_MODEL_VERSION) return jsonError("Candidate analysis not available for this security", 404);
    const snapshot = await fetchSymbolSnapshot(symbol, market, symbol, assetType);
    return Response.json({ security: rankSnapshots([snapshot], riskPlan, false)[0], bars: snapshot.bars.slice(-260) });
  } catch (error) { return jsonError("Security data unavailable", 502, error); }
}
