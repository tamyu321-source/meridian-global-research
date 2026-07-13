import type { Locale } from "./types";

type Params = Record<string, string | number | null | undefined>;

const en = {
  language:"Language", mainNavigation:"Main navigation", researchDesk:"Research desk", model:"Model", holdingPeriod:"2–12 week swing", dataStatus:"Data status",
  dashboard:"Overview", scanner:"Market scanner", signals:"Signals", security:"Security research",
  refreshQuotes:"Refresh market quotes", refreshingQuotes:"Refreshing quotes {processed}/{total}", refreshComplete:"Updated {updated} quotes directly from the public market source ({failed} failed); model scores remain from the latest full analysis.", refreshFailed:"The server could not refresh public market quotes.",
  fullScan:"Full scan", discovered:"Discovered", analyzed:"Analyzed", failed:"Failed", fallback:"Fallback", running:"Running", universeTarget:"500 stocks + 100 ETFs per market",
  shadowBuy:"Shadow buy", watch:"Watch", hardGated:"Hard gated", ibkrFeed:"IBKR feed", off:"Off", ranked:"ranked", limited:"limited",
  stock:"Stock", etf:"ETF", buy:"Buy", hold:"Hold", reduce:"Reduce", exit:"Exit", shadow:"Shadow", formal:"Formal",
  realtime:"Real-time", delayed:"Delayed", fallbackData:"Fallback", stale:"Stale",
  trendConfirmed:"Trend confirmed", trendUnconfirmed:"Trend not confirmed", momentumLeadership:"Momentum leadership", momentumMixed:"Mixed momentum", riskControlled:"Risk controlled", volatilityElevated:"Elevated volatility", liquidityAcceptable:"Liquidity acceptable", liquidityThin:"Thin liquidity", formalGateActive:"Formal gate active", ibkrNotConnected:"IBKR not connected",
  insufficientHistory:"Insufficient history", staleData:"Stale data", sourceWarning:"Source warning", invalidPrice:"Invalid price",
  portfolioEyebrow:"Paper / Portfolio", loading:"Loading…", setupButton:"Set up", symbol:"Symbol", market:"Market", quantity:"Quantity", sellable:"Sellable", averagePrice:"Average / Price", baseValue:"Base value", pnl:"P&L", sell:"Paper sell", positions:"Positions", equity:"Equity", cash:"Cash", unrealizedPnl:"Unrealized P&L", drawdown:"Drawdown", feeNotice:"Fees, taxes and FX are revalidated server-side",
  riskLimits:"Risk limits", riskPlan:"Risk plan", singleTradeRisk:"Risk per trade", maxPosition:"Max single position", maxSector:"Max sector", maxMarket:"Max market", drawdownBreaker:"Drawdown breaker", capitalFirst:"Capital first", balanced:"Balanced growth", growth:"Aggressive growth", minimumLotRule:"For markets requiring board lots, the first minimum lot may exceed position and sector limits, but never the market limit or available cash.", minimumLotException:"Minimum tradable lot exception",
  marketRules:"Market rules", settlement:"Settlement", tradingUnit:"Trading unit", variable:"Security-specific", sessionOpen:"Open estimate", sessionClosed:"Closed estimate", ruleVersion:"Rule version",
  orderHistory:"Order history", orderTime:"Time", side:"Side", filledPrice:"Filled price", feesTaxes:"Fees + taxes", realizedPnl:"Realized P&L", status:"Status", filled:"Filled", noRecords:"No records", sellCompleted:"Paper sell completed",
  backtestEyebrow:"Model / Validation", formalLocked:"Formal signals locked", validationRequired:"Backtest and 30 trading-day shadow validation are required.", minimumTrades:"Minimum trades", profitFactor:"Profit factor", sharpe:"Sharpe", shadowDays:"Shadow days", pending:"Pending", passed:"Passed", locked:"Locked",
  notStarted:"Not started", inProgress:"In progress", migrationPending:"Migration pending", complete:"Complete", partial:"Partial",
  healthEyebrow:"System / Health", primaryFeed:"Primary real-time feed", shadowUntilValidated:"Public-source candidates remain shadow signals until IBKR subscriptions and validation are complete.", noSnapshot:"No snapshot", healthy:"Healthy", degraded:"Degraded", unavailable:"Unavailable", operational:"Operational", waiting:"Waiting for data", daily:"Daily", unknown:"Unknown",
  settingsEyebrow:"Owner / Settings", baseCurrency:"Base currency", paperCapital:"Paper capital", email:"Email", enableEmail:"Enable Email alerts through Resend", saved:"Saved", saveFailed:"Save failed", capitalSynced:"Saved: paper capital {capital}; cash adjusted by {delta}.", inAppEmailDelivered:"In-app and Email delivered", inAppDelivered:"In-app delivered; Email is not configured", alertFailed:"Alert failed",
  errorGeneric:"The request could not be completed. Please try again.", errorSignIn:"Sign in is required.", errorService:"The portfolio service is temporarily unavailable.", errorInvalidOrder:"Please provide a valid security, side and whole-number quantity.", errorSetup:"Complete portfolio setup before paper trading.", errorNoQuote:"No current quote is available for this security.", errorMarketQuantity:"The quantity does not satisfy this market's trading-unit rules.", errorStaleQuote:"The quote is stale, so simulated execution is blocked.", errorDrawdown:"Portfolio drawdown reached the {max}% breaker; new buys are paused.", errorT1:"The sell quantity exceeds the currently sellable A-share position (T+1).", errorPosition:"This order would exceed the {max}% maximum single-position limit of the {plan} plan.", errorMarket:"This order would exceed the {max}% maximum market exposure.", errorSector:"This order would exceed the {max}% maximum sector exposure.", errorCash:"Insufficient paper cash after FX and transaction costs.", errorPortfolio:"The paper portfolio is temporarily unavailable.", errorOrder:"The paper order could not be completed.", errorCapitalRequired:"Paper capital must be greater than zero.", errorCapitalReduction:"Capital cannot be reduced below {minimum} while current holdings remain. Sell positions first.", errorCurrencyLocked:"Base currency is locked to {currency} after paper activity exists.", errorSettings:"Settings could not be saved.",
} as const;

