"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Locale, RankedSecurity, RiskPlanId } from "@/lib/types";
import { MARKETS, MODEL_VERSION, RISK_PLANS } from "@/lib/types";

export type AppView = "dashboard" | "scanner" | "signals" | "portfolio" | "backtests" | "health" | "settings" | "security";
type RankingPayload = { rankings: RankedSecurity[]; meta: { mode: string; primaryFeed: string; ibkrConnected: boolean; generatedAt: string; errors?: string[] } };

const words = {
  "zh-TW": { nav:["總覽","市場掃描","訊號中心","模擬組合","回測驗證","資料健康","設定"], shadow:"影子訊號", public:"公開來源／延遲", title:"跨市場投資研究", subtitle:"每日全市場排名，盤中確認進出場；所有訊號保留來源、風險與模型版本。", scan:"重新掃描", loading:"正在向市場來源取得資料…", noData:"目前沒有可驗證資料。請稍後重試或檢查資料健康度。", market:"市場", asset:"資產", risk:"風險計畫", all:"全部", stocks:"普通股", etfs:"ETF", score:"分數", signal:"訊號", price:"價格", freshness:"資料", factors:"六因子拆解", plan:"完整交易計畫", entry:"進場區", stop:"停損", targets:"分批目標", maxWeight:"最大倉位", reason:"判斷依據", blocked:"禁止正式買進", paperBuy:"模擬買進", qty:"數量", setup:"請先在設定頁輸入模擬資金。", health:"七市場資料健康", ibkr:"IBKR 尚未啟用", backtest:"回測與正式化門檻", portfolio:"模擬投資組合", settings:"研究設定", save:"儲存設定", notify:"測試通知", disclaimer:"本系統為研究與模擬決策工具，不保證獲利；IBKR 與影子驗證未完成前，不會標記正式即時訊號。" },
  "zh-CN": { nav:["总览","市场扫描","信号中心","模拟组合","回测验证","数据健康","设置"], shadow:"影子信号", public:"公开来源／延迟", title:"跨市场投资研究", subtitle:"每日全市场排名，盘中确认进出场；所有信号保留来源、风险与模型版本。", scan:"重新扫描", loading:"正在从市场来源获取数据…", noData:"目前没有可验证数据。请稍后重试或检查数据健康度。", market:"市场", asset:"资产", risk:"风险计划", all:"全部", stocks:"普通股", etfs:"ETF", score:"分数", signal:"信号", price:"价格", freshness:"数据", factors:"六因子拆解", plan:"完整交易计划", entry:"进场区", stop:"止损", targets:"分批目标", maxWeight:"最大仓位", reason:"判断依据", blocked:"禁止正式买入", paperBuy:"模拟买入", qty:"数量", setup:"请先在设置页输入模拟资金。", health:"七市场数据健康", ibkr:"IBKR 尚未启用", backtest:"回测与正式化门槛", portfolio:"模拟投资组合", settings:"研究设置", save:"保存设置", notify:"测试通知", disclaimer:"本系统为研究与模拟决策工具，不保证盈利；IBKR 与影子验证完成前，不会标记正式实时信号。" },
  en: { nav:["Overview","Market scanner","Signals","Paper portfolio","Backtests","Data health","Settings"], shadow:"Shadow signal", public:"Public source / delayed", title:"Cross-market investment research", subtitle:"Daily universe ranking with intraday confirmation. Every signal keeps its source, risk gates, and model version.", scan:"Run scan", loading:"Fetching verifiable market data…", noData:"No verifiable data is available. Retry or inspect data health.", market:"Market", asset:"Asset", risk:"Risk plan", all:"All", stocks:"Stocks", etfs:"ETFs", score:"Score", signal:"Signal", price:"Price", freshness:"Data", factors:"Six-factor attribution", plan:"Complete trade plan", entry:"Entry zone", stop:"Stop", targets:"Targets", maxWeight:"Max weight", reason:"Decision evidence", blocked:"Formal buy blocked", paperBuy:"Paper buy", qty:"Quantity", setup:"Set paper capital in Settings first.", health:"Seven-market data health", ibkr:"IBKR is not enabled", backtest:"Backtest and activation gates", portfolio:"Paper portfolio", settings:"Research settings", save:"Save settings", notify:"Test alert", disclaimer:"Research and paper-decision tool only. No signal is marked formal real-time until IBKR and shadow validation are complete." },
  ja: { nav:["概要","市場スキャン","シグナル","模擬ポートフォリオ","バックテスト","データ状態","設定"], shadow:"シャドーシグナル", public:"公開情報／遅延", title:"市場横断型投資リサーチ", subtitle:"日次ランキングと場中確認。すべてのシグナルに情報源、リスク、モデル版を保存します。", scan:"再スキャン", loading:"検証可能な市場データを取得中…", noData:"検証可能なデータがありません。データ状態を確認してください。", market:"市場", asset:"資産", risk:"リスクプラン", all:"すべて", stocks:"株式", etfs:"ETF", score:"スコア", signal:"シグナル", price:"価格", freshness:"データ", factors:"6因子分析", plan:"取引計画", entry:"エントリー", stop:"損切り", targets:"目標", maxWeight:"最大比率", reason:"判断根拠", blocked:"正式買い禁止", paperBuy:"模擬買い", qty:"数量", setup:"設定で模擬資金を入力してください。", health:"7市場のデータ状態", ibkr:"IBKR未設定", backtest:"バックテストと有効化基準", portfolio:"模擬ポートフォリオ", settings:"研究設定", save:"設定を保存", notify:"通知テスト", disclaimer:"研究・模擬判断用です。IBKRとシャドー検証完了前は正式リアルタイム表示を行いません。" },
  ko: { nav:["개요","시장 스캔","신호","모의 포트폴리오","백테스트","데이터 상태","설정"], shadow:"섀도 신호", public:"공개 소스／지연", title:"글로벌 투자 리서치", subtitle:"일일 종목 순위와 장중 확인. 모든 신호에 출처, 위험 및 모델 버전을 보존합니다.", scan:"다시 스캔", loading:"검증 가능한 시장 데이터를 가져오는 중…", noData:"검증 가능한 데이터가 없습니다. 데이터 상태를 확인하세요.", market:"시장", asset:"자산", risk:"위험 계획", all:"전체", stocks:"주식", etfs:"ETF", score:"점수", signal:"신호", price:"가격", freshness:"데이터", factors:"6개 팩터 분석", plan:"전체 거래 계획", entry:"진입 구간", stop:"손절", targets:"목표", maxWeight:"최대 비중", reason:"판단 근거", blocked:"정식 매수 차단", paperBuy:"모의 매수", qty:"수량", setup:"설정에서 모의 자금을 입력하세요.", health:"7개 시장 데이터 상태", ibkr:"IBKR 미설정", backtest:"백테스트 및 활성화 기준", portfolio:"모의 포트폴리오", settings:"리서치 설정", save:"설정 저장", notify:"알림 테스트", disclaimer:"연구 및 모의 의사결정 도구입니다. IBKR 및 섀도 검증 전에는 정식 실시간 신호로 표시하지 않습니다." },
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
  const [error, setError] = useState("");
  const [quantity, setQuantity] = useState(1);
  const t = words[locale];

  useEffect(() => { const stored = localStorage.getItem("meridian.locale") as Locale | null; if (stored && words[stored]) setLocale(stored); }, []);
  useEffect(() => { localStorage.setItem("meridian.locale", locale); document.documentElement.lang = locale; }, [locale]);

  const loadRankings = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/rankings?market=${market}&assetType=${assetType}&riskPlan=${riskPlan}`, { cache: "no-store" });
      const next = await response.json() as RankingPayload & { error?: string };
      if (!response.ok) throw new Error(next.error ?? "scan_failed");
      setPayload(next); setSelected((current) => next.rankings.find((item) => item.instrumentId === current?.instrumentId) ?? next.rankings[0] ?? null);
    } catch (caught) { setPayload(null); setSelected(null); setError(caught instanceof Error ? caught.message : "scan_failed"); }
    finally { setLoading(false); }
  }, [market, assetType, riskPlan]);

  useEffect(() => { if (["dashboard", "scanner", "signals"].includes(view)) void loadRankings(); }, [view, loadRankings]);
  useEffect(() => {
    if (view !== "security" || !instrumentId) return;
    setLoading(true);
    fetch(`/api/securities/${encodeURIComponent(instrumentId)}?riskPlan=${riskPlan}`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { security?: RankedSecurity; error?: string };
      if (!response.ok || !result.security) throw new Error(result.error ?? "security_unavailable");
      setSelected(result.security);
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "security_unavailable")).finally(() => setLoading(false));
  }, [view, instrumentId, riskPlan]);

  const selectedRank = selected;
  const summary = useMemo(() => ({ buy: payload?.rankings.filter((item) => item.action === "BUY").length ?? 0, watch: payload?.rankings.filter((item) => item.action === "WATCH").length ?? 0, blocked: payload?.rankings.filter((item) => item.hardGates.length > 0).length ?? 0 }), [payload]);

  async function paperBuy() {
    if (!selectedRank) return;
    const response = await fetch("/api/paper/orders", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ instrumentId:selectedRank.instrumentId, side:"BUY", quantity }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) setError(result.error ?? t.setup); else setError("");
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/"><span className="brand-mark">M</span><span>MERIDIAN</span></a>
        <div className="header-status"><span className="status-dot" />{t.shadow}<b>{t.public}</b></div>
        <select aria-label="Language" value={locale} onChange={(event) => setLocale(event.target.value as Locale)}><option value="zh-TW">繁體中文</option><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select>
      </header>
      <aside className="side-nav" aria-label="Main navigation">
        <div className="side-caption">RESEARCH DESK</div>
        {t.nav.map((label, index) => <a key={label} className={(view === ["dashboard","scanner","signals","portfolio","backtests","health","settings"][index]) ? "active" : ""} href={navHref[index]}><span>{String(index + 1).padStart(2,"0")}</span>{label}</a>)}
        <div className="model-stamp"><span>MODEL</span><strong>{MODEL_VERSION}</strong><small>2–12 WEEK SWING</small></div>
      </aside>
      <main className="workspace">
        {(["dashboard", "scanner", "signals", "security"] as AppView[]).includes(view) && <>
          <section className="workspace-title"><div><p>MERIDIAN / {view.toUpperCase()}</p><h1>{view === "security" ? selectedRank?.name ?? t.title : t.title}</h1><span>{t.subtitle}</span></div><button className="scan-button" onClick={loadRankings} disabled={loading}>{loading ? "…" : "↻"} {t.scan}</button></section>
          {view !== "security" && <section className="control-deck">
            <Control label={t.market}><button className={market === "ALL" ? "active" : ""} onClick={() => setMarket("ALL")}>{t.all}</button>{MARKETS.map((item) => <button key={item} className={market === item ? "active" : ""} onClick={() => setMarket(item)}>{item}</button>)}</Control>
            <Control label={t.asset}><button className={assetType === "ALL" ? "active" : ""} onClick={() => setAssetType("ALL")}>{t.all}</button><button className={assetType === "STOCK" ? "active" : ""} onClick={() => setAssetType("STOCK")}>{t.stocks}</button><button className={assetType === "ETF" ? "active" : ""} onClick={() => setAssetType("ETF")}>{t.etfs}</button></Control>
            <Control label={t.risk}>{(Object.keys(RISK_PLANS) as RiskPlanId[]).map((item) => <button key={item} className={riskPlan === item ? "active" : ""} onClick={() => setRiskPlan(item)}>{item === "capital_first" ? "0.5%" : item === "balanced" ? "1.0%" : "1.5%"}</button>)}</Control>
          </section>}
          {view === "dashboard" && <section className="metric-grid"><Metric label="SHADOW BUY" value={summary.buy} tone="green"/><Metric label="WATCH" value={summary.watch}/><Metric label="HARD GATED" value={summary.blocked} tone="red"/><Metric label="IBKR FEED" value="OFF" tone="red"/></section>}
          {loading && <div className="state-card"><span className="loading-line" />{t.loading}</div>}
          {!loading && error && <div className="state-card error-state">{error}</div>}
          {!loading && !error && view !== "security" && <section className="research-layout">
            <div className="ranking-panel"><div className="panel-title"><strong>{payload?.rankings.length ?? 0} VERIFIED CANDIDATES</strong><span>{payload?.meta.generatedAt ? new Date(payload.meta.generatedAt).toLocaleString(locale) : "—"}</span></div>
              {payload?.rankings.length ? <div className="ranking-list">{payload.rankings.map((item, index) => <button key={item.instrumentId} onClick={() => setSelected(item)} className={selectedRank?.instrumentId === item.instrumentId ? "selected" : ""}>
                <span className="rank-no">{String(index + 1).padStart(2,"0")}</span><span className="ticker"><strong>{item.symbol}</strong><small>{item.name}</small></span><span className="tags"><i>{item.market}</i><i>{item.assetType}</i></span><span className={`action action-${item.action.toLowerCase()}`}>{item.action}</span><span className="quote"><strong>{item.price.toLocaleString(locale)}</strong><small>{item.changePct >= 0 ? "+" : ""}{item.changePct}%</small></span><span className="score-cell"><strong>{item.score}</strong><i style={{"--score":`${item.score}%`} as React.CSSProperties}/></span>
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
      <footer className="app-footer"><span>© 2026 MERIDIAN RESEARCH</span><p>{t.disclaimer}</p><a href="/health">DATA STATUS →</a></footer>
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) { return <div className="control-group"><span>{label}</span><div>{children}</div></div>; }
function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) { return <div className={`metric-card ${tone ?? ""}`}><span>{label}</span><strong>{value}</strong><i/></div>; }

function SecurityPanel({ security, locale, t, quantity, setQuantity, onPaperBuy, standalone=false }: { security: RankedSecurity; locale: Locale; t: typeof words[Locale]; quantity:number; setQuantity:(value:number)=>void; onPaperBuy:()=>void; standalone?:boolean }) {
  return <aside className={`security-panel ${standalone ? "standalone" : ""}`}>
    <div className="security-head"><div><span>{security.market} · {security.assetType} · {security.exchange}</span><h2>{security.name}</h2><p>{security.symbol} / {security.currency}</p></div><div className="score-orbit"><strong>{security.score}</strong><small>{security.status}</small></div></div>
    <div className="source-banner"><span className={`freshness freshness-${security.freshness}`}>{security.freshness}</span><div><strong>{security.source}</strong><small>{new Date(security.capturedAt).toLocaleString(locale)}</small></div></div>
    <div className="factor-deck"><h3>{t.factors}</h3>{factorKeys.map((key,index)=><div key={key}><span>{factorName[locale][index]}</span><i><b style={{width:`${security.factors[key]}%`}}/></i><strong>{security.factors[key]}</strong></div>)}</div>
    <div className="trade-plan"><h3>{t.plan}</h3><dl><div><dt>{t.entry}</dt><dd>{security.tradePlan.entryLow}–{security.tradePlan.entryHigh}</dd></div><div><dt>{t.stop}</dt><dd>{security.tradePlan.stop}</dd></div><div><dt>{t.targets}</dt><dd>{security.tradePlan.target1} / {security.tradePlan.target2}</dd></div><div><dt>{t.maxWeight}</dt><dd>{security.tradePlan.maxWeightPct}%</dd></div></dl></div>
    <div className="evidence"><h3>{t.reason}</h3><div>{security.reasonCodes.map((code)=><span key={code}>{code.replaceAll("_"," ")}</span>)}</div>{security.hardGates.length>0&&<p><b>!</b>{t.blocked}: {security.hardGates.join(" · ")}</p>}</div>
    <div className="paper-action"><label>{t.qty}<input type="number" min="1" step="1" value={quantity} onChange={(event)=>setQuantity(Math.max(1,Number(event.target.value)))}/></label><button onClick={onPaperBuy}>{t.paperBuy}</button></div>
  </aside>;
}

function PortfolioView({ locale, title, setup }: { locale:Locale; title:string; setup:string }) {
  const [data,setData]=useState<{portfolio?:Record<string,unknown>;positions?:Array<Record<string,unknown>>;orders?:Array<Record<string,unknown>>}|null>(null);
  useEffect(()=>{fetch("/api/paper/orders",{cache:"no-store"}).then(async r=>await r.json() as {portfolio?:Record<string,unknown>;positions?:Array<Record<string,unknown>>;orders?:Array<Record<string,unknown>>}).then(setData).catch(()=>setData({}));},[]);
  return <PageSection title={title} eyebrow="PAPER / PORTFOLIO">{!data?<div className="state-card">Loading…</div>:!data.portfolio?<div className="empty-state large"><h2>{setup}</h2><a className="scan-button" href="/settings">SETUP →</a></div>:<><section className="metric-grid"><Metric label="CASH" value={`${data.portfolio.base_currency} ${Number(data.portfolio.cash).toLocaleString(locale)}`}/><Metric label="STARTING CAPITAL" value={Number(data.portfolio.starting_capital).toLocaleString(locale)}/><Metric label="POSITIONS" value={data.positions?.length??0}/><Metric label="RISK PLAN" value={String(data.portfolio.risk_plan)}/></section><DataTable rows={data.positions??[]}/><DataTable rows={data.orders??[]}/></>}</PageSection>;
}

function BacktestView({ locale, title }: { locale:Locale; title:string }) {
  const [data,setData]=useState<Record<string,unknown>|null>(null); useEffect(()=>{fetch(`/api/backtests/${MODEL_VERSION}`,{cache:"no-store"}).then(async r=>await r.json() as Record<string,unknown>).then(setData);},[]);
  const acceptance=data?.acceptance as Record<string,number>|undefined; const markets=data?.markets as Array<Record<string,unknown>>|undefined;
  return <PageSection title={title} eyebrow="MODEL / VALIDATION"><div className="activation-banner"><span>FORMAL SIGNALS LOCKED</span><strong>{String(data?.status??"LOADING")}</strong><p>Backtest + 30 trading-day shadow gate required.</p></div>{acceptance&&<section className="metric-grid"><Metric label="MIN TRADES" value={acceptance.minimumTrades}/><Metric label="PROFIT FACTOR" value={`≥ ${acceptance.profitFactor}`}/><Metric label="SHARPE" value={`≥ ${acceptance.sharpe}`}/><Metric label="SHADOW DAYS" value={acceptance.shadowTradingDays}/></section>}<div className="market-health-grid">{markets?.map(row=><div key={String(row.market)}><span>{String(row.market)}</span><strong>{String(row.status)}</strong><small>{new Date().toLocaleDateString(locale)}</small></div>)}</div></PageSection>;
}

function HealthView({ locale, title, ibkr }: { locale:Locale; title:string; ibkr:string }) {
  const [data,setData]=useState<{markets?:Array<Record<string,unknown>>;storage?:Record<string,unknown>}|null>(null); useEffect(()=>{fetch("/api/data-health",{cache:"no-store"}).then(async r=>await r.json() as {markets?:Array<Record<string,unknown>>;storage?:Record<string,unknown>}).then(setData);},[]);
  return <PageSection title={title} eyebrow="SYSTEM / HEALTH"><div className="activation-banner warning"><span>PRIMARY REAL-TIME FEED</span><strong>{ibkr}</strong><p>Public-source candidates remain SHADOW until IBKR subscriptions and validation are complete.</p></div><div className="market-health-grid">{data?.markets?.map(row=><div key={String(row.market)} className={`health-${row.status}`}><span>{String(row.market)}</span><strong>{String(row.status)}</strong><small>{String(row.source)}<br/>{row.lastCapturedAt?new Date(String(row.lastCapturedAt)).toLocaleString(locale):"No snapshot"}</small></div>)}</div></PageSection>;
}

function SettingsView({ locale, title, saveLabel, notifyLabel }: { locale:Locale; title:string; saveLabel:string; notifyLabel:string }) {
  const [form,setForm]=useState({locale,baseCurrency:"TWD",paperCapital:"",riskPlan:"capital_first",emailAlerts:false,alertEmail:""}); const [message,setMessage]=useState("");
  useEffect(()=>{fetch("/api/settings",{cache:"no-store"}).then(async r=>await r.json() as {settings?:Record<string,unknown>}).then(d=>d.settings&&setForm({locale:(d.settings.locale as Locale)??locale,baseCurrency:String(d.settings.baseCurrency??"TWD"),paperCapital:d.settings.paperCapital?String(d.settings.paperCapital):"",riskPlan:String(d.settings.riskPlan??"capital_first"),emailAlerts:Boolean(d.settings.emailAlerts),alertEmail:String(d.settings.alertEmail??"")}));},[locale]);
  async function save(){const r=await fetch("/api/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,paperCapital:Number(form.paperCapital)||null})});setMessage(r.ok?"Saved":"Save failed");}
  async function notify(){const r=await fetch("/api/alerts/test",{method:"POST"});const d=await r.json() as {delivered?:{email?:boolean}};setMessage(r.ok?(d.delivered?.email?"In-app + Email delivered":"In-app delivered; Email not configured"):"Alert failed");}
  return <PageSection title={title} eyebrow="OWNER / SETTINGS"><div className="settings-card"><label>Language<select value={form.locale} onChange={e=>setForm({...form,locale:e.target.value as Locale})}><option value="zh-TW">繁體中文</option><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select></label><label>Base currency<select value={form.baseCurrency} onChange={e=>setForm({...form,baseCurrency:e.target.value})}><option>TWD</option><option>USD</option><option>JPY</option><option>HKD</option><option>CNY</option><option>KRW</option><option>SGD</option></select></label><label>Paper capital<input inputMode="decimal" value={form.paperCapital} onChange={e=>setForm({...form,paperCapital:e.target.value})} placeholder="1000000"/></label><label>Risk plan<select value={form.riskPlan} onChange={e=>setForm({...form,riskPlan:e.target.value})}><option value="capital_first">Capital first · 0.5%</option><option value="balanced">Balanced · 1.0%</option><option value="growth">Growth · 1.5%</option></select></label><label>Email<input type="email" value={form.alertEmail} onChange={e=>setForm({...form,alertEmail:e.target.value})}/></label><label className="check-row"><input type="checkbox" checked={form.emailAlerts} onChange={e=>setForm({...form,emailAlerts:e.target.checked})}/> Enable Email alerts through Resend</label><div className="settings-actions"><button onClick={save}>{saveLabel}</button><button className="secondary" onClick={notify}>{notifyLabel}</button><span>{message}</span></div></div></PageSection>;
}

function PageSection({title,eyebrow,children}:{title:string;eyebrow:string;children:React.ReactNode}){return <><section className="workspace-title"><div><p>{eyebrow}</p><h1>{title}</h1></div></section>{children}</>}
function DataTable({rows}:{rows:Array<Record<string,unknown>>}){if(!rows.length)return <div className="empty-state">No records</div>;const keys=Object.keys(rows[0]).slice(0,7);return <div className="data-table"><table><thead><tr>{keys.map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={index}>{keys.map(k=><td key={k}>{String(row[k]??"—")}</td>)}</tr>)}</tbody></table></div>}
