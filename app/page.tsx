"use client";

import { useMemo, useState } from "react";

type Locale = "en" | "zh-TW" | "zh-CN" | "ja" | "ko";
type Market = "ALL" | "US" | "CN" | "HK" | "TW" | "JP" | "KR" | "SG";
type Preset = "balanced" | "quality" | "value" | "momentum" | "defensive";

const copy = {
  en: {
    nav: ["Discover", "Methodology", "Markets"], locale: "English", eyebrow: "GLOBAL EQUITY INTELLIGENCE",
    titleA: "One world.", titleB: "Better signals.", subtitle: "Compare securities across seven markets with market-aware scoring, transparent factors, and disciplined risk gates.",
    explore: "Explore signals", methodology: "See methodology", universe: "Securities screened", markets: "Markets", factors: "Core factors", refreshed: "Demo data · Updated Jul 11",
    finder: "Signal finder", finderSub: "Ranked with your selected strategy", search: "Search symbol or company", all: "All markets", strategy: "Strategy lens", results: "ranked securities",
    columns: ["Security", "Market", "Signal", "Score", "1Y quality", "Risk"], conviction: "High conviction", watch: "Watch", watching: "Watching",
    detail: "Signal anatomy", thesis: "Why it ranks", strengths: "Primary strengths", caution: "Watch item", factorMix: "Factor contribution",
    regime: "Market regime", regimeCopy: "Neutral-growth", regimeNote: "Rates and volatility are normalized by local market before cross-market comparison.",
    process: "How Meridian scores", processSub: "A transparent pipeline, not a black box.", steps: ["Normalize locally", "Apply quality gates", "Score five factors", "Adjust for regime", "Rank with risk cap"],
    disclosure: "Research demo only. Scores use illustrative data and are not investment advice, an offer, or a promise of future returns.", noResults: "No securities match this view.",
  },
  "zh-TW": {
    nav: ["發掘標的", "評分方法", "市場"], locale: "繁體中文", eyebrow: "全球證券研究系統",
    titleA: "放眼全球，", titleB: "找到更好的訊號。", subtitle: "以市場校準的評分、透明因子與嚴謹風險門檻，比較七大市場的投資標的。",
    explore: "開始探索", methodology: "查看方法", universe: "掃描證券", markets: "涵蓋市場", factors: "核心因子", refreshed: "示範資料 · 7 月 11 日更新",
    finder: "訊號選股器", finderSub: "依你選擇的策略即時計算排名", search: "搜尋代號或公司", all: "全部市場", strategy: "策略視角", results: "檔排名標的",
    columns: ["證券", "市場", "訊號", "總分", "一年品質", "風險"], conviction: "高度關注", watch: "加入觀察", watching: "已觀察",
    detail: "訊號解析", thesis: "入選理由", strengths: "主要優勢", caution: "留意事項", factorMix: "因子貢獻",
    regime: "市場狀態", regimeCopy: "中性成長", regimeNote: "先按各地利率與波動環境校準，再進行跨市場比較。",
    process: "Meridian 如何評分", processSub: "透明流程，不是黑盒子。", steps: ["市場內標準化", "套用品質門檻", "計算五大因子", "依市場狀態調整", "風險上限後排名"],
    disclosure: "本網站僅為研究產品示範。分數使用示意資料，不構成投資建議、要約或未來報酬保證。", noResults: "目前沒有符合條件的證券。",
  },
  "zh-CN": {
    nav: ["发现标的", "评分方法", "市场"], locale: "简体中文", eyebrow: "全球证券研究系统",
    titleA: "放眼全球，", titleB: "找到更好的信号。", subtitle: "以市场校准的评分、透明因子与严谨风险门槛，比较七大市场的投资标的。",
    explore: "开始探索", methodology: "查看方法", universe: "扫描证券", markets: "覆盖市场", factors: "核心因子", refreshed: "演示数据 · 7 月 11 日更新",
    finder: "信号选股器", finderSub: "依所选策略即时计算排名", search: "搜索代码或公司", all: "全部市场", strategy: "策略视角", results: "只排名标的",
    columns: ["证券", "市场", "信号", "总分", "一年质量", "风险"], conviction: "高度关注", watch: "加入观察", watching: "已观察",
    detail: "信号解析", thesis: "入选理由", strengths: "主要优势", caution: "留意事项", factorMix: "因子贡献",
    regime: "市场状态", regimeCopy: "中性增长", regimeNote: "先按各地利率与波动环境校准，再进行跨市场比较。",
    process: "Meridian 如何评分", processSub: "透明流程，不是黑盒子。", steps: ["市场内标准化", "应用质量门槛", "计算五大因子", "按市场状态调整", "风险上限后排名"],
    disclosure: "本网站仅为研究产品演示。分数使用示意数据，不构成投资建议、要约或未来回报保证。", noResults: "目前没有符合条件的证券。",
  },
  ja: {
    nav: ["銘柄発見", "評価手法", "市場"], locale: "日本語", eyebrow: "グローバル株式インテリジェンス",
    titleA: "世界を見渡し、", titleB: "より良いシグナルを。", subtitle: "市場別に調整したスコア、透明なファクター、厳格なリスク基準で7市場の証券を比較します。",
    explore: "シグナルを見る", methodology: "評価手法", universe: "分析銘柄", markets: "対応市場", factors: "主要因子", refreshed: "デモデータ · 7月11日更新",
    finder: "シグナル検索", finderSub: "選択した戦略でリアルタイム順位付け", search: "銘柄コード・企業名を検索", all: "全市場", strategy: "戦略レンズ", results: "件のランキング",
    columns: ["銘柄", "市場", "シグナル", "スコア", "品質", "リスク"], conviction: "高確度", watch: "ウォッチ", watching: "登録済み",
    detail: "シグナル分析", thesis: "上位の理由", strengths: "主な強み", caution: "注意点", factorMix: "ファクター寄与",
    regime: "市場レジーム", regimeCopy: "中立・成長", regimeNote: "各市場の金利とボラティリティを正規化してから比較します。",
    process: "Meridianの評価方法", processSub: "ブラックボックスではなく、透明な工程。", steps: ["市場内で正規化", "品質基準を適用", "5因子を採点", "レジーム調整", "リスク上限で順位付け"],
    disclosure: "研究用デモです。スコアは例示データであり、投資助言・勧誘・将来収益の保証ではありません。", noResults: "条件に合う銘柄がありません。",
  },
  ko: {
    nav: ["종목 발굴", "평가 방법", "시장"], locale: "한국어", eyebrow: "글로벌 주식 인텔리전스",
    titleA: "세계를 보고,", titleB: "더 나은 신호를 찾으세요.", subtitle: "시장별 보정 점수, 투명한 팩터, 엄격한 위험 기준으로 7개 시장의 증권을 비교합니다.",
    explore: "신호 탐색", methodology: "평가 방법", universe: "분석 종목", markets: "지원 시장", factors: "핵심 팩터", refreshed: "데모 데이터 · 7월 11일 갱신",
    finder: "시그널 파인더", finderSub: "선택한 전략으로 실시간 순위 계산", search: "종목 코드 또는 회사 검색", all: "전체 시장", strategy: "전략 렌즈", results: "개 순위 종목",
    columns: ["종목", "시장", "신호", "점수", "품질", "위험"], conviction: "높은 확신", watch: "관심", watching: "관심 등록",
    detail: "신호 분석", thesis: "상위 선정 이유", strengths: "주요 강점", caution: "주의 사항", factorMix: "팩터 기여도",
    regime: "시장 국면", regimeCopy: "중립 성장", regimeNote: "현지 금리와 변동성을 먼저 정규화한 뒤 시장 간 비교합니다.",
    process: "Meridian 평가 방식", processSub: "블랙박스가 아닌 투명한 과정입니다.", steps: ["시장 내 정규화", "품질 기준 적용", "5개 팩터 점수화", "시장 국면 조정", "위험 상한 후 순위화"],
    disclosure: "연구용 데모입니다. 점수는 예시 데이터이며 투자 자문, 청약 또는 미래 수익 보장이 아닙니다.", noResults: "조건에 맞는 종목이 없습니다.",
  },
} as const;