type CopyKey = keyof typeof en;

const zhCN: Record<CopyKey,string> = {
  language:"语言",mainNavigation:"主导航",researchDesk:"研究工作台",model:"模型",holdingPeriod:"2–12 周波段",dataStatus:"数据状态",
  dashboard:"总览",scanner:"市场扫描",signals:"信号中心",security:"证券研究",
  refreshQuotes:"重新扫描行情",refreshingQuotes:"正在刷新行情 {processed}/{total}",refreshComplete:"已从公开市场来源直接更新 {updated} 条行情（{failed} 条失败）；模型分数仍来自最近一次完整分析。",refreshFailed:"服务器未能刷新公开市场行情。",
  fullScan:"全市场扫描",discovered:"发现标的",analyzed:"完成分析",failed:"分析失败",fallback:"备用来源",running:"运行中",universeTarget:"每个市场 500 只股票 + 100 只 ETF",
  shadowBuy:"影子买入",watch:"观察",hardGated:"风险门槛阻止",ibkrFeed:"IBKR 行情",off:"未启用",ranked:"只已排名",limited:"有限样本",
  stock:"股票",etf:"ETF",buy:"买入",hold:"持有",reduce:"减仓",exit:"退出",shadow:"影子",formal:"正式",
  realtime:"实时",delayed:"延迟",fallbackData:"备用来源",stale:"过期",
  trendConfirmed:"趋势确认",trendUnconfirmed:"趋势未确认",momentumLeadership:"动量领先",momentumMixed:"动量混合",riskControlled:"风险受控",volatilityElevated:"波动率偏高",liquidityAcceptable:"流动性合格",liquidityThin:"流动性不足",formalGateActive:"正式门槛已启用",ibkrNotConnected:"IBKR 尚未连接",
  insufficientHistory:"历史数据不足",staleData:"数据已过期",sourceWarning:"数据源警告",invalidPrice:"价格无效",
  portfolioEyebrow:"模拟交易／投资组合",loading:"加载中…",setupButton:"前往设置",symbol:"证券代码",market:"市场",quantity:"数量",sellable:"可卖",averagePrice:"成本／现价",baseValue:"基准币值",pnl:"损益",sell:"模拟卖出",positions:"持仓",equity:"净值",cash:"现金",unrealizedPnl:"未实现损益",drawdown:"回撤",feeNotice:"费用、税费与汇率会在服务器重新计算",
  riskLimits:"风险限制",riskPlan:"风险计划",singleTradeRisk:"单笔风险",maxPosition:"单只证券上限",maxSector:"单一行业上限",maxMarket:"单一市场上限",drawdownBreaker:"回撤熔断线",capitalFirst:"保本优先",balanced:"均衡成长",growth:"积极成长",minimumLotRule:"对于必须整手交易的市场，首次买入最小一手可以突破单股及行业上限，但绝不会突破市场上限或可用现金。",minimumLotException:"最小交易整手例外",
  marketRules:"市场规则",settlement:"交收",tradingUnit:"交易单位",variable:"按证券而定",sessionOpen:"预计开市",sessionClosed:"预计休市",ruleVersion:"规则版本",
  orderHistory:"订单记录",orderTime:"时间",side:"方向",filledPrice:"成交价",feesTaxes:"费用与税费",realizedPnl:"已实现损益",status:"状态",filled:"已成交",noRecords:"暂无记录",sellCompleted:"模拟卖出完成",
  backtestEyebrow:"模型／验证",formalLocked:"正式信号尚未解锁",validationRequired:"必须通过回测及 30 个交易日影子验证。",minimumTrades:"最低交易笔数",profitFactor:"获利因子",sharpe:"夏普比率",shadowDays:"影子验证天数",pending:"待验证",passed:"已通过",locked:"未解锁",
  notStarted:"尚未开始",inProgress:"进行中",migrationPending:"迁移待完成",complete:"完成",partial:"部分完成",
  healthEyebrow:"系统／数据健康",primaryFeed:"正式实时主行情",shadowUntilValidated:"完成 IBKR 行情订阅及验证前，公开来源候选仍只显示影子信号。",noSnapshot:"暂无快照",healthy:"正常",degraded:"降级",unavailable:"不可用",operational:"运行正常",waiting:"等待数据",daily:"日线",unknown:"未知",
  settingsEyebrow:"仅限拥有者／设置",baseCurrency:"基准货币",paperCapital:"模拟资金",email:"电子邮箱",enableEmail:"通过 Resend 启用邮件提醒",saved:"已保存",saveFailed:"保存失败",capitalSynced:"已保存：模拟本金 {capital}；现金同步调整 {delta}。",inAppEmailDelivered:"站内和邮件通知均已送达",inAppDelivered:"站内通知已送达；邮件尚未配置",alertFailed:"通知发送失败",
  errorGeneric:"暂时无法完成请求，请重试。",errorSignIn:"请先登录。",errorService:"模拟组合服务暂时不可用。",errorInvalidOrder:"请输入有效证券、买卖方向和整数数量。",errorSetup:"请先完成模拟组合设置。",errorNoQuote:"该证券目前没有可用行情。",errorMarketQuantity:"数量不符合该市场的交易单位规则。",errorStaleQuote:"行情已经过期，因此禁止模拟成交。",errorDrawdown:"组合回撤已达到 {max}% 熔断线，暂停新买入。",errorT1:"卖出数量超过当前可卖 A 股持仓（T+1）。",errorPosition:"该订单会超过“{plan}”计划 {max}% 的单只证券上限。",errorMarket:"该订单会超过 {max}% 的单一市场上限。",errorSector:"该订单会超过 {max}% 的单一行业上限。",errorCash:"计入汇率和交易成本后，模拟现金不足。",errorPortfolio:"模拟组合暂时不可用。",errorOrder:"模拟订单未能完成。",errorCapitalRequired:"模拟资金必须大于零。",errorCapitalReduction:"当前仍有持仓，模拟本金不能低于 {minimum}；请先卖出部分持仓。",errorCurrencyLocked:"已有模拟交易后，基准货币锁定为 {currency}。",errorSettings:"设置未能保存。",
};

