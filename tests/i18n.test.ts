import assert from "node:assert/strict";
import test from "node:test";
import { apiErrorText, codeText, riskPlanName, tx } from "../lib/i18n";

test("risk-plan limits and names are localized", () => {
  assert.equal(riskPlanName("zh-CN","growth"), "积极成长");
  assert.equal(riskPlanName("zh-TW","capital_first"), "保本優先");
  assert.equal(riskPlanName("ja","balanced"), "バランス成長");
  assert.equal(riskPlanName("ko","growth"), "적극 성장");
});

test("paper-order risk errors use localized parameters", () => {
  assert.equal(apiErrorText("zh-CN",{errorCode:"POSITION_LIMIT",errorParams:{max:12,plan:"growth"}}), "该订单会超过“积极成长”计划 12% 的单只证券上限。");
  assert.equal(apiErrorText("en",{errorCode:"DRAWDOWN_BREAKER",errorParams:{max:20}}), "Portfolio drawdown reached the 20% breaker; new buys are paused.");
  assert.equal(apiErrorText("zh-CN",{errorCode:"CAPITAL_REDUCTION_BLOCKED",errorParams:{minimum:4_000}}), "当前仍有持仓，模拟本金不能低于 4000；请先卖出部分持仓。");
});

test("algorithm and health codes no longer leak English UI labels", () => {
  assert.equal(codeText("zh-TW","TREND_CONFIRMED"), "趨勢確認");
  assert.equal(codeText("ja","NOT_STARTED"), "未開始");
  assert.equal(codeText("ko","operational"), "정상 운영");
  assert.equal(codeText("zh-CN","MINIMUM_TRADABLE_LOT"), "最小交易整手例外");
});

test("all supported locales expose core portfolio copy", () => {
  for (const locale of ["en","zh-TW","zh-CN","ja","ko"] as const) {
    assert.notEqual(tx(locale,"maxPosition"), "");
    assert.notEqual(tx(locale,"marketRules"), "");
    assert.notEqual(tx(locale,"orderHistory"), "");
    assert.notEqual(tx(locale,"refreshQuotes"), "");
    assert.notEqual(tx(locale,"fullAnalysis"), "");
    assert.notEqual(tx(locale,"fullAnalysisConfirmBody"), "");
    assert.notEqual(tx(locale,"analysisCloudMissing"), "");
    assert.notEqual(tx(locale,"reanalysisBuyBlocked"), "");
    assert.match(tx(locale,"refreshComplete",{updated:12,failed:0}), /12/);
    assert.notEqual(tx(locale,"refreshPositions"), "");
    assert.notEqual(tx(locale,"holdingAdvice"), "");
    assert.notEqual(tx(locale,"holdingAdviceNote"), "");
    assert.notEqual(tx(locale,"recommendedSell"), "");
    assert.notEqual(tx(locale,"holdingDisclaimer"), "");
    assert.match(tx(locale,"portfolioQuotesUpdated",{updated:2,failed:0}), /2/);
  }
});

test("holding actions and evidence are localized", () => {
  assert.equal(codeText("zh-TW","REVIEW"), "檢查資料");
  assert.equal(codeText("zh-CN","HOLDING_STOP_TRIGGERED"), "现价已触及 ATR 止损");
  assert.equal(codeText("ja","HOLDING_TARGET1_REACHED"), "第1利益目標に到達しました");
  assert.equal(codeText("ko","HOLDING_PLAN_VALID"), "추세와 위험 조건이 유효합니다");
});

test("v2.2 entry states, profile status and model-lock copy are localized", () => {
  assert.equal(codeText("zh-TW","BREAKOUT_READY"), "高品質放量突破，可以進場");
  assert.equal(codeText("zh-CN","OVEREXTENDED"), "趋势良好但过度延伸，至少等待三个交易日");
  assert.match(codeText("ja","BLOCKED_REGIME"), /市場状態/);
  assert.match(codeText("ko","PULLBACK_READY"), /진입 가능/);
  for (const locale of ["en","zh-TW","zh-CN","ja","ko"] as const) {
    assert.notEqual(tx(locale,"candidateLocked"), "");
    assert.notEqual(tx(locale,"entryQuality"), "");
    assert.notEqual(tx(locale,"chart5y"), "");
    assert.notEqual(tx(locale,"investmentMarkets"), "");
    assert.notEqual(tx(locale,"customRiskPolicy"), "");
    assert.match(tx(locale,"riskPolicyPreview",{position:12,sector:40,marketTotal:80,cash:20}), /12/);
    assert.notEqual(tx(locale,"riskPolicyConflictPreview"), "");
    assert.notEqual(codeText(locale,"ACTIVE_SHADOW"), "ACTIVE SHADOW");
  }
});

test("custom risk-policy errors are localized", () => {
  assert.match(apiErrorText("zh-TW",{errorCode:"MARKET_NOT_ENABLED",errorParams:{market:"CN"}}),/CN/);
  assert.match(apiErrorText("ja",{errorCode:"TRADE_RISK_LIMIT",errorParams:{riskPct:1.4,max:1,maximumQuantity:80,minimumCapital:6000}}),/80/);
  assert.match(apiErrorText("ko",{errorCode:"RISK_POLICY_INVALID",errorParams:{rule:"RISK_LIMIT_RANGE"}}),/RISK_LIMIT_RANGE/);
});

test("a quote outside the analyzed entry zone has a localized paper-buy error", () => {
  assert.equal(apiErrorText("zh-TW",{errorCode:"PRICE_OUTSIDE_ENTRY_ZONE"}), "最新價格已離開分析進場區，請先執行完整分析再模擬買進。");
  assert.match(apiErrorText("ja",{errorCode:"PRICE_OUTSIDE_ENTRY_ZONE"}), /完全分析/);
});