const marketNames: Record<Market, Record<Locale, string>> = {
  ALL: { en: "All", "zh-TW": "全部", "zh-CN": "全部", ja: "すべて", ko: "전체" },
  US: { en: "United States", "zh-TW": "美股", "zh-CN": "美股", ja: "米国", ko: "미국" },
  CN: { en: "China A", "zh-TW": "中國 A 股", "zh-CN": "中国 A 股", ja: "中国A株", ko: "중국 A주" },
  HK: { en: "Hong Kong", "zh-TW": "港股", "zh-CN": "港股", ja: "香港", ko: "홍콩" },
  TW: { en: "Taiwan", "zh-TW": "台股", "zh-CN": "台股", ja: "台湾", ko: "대만" },
  JP: { en: "Japan", "zh-TW": "日股", "zh-CN": "日股", ja: "日本", ko: "일본" },
  KR: { en: "Korea", "zh-TW": "韓股", "zh-CN": "韩股", ja: "韓国", ko: "한국" },
  SG: { en: "Singapore", "zh-TW": "新加坡", "zh-CN": "新加坡", ja: "シンガポール", ko: "싱가포르" },
};

const presetNames: Record<Preset, Record<Locale, string>> = {
  balanced: { en: "Balanced", "zh-TW": "均衡", "zh-CN": "均衡", ja: "バランス", ko: "균형" },
  quality: { en: "Quality", "zh-TW": "品質", "zh-CN": "质量", ja: "クオリティ", ko: "퀄리티" },
  value: { en: "Value", "zh-TW": "價值", "zh-CN": "价值", ja: "バリュー", ko: "가치" },
  momentum: { en: "Momentum", "zh-TW": "動能", "zh-CN": "动量", ja: "モメンタム", ko: "모멘텀" },
  defensive: { en: "Defensive", "zh-TW": "防禦", "zh-CN": "防御", ja: "ディフェンシブ", ko: "방어" },
};

