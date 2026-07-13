import type { EntryState, SetupMetrics } from "./types";

const ENTRY_STATES = new Set<EntryState>([
  "BREAKOUT_READY",
  "PULLBACK_READY",
  "WAIT_PULLBACK",
  "OVEREXTENDED",
  "NO_SETUP",
  "BLOCKED_REGIME",
  "BLOCKED_DATA",
]);
const SETUP_TYPES = new Set<SetupMetrics["setupType"]>(["BREAKOUT", "PULLBACK", "NONE"]);
const MARKET_REGIMES = new Set<SetupMetrics["marketRegime"]>(["RISK_ON", "NEUTRAL", "RISK_OFF", "UNKNOWN"]);
const NUMBER_FIELDS: Array<keyof SetupMetrics> = [
  "distance52WeekHighPct",
  "distance5YearHighPct",
  "extensionAtr",
  "breakoutLevel",
  "volumeRatio",
  "closeLocation",
  "gapAtr",
  "rangeAtr",
  "coolingSessionsRemaining",
  "marketBreadthPct",
];

/**
 * Legacy v2.0 signals store an empty setup object. Only expose setup metrics
 * when the complete v2.1 payload is present so old or partial rows remain safe.
 */
export function normalizeSetupMetrics(value: unknown): SetupMetrics | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!ENTRY_STATES.has(candidate.entryState as EntryState)) return undefined;
  if (!SETUP_TYPES.has(candidate.setupType as SetupMetrics["setupType"])) return undefined;
  if (!MARKET_REGIMES.has(candidate.marketRegime as SetupMetrics["marketRegime"])) return undefined;
  if (!NUMBER_FIELDS.every((key) => typeof candidate[key] === "number" && Number.isFinite(candidate[key]))) return undefined;
  if (typeof candidate.researchEligible !== "boolean") return undefined;
  if (candidate.benchmarkSymbol !== null && typeof candidate.benchmarkSymbol !== "string") return undefined;
  return candidate as unknown as SetupMetrics;
}
