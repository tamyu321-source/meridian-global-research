import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("production shell and metadata replace the demo", async () => {
  const [page, layout, app, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/meridian-app.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /MeridianApp view="dashboard"/);
  assert.match(layout, /Auditable Global Investment Research/);
  assert.match(layout, /openGraph/);
  assert.match(app, /影子訊號/);
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
});