const zhTW: Record<CopyKey,string> = {
  ...zhCN,
  language:"語言",mainNavigation:"主導覽",researchDesk:"研究工作台",dataStatus:"資料狀態",scanner:"市場掃描",signals:"訊號中心",security:"證券研究",
  refreshQuotes:"重新掃描行情",refreshingQuotes:"正在更新行情 {processed}/{total}",refreshComplete:"已直接從公開市場來源更新 {updated} 筆行情（{failed} 筆失敗）；模型分數仍沿用最近一次完整分析。",refreshFailed:"伺服器未能更新公開市場行情。",
  fullScan:"全市場掃描",discovered:"發現標的",analyzed:"完成分析",failed:"分析失敗",fallback:"備用來源",running:"執行中",universeTarget:"每個市場 500 檔股票 + 100 檔 ETF",
  shadowBuy:"影子買進",watch:"觀察",hardGated:"風險門檻阻擋",ibkrFeed:"IBKR 行情",off:"未啟用",ranked:"檔已排名",limited:"有限樣本",
  stock:"股票",buy:"買進",hold:"持有",reduce:"減碼",exit:"退出",formal:"正式",realtime:"即時",delayed:"延遲",fallbackData:"備用來源",stale:"過期",
  trendConfirmed:"趨勢確認",trendUnconfirmed:"趨勢未確認",momentumLeadership:"動能領先",momentumMixed:"動能混合",riskControlled:"風險受控",volatilityElevated:"波動率偏高",liquidityAcceptable:"流動性合格",liquidityThin:"流動性不足",formalGateActive:"正式門檻已啟用",ibkrNotConnected:"IBKR 尚未連線",
  insufficientHistory:"歷史資料不足",staleData:"資料已過期",sourceWarning:"資料源警告",invalidPrice:"價格無效",
  portfolioEyebrow:"模擬交易／投資組合",loading:"載入中…",setupButton:"前往設定",symbol:"證券代碼",quantity:"數量",sellable:"可賣",averagePrice:"成本／現價",baseValue:"基準幣值",pnl:"損益",sell:"模擬賣出",positions:"持倉",equity:"淨值",cash:"現金",unrealizedPnl:"未實現損益",drawdown:"回撤",feeNotice:"費用、稅與匯率會在伺服器重新計算",
  riskLimits:"風險限制",riskPlan:"風險計畫",singleTradeRisk:"單筆風險",maxPosition:"單一證券上限",maxSector:"單一產業上限",maxMarket:"單一市場上限",drawdownBreaker:"回撤熔斷線",capitalFirst:"保本優先",balanced:"均衡成長",growth:"積極成長",minimumLotRule:"對於必須整張交易的市場，首次買進最小一張可以突破單一證券與產業上限，但絕不會突破市場上限或可用現金。",minimumLotException:"最小交易單位例外",
  marketRules:"市場規則",settlement:"交割",tradingUnit:"交易單位",variable:"依證券而定",sessionOpen:"預估開市",sessionClosed:"預估休市",ruleVersion:"規則版本",
  orderHistory:"訂單紀錄",orderTime:"時間",side:"方向",filledPrice:"成交價",feesTaxes:"費用與稅",realizedPnl:"已實現損益",status:"狀態",filled:"已成交",noRecords:"暫無紀錄",sellCompleted:"模擬賣出完成",
  backtestEyebrow:"模型／驗證",formalLocked:"正式訊號尚未解鎖",validationRequired:"必須通過回測及 30 個交易日影子驗證。",minimumTrades:"最低交易筆數",profitFactor:"獲利因子",sharpe:"夏普比率",shadowDays:"影子驗證天數",pending:"待驗證",passed:"已通過",locked:"未解鎖",
  notStarted:"尚未開始",inProgress:"進行中",migrationPending:"移轉待完成",complete:"完成",partial:"部分完成",
  healthEyebrow:"系統／資料健康",primaryFeed:"正式即時主行情",shadowUntilValidated:"完成 IBKR 行情訂閱及驗證前，公開來源候選仍只顯示影子訊號。",noSnapshot:"暫無快照",healthy:"正常",degraded:"降級",unavailable:"不可用",operational:"運作正常",waiting:"等待資料",daily:"日線",unknown:"未知",
  settingsEyebrow:"僅限擁有者／設定",baseCurrency:"基準貨幣",paperCapital:"模擬資金",email:"電子郵件",enableEmail:"透過 Resend 啟用 Email 提醒",saved:"已儲存",saveFailed:"儲存失敗",capitalSynced:"已儲存：模擬本金 {capital}；現金同步調整 {delta}。",inAppEmailDelivered:"站內與 Email 通知均已送達",inAppDelivered:"站內通知已送達；Email 尚未設定",alertFailed:"通知傳送失敗",
  errorGeneric:"暫時無法完成要求，請重試。",errorSignIn:"請先登入。",errorService:"模擬組合服務暫時不可用。",errorInvalidOrder:"請輸入有效證券、買賣方向與整數數量。",errorSetup:"請先完成模擬組合設定。",errorNoQuote:"此證券目前沒有可用行情。",errorMarketQuantity:"數量不符合此市場的交易單位規則。",errorStaleQuote:"行情已經過期，因此禁止模擬成交。",errorDrawdown:"組合回撤已達 {max}% 熔斷線，暫停新買進。",errorT1:"賣出數量超過目前可賣 A 股持倉（T+1）。",errorPosition:"此訂單會超過「{plan}」計畫 {max}% 的單一證券上限。",errorMarket:"此訂單會超過 {max}% 的單一市場上限。",errorSector:"此訂單會超過 {max}% 的單一產業上限。",errorCash:"計入匯率與交易成本後，模擬現金不足。",errorPortfolio:"模擬組合暫時不可用。",errorOrder:"模擬訂單未能完成。",errorCapitalRequired:"模擬資金必須大於零。",errorCapitalReduction:"目前仍有持倉，模擬本金不得低於 {minimum}；請先賣出部分持倉。",errorCurrencyLocked:"已有模擬交易後，基準貨幣鎖定為 {currency}。",errorSettings:"設定未能儲存。",
};

