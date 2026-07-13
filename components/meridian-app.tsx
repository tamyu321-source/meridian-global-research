"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiErrorText, codeText, riskPlanName, tx } from "@/lib/i18n";
import type { Locale, RankedSecurity, RiskPlanId } from "@/lib/types";
import { MARKETS, MODEL_VERSION, RISK_PLANS } from "@/lib/types";

export type AppView = "dashboard" | "scanner" | "signals" | "portfolio" | "backtests" | "health" | "settings" | "security";
type ScanMeta = { id:string; status:string; completedAt:string|null; discoveredCount:number; analyzedCount:number; failedCount:number; fallbackCount:number; targetStocksPerMarket:number; targetEtfsPerMarket:number; coverage:Record<string,unknown>; qualityGatePassed?:boolean; sourceConflicts?:number; corporateActionAnomalies?:number; configHash?:string };
type RankingPayload = { rankings: RankedSecurity[]; meta: { mode: string; primaryFeed: string; discovery?:string; ibkrConnected: boolean; generatedAt: string; errors?: string[]; scan?:ScanMeta|null } };
type ApiErrorPayload = { error?:string; errorCode?:string; errorParams?:Record<string,string|number> };
type QuoteRefreshPayload = { scanId:string; total:number; processed:number; updated:number; failed:number; nextCursor:string|null; done:boolean; capturedAt:string };
type AnalysisComponentPayload = { id:string; market:string; assetType:string; status:string; phase:string; total:number; processed:number; updated:number; failed:number; heartbeatAt:string|null; errorCode:string|null; errorDetail:string|null };
type AnalysisJobPayload = { jobId:string; status:string; marketScope:string; assetScope:string; createdAt:string; completedAt:string|null; githubRunUrl:string|null; errorCode:string|null; errorDetail:string|null; components:AnalysisComponentPayload[] };

const words = {
  "zh-TW": { nav:["總覽","市場掃描","訊號中心","模擬組合","回測驗證","資料健康","設定"], shadow:"影子 BUY", public:"公開來源／延遲／暫定回測", title:"跨市場投資研究", subtitle:"v2 以真實五年量價、股票／ETF 分離模型與嚴格門檻排名；允許沒有 BUY。", scan:"重新掃描", loading:"正在向市場來源取得資料…", noData:"目前沒有可驗證資料。請稍後重試或檢查資料健康度。", market:"市場", asset:"資產", risk:"風險計畫", all:"全部", stocks:"普通股", etfs:"ETF", score:"分數", signal:"訊號", price:"價格", freshness:"資料", factors:"模型因子拆解", plan:"完整交易計畫", entry:"進場區", stop:"停損", targets:"分批目標", maxWeight:"最大倉位", reason:"判斷依據", blocked:"降為觀察", paperBuy:"模擬買進", qty:"數量", setup:"請先在設定頁輸入模擬資金。", health:"七市場資料健康", ibkr:"只使用公開資料", backtest:"暫定回測與驗證門檻", portfolio:"模擬投資組合", settings:"研究設定", save:"儲存設定", notify:"測試通知", quality:"資料完整度", sources:"來源數", bucket:"桶內排名", provisional:"公開資料回測含幸存者偏差，永遠不能解鎖 FORMAL。", disclaimer:"本系統為研究與模擬決策工具，不保證獲利；公開資料只產生影子 BUY，暫定回測不能升級正式訊號。" },
  "zh-CN": { nav:["总览","市场扫描","信号中心","模拟组合","回测验证","数据健康","设置"], shadow:"影子 BUY", public:"公开来源／延迟／暂定回测", title:"跨市场投资研究", subtitle:"v2 使用真实五年量价、股票／ETF 分离模型和严格门槛排名；允许没有 BUY。", scan:"重新扫描", loading:"正在从市场来源获取数据…", noData:"目前没有可验证数据。请稍后重试或检查数据健康度。", market:"市场", asset:"资产", risk:"风险计划", all:"全部", stocks:"普通股", etfs:"ETF", score:"分数", signal:"信号", price:"价格", freshness:"数据", factors:"模型因子拆解", plan:"完整交易计划", entry:"进场区", stop:"止损", targets:"分批目标", maxWeight:"最大仓位", reason:"判断依据", blocked:"降为观察", paperBuy:"模拟买入", qty:"数量", setup:"请先在设置页输入模拟资金。", health:"七市场数据健康", ibkr:"仅使用公开数据", backtest:"暂定回测与验证门槛", portfolio:"模拟投资组合", settings:"研究设置", save:"保存设置", notify:"测试通知", quality:"数据完整度", sources:"来源数", bucket:"桶内排名", provisional:"公开数据回测存在幸存者偏差，永远不能解锁 FORMAL。", disclaimer:"本系统为研究与模拟决策工具，不保证盈利；公开数据只产生影子 BUY，暂定回测不能升级正式信号。" },
  en: { nav:["Overview","Market scanner","Signals","Paper portfolio","Backtests","Data health","Settings"], shadow:"Shadow BUY", public:"Public / delayed / provisional backtest", title:"Cross-market investment research", subtitle:"v2 ranks genuine five-year price-volume data with separate stock and ETF models and strict gates; zero BUYs is valid.", scan:"Run scan", loading:"Fetching verifiable market data…", noData:"No verifiable data is available. Retry or inspect data health.", market:"Market", asset:"Asset", risk:"Risk plan", all:"All", stocks:"Stocks", etfs:"ETFs", score:"Score", signal:"Signal", price:"Price", freshness:"Data", factors:"Model factor attribution", plan:"Complete trade plan", entry:"Entry zone", stop:"Stop", targets:"Targets", maxWeight:"Max weight", reason:"Decision evidence", blocked:"Downgraded to WATCH", paperBuy:"Paper buy", qty:"Quantity", setup:"Set paper capital in Settings first.", health:"Seven-market data health", ibkr:"Public data only", backtest:"Provisional backtest gates", portfolio:"Paper portfolio", settings:"Research settings", save:"Save settings", notify:"Test alert", quality:"Data completeness", sources:"Source count", bucket:"Bucket rank", provisional:"Public-data history has survivorship bias and can never unlock FORMAL.", disclaimer:"Research and paper-decision tool only. Public data produces SHADOW BUYs; provisional backtests cannot promote FORMAL signals." },
  ja: { nav:["概要","市場スキャン","シグナル","模擬ポートフォリオ","バックテスト","データ状態","設定"], shadow:"シャドー BUY", public:"公開情報／遅延／暫定検証", title:"市場横断型投資リサーチ", subtitle:"v2 は実測5年OHLCVを株式・ETF別モデルと厳格な条件で評価し、BUYゼロも許容します。", scan:"再スキャン", loading:"検証可能な市場データを取得中…", noData:"検証可能なデータがありません。データ状態を確認してください。", market:"市場", asset:"資産", risk:"リスクプラン", all:"すべて", stocks:"株式", etfs:"ETF", score:"スコア", signal:"シグナル", price:"価格", freshness:"データ", factors:"モデル因子分析", plan:"取引計画", entry:"エントリー", stop:"損切り", targets:"目標", maxWeight:"最大比率", reason:"判断根拠", blocked:"WATCHへ降格", paperBuy:"模擬買い", qty:"数量", setup:"設定で模擬資金を入力してください。", health:"7市場のデータ状態", ibkr:"公開データのみ", backtest:"暫定バックテスト基準", portfolio:"模擬ポートフォリオ", settings:"研究設定", save:"設定を保存", notify:"通知テスト", quality:"データ完全性", sources:"情報源数", bucket:"バケット順位", provisional:"公開データには生存者バイアスがあり、FORMALは解除できません。", disclaimer:"研究・模擬判断用です。公開データはSHADOW BUYのみで、暫定検証からFORMALへ昇格しません。" },
  ko: { nav:["개요","시장 스캔","신호","모의 포트폴리오","백테스트","데이터 상태","설정"], shadow:"섀도 BUY", public:"공개／지연／잠정 백테스트", title:"글로벌 투자 리서치", subtitle:"v2는 실제 5년 OHLCV를 주식·ETF 분리 모델과 엄격한 기준으로 평가하며 BUY 0개도 허용합니다.", scan:"다시 스캔", loading:"검증 가능한 시장 데이터를 가져오는 중…", noData:"검증 가능한 데이터가 없습니다. 데이터 상태를 확인하세요.", market:"시장", asset:"자산", risk:"위험 계획", all:"전체", stocks:"주식", etfs:"ETF", score:"점수", signal:"신호", price:"가격", freshness:"데이터", factors:"모델 팩터 분석", plan:"전체 거래 계획", entry:"진입 구간", stop:"손절", targets:"목표", maxWeight:"최대 비중", reason:"판단 근거", blocked:"WATCH로 하향", paperBuy:"모의 매수", qty:"수량", setup:"설정에서 모의 자금을 입력하세요.", health:"7개 시장 데이터 상태", ibkr:"공개 데이터만 사용", backtest:"잠정 백테스트 기준", portfolio:"모의 포트폴리오", settings:"리서치 설정", save:"설정 저장", notify:"알림 테스트", quality:"데이터 완전성", sources:"출처 수", bucket:"버킷 순위", provisional:"공개 이력에는 생존 편향이 있어 FORMAL을 해제할 수 없습니다.", disclaimer:"연구 및 모의 의사결정 도구입니다. 공개 데이터는 SHADOW BUY만 생성하며 잠정 검증으로 FORMAL 승격되지 않습니다." },
} as const;

