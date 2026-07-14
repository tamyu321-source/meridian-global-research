export type EntryZone = { entryLow?:number; entryHigh?:number };

export function evaluateEntryZone(priceValue:unknown, plan:EntryZone) {
  const price = Number(priceValue);
  const entryLow = Number(plan.entryLow ?? 0);
  const entryHigh = Number(plan.entryHigh ?? 0);
  const configured = Number.isFinite(price) && price > 0 && Number.isFinite(entryLow) && Number.isFinite(entryHigh) && entryLow > 0 && entryHigh >= entryLow;
  const tolerance = configured ? Math.max(1,Math.abs(price),Math.abs(entryLow),Math.abs(entryHigh)) * Number.EPSILON * 8 : 0;
  return {
    price,
    entryLow,
    entryHigh,
    configured,
    inside:configured && price >= entryLow - tolerance && price <= entryHigh + tolerance,
  };
}
