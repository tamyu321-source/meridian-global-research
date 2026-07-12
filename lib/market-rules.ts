import type { AssetType, MarketCode } from "./types";

export const MARKET_RULE_VERSION = "2026-07-12";

export type MarketRule = {
  market: MarketCode;
  timeZone: string;
  sessions: Array<[number, number]>;
  settlement: "T+1" | "T+2";
  stockLot: number | null;
  etfLot: number | null;
  oddLotAllowed: boolean;
  priceLimitPct: number | null;
  commissionRate: number;
  commissionMinimum: number;
  exchangeRate: number;
  stockSellTaxRate: number;
  etfSellTaxRate: number;
  stampDutyBothSidesRate: number;
  notes: string[];
};

export const MARKET_RULES: Record<MarketCode, MarketRule> = {
  US: { market:"US", timeZone:"America/New_York", sessions:[[570,960]], settlement:"T+1", stockLot:1, etfLot:1, oddLotAllowed:true, priceLimitPct:null, commissionRate:.000035, commissionMinimum:.35, exchangeRate:0, stockSellTaxRate:0, etfSellTaxRate:0, stampDutyBothSidesRate:0, notes:["IBKR Pro tiered entry-rate estimate; regulatory pass-through fees may vary"] },
  CN: { market:"CN", timeZone:"Asia/Shanghai", sessions:[[570,690],[780,900]], settlement:"T+1", stockLot:100, etfLot:100, oddLotAllowed:false, priceLimitPct:10, commissionRate:.0003, commissionMinimum:5, exchangeRate:.00001, stockSellTaxRate:.0005, etfSellTaxRate:0, stampDutyBothSidesRate:0, notes:["A-share buy orders use 100-share lots", "Same-day purchased quantity is not sellable in this simulator"] },
  HK: { market:"HK", timeZone:"Asia/Hong_Kong", sessions:[[570,720],[780,960]], settlement:"T+2", stockLot:null, etfLot:null, oddLotAllowed:true, priceLimitPct:null, commissionRate:.0005, commissionMinimum:18, exchangeRate:.000085, stockSellTaxRate:0, etfSellTaxRate:0, stampDutyBothSidesRate:.001, notes:["Board lot is security-specific and requires broker reference data", "ETF stamp duty is estimated as exempt"] },
  TW: { market:"TW", timeZone:"Asia/Taipei", sessions:[[540,810]], settlement:"T+2", stockLot:1000, etfLot:1000, oddLotAllowed:true, priceLimitPct:10, commissionRate:.0008, commissionMinimum:80, exchangeRate:0, stockSellTaxRate:.003, etfSellTaxRate:.001, stampDutyBothSidesRate:0, notes:["Quantities below 1,000 use the odd-lot market", "Day-trade tax relief is not assumed"] },
  JP: { market:"JP", timeZone:"Asia/Tokyo", sessions:[[540,690],[750,930]], settlement:"T+2", stockLot:100, etfLot:1, oddLotAllowed:false, priceLimitPct:null, commissionRate:.0005, commissionMinimum:80, exchangeRate:0, stockSellTaxRate:0, etfSellTaxRate:0, stampDutyBothSidesRate:0, notes:["Domestic stocks use 100-share trading units", "ETF units vary by product; simulator permits one unit"] },
  KR: { market:"KR", timeZone:"Asia/Seoul", sessions:[[540,930]], settlement:"T+2", stockLot:1, etfLot:1, oddLotAllowed:true, priceLimitPct:30, commissionRate:.0006, commissionMinimum:4000, exchangeRate:0, stockSellTaxRate:.0015, etfSellTaxRate:0, stampDutyBothSidesRate:0, notes:["Sell tax is a conservative simulation estimate and varies by venue/product"] },
  SG: { market:"SG", timeZone:"Asia/Singapore", sessions:[[540,720],[780,1020]], settlement:"T+2", stockLot:100, etfLot:1, oddLotAllowed:true, priceLimitPct:null, commissionRate:.0008, commissionMinimum:2.5, exchangeRate:.0004, stockSellTaxRate:0, etfSellTaxRate:0, stampDutyBothSidesRate:0, notes:["Standard stock board lot is 100; odd lots use the unit-share market", "Exchange and clearing fees are estimated"] },
};

export function validateMarketQuantity(market: MarketCode, assetType: AssetType, side: "BUY" | "SELL", quantity: number) {
  const rule = MARKET_RULES[market];
  const lot = assetType === "ETF" ? rule.etfLot : rule.stockLot;
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) return "Quantity must be a positive whole number";
  if (market === "CN" && side === "BUY" && lot && quantity % lot !== 0) return `China buy quantity must be a multiple of ${lot}`;
  if (market === "JP" && assetType === "STOCK" && lot && quantity % lot !== 0) return `Japan stock quantity must be a multiple of ${lot}`;
  return null;
}

export function validatePositionQuantity(market: MarketCode, side:"BUY"|"SELL", quantity:number, heldQuantity:number) {
  if (side !== "SELL" || market !== "CN") return null;
  const oddRemainder = heldQuantity % 100;
  if (quantity % 100 !== 0 && quantity !== oddRemainder && quantity !== heldQuantity) return "China sell quantity must use 100-share lots or clear the odd-lot remainder";
  return null;
}

export function estimateMarketCosts(market: MarketCode, assetType: AssetType, side: "BUY" | "SELL", grossLocal: number, quantity: number) {
  const rule = MARKET_RULES[market];
  const commission = Math.max(rule.commissionMinimum, market === "US" ? quantity * .0035 : grossLocal * rule.commissionRate);
  const exchangeFees = grossLocal * rule.exchangeRate;
  const stampDuty = assetType === "ETF" && market === "HK" ? 0 : grossLocal * rule.stampDutyBothSidesRate;
  const sellTax = side === "SELL" ? grossLocal * (assetType === "ETF" ? rule.etfSellTaxRate : rule.stockSellTaxRate) : 0;
  return { commission, exchangeFees, stampDuty, sellTax, total:commission + exchangeFees + stampDuty + sellTax, ruleVersion:MARKET_RULE_VERSION };
}

export function marketSessionState(market: MarketCode, now = new Date()) {
  const rule = MARKET_RULES[market];
  const parts = new Intl.DateTimeFormat("en-US", { timeZone:rule.timeZone, weekday:"short", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(now);
  const value = (type:string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = value("weekday");
  const minutes = Number(value("hour")) * 60 + Number(value("minute"));
  const weekdayOpen = !["Sat","Sun"].includes(weekday);
  const open = weekdayOpen && rule.sessions.some(([start,end]) => minutes >= start && minutes < end);
  return { state:open ? "OPEN_ESTIMATE" : "CLOSED_ESTIMATE", localTime:`${weekday} ${value("hour")}:${value("minute")}`, timeZone:rule.timeZone, holidayCalendar:"not_connected" };
}

export function marketRulesForClient() {
  return Object.values(MARKET_RULES).map((rule) => ({ market:rule.market, settlement:rule.settlement, stockLot:rule.stockLot, etfLot:rule.etfLot, oddLotAllowed:rule.oddLotAllowed, priceLimitPct:rule.priceLimitPct, notes:rule.notes, session:marketSessionState(rule.market) }));
}