const navHref = ["/", "/scanner", "/signals", "/portfolio", "/backtests", "/health", "/settings"];
const factorKeys = ["trend", "momentum", "relativeStrength", "liquidity", "risk", "regime"] as const;
const factorName: Record<Locale, string[]> = { "zh-TW":["趨勢","動能","相對強度","流動性","下行風險","市場狀態"], "zh-CN":["趋势","动量","相对强度","流动性","下行风险","市场状态"], en:["Trend","Momentum","Relative strength","Liquidity","Downside risk","Regime"], ja:["トレンド","モメンタム","相対強度","流動性","下方リスク","市場環境"], ko:["추세","모멘텀","상대 강도","유동성","하방 위험","시장 국면"] };

export function MeridianApp({ view, instrumentId }: { view: AppView; instrumentId?: string }) {
  const [locale, setLocale] = useState<Locale>("zh-TW");
  const [market, setMarket] = useState("ALL");
  const [assetType, setAssetType] = useState("ALL");
  const [riskPlan, setRiskPlan] = useState<RiskPlanId>("capital_first");
  const [payload, setPayload] = useState<RankingPayload | null>(null);
  const [selected, setSelected] = useState<RankedSecurity | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ processed:0, total:0, updated:0, failed:0 });
  const [scanMessage, setScanMessage] = useState("");
  const [analysisConfirm, setAnalysisConfirm] = useState(false);
  const [analysisStarting, setAnalysisStarting] = useState(false);
  const [analysisJob, setAnalysisJob] = useState<AnalysisJobPayload | null>(null);
  const [analysisMessage, setAnalysisMessage] = useState("");
  const [error, setError] = useState("");
  const [quantity, setQuantity] = useState(1);
  const t = words[locale];
  const x = useCallback((key:Parameters<typeof tx>[1], params?:Parameters<typeof tx>[2]) => tx(locale,key,params),[locale]);

  // Locale preference can only be read after the client has hydrated.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { const stored = localStorage.getItem("meridian.locale") as Locale | null; if (stored && words[stored]) setLocale(stored); }, []);
  useEffect(() => { localStorage.setItem("meridian.locale", locale); document.documentElement.lang = locale; }, [locale]);
  useEffect(() => { fetch("/api/settings",{cache:"no-store"}).then(async response=>await response.json() as {settings?:{riskPlan?:RiskPlanId}}).then(result=>{if(result.settings?.riskPlan&&RISK_PLANS[result.settings.riskPlan])setRiskPlan(result.settings.riskPlan);}).catch(()=>undefined); }, []);

  const loadRankings = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/rankings?market=${market}&assetType=${assetType}&riskPlan=${riskPlan}`, { cache: "no-store" });
      const next = await response.json() as RankingPayload & ApiErrorPayload;
      if (!response.ok) throw new Error(apiErrorText(locale,next));
      setPayload(next); setSelected((current) => next.rankings.find((item) => item.instrumentId === current?.instrumentId) ?? next.rankings[0] ?? null);
    } catch (caught) { setPayload(null); setSelected(null); setError(caught instanceof Error ? caught.message : x("errorGeneric")); }
    finally { setLoading(false); }
  }, [market, assetType, riskPlan, locale, x]);

  const refreshMarketQuotes = useCallback(async () => {
    setScanning(true); setError(""); setScanMessage("");
    let cursor = "", scanId = "", processed = 0, updated = 0, failed = 0, total = 0;
    try {
      for (let batch = 0; batch < 500; batch += 1) {
        const response = await fetch("/api/scans/refresh", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ market, assetType, cursor, scanId }) });
        const result = await response.json() as QuoteRefreshPayload & ApiErrorPayload;
        if (!response.ok) throw new Error(result.error ?? x("refreshFailed"));
        scanId = result.scanId; total = result.total; processed += result.processed; updated += result.updated; failed += result.failed;
        setScanProgress({ processed, total, updated, failed });
        if (result.done || !result.nextCursor) break;
        cursor = result.nextCursor;
      }
      setScanMessage(x("refreshComplete", { updated, failed }));
      await loadRankings();
    } catch (caught) { setError(caught instanceof Error ? caught.message : x("refreshFailed")); }
    finally { setScanning(false); }
  }, [market, assetType, loadRankings, x]);

  const loadAnalysisJob = useCallback(async (jobId?: string) => {
    const endpoint = jobId ? `/api/scans/full/${encodeURIComponent(jobId)}` : `/api/scans/full?market=${market}&assetType=${assetType}`;
    const response = await fetch(endpoint, { cache:"no-store" });
    const result = await response.json() as { job?:AnalysisJobPayload|null } & ApiErrorPayload;
    if (!response.ok) throw new Error(result.error ?? x("errorGeneric"));
    setAnalysisJob(result.job ?? null);
    return result.job ?? null;
  }, [market, assetType, x]);

  async function startFullAnalysis() {
    setAnalysisStarting(true); setAnalysisMessage(""); setError("");
    try {
      const response = await fetch("/api/scans/full", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ market, assetType }) });
      const result = await response.json() as { job?:AnalysisJobPayload|null; reused?:boolean } & ApiErrorPayload;
      if (!response.ok) {
        if (result.errorCode?.startsWith("GITHUB_")) throw new Error(x("analysisCloudMissing"));
        throw new Error(result.error ?? x("errorGeneric"));
      }
      setAnalysisJob(result.job ?? null); setAnalysisMessage(x("analysisStarted")); setAnalysisConfirm(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : x("errorGeneric")); }
    finally { setAnalysisStarting(false); }
  }

  // The current filters drive a server refresh rather than derived local state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (["dashboard", "scanner", "signals"].includes(view)) void loadRankings(); }, [view, loadRankings]);
  useEffect(() => {
    if (!["dashboard", "scanner", "signals"].includes(view)) return;
    // The active server job is the durable source of truth after refresh or sign-in.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAnalysisJob().catch(() => undefined);
  }, [view, loadAnalysisJob]);
  useEffect(() => {
    if (!analysisJob || !["QUEUED", "DISPATCHED", "RUNNING"].includes(analysisJob.status)) return;
    const timer = window.setInterval(() => {
      void loadAnalysisJob(analysisJob.jobId).then((next) => {
        if (!next || ["QUEUED", "DISPATCHED", "RUNNING"].includes(next.status)) return;
        setAnalysisMessage(next.status === "COMPLETE" ? x("analysisComplete") : next.status === "PARTIAL" ? x("analysisPartial") : x("analysisFailed"));
        void loadRankings();
      }).catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [analysisJob, loadAnalysisJob, loadRankings, x]);
  useEffect(() => {
    if (view !== "security" || !instrumentId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/securities/${encodeURIComponent(instrumentId)}?riskPlan=${riskPlan}`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { security?: RankedSecurity } & ApiErrorPayload;
      if (!response.ok || !result.security) throw new Error(apiErrorText(locale,result));
      setSelected(result.security);
    }).catch((caught) => setError(caught instanceof Error ? caught.message : x("errorGeneric"))).finally(() => setLoading(false));
  }, [view, instrumentId, riskPlan, locale, x]);

  const selectedRank = selected;
  const summary = useMemo(() => ({ buy: payload?.rankings.filter((item) => item.action === "BUY").length ?? 0, watch: payload?.rankings.filter((item) => item.action === "WATCH").length ?? 0, blocked: payload?.rankings.filter((item) => item.hardGates.length > 0).length ?? 0 }), [payload]);

  async function paperBuy() {
    if (!selectedRank) return;
    const response = await fetch("/api/paper/orders", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ instrumentId:selectedRank.instrumentId, side:"BUY", quantity }) });
    const result = await response.json() as ApiErrorPayload;
    if (!response.ok) setError(apiErrorText(locale,result,"errorSetup")); else setError("");
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" href="/"><span className="brand-mark">M</span><span>MERIDIAN</span></Link>
        <div className="header-status"><span className="status-dot" />{t.shadow}<b>{t.public}</b></div>
        <select aria-label={x("language")} value={locale} onChange={(event) => setLocale(event.target.value as Locale)}><option value="zh-TW">繁體中文</option><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select>
      </header>
      <aside className="side-nav" aria-label={x("mainNavigation")}>
        <div className="side-caption">{x("researchDesk")}</div>
        {t.nav.map((label, index) => <Link key={label} className={(view === ["dashboard","scanner","signals","portfolio","backtests","health","settings"][index]) ? "active" : ""} href={navHref[index]}><span>{String(index + 1).padStart(2,"0")}</span>{label}</Link>)}
        <div className="model-stamp"><span>{x("model")}</span><strong>{MODEL_VERSION}</strong><small>{x("holdingPeriod")}</small></div>
      </aside>
      <main className="workspace">
        {(["dashboard", "scanner", "signals", "security"] as AppView[]).includes(view) && <>
          <section className="workspace-title"><div><p>MERIDIAN / {x(view === "dashboard" ? "dashboard" : view === "scanner" ? "scanner" : view === "signals" ? "signals" : "security")}</p><h1>{view === "security" ? selectedRank?.name ?? t.title : t.title}</h1><span>{t.subtitle}</span></div>{view !== "security" && <div className="analysis-actions"><button className="scan-button secondary" onClick={() => void refreshMarketQuotes()} disabled={loading || scanning}>{scanning ? "…" : "↻"} {scanning ? x("refreshingQuotes", { processed:scanProgress.processed, total:scanProgress.total || "—" }) : x("refreshQuotes")}</button><button className="scan-button" onClick={() => setAnalysisConfirm(true)} disabled={analysisStarting}>◈ {x("fullAnalysis")}</button></div>}</section>
          {(scanMessage || scanning) && <div className="scan-refresh-status" role="status">{scanning ? x("refreshingQuotes", { processed:scanProgress.processed, total:scanProgress.total || "—" }) : scanMessage}{scanning && scanProgress.failed > 0 ? ` · ${x("failed")}: ${scanProgress.failed}` : ""}</div>}
          {view !== "security" && analysisJob && <AnalysisProgress job={analysisJob} locale={locale}/>}
          {view !== "security" && analysisMessage && <div className="scan-refresh-status" role="status">{analysisMessage}</div>}
          {view !== "security" && <section className="control-deck">
            <Control label={t.market}><button className={market === "ALL" ? "active" : ""} onClick={() => setMarket("ALL")}>{t.all}</button>{MARKETS.map((item) => <button key={item} className={market === item ? "active" : ""} onClick={() => setMarket(item)}>{item}</button>)}</Control>
            <Control label={t.asset}><button className={assetType === "ALL" ? "active" : ""} onClick={() => setAssetType("ALL")}>{t.all}</button><button className={assetType === "STOCK" ? "active" : ""} onClick={() => setAssetType("STOCK")}>{t.stocks}</button><button className={assetType === "ETF" ? "active" : ""} onClick={() => setAssetType("ETF")}>{t.etfs}</button></Control>
            <Control label={t.risk}>{(Object.keys(RISK_PLANS) as RiskPlanId[]).map((item) => <button key={item} className={riskPlan === item ? "active" : ""} onClick={() => setRiskPlan(item)} title={`${tx(locale,"singleTradeRisk")} ${RISK_PLANS[item].riskBudgetPct}% · ${tx(locale,"maxPosition")} ${RISK_PLANS[item].maxWeightPct}%`}>{riskPlanName(locale,item)} · {RISK_PLANS[item].maxWeightPct}%</button>)}</Control>
          </section>}
          {view !== "security" && payload?.meta.scan && <section className="scan-audit-strip" aria-label={x("fullScan")}>
            <div><span>{x("fullScan")}</span><strong>{codeText(locale,payload.meta.scan.status)}</strong></div>
            <div><span>{x("discovered")}</span><strong>{payload.meta.scan.discoveredCount.toLocaleString(locale)}</strong></div>
            <div><span>{x("analyzed")}</span><strong>{payload.meta.scan.analyzedCount.toLocaleString(locale)}</strong></div>
            <div><span>{x("failed")}</span><strong>{payload.meta.scan.failedCount.toLocaleString(locale)}</strong></div>
            <div><span>{x("fallback")}</span><strong>{payload.meta.scan.fallbackCount.toLocaleString(locale)}</strong></div>
            <p>{x("universeTarget")} · {payload.meta.scan.qualityGatePassed ? "≥95% ✓" : "<95%"} · {payload.meta.scan.completedAt ? new Date(payload.meta.scan.completedAt).toLocaleString(locale) : x("running")}</p>
          </section>}
          {view === "dashboard" && <section className="metric-grid"><Metric label={x("shadowBuy")} value={summary.buy} tone="green"/><Metric label={x("watch")} value={summary.watch}/><Metric label={x("hardGated")} value={summary.blocked} tone="red"/><Metric label={x("ibkrFeed")} value={x("off")} tone="red"/></section>}
          {loading && <div className="state-card"><span className="loading-line" />{t.loading}</div>}
          {!loading && error && <div className="state-card error-state">{error}</div>}
          {!loading && !error && view !== "security" && <section className="research-layout">
            <div className="ranking-panel"><div className="panel-title"><strong>{payload?.rankings.length ?? 0} {x("ranked")} · {payload?.meta.scan?.analyzedCount?.toLocaleString(locale) ?? x("limited")} {x("analyzed")}</strong><span>{payload?.meta.generatedAt ? new Date(payload.meta.generatedAt).toLocaleString(locale) : "—"}</span></div>
              {payload?.rankings.length ? <div className="ranking-list">{payload.rankings.map((item, index) => <button key={item.instrumentId} onClick={() => setSelected(item)} className={selectedRank?.instrumentId === item.instrumentId ? "selected" : ""}>
                <span className="rank-no">{String(index + 1).padStart(2,"0")}</span><span className="ticker"><strong>{item.symbol}</strong><small>{item.name}</small></span><span className="tags"><i>{item.market}</i><i>{codeText(locale,item.assetType)}</i></span><span className={`action action-${item.action.toLowerCase()}`}>{codeText(locale,item.action)}</span><span className="quote"><strong>{item.price.toLocaleString(locale)}</strong><small>{item.changePct >= 0 ? "+" : ""}{item.changePct}%</small></span><span className="score-cell"><strong>{item.score}</strong><i style={{"--score":`${item.score}%`} as React.CSSProperties}/></span>
              </button>)}</div> : <div className="empty-state">{t.noData}</div>}
            </div>
            {selectedRank && <SecurityPanel security={selectedRank} locale={locale} t={t} quantity={quantity} setQuantity={setQuantity} onPaperBuy={paperBuy}/>} 
          </section>}
          {!loading && view === "security" && selectedRank && <SecurityPanel security={selectedRank} locale={locale} t={t} quantity={quantity} setQuantity={setQuantity} onPaperBuy={paperBuy} standalone/>}
        </>}
        {view === "portfolio" && <PortfolioView locale={locale} title={t.portfolio} setup={t.setup}/>} 
        {view === "backtests" && <BacktestView locale={locale} title={t.backtest}/>} 
        {view === "health" && <HealthView locale={locale} title={t.health} ibkr={t.ibkr}/>} 
        {view === "settings" && <SettingsView locale={locale} title={t.settings} saveLabel={t.save} notifyLabel={t.notify}/>} 
      </main>
      {analysisConfirm && <AnalysisConfirmModal locale={locale} market={market} assetType={assetType} starting={analysisStarting} onCancel={() => setAnalysisConfirm(false)} onStart={() => void startFullAnalysis()}/>}
      <footer className="app-footer"><span>© 2026 MERIDIAN RESEARCH</span><p>{t.disclaimer}</p><Link href="/health">{x("dataStatus")} →</Link></footer>
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) { return <div className="control-group"><span>{label}</span><div>{children}</div></div>; }
function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) { return <div className={`metric-card ${tone ?? ""}`}><span>{label}</span><strong>{value}</strong><i/></div>; }