const weights: Record<Preset, number[]> = {
  balanced: [0.24, 0.2, 0.2, 0.2, 0.16], quality: [0.42, 0.15, 0.13, 0.16, 0.14],
  value: [0.2, 0.42, 0.12, 0.12, 0.14], momentum: [0.16, 0.1, 0.46, 0.16, 0.12], defensive: [0.28, 0.18, 0.1, 0.12, 0.32],
};

const securities = [
  { symbol: "2330", name: "Taiwan Semiconductor", local: "台積電", market: "TW" as Market, factors: [96, 72, 91, 94, 82], risk: 22, thesis: "Structural AI demand, high capital efficiency, and durable process leadership support resilient earnings quality.", caution: "Semiconductor cycle concentration and geopolitical exposure require position-size discipline." },
  { symbol: "NVDA", name: "NVIDIA", local: "NVIDIA", market: "US" as Market, factors: [94, 58, 96, 97, 68], risk: 34, thesis: "Accelerated-computing leadership combines exceptional growth, margins, and positive revisions.", caution: "Premium expectations increase sensitivity to any slowdown in AI infrastructure spending." },
  { symbol: "7203", name: "Toyota Motor", local: "トヨタ自動車", market: "JP" as Market, factors: [88, 84, 76, 79, 83], risk: 18, thesis: "A broad powertrain portfolio, cash generation, and improving capital returns create balanced upside.", caution: "Currency normalization and cyclical vehicle demand may temper near-term momentum." },
  { symbol: "005930", name: "Samsung Electronics", local: "삼성전자", market: "KR" as Market, factors: [86, 78, 82, 88, 76], risk: 25, thesis: "Memory-cycle recovery and advanced packaging investment support an improving earnings profile.", caution: "Execution in high-bandwidth memory remains the key swing factor." },
  { symbol: "0700", name: "Tencent Holdings", local: "騰訊控股", market: "HK" as Market, factors: [90, 81, 74, 86, 78], risk: 27, thesis: "High-quality platform cash flows and disciplined capital returns offset a slower macro backdrop.", caution: "Regulatory and domestic-consumption uncertainty can widen the valuation range." },
  { symbol: "600519", name: "Kweichow Moutai", local: "贵州茅台", market: "CN" as Market, factors: [92, 67, 62, 84, 88], risk: 19, thesis: "Brand scarcity, pricing power, and a strong balance sheet sustain exceptional return quality.", caution: "Premium-spirit demand and channel inventory deserve close monitoring." },
  { symbol: "D05", name: "DBS Group", local: "DBS Group", market: "SG" as Market, factors: [89, 79, 71, 82, 90], risk: 14, thesis: "Strong deposit franchise, capital discipline, and stable asset quality underpin defensive compounding.", caution: "Falling policy rates could compress net interest margins." },
  { symbol: "AAPL", name: "Apple", local: "Apple", market: "US" as Market, factors: [93, 61, 75, 85, 79], risk: 20, thesis: "Ecosystem retention and services mix support cash flow durability and capital returns.", caution: "Hardware replacement cycles and regulatory pressure can limit multiple expansion." },
  { symbol: "9988", name: "Alibaba Group", local: "阿里巴巴", market: "HK" as Market, factors: [78, 90, 69, 80, 65], risk: 36, thesis: "Low expectations, cloud optionality, and capital returns offer asymmetric rerating potential.", caution: "Competitive intensity and consumer weakness keep forecast dispersion elevated." },
  { symbol: "8035", name: "Tokyo Electron", local: "東京エレクトロン", market: "JP" as Market, factors: [91, 55, 89, 92, 66], risk: 31, thesis: "Leading wafer-fabrication exposure captures long-run semiconductor capital intensity.", caution: "Order cyclicality and export controls can produce sharp estimate revisions." },
];

