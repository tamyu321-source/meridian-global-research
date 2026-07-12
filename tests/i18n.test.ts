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
  }
});