function phaseLabel(locale:Locale, phase:string) {
  const keys:Record<string,Parameters<typeof tx>[1]> = { QUEUED:"phaseQueued", DISCOVERY:"phaseDiscovery", HISTORY:"phaseHistory", ENRICHMENT:"phaseEnrichment", SCORING:"phaseScoring", UPLOADING:"phaseUploading", COMPLETE:"phaseComplete" };
  return tx(locale,keys[phase] ?? "phaseQueued");
}

function AnalysisProgress({ job, locale }: { job:AnalysisJobPayload; locale:Locale }) {
  const complete = job.components.filter((item) => ["COMPLETE", "SKIPPED"].includes(item.status)).length;
  const terminal = ["COMPLETE", "PARTIAL", "FAILED"].includes(job.status);
  const statusText = job.status === "COMPLETE" ? tx(locale,"analysisComplete") : job.status === "PARTIAL" ? tx(locale,"analysisPartial") : job.status === "FAILED" ? tx(locale,"analysisFailed") : tx(locale,"analysisActive");
  return <section className={`analysis-progress ${terminal ? `analysis-${job.status.toLowerCase()}` : ""}`} aria-live="polite">
    <div className="analysis-progress-head"><div><span>{statusText}</span><strong>{tx(locale,"analysisProgress",{completed:complete,total:job.components.length})}</strong></div>{job.githubRunUrl&&<a href={job.githubRunUrl} target="_blank" rel="noreferrer">GitHub Actions ↗</a>}</div>
    <div className="analysis-components">{job.components.map((item) => {
      const percent = item.total > 0 ? Math.min(100,Math.round(item.processed / item.total * 100)) : item.status === "COMPLETE" ? 100 : 0;
      return <div key={item.id} className={`analysis-component component-${item.status.toLowerCase()}`}><div><strong>{item.market} · {codeText(locale,item.assetType)}</strong><span>{phaseLabel(locale,item.phase)} · {percent}%</span></div><i><b style={{width:`${percent}%`}}/></i>{item.errorCode&&<small>{item.errorDetail || item.errorCode}</small>}</div>;
    })}</div>
  </section>;
}