const factorLabels: Record<Locale, string[]> = {
  en: ["Quality", "Value", "Momentum", "Growth", "Resilience"], "zh-TW": ["品質", "價值", "動能", "成長", "韌性"],
  "zh-CN": ["质量", "价值", "动量", "增长", "韧性"], ja: ["品質", "割安度", "勢い", "成長", "耐性"], ko: ["품질", "가치", "모멘텀", "성장", "회복력"],
};

export default function Home() {
  const [locale, setLocale] = useState<Locale>("zh-TW");
  const [market, setMarket] = useState<Market>("ALL");
  const [preset, setPreset] = useState<Preset>("balanced");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("2330");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const t = copy[locale];

  const ranked = useMemo(() => securities.map((security) => {
    const factorScore = security.factors.reduce((sum, value, index) => sum + value * weights[preset][index], 0);
    return { ...security, score: Math.round(factorScore * 0.9 + (100 - security.risk) * 0.1) };
  }).filter((security) => (market === "ALL" || security.market === market) && `${security.symbol} ${security.name} ${security.local}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.score - a.score), [market, preset, query]);

  const active = securities.find((security) => security.symbol === selected) ?? securities[0];
  const activeScore = Math.round(active.factors.reduce((sum, value, index) => sum + value * weights[preset][index], 0) * 0.9 + (100 - active.risk) * 0.1);
  const toggleWatch = (symbol: string) => setWatchlist((current) => current.includes(symbol) ? current.filter((item) => item !== symbol) : [...current, symbol]);

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Meridian home"><span className="brand-mark">M</span><span>MERIDIAN</span></a>
        <nav aria-label="Primary navigation">
          <a href="#signals">{t.nav[0]}</a><a href="#method">{t.nav[1]}</a><a href="#markets">{t.nav[2]}</a>
        </nav>
        <label className="locale-picker"><span className="sr-only">Language</span><select value={locale} onChange={(event) => setLocale(event.target.value as Locale)} aria-label="Language"><option value="en">EN · English</option><option value="zh-TW">繁 · 繁體中文</option><option value="zh-CN">简 · 简体中文</option><option value="ja">日 · 日本語</option><option value="ko">한 · 한국어</option></select></label>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span />{t.eyebrow}</p>
          <h1>{t.titleA}<em>{t.titleB}</em></h1>
          <p className="hero-subtitle">{t.subtitle}</p>
          <div className="hero-actions"><a className="primary-button" href="#signals">{t.explore}<span>↘</span></a><a className="text-button" href="#method">{t.methodology}<span>→</span></a></div>
          <dl className="hero-stats"><div><dt>12,480+</dt><dd>{t.universe}</dd></div><div><dt>7</dt><dd>{t.markets}</dd></div><div><dt>5</dt><dd>{t.factors}</dd></div></dl>
        </div>
        <div className="atlas" aria-label="Stylized global market map">
          <div className="atlas-ring ring-one" /><div className="atlas-ring ring-two" /><div className="atlas-axis axis-x" /><div className="atlas-axis axis-y" />
          <span className="map-dot dot-us"><b>US</b><i>OPEN</i></span><span className="map-dot dot-cn"><b>CN</b><i>+0.8%</i></span><span className="map-dot dot-tw"><b>TW</b><i>+1.2%</i></span><span className="map-dot dot-jp"><b>JP</b><i>+0.5%</i></span><span className="map-dot dot-sg"><b>SG</b><i>LIVE</i></span>
          <div className="atlas-caption"><span>35°N / 139°E</span><strong>{t.regimeCopy}</strong><small>{t.refreshed}</small></div>
        </div>
      </section>

      <section className="market-strip" id="markets" aria-label="Supported markets">
        {(["US", "CN", "HK", "TW", "JP", "KR", "SG"] as Market[]).map((code) => <button key={code} onClick={() => { setMarket(code); document.getElementById("signals")?.scrollIntoView({ behavior: "smooth" }); }}><span>{code}</span>{marketNames[code][locale]}</button>)}
      </section>

      <section className="finder-section" id="signals">
        <div className="section-heading"><div><p className="kicker">01 — DISCOVER</p><h2>{t.finder}</h2><p>{t.finderSub}</p></div><div className="update-stamp"><span className="pulse" />{t.refreshed}</div></div>
        <div className="finder-controls">
          <label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.search} aria-label={t.search} /><kbd>⌘ K</kbd></label>
          <div className="market-tabs" role="group" aria-label="Market filter">{(["ALL", "US", "CN", "HK", "TW", "JP", "KR", "SG"] as Market[]).map((code) => <button key={code} className={market === code ? "active" : ""} onClick={() => setMarket(code)}>{code === "ALL" ? t.all : code}</button>)}</div>
          <div className="preset-row"><span>{t.strategy}</span><div role="group" aria-label={t.strategy}>{(["balanced", "quality", "value", "momentum", "defensive"] as Preset[]).map((item) => <button key={item} className={preset === item ? "active" : ""} onClick={() => setPreset(item)}>{presetNames[item][locale]}</button>)}</div></div>
        </div>

        <div className="research-grid">
          <div className="ranking-card">
            <div className="table-meta"><strong>{ranked.length} {t.results}</strong><span>MERIDIAN SCORE™</span></div>
            <div className="table-scroll">
              <table><thead><tr>{t.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>
                {ranked.map((security, index) => <tr key={security.symbol} className={selected === security.symbol ? "selected" : ""} onClick={() => setSelected(security.symbol)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelected(security.symbol); }}>
                  <td><div className="security-cell"><span className="rank">{String(index + 1).padStart(2, "0")}</span><span className="security-logo">{security.symbol.slice(0, 1)}</span><span><strong>{security.local}</strong><small>{security.symbol} · {security.name}</small></span></div></td>
                  <td><span className="market-code">{security.market}</span></td><td><span className={`signal-badge ${security.score > 87 ? "high" : "positive"}`}>{security.score > 87 ? t.conviction : presetNames[preset][locale]}</span></td>
                  <td><strong className="score">{security.score}</strong><span className="score-bar"><i style={{ width: `${security.score}%` }} /></span></td><td>{security.factors[0]}</td><td><span className={`risk risk-${security.risk > 30 ? "high" : security.risk > 22 ? "mid" : "low"}`}>{security.risk}</span></td>
                </tr>)}
              </tbody></table>{ranked.length === 0 && <p className="empty-state">{t.noResults}</p>}
            </div>
          </div>

          <aside className="signal-detail">
            <div className="detail-top"><div><p>{t.detail}</p><h3>{active.local}</h3><span>{active.symbol} · {marketNames[active.market][locale]}</span></div><div className="score-dial"><strong>{activeScore}</strong><small>/100</small></div></div>
            <button className={`watch-button ${watchlist.includes(active.symbol) ? "active" : ""}`} onClick={() => toggleWatch(active.symbol)}><span>{watchlist.includes(active.symbol) ? "◆" : "◇"}</span>{watchlist.includes(active.symbol) ? t.watching : t.watch}</button>
            <div className="detail-copy"><p className="detail-label">{t.thesis}</p><p>{active.thesis}</p></div>
            <div className="factor-list"><p className="detail-label">{t.factorMix}</p>{active.factors.map((value, index) => <div key={factorLabels[locale][index]}><span>{factorLabels[locale][index]}</span><span className="factor-track"><i style={{ width: `${value}%` }} /></span><strong>{value}</strong></div>)}</div>
            <div className="caution"><span>!</span><div><p className="detail-label">{t.caution}</p><p>{active.caution}</p></div></div>
          </aside>
        </div>
      </section>

      <section className="method-section" id="method">
        <div className="method-intro"><p className="kicker">02 — METHODOLOGY</p><h2>{t.process}</h2><p>{t.processSub}</p></div>
        <div className="method-flow">{t.steps.map((step, index) => <div key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong><i>{index < t.steps.length - 1 ? "→" : "✓"}</i></div>)}</div>
        <div className="regime-card"><div className="regime-orbit"><span>R</span></div><div><p>{t.regime}</p><h3>{t.regimeCopy}</h3><span>{t.regimeNote}</span></div><dl><div><dt>VOL</dt><dd>18.4</dd></div><div><dt>BREADTH</dt><dd>61%</dd></div><div><dt>LIQUIDITY</dt><dd>78</dd></div></dl></div>
      </section>

      <footer><div className="brand footer-brand"><span className="brand-mark">M</span><span>MERIDIAN</span></div><p>{t.disclosure}</p><span>© 2026 Meridian Research</span></footer>
    </main>
  );
}