const ja: Record<CopyKey,string> = {
  ...en,
  language:"言語",mainNavigation:"メインナビゲーション",researchDesk:"リサーチデスク",model:"モデル",holdingPeriod:"2～12週間のスイング",dataStatus:"データ状態",dashboard:"概要",scanner:"市場スキャン",signals:"シグナル",security:"銘柄リサーチ",
  refreshQuotes:"市場価格を再取得",refreshingQuotes:"価格を更新中 {processed}/{total}",refreshComplete:"公開市場ソースから {updated} 件を更新しました（{failed} 件失敗）。モデルスコアは直近の完全分析を維持します。",refreshFailed:"サーバーで公開市場価格を更新できませんでした。",
  fullScan:"全市場スキャン",discovered:"検出",analyzed:"分析済み",failed:"失敗",fallback:"代替ソース",running:"実行中",universeTarget:"市場ごとに株式500銘柄＋ETF100銘柄",shadowBuy:"シャドー買い",watch:"監視",hardGated:"リスク制限",ibkrFeed:"IBKRデータ",off:"未設定",ranked:"件を順位付け",limited:"限定データ",
  stock:"株式",buy:"買い",hold:"保有",reduce:"縮小",exit:"手仕舞い",shadow:"シャドー",formal:"正式",realtime:"リアルタイム",delayed:"遅延",fallbackData:"代替",stale:"期限切れ",
  trendConfirmed:"トレンド確認",trendUnconfirmed:"トレンド未確認",momentumLeadership:"モメンタム優位",momentumMixed:"モメンタム混在",riskControlled:"リスク管理良好",volatilityElevated:"ボラティリティ上昇",liquidityAcceptable:"流動性良好",liquidityThin:"流動性不足",formalGateActive:"正式ゲート有効",ibkrNotConnected:"IBKR未接続",insufficientHistory:"履歴不足",staleData:"データ期限切れ",sourceWarning:"データソース警告",invalidPrice:"価格無効",
  portfolioEyebrow:"模擬取引／ポートフォリオ",loading:"読み込み中…",setupButton:"設定へ",symbol:"銘柄コード",market:"市場",quantity:"数量",sellable:"売却可能",averagePrice:"平均単価／現在値",baseValue:"基準通貨価値",pnl:"損益",sell:"模擬売却",positions:"保有銘柄",equity:"純資産",cash:"現金",unrealizedPnl:"含み損益",drawdown:"ドローダウン",feeNotice:"手数料・税・為替はサーバーで再計算されます",
  riskLimits:"リスク制限",riskPlan:"リスクプラン",singleTradeRisk:"1取引リスク",maxPosition:"1銘柄上限",maxSector:"セクター上限",maxMarket:"市場上限",drawdownBreaker:"ドローダウン停止線",capitalFirst:"元本保全",balanced:"バランス成長",growth:"積極成長",minimumLotRule:"売買単位が必須の市場では、最初の最低単位に限り銘柄・セクター上限を超過できますが、市場上限と利用可能現金は超過できません。",minimumLotException:"最低売買単位の例外",
  marketRules:"市場ルール",settlement:"決済",tradingUnit:"取引単位",variable:"銘柄別",sessionOpen:"推定取引中",sessionClosed:"推定休場",ruleVersion:"ルール版",orderHistory:"注文履歴",orderTime:"時刻",side:"売買",filledPrice:"約定価格",feesTaxes:"手数料・税",realizedPnl:"実現損益",status:"状態",filled:"約定済み",noRecords:"記録なし",sellCompleted:"模擬売却完了",
  backtestEyebrow:"モデル／検証",formalLocked:"正式シグナルは未解除",validationRequired:"バックテストと30取引日のシャドー検証が必要です。",minimumTrades:"最低取引数",profitFactor:"プロフィットファクター",sharpe:"シャープレシオ",shadowDays:"シャドー日数",pending:"検証待ち",passed:"合格",locked:"未解除",
  notStarted:"未開始",inProgress:"進行中",migrationPending:"移行待ち",complete:"完了",partial:"一部完了",
  healthEyebrow:"システム／データ状態",primaryFeed:"正式リアルタイム主データ",shadowUntilValidated:"IBKR購読と検証完了までは、公開情報の候補をシャドーシグナルとして表示します。",noSnapshot:"スナップショットなし",healthy:"正常",degraded:"低下",unavailable:"利用不可",operational:"稼働中",waiting:"データ待ち",daily:"日次",unknown:"不明",
  settingsEyebrow:"所有者専用／設定",baseCurrency:"基準通貨",paperCapital:"模擬資金",email:"メール",enableEmail:"Resendでメール通知を有効化",saved:"保存しました",saveFailed:"保存失敗",capitalSynced:"保存しました：模擬元本 {capital}、現金調整 {delta}。",inAppEmailDelivered:"アプリ内・メール通知を送信しました",inAppDelivered:"アプリ内通知を送信。メール未設定",alertFailed:"通知失敗",
  errorGeneric:"処理を完了できませんでした。再試行してください。",errorSignIn:"ログインが必要です。",errorService:"模擬ポートフォリオは一時的に利用できません。",errorInvalidOrder:"有効な銘柄、売買、整数数量を入力してください。",errorSetup:"先に模擬ポートフォリオを設定してください。",errorNoQuote:"この銘柄の現在値を取得できません。",errorMarketQuantity:"数量がこの市場の取引単位に適合しません。",errorStaleQuote:"価格が古いため模擬約定できません。",errorDrawdown:"ドローダウンが{max}%の停止線に達し、新規買いを停止しました。",errorT1:"売却数量が現在売却可能なA株数量を超えています（T+1）。",errorPosition:"この注文は「{plan}」プランの1銘柄上限{max}%を超えます。",errorMarket:"この注文は市場上限{max}%を超えます。",errorSector:"この注文はセクター上限{max}%を超えます。",errorCash:"為替と取引費用を含めると模擬現金が不足します。",errorPortfolio:"模擬ポートフォリオを取得できません。",errorOrder:"模擬注文を完了できませんでした。",errorCapitalRequired:"模擬資金は0より大きい必要があります。",errorCapitalReduction:"保有中のため、模擬元本を {minimum} 未満にできません。先に売却してください。",errorCurrencyLocked:"模擬取引後の基準通貨は {currency} に固定されています。",errorSettings:"設定を保存できませんでした。",
};

