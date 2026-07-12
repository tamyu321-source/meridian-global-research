export type CapitalState = { startingCapital:number; cash:number; highWatermark:number };

export function calculateCapitalAdjustment(current:CapitalState, nextCapital:number) {
  if (!Number.isFinite(nextCapital) || nextCapital <= 0) return { ok:false as const, reason:"PAPER_CAPITAL_REQUIRED" as const };
  const delta = nextCapital - current.startingCapital;
  const cash = current.cash + delta;
  if (cash < -0.000001) return { ok:false as const, reason:"CAPITAL_REDUCTION_BLOCKED" as const, minimumCapital:current.startingCapital - current.cash };
  const highWatermark = Math.max(nextCapital,current.highWatermark + delta);
  return { ok:true as const, previousCapital:current.startingCapital, capital:nextCapital, delta, cash:Math.max(0,cash), highWatermark };
}