function AnalysisConfirmModal({ locale, market, assetType, starting, onCancel, onStart }: { locale:Locale; market:string; assetType:string; starting:boolean; onCancel:()=>void; onStart:()=>void }) {
  const marketCount = market === "ALL" ? MARKETS.length : 1;
  const estimate = marketCount * (assetType === "STOCK" ? 500 : assetType === "ETF" ? 100 : 600);
  const scope = `${market === "ALL" ? MARKETS.join(" · ") : market} / ${assetType === "ALL" ? `${tx(locale,"stock")} + ETF` : codeText(locale,assetType)}`;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.currentTarget===event.target&&!starting)onCancel();}}><section className="analysis-modal" role="dialog" aria-modal="true" aria-labelledby="full-analysis-title"><p>MERIDIAN / {tx(locale,"shadow")}</p><h2 id="full-analysis-title">{tx(locale,"fullAnalysisConfirmTitle")}</h2><div className="modal-warning">{tx(locale,"fullAnalysisConfirmBody")}</div><dl><div><dt>{tx(locale,"analysisScope")}</dt><dd>{scope}</dd></div><div><dt>{tx(locale,"analysisEstimate")}</dt><dd>≈ {estimate.toLocaleString(locale)}</dd></div><div><dt>{tx(locale,"analysisFirstBackfill")}</dt><dd>{tx(locale,"analysisFirstBackfillValue")}</dd></div></dl><div className="modal-actions"><button className="secondary" disabled={starting} onClick={onCancel}>{tx(locale,"cancel")}</button><button disabled={starting} onClick={onStart}>{starting ? tx(locale,"analysisQueued") : tx(locale,"startAnalysis")}</button></div></section></div>;
}