const ko: Record<CopyKey,string> = {
  ...en,
  language:"언어",mainNavigation:"주 탐색",researchDesk:"리서치 데스크",model:"모델",holdingPeriod:"2~12주 스윙",dataStatus:"데이터 상태",dashboard:"개요",scanner:"시장 스캔",signals:"신호",security:"종목 리서치",
  refreshQuotes:"시장 시세 다시 스캔",refreshingQuotes:"시세 업데이트 중 {processed}/{total}",refreshComplete:"공개 시장 소스에서 시세 {updated}건을 업데이트했습니다({failed}건 실패). 모델 점수는 최근 전체 분석을 유지합니다.",refreshFailed:"서버가 공개 시장 시세를 업데이트하지 못했습니다.",
  fullScan:"전체 시장 스캔",discovered:"발견",analyzed:"분석 완료",failed:"실패",fallback:"대체 소스",running:"실행 중",universeTarget:"시장별 주식 500개 + ETF 100개",shadowBuy:"섀도 매수",watch:"관찰",hardGated:"위험 제한",ibkrFeed:"IBKR 시세",off:"비활성",ranked:"개 순위",limited:"제한 데이터",
  stock:"주식",buy:"매수",hold:"보유",reduce:"축소",exit:"청산",shadow:"섀도",formal:"정식",realtime:"실시간",delayed:"지연",fallbackData:"대체",stale:"만료",
  trendConfirmed:"추세 확인",trendUnconfirmed:"추세 미확인",momentumLeadership:"모멘텀 우위",momentumMixed:"모멘텀 혼조",riskControlled:"위험 통제",volatilityElevated:"변동성 상승",liquidityAcceptable:"유동성 양호",liquidityThin:"유동성 부족",formalGateActive:"정식 기준 활성",ibkrNotConnected:"IBKR 미연결",insufficientHistory:"이력 부족",staleData:"데이터 만료",sourceWarning:"데이터 소스 경고",invalidPrice:"가격 오류",
  portfolioEyebrow:"모의 거래／포트폴리오",loading:"불러오는 중…",setupButton:"설정하기",symbol:"종목 코드",market:"시장",quantity:"수량",sellable:"매도 가능",averagePrice:"평균가／현재가",baseValue:"기준 통화 가치",pnl:"손익",sell:"모의 매도",positions:"보유 종목",equity:"순자산",cash:"현금",unrealizedPnl:"미실현 손익",drawdown:"낙폭",feeNotice:"수수료, 세금 및 환율은 서버에서 재계산됩니다",
  riskLimits:"위험 제한",riskPlan:"위험 계획",singleTradeRisk:"거래당 위험",maxPosition:"종목당 한도",maxSector:"업종 한도",maxMarket:"시장 한도",drawdownBreaker:"낙폭 중단선",capitalFirst:"원금 보전",balanced:"균형 성장",growth:"적극 성장",minimumLotRule:"거래 단위가 필수인 시장에서는 첫 최소 단위가 종목 및 업종 한도를 넘을 수 있지만 시장 한도와 가용 현금은 넘을 수 없습니다.",minimumLotException:"최소 거래 단위 예외",
  marketRules:"시장 규칙",settlement:"결제",tradingUnit:"거래 단위",variable:"종목별",sessionOpen:"예상 개장",sessionClosed:"예상 휴장",ruleVersion:"규칙 버전",orderHistory:"주문 기록",orderTime:"시간",side:"구분",filledPrice:"체결가",feesTaxes:"수수료·세금",realizedPnl:"실현 손익",status:"상태",filled:"체결",noRecords:"기록 없음",sellCompleted:"모의 매도 완료",
  backtestEyebrow:"모델／검증",formalLocked:"정식 신호 잠김",validationRequired:"백테스트 및 30거래일 섀도 검증이 필요합니다.",minimumTrades:"최소 거래 수",profitFactor:"수익 팩터",sharpe:"샤프 지수",shadowDays:"섀도 일수",pending:"검증 대기",passed:"통과",locked:"잠김",
  notStarted:"시작 전",inProgress:"진행 중",migrationPending:"마이그레이션 대기",complete:"완료",partial:"일부 완료",
  healthEyebrow:"시스템／데이터 상태",primaryFeed:"정식 실시간 주 시세",shadowUntilValidated:"IBKR 구독 및 검증 전에는 공개 소스 후보를 섀도 신호로 표시합니다.",noSnapshot:"스냅샷 없음",healthy:"정상",degraded:"저하",unavailable:"사용 불가",operational:"정상 운영",waiting:"데이터 대기",daily:"일간",unknown:"알 수 없음",
  settingsEyebrow:"소유자 전용／설정",baseCurrency:"기준 통화",paperCapital:"모의 자금",email:"이메일",enableEmail:"Resend 이메일 알림 활성화",saved:"저장됨",saveFailed:"저장 실패",capitalSynced:"저장됨: 모의 원금 {capital}, 현금 조정 {delta}.",inAppEmailDelivered:"앱 및 이메일 알림 전송 완료",inAppDelivered:"앱 알림 전송 완료; 이메일 미설정",alertFailed:"알림 실패",
  errorGeneric:"요청을 완료하지 못했습니다. 다시 시도하세요.",errorSignIn:"로그인이 필요합니다.",errorService:"모의 포트폴리오 서비스를 일시적으로 사용할 수 없습니다.",errorInvalidOrder:"유효한 종목, 매매 구분 및 정수 수량을 입력하세요.",errorSetup:"먼저 모의 포트폴리오를 설정하세요.",errorNoQuote:"현재 시세를 사용할 수 없습니다.",errorMarketQuantity:"수량이 해당 시장의 거래 단위 규칙에 맞지 않습니다.",errorStaleQuote:"시세가 오래되어 모의 체결이 차단되었습니다.",errorDrawdown:"포트폴리오 낙폭이 {max}% 중단선에 도달해 신규 매수를 중지했습니다.",errorT1:"매도 수량이 현재 매도 가능한 A주 수량을 초과합니다(T+1).",errorPosition:"이 주문은 '{plan}' 계획의 종목당 {max}% 한도를 초과합니다.",errorMarket:"이 주문은 시장 한도 {max}%를 초과합니다.",errorSector:"이 주문은 업종 한도 {max}%를 초과합니다.",errorCash:"환율과 거래 비용을 반영하면 모의 현금이 부족합니다.",errorPortfolio:"모의 포트폴리오를 불러올 수 없습니다.",errorOrder:"모의 주문을 완료하지 못했습니다.",errorCapitalRequired:"모의 자금은 0보다 커야 합니다.",errorCapitalReduction:"보유 종목이 있어 모의 원금을 {minimum} 미만으로 줄일 수 없습니다. 먼저 매도하세요.",errorCurrencyLocked:"모의 거래 후 기준 통화는 {currency}로 잠깁니다.",errorSettings:"설정을 저장하지 못했습니다.",
};

