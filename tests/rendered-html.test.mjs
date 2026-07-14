import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("production shell exposes v2 shadow and provisional-data truth", async () => {
  const [page, layout, app, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/meridian-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /MeridianApp view="dashboard"/);
  assert.match(layout, /Auditable Global Investment Research/);
  assert.match(layout, /openGraph/);
  assert.match(app, /影子 BUY/);
  assert.match(app, /暫定回測/);
  assert.match(app, /允許沒有 BUY/);
  assert.match(app, /跨市場投資研究/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(`${page}${layout}${app}`, /Your site is taking shape|codex-preview|Demo data/i);
  assert.doesNotMatch(app, />AAPL<|>NVDA<|>2330</i);
});

test("deployment build contains server, client and social assets", async () => {
  await Promise.all([
    access(new URL("../dist/server/index.js", import.meta.url)),
    access(new URL("../dist/server/ssr/index.js", import.meta.url)),
    access(new URL("../dist/client/og.png", import.meta.url)),
  ]);
});

test("all primary product route entrypoints exist", async () => {
  for (const path of ["scanner", "signals", "portfolio", "backtests", "health", "settings"]) {
    const source = await readFile(new URL(`../app/${path}/page.tsx`, import.meta.url), "utf8");
    assert.match(source, new RegExp(`view=\\"${path}\\"`));
  }
  await access(new URL("../app/api/paper/quotes/route.ts", import.meta.url));
  await access(new URL("../app/api/scans/full/route.ts", import.meta.url));
  await access(new URL("../app/api/ingest/scan-progress/route.ts", import.meta.url));
  await access(new URL("../app/api/ingest/artifacts/restore/route.ts", import.meta.url));
  await access(new URL("../.github/workflows/full-analysis.yml", import.meta.url));
});

test("full analysis binds the selected model through UI, API, workflow, and Python", async () => {
  const [app, route, workflow, bridge] = await Promise.all([
    readFile(new URL("../components/meridian-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/scans/full/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/full-analysis.yml", import.meta.url), "utf8"),
    readFile(new URL("../bridge/meridian_bridge.py", import.meta.url), "utf8"),
  ]);
  assert.match(app, /JSON\.stringify\(\{ market, assetType, modelVersion \}\)/);
  assert.match(app, /modelVersion=\$\{encodeURIComponent\(modelVersion\)\}/);
  assert.match(app, /if \(next\.modelVersion === modelVersion\) void loadRankings\(\);/);
  assert.match(route, /modelVersion: component\.model_version/);
  assert.match(workflow, /--model-version "\$\{\{ matrix\.component\.modelVersion \}\}"/);
  assert.match(bridge, /def _select_model\(model_version\):/);
  assert.match(bridge, /MODEL_MODULE is model_v22/);
});

test("paper BUY validates the same model and entry zone shown to the user", async () => {
  const [app, orders] = await Promise.all([
    readFile(new URL("../components/meridian-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/paper/orders/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(app, /modelVersion:selectedRank\.modelVersion/);
  assert.match(orders, /WHERE out\.model_version=\? AND sig\.model_version=out\.model_version/);
  assert.match(orders, /resolvedTradePlan=parseJson<TradePlan>\(activeSignal\.trade_plan_json,emptyTradePlan\)/);
  assert.match(orders, /evaluateEntryZone\(price,resolvedTradePlan\)/);
});