function SecurityPanel({ security, locale, t, quantity, setQuantity, onPaperBuy, standalone=false }: { security: RankedSecurity; locale: Locale; t: typeof words[Locale]; quantity:number; setQuantity:(value:number)=>void; onPaperBuy:()=>void; standalone?:boolean }) {
  return <aside className={`security-panel ${standalone ? "standalone" : ""}`}>
    <div className="security-head"><div><span>{security.market} · {codeText(locale,security.assetType)} · {security.exchange}</span><h2>{security.name}</h2><p>{security.symbol} / {security.currency}</p></div><div className="score-orbit"><strong>{security.score}</strong><small>{codeText(locale,security.status)}</small></div></div>
    <div className="source-banner"><span className={`freshness freshness-${security.freshness}`}>{codeText(locale,security.freshness)}</span><div><strong>{security.source}</strong><small>{tx(locale,"quoteTime")}: {new Date(security.capturedAt).toLocaleString(locale)} · {security.currency} {security.price.toLocaleString(locale)}</small><small>{tx(locale,"analysisTime")}: {security.analysisCapturedAt ? new Date(security.analysisCapturedAt).toLocaleString(locale) : "—"} · {tx(locale,"analysisPrice")}: {security.analysisPrice ? `${security.currency} ${security.analysisPrice.toLocaleString(locale)}` : "—"}</small></div></div>
    <div className="risk-limit-grid"><div><span>{t.quality}</span><strong>{security.dataQuality?.completenessPct ?? 0}%</strong></div><div><span>{t.sources}</span><strong>{security.dataQuality?.sourceCount ?? 0}</strong></div><div><span>{t.bucket}</span><strong>{security.selection?.bucketRank ?? 0} / {security.selection?.buyLimit ?? 0} BUY</strong></div><div><span>{tx(locale,"model")}</span><strong>{security.assetModel}</strong></div></div>
    <div className="factor-deck"><h3>{t.factors}</h3>{factorKeys.map((key,index)=><div key={key}><span>{factorName[locale][index]}</span><i><b style={{width:`${security.factors[key]}%`}}/></i><strong>{security.factors[key]}</strong></div>)}</div>
    <div className="trade-plan"><h3>{t.plan}</h3><dl><div><dt>{t.entry}</dt><dd>{security.tradePlan.entryLow}–{security.tradePlan.entryHigh}</dd></div><div><dt>{t.stop}</dt><dd>{security.tradePlan.stop}</dd></div><div><dt>{t.targets}</dt><dd>{security.tradePlan.target1} / {security.tradePlan.target2}</dd></div><div><dt>{t.maxWeight}</dt><dd>{security.tradePlan.maxWeightPct}%</dd></div></dl></div>
    <div className="evidence"><h3>{t.reason}</h3><div>{security.reasonCodes.map((code)=><span key={code}>{codeText(locale,code)}</span>)}</div>{security.hardGates.length>0&&<p><b>!</b>{t.blocked}: {security.hardGates.map((code)=>codeText(locale,code)).join(" · ")}</p>}</div>
    {security.tradePlanState === "REANALYSIS_REQUIRED"&&<div className="reanalysis-warning"><strong>{tx(locale,"reanalysisRequired")}</strong><span>{tx(locale,"reanalysisBuyBlocked")}</span></div>}
    <div className="paper-action"><label>{t.qty}<input type="number" min="1" step="1" value={quantity} onChange={(event)=>setQuantity(Math.max(1,Number(event.target.value)))}/></label><button onClick={onPaperBuy} disabled={security.tradePlanState === "REANALYSIS_REQUIRED"}>{t.paperBuy}</button></div>
  </aside>;
}