const copies: Record<Locale,Record<CopyKey,string>> = { en, "zh-CN":zhCN, "zh-TW":zhTW, ja, ko };

export function tx(locale:Locale, key:CopyKey, params:Params = {}) {
  return Object.entries(params).reduce((text,[name,value]) => text.replaceAll(`{${name}}`, String(value ?? "")), copies[locale]?.[key] ?? en[key]);
}

const codeKeys:Record<string,CopyKey> = {
  STOCK:"stock", ETF:"etf", BUY:"buy", WATCH:"watch", HOLD:"hold", REDUCE:"reduce", EXIT:"exit", SHADOW:"shadow", FORMAL:"formal",
  realtime:"realtime", delayed:"delayed", fallback:"fallbackData", stale:"stale",
  TREND_CONFIRMED:"trendConfirmed", TREND_UNCONFIRMED:"trendUnconfirmed", MOMENTUM_LEADERSHIP:"momentumLeadership", MOMENTUM_MIXED:"momentumMixed", RISK_CONTROLLED:"riskControlled", VOLATILITY_ELEVATED:"volatilityElevated", LIQUIDITY_ACCEPTABLE:"liquidityAcceptable", LIQUIDITY_THIN:"liquidityThin", FORMAL_GATE_ACTIVE:"formalGateActive", IBKR_NOT_CONNECTED:"ibkrNotConnected",
  INSUFFICIENT_HISTORY:"insufficientHistory", STALE_DATA:"staleData", SOURCE_WARNING:"sourceWarning", INVALID_PRICE:"invalidPrice",
  FILLED:"filled", MINIMUM_TRADABLE_LOT:"minimumLotException", OPEN_ESTIMATE:"sessionOpen", CLOSED_ESTIMATE:"sessionClosed", COMPLETED:"passed", PENDING:"pending", PASSED:"passed", LOCKED:"locked", NOT_STARTED:"notStarted", IN_PROGRESS:"inProgress", MIGRATION_PENDING:"migrationPending", COMPLETE:"complete", PARTIAL:"partial", operational:"operational", waiting:"waiting", healthy:"healthy", degraded:"degraded", unavailable:"unavailable", daily:"daily", unknown:"unknown", "public fallback":"fallbackData",
};