function PortfolioView({ locale, title, setup }: { locale:Locale; title:string; setup:string }) {
  type PortfolioPayload={portfolio?:Record<string,unknown>|null;positions?:Array<Record<string,unknown>>;orders?:Array<Record<string,unknown>>;summary?:Record<string,unknown>|null;marketRules?:Array<Record<string,unknown>>};
  type AdviceView={action?:string;urgency?:string;reasonCodes?:string[];recommendedSellQuantity?:number;currentWeightPct?:number;marketWeightPct?:number;sectorWeightPct?:number;returnPct?:number;score?:number|null;confidence?:number|null;analysisCapturedAt?:string|null;analysisPrice?:number|null;modelVersion?:string|null;assetModel?:string|null;validationStatus?:string|null;tradePlan?:Record<string,unknown>|null;quoteCurrent?:boolean;analysisCurrent?:boolean};
  const x = useCallback((key:Parameters<typeof tx>[1], params?:Parameters<typeof tx>[2]) => tx(locale,key,params),[locale]);
  const [data,setData]=useState<PortfolioPayload|null>(null),[sellQty,setSellQty]=useState<Record<string,number>>({}),[message,setMessage]=useState("");
  const [refreshing,setRefreshing]=useState(false);
  const load=useCallback(async()=>{try{const response=await fetch("/api/paper/orders",{cache:"no-store"});const next=await response.json() as PortfolioPayload & ApiErrorPayload;if(!response.ok)throw new Error(apiErrorText(locale,next,"errorPortfolio"));setData(next);setSellQty(Object.fromEntries((next.positions??[]).map(row=>{const advice=(row.advice??{}) as AdviceView,sellable=Number(row.sellable_quantity??0),suggested=Number(advice.recommendedSellQuantity??0);return [String(row.instrument_id),suggested>0?suggested:Math.min(1,sellable)];})));}catch(caught){setMessage(caught instanceof Error?caught.message:x("errorPortfolio"));setData({});}},[locale,x]);
  // Initial portfolio hydration must synchronize the client with the owner-only API.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{void load();},[load]);
  async function sell(row:Record<string,unknown>){const instrumentId=String(row.instrument_id),quantity=Number(sellQty[instrumentId]??0);setMessage("");const response=await fetch("/api/paper/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({instrumentId,side:"SELL",quantity})});const result=await response.json() as ApiErrorPayload & {order?:{realizedPnlBase?:number;baseCurrency?:string}};if(!response.ok){setMessage(apiErrorText(locale,result,"errorOrder"));return;}setMessage(`${x("sellCompleted")}: ${result.order?.baseCurrency??""} ${Number(result.order?.realizedPnlBase??0).toLocaleString(locale)}`);await load();}
  async function refreshPositions(){setRefreshing(true);setMessage("");try{const response=await fetch("/api/paper/quotes",{method:"POST"});const result=await response.json() as ApiErrorPayload&{updated?:number;failed?:number};if(!response.ok)throw new Error(apiErrorText(locale,result,"errorQuoteRefresh"));await load();setMessage(x("portfolioQuotesUpdated",{updated:Number(result.updated??0),failed:Number(result.failed??0)}));}catch(caught){setMessage(caught instanceof Error?caught.message:x("errorQuoteRefresh"));}finally{setRefreshing(false);}}
  const summary=data?.summary??{},positions=data?.positions??[],base=String(summary.baseCurrency??data?.portfolio?.base_currency??"");
  if(!data)return <PageSection title={title} eyebrow={x("portfolioEyebrow")}><div className="state-card">{x("loading")}</div></PageSection>;
  if(!data.portfolio)return <PageSection title={title} eyebrow={x("portfolioEyebrow")}><div className="empty-state large"><h2>{setup}</h2><Link className="scan-button" href="/settings">{x("setupButton")} →</Link></div></PageSection>;
  const riskPlan=String(data.portfolio.risk_plan??"capital_first") as RiskPlanId,limits=RISK_PLANS[riskPlan]??RISK_PLANS.capital_first;
  const adviceCounts=(summary.adviceCounts??{}) as Record<string,number>;
  return <PageSection title={title} eyebrow={x("portfolioEyebrow")}>
    <section className="metric-grid"><Metric label={x("equity")} value={`${base} ${Number(summary.equity??0).toLocaleString(locale)}`}/><Metric label={x("cash")} value={`${base} ${Number(summary.cash??0).toLocaleString(locale)}`}/><Metric label={x("unrealizedPnl")} value={`${base} ${Number(summary.unrealizedPnl??0).toLocaleString(locale)}`} tone={Number(summary.unrealizedPnl??0)<0?"red":"green"}/><Metric label={x("drawdown")} value={`${Number(summary.drawdownPct??0).toFixed(2)}%`} tone={Number(summary.drawdownPct??0)>0?"red":undefined}/></section>
    <h3 className="section-label">{x("riskLimits")}</h3><div className="risk-limit-grid"><div><span>{x("riskPlan")}</span><strong>{riskPlanName(locale,riskPlan)}</strong></div><div><span>{x("singleTradeRisk")}</span><strong>{limits.riskBudgetPct}%</strong></div><div><span>{x("maxPosition")}</span><strong>{limits.maxWeightPct}%</strong></div><div><span>{x("maxSector")}</span><strong>{limits.maxSectorPct}%</strong></div><div><span>{x("maxMarket")}</span><strong>{limits.maxMarketPct}%</strong></div><div><span>{x("drawdownBreaker")}</span><strong>{limits.drawdownBreakerPct}%</strong></div></div><p className="risk-limit-note">{x("minimumLotRule")}</p>
    {Boolean(summary.newBuysPaused)&&<div className="portfolio-risk-alert">{x("newBuysPaused")}</div>}
    <div className="portfolio-note"><strong>{x("holdingAdvice")}: {positions.length}</strong><span>{x("holdingAdviceNote")}</span><button className="portfolio-refresh-button" disabled={refreshing||positions.length===0} onClick={()=>void refreshPositions()}>{refreshing?x("refreshingPositions"):x("refreshPositions")}</button><b>{message}</b></div>
    {positions.length?<><div className="advice-summary">{(["HOLD","REDUCE","EXIT","REVIEW"] as const).map(action=><span key={action} className={`advice-count advice-${action.toLowerCase()}`}><b>{Number(adviceCounts[action]??0)}</b>{codeText(locale,action)}</span>)}</div><div className="holding-advice-grid">{positions.map(row=>{const id=String(row.instrument_id),sellable=Number(row.sellable_quantity??0),advice=(row.advice??{}) as AdviceView,plan=(advice.tradePlan??{}) as Record<string,unknown>,suggested=Number(advice.recommendedSellQuantity??0),action=String(advice.action??"REVIEW"),returnPct=Number(advice.returnPct??0);return <article key={id} className={`holding-advice-card advice-${action.toLowerCase()}`}>
      <header><div><span>{String(row.market)} · {codeText(locale,row.asset_type)}</span><Link href={`/securities/${encodeURIComponent(id)}`}>{String(row.symbol)}</Link><small>{String(row.name)}</small></div><strong>{codeText(locale,action)}</strong></header>
      <div className="holding-price-line"><div><span>{x("costCurrent")}</span><b>{String(row.currency)} {Number(row.average_cost??0).toLocaleString(locale)} / {Number(row.price??0).toLocaleString(locale)}</b></div><div><span>{x("holdingReturn")}</span><b className={returnPct>=0?"positive":"negative"}>{returnPct>=0?"+":""}{returnPct.toFixed(2)}%</b></div><div><span>{x("pnl")}</span><b className={Number(row.unrealized_pnl_base)>=0?"positive":"negative"}>{base} {Number(row.unrealized_pnl_base??0).toLocaleString(locale)}</b></div></div>
      <dl className="holding-evidence"><div><dt>{x("latestQuote")}</dt><dd>{codeText(locale,row.freshness)} · {row.captured_at?new Date(String(row.captured_at)).toLocaleString(locale):"—"}<small>{String(row.source??"—")}</small></dd></div><div><dt>{x("analysisSnapshot")}</dt><dd>{advice.analysisCapturedAt?new Date(String(advice.analysisCapturedAt)).toLocaleString(locale):x("analysisUnavailable")}<small>{advice.analysisPrice?`${x("analysisPrice")} ${Number(advice.analysisPrice).toLocaleString(locale)} · ${advice.modelVersion??"—"}`:"—"}</small></dd></div><div><dt>{x("scoreConfidence")}</dt><dd>{advice.score==null?"—":`${Number(advice.score).toFixed(1)} / ${Number(advice.confidence??0).toFixed(1)}`}<small>{String(advice.assetModel??"—")} · {codeText(locale,advice.validationStatus)}</small></dd></div><div><dt>{x("portfolioWeights")}</dt><dd>{Number(advice.currentWeightPct??0).toFixed(2)}% / {Number(advice.marketWeightPct??0).toFixed(2)}% / {Number(advice.sectorWeightPct??0).toFixed(2)}%</dd></div><div><dt>{x("tradeGuardrails")}</dt><dd>{Number(plan.stop??0)>0?`${Number(plan.stop).toLocaleString(locale)} / ${Number(plan.target1??0).toLocaleString(locale)} / ${Number(plan.target2??0).toLocaleString(locale)}`:"—"}</dd></div><div><dt>{x("quantity")} / {x("sellable")}</dt><dd>{Number(row.quantity??0).toLocaleString(locale)} / {sellable.toLocaleString(locale)}</dd></div></dl>
      <div className="holding-reasons"><span>{x("suggestedAction")}</span>{(advice.reasonCodes??[]).map(code=><p key={code}>{codeText(locale,code)}</p>)}</div>
      <div className="holding-sell"><div><span>{x("recommendedSell")}</span><strong>{suggested.toLocaleString(locale)}</strong>{suggested>0&&<button type="button" onClick={()=>setSellQty({...sellQty,[id]:suggested})}>{x("useSuggestion")}</button>}</div><div className="sell-control"><input aria-label={`${x("sell")} ${String(row.symbol)}`} type="number" min="1" max={sellable} step="1" disabled={sellable<=0} value={sellQty[id]??Math.min(1,sellable)} onChange={event=>setSellQty({...sellQty,[id]:Math.max(1,Number(event.target.value))})}/><button disabled={sellable<=0} onClick={()=>void sell(row)}>{sellable>0?x("sell"):x("noSellable")}</button></div></div>
    </article>})}</div><p className="holding-disclaimer">{x("holdingDisclaimer")} · {x("feeNotice")}</p></>:<div className="empty-state">{x("positions")}: 0</div>}
    <h3 className="section-label">{x("marketRules")}</h3><div className="market-rule-grid">{(data.marketRules??[]).map(rule=>{const session=rule.session as Record<string,unknown>|undefined;return <div key={String(rule.market)}><strong>{String(rule.market)}</strong><span>{x("settlement")}: {String(rule.settlement)} · {x("tradingUnit")}: {String(rule.stockLot??x("variable"))}</span><small>{codeText(locale,session?.state)} · {x("ruleVersion")} {String(rule.ruleVersion??"—")}</small></div>})}</div>
    <h3 className="section-label">{x("orderHistory")}</h3><OrderHistory locale={locale} rows={data.orders??[]}/>
  </PageSection>;
}

function BacktestView({ locale, title }: { locale:Locale; title:string }) {
  const [data,setData]=useState<Record<string,unknown>|null>(null); useEffect(()=>{fetch(`/api/backtests/${MODEL_VERSION}`,{cache:"no-store"}).then(async r=>await r.json() as Record<string,unknown>).then(setData);},[]);
  const acceptance=data?.acceptance as Record<string,number>|undefined; const markets=data?.markets as Array<Record<string,unknown>>|undefined;
  return <PageSection title={title} eyebrow={tx(locale,"backtestEyebrow")}><div className="activation-banner"><span>{tx(locale,"formalLocked")}</span><strong>{data?codeText(locale,data.status):tx(locale,"loading")}</strong><p>{tFor(locale).provisional}</p></div>{acceptance&&<section className="metric-grid"><Metric label={tx(locale,"minimumTrades")} value={acceptance.minimumTrades}/><Metric label={tx(locale,"profitFactor")} value={`≥ ${acceptance.profitFactor}`}/><Metric label={tx(locale,"sharpe")} value={`≥ ${acceptance.sharpe}`}/><Metric label={tx(locale,"shadowDays")} value={acceptance.shadowTradingDays}/></section>}<div className="market-health-grid">{markets?.map(row=><div key={String(row.market)}><span>{String(row.market)}</span><strong>{codeText(locale,row.status)}</strong><small>{new Date().toLocaleDateString(locale)}</small></div>)}</div></PageSection>;
}

function tFor(locale:Locale){ return words[locale]; }

function HealthView({ locale, title, ibkr }: { locale:Locale; title:string; ibkr:string }) {
  type HealthPayload={markets?:Array<Record<string,unknown>>;storage?:Record<string,unknown>;cloudAnalyzer?:{configured?:boolean;state?:string;repository?:string|null;url?:string|null};analysisJobs?:Array<Record<string,unknown>>};
  const [data,setData]=useState<HealthPayload|null>(null); useEffect(()=>{fetch("/api/data-health",{cache:"no-store"}).then(async r=>await r.json() as HealthPayload).then(setData);},[]);
  const cloud=data?.cloudAnalyzer;
  return <PageSection title={title} eyebrow={tx(locale,"healthEyebrow")}><div className="activation-banner warning"><span>{tx(locale,"primaryFeed")}</span><strong>{ibkr}</strong><p>{tx(locale,"shadowUntilValidated")}</p></div><div className={`activation-banner ${cloud?.configured&&cloud.state==="active"?"":"warning"}`}><span>{tx(locale,"fullAnalysis")}</span><strong>{cloud?.configured ? String(cloud.state??tx(locale,"unknown")) : tx(locale,"off")}</strong><p>{cloud?.configured ? `${cloud.repository??"GitHub"} · ${tx(locale,"analysisJobCount",{count:data?.analysisJobs?.length??0})}` : tx(locale,"analysisCloudMissing")}</p></div><div className="market-health-grid">{data?.markets?.map(row=><div key={String(row.market)} className={`health-${row.status}`}><span>{String(row.market)}</span><strong>{codeText(locale,row.status)}</strong><small>{codeText(locale,row.source)}<br/>{row.lastCapturedAt?new Date(String(row.lastCapturedAt)).toLocaleString(locale):tx(locale,"noSnapshot")}</small></div>)}</div></PageSection>;
}

function SettingsView({ locale, title, saveLabel, notifyLabel }: { locale:Locale; title:string; saveLabel:string; notifyLabel:string }) {
  const [form,setForm]=useState({locale,baseCurrency:"TWD",paperCapital:"",riskPlan:"capital_first",emailAlerts:false,alertEmail:""}); const [message,setMessage]=useState("");
  useEffect(()=>{fetch("/api/settings",{cache:"no-store"}).then(async r=>await r.json() as {settings?:Record<string,unknown>}).then(d=>d.settings&&setForm({locale:(d.settings.locale as Locale)??locale,baseCurrency:String(d.settings.baseCurrency??"TWD"),paperCapital:d.settings.paperCapital?String(d.settings.paperCapital):"",riskPlan:String(d.settings.riskPlan??"capital_first"),emailAlerts:Boolean(d.settings.emailAlerts),alertEmail:String(d.settings.alertEmail??"")}));},[locale]);
  async function save(){const r=await fetch("/api/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,paperCapital:Number(form.paperCapital)||null})});const d=await r.json() as ApiErrorPayload&{portfolioAdjustment?:{capital:number;delta:number}};if(!r.ok){setMessage(apiErrorText(locale,d,"errorSettings"));return;}const adjustment=d.portfolioAdjustment;setMessage(adjustment?tx(locale,"capitalSynced",{capital:adjustment.capital.toLocaleString(locale),delta:`${adjustment.delta>0?"+":""}${adjustment.delta.toLocaleString(locale)}`}):tx(locale,"saved"));}
  async function notify(){const r=await fetch("/api/alerts/test",{method:"POST"});const d=await r.json() as {delivered?:{email?:boolean}};setMessage(r.ok?tx(locale,d.delivered?.email?"inAppEmailDelivered":"inAppDelivered"):tx(locale,"alertFailed"));}
  return <PageSection title={title} eyebrow={tx(locale,"settingsEyebrow")}><div className="settings-card"><label>{tx(locale,"language")}<select value={form.locale} onChange={e=>setForm({...form,locale:e.target.value as Locale})}><option value="zh-TW">繁體中文</option><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select></label><label>{tx(locale,"baseCurrency")}<select value={form.baseCurrency} onChange={e=>setForm({...form,baseCurrency:e.target.value})}><option>TWD</option><option>USD</option><option>JPY</option><option>HKD</option><option>CNY</option><option>KRW</option><option>SGD</option></select></label><label>{tx(locale,"paperCapital")}<input inputMode="decimal" value={form.paperCapital} onChange={e=>setForm({...form,paperCapital:e.target.value})} placeholder="1000000"/></label><label>{tx(locale,"riskPlan")}<select value={form.riskPlan} onChange={e=>setForm({...form,riskPlan:e.target.value})}>{(Object.keys(RISK_PLANS) as RiskPlanId[]).map(id=><option key={id} value={id}>{riskPlanName(locale,id)} · {tx(locale,"singleTradeRisk")} {RISK_PLANS[id].riskBudgetPct}% · {tx(locale,"maxPosition")} {RISK_PLANS[id].maxWeightPct}%</option>)}</select></label><label>{tx(locale,"email")}<input type="email" value={form.alertEmail} onChange={e=>setForm({...form,alertEmail:e.target.value})}/></label><label className="check-row"><input type="checkbox" checked={form.emailAlerts} onChange={e=>setForm({...form,emailAlerts:e.target.checked})}/> {tx(locale,"enableEmail")}</label><div className="settings-actions"><button onClick={save}>{saveLabel}</button><button className="secondary" onClick={notify}>{notifyLabel}</button><span>{message}</span></div></div></PageSection>;
}

function PageSection({title,eyebrow,children}:{title:string;eyebrow:string;children:React.ReactNode}){return <><section className="workspace-title"><div><p>{eyebrow}</p><h1>{title}</h1></div></section>{children}</>}
function OrderHistory({locale,rows}:{locale:Locale;rows:Array<Record<string,unknown>>}){if(!rows.length)return <div className="empty-state">{tx(locale,"noRecords")}</div>;return <div className="data-table"><table><thead><tr><th>{tx(locale,"orderTime")}</th><th>{tx(locale,"symbol")}</th><th>{tx(locale,"side")}</th><th>{tx(locale,"quantity")}</th><th>{tx(locale,"filledPrice")}</th><th>{tx(locale,"feesTaxes")}</th><th>{tx(locale,"realizedPnl")}</th><th>{tx(locale,"status")}</th></tr></thead><tbody>{rows.map((row,index)=><tr key={String(row.id??index)}><td>{String(row.created_at??"—")}</td><td><strong>{String(row.symbol??"—")}</strong><small>{String(row.name??"")}</small></td><td>{codeText(locale,row.side)}</td><td>{Number(row.quantity??0).toLocaleString(locale)}</td><td>{String(row.currency??row.instrument_currency??"")} {Number(row.filled_price??0).toLocaleString(locale)}</td><td>{String(row.currency??row.instrument_currency??"")} {(Number(row.commission??0)+Number(row.taxes??0)).toLocaleString(locale)}</td><td>{Number(row.realized_pnl_base??0).toLocaleString(locale)}</td><td>{codeText(locale,row.status)}{Boolean(row.risk_exception)&&<small>{codeText(locale,row.risk_exception)}</small>}</td></tr>)}</tbody></table></div>}