export function codeText(locale:Locale, code:unknown) {
  const raw = String(code ?? "");
  const v2 = v2Codes[locale]?.[raw];
  if (v2) return v2;
  const key = codeKeys[raw] ?? codeKeys[raw.toUpperCase()];
  return key ? tx(locale,key) : raw.replaceAll("_"," ");
}

const v2Codes:Record<Locale,Record<string,string>> = {
  en:{ WATCH:"Watch",PUBLIC_DATA_SHADOW:"Public-data shadow",NON_GENUINE_OHLCV:"Genuine OHLCV unavailable",SECTOR_UNKNOWN:"Industry unknown",SOURCE_CONFLICT:"Source conflict over 1%",CORPORATE_ACTION_ANOMALY:"Corporate-action anomaly",ETF_STRUCTURE_EXCLUDED:"ETF structure excluded",PRICE_NOT_ABOVE_MA_SET:"Price is not above 20/50/200-day averages",LONG_TREND_NOT_RISING:"50/200-day trend is not rising",MOMENTUM_NOT_POSITIVE:"3/6-month return is not positive",RELATIVE_STRENGTH_BELOW_70:"Relative strength below 70",VOLUME_CONFIRMATION_PENDING:"Volume confirmation pending",RISK_OFF:"Market regime is risk-off",ETF_STRUCTURE_INCOMPLETE:"ETF structure data incomplete",DAILY_SELECTION_CAP:"Daily 3+1 selection cap",SITE_FALLBACK_WATCH_ONLY:"Site fallback is watch-only",PROVISIONAL_BACKTEST:"Provisional backtest",PROVISIONAL_PASSED:"Provisionally passed",PROVISIONAL_FAILED_GATE:"Provisional gate failed"},
  "zh-CN":{ WATCH:"观察",PUBLIC_DATA_SHADOW:"公开数据影子信号",NON_GENUINE_OHLCV:"缺少真实量价",SECTOR_UNKNOWN:"行业未知",SOURCE_CONFLICT:"来源差异超过 1%",CORPORATE_ACTION_ANOMALY:"公司行动异常",ETF_STRUCTURE_EXCLUDED:"ETF 产品结构不合格",PRICE_NOT_ABOVE_MA_SET:"价格未站上 20/50/200 日均线",LONG_TREND_NOT_RISING:"50/200 日趋势未向上",MOMENTUM_NOT_POSITIVE:"3/6 月收益未同时为正",RELATIVE_STRENGTH_BELOW_70:"相对强度低于 70",VOLUME_CONFIRMATION_PENDING:"等待成交量确认",RISK_OFF:"市场处于避险状态",ETF_STRUCTURE_INCOMPLETE:"ETF 产品结构资料不完整",DAILY_SELECTION_CAP:"达到每日 3+1 选择上限",SITE_FALLBACK_WATCH_ONLY:"网站备用扫描只允许观察",PROVISIONAL_BACKTEST:"暂定回测",PROVISIONAL_PASSED:"暂定通过",PROVISIONAL_FAILED_GATE:"未通过暂定门槛"},
  "zh-TW":{ WATCH:"觀察",PUBLIC_DATA_SHADOW:"公開資料影子訊號",NON_GENUINE_OHLCV:"缺少真實量價",SECTOR_UNKNOWN:"產業未知",SOURCE_CONFLICT:"來源差異超過 1%",CORPORATE_ACTION_ANOMALY:"公司行動異常",ETF_STRUCTURE_EXCLUDED:"ETF 產品結構不合格",PRICE_NOT_ABOVE_MA_SET:"價格未站上 20/50/200 日均線",LONG_TREND_NOT_RISING:"50/200 日趨勢未向上",MOMENTUM_NOT_POSITIVE:"3/6 月報酬未同時為正",RELATIVE_STRENGTH_BELOW_70:"相對強度低於 70",VOLUME_CONFIRMATION_PENDING:"等待成交量確認",RISK_OFF:"市場處於避險狀態",ETF_STRUCTURE_INCOMPLETE:"ETF 產品結構資料不完整",DAILY_SELECTION_CAP:"達到每日 3+1 選擇上限",SITE_FALLBACK_WATCH_ONLY:"網站備用掃描只允許觀察",PROVISIONAL_BACKTEST:"暫定回測",PROVISIONAL_PASSED:"暫定通過",PROVISIONAL_FAILED_GATE:"未通過暫定門檻"},
  ja:{ WATCH:"監視",PUBLIC_DATA_SHADOW:"公開データのシャドー",NON_GENUINE_OHLCV:"実測OHLCVなし",SECTOR_UNKNOWN:"業種不明",SOURCE_CONFLICT:"情報源の差が1%超",CORPORATE_ACTION_ANOMALY:"企業行動の異常",ETF_STRUCTURE_EXCLUDED:"ETF構造が不適格",PRICE_NOT_ABOVE_MA_SET:"価格が20/50/200日線を上回っていません",LONG_TREND_NOT_RISING:"50/200日トレンドが上昇していません",MOMENTUM_NOT_POSITIVE:"3/6か月リターンが共にプラスではありません",RELATIVE_STRENGTH_BELOW_70:"相対強度70未満",VOLUME_CONFIRMATION_PENDING:"出来高確認待ち",RISK_OFF:"市場はリスクオフ",ETF_STRUCTURE_INCOMPLETE:"ETF構造データ不足",DAILY_SELECTION_CAP:"日次3+1上限",SITE_FALLBACK_WATCH_ONLY:"サイト予備スキャンは監視のみ",PROVISIONAL_BACKTEST:"暫定バックテスト",PROVISIONAL_PASSED:"暫定合格",PROVISIONAL_FAILED_GATE:"暫定基準不合格"},
  ko:{ WATCH:"관찰",PUBLIC_DATA_SHADOW:"공개 데이터 섀도",NON_GENUINE_OHLCV:"실제 OHLCV 없음",SECTOR_UNKNOWN:"업종 미분류",SOURCE_CONFLICT:"출처 차이 1% 초과",CORPORATE_ACTION_ANOMALY:"기업행동 이상",ETF_STRUCTURE_EXCLUDED:"ETF 구조 부적격",PRICE_NOT_ABOVE_MA_SET:"가격이 20/50/200일선 위가 아님",LONG_TREND_NOT_RISING:"50/200일 추세 미상승",MOMENTUM_NOT_POSITIVE:"3/6개월 수익률이 모두 양수가 아님",RELATIVE_STRENGTH_BELOW_70:"상대강도 70 미만",VOLUME_CONFIRMATION_PENDING:"거래량 확인 대기",RISK_OFF:"시장 위험회피 상태",ETF_STRUCTURE_INCOMPLETE:"ETF 구조 데이터 부족",DAILY_SELECTION_CAP:"일일 3+1 상한",SITE_FALLBACK_WATCH_ONLY:"사이트 예비 스캔은 관찰 전용",PROVISIONAL_BACKTEST:"잠정 백테스트",PROVISIONAL_PASSED:"잠정 통과",PROVISIONAL_FAILED_GATE:"잠정 기준 실패"},
};

export function riskPlanName(locale:Locale, id:unknown) {
  const key:CopyKey = id === "growth" ? "growth" : id === "balanced" ? "balanced" : "capitalFirst";
  return tx(locale,key);
}

const errorKeys:Record<string,CopyKey> = {
  SIGN_IN_REQUIRED:"errorSignIn", SERVICE_UNAVAILABLE:"errorService", INVALID_ORDER:"errorInvalidOrder", SETUP_REQUIRED:"errorSetup", NO_QUOTE:"errorNoQuote", MARKET_QUANTITY_RULE:"errorMarketQuantity", STALE_QUOTE:"errorStaleQuote", DRAWDOWN_BREAKER:"errorDrawdown", CN_T_PLUS_ONE:"errorT1", POSITION_LIMIT:"errorPosition", MARKET_LIMIT:"errorMarket", SECTOR_LIMIT:"errorSector", INSUFFICIENT_CASH:"errorCash", PORTFOLIO_UNAVAILABLE:"errorPortfolio", PAPER_ORDER_FAILED:"errorOrder",
  PAPER_CAPITAL_REQUIRED:"errorCapitalRequired", CAPITAL_REDUCTION_BLOCKED:"errorCapitalReduction", BASE_CURRENCY_LOCKED:"errorCurrencyLocked", SETTINGS_SAVE_FAILED:"errorSettings",
};

export function apiErrorText(locale:Locale, payload:{errorCode?:string;errorParams?:Params}|null|undefined, fallback:CopyKey="errorGeneric") {
  const key = payload?.errorCode ? errorKeys[payload.errorCode] : undefined;
  const params = { ...payload?.errorParams };
  if (params.plan) params.plan = riskPlanName(locale,params.plan);
  return tx(locale,key ?? fallback,params);
}
