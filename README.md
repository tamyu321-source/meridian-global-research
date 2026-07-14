# Meridian Global Research

The owner-only Sites application for seven-market shadow signals, paper trading,
data health, and provisional walk-forward backtests. It deliberately separates
fast quote updates from the canonical five-year Python analysis.

The application runs on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Analysis architecture

- **Update latest quotes** refreshes visible prices and paper-position P&L. It
  never changes a model score or trade plan.
- **Run full analysis** creates durable D1 jobs and dispatches
  `.github/workflows/full-analysis.yml`. The runner restores the last successful
  market/asset Parquet from R2, downloads a seven-day overlap (or the first five
  years), and invokes the reliability-first market-profile model in
  `bridge/model_v22.py`
  through `bridge/meridian_bridge.py`.
- `meridian-swing-v2.2.0` uses one canonical calculation engine with fourteen
  immutable market/asset profiles. Each bucket is calibrated from the locked
  3x3 candidate grid, evaluated on the untouched final two years, and then
  shadow-validated for 30 trading days. Only that bucket replaces v2.0 after it
  reaches `ACTIVE_SHADOW`; v2.1 is audit-only and no longer creates scans.
- v2.2 separates research ranking from entry timing. Only a confirmed
  volume breakout or healthy pullback can be a SHADOW BUY; overextension,
  shock cooling, missing breadth, neutral breakout attempts and risk-off
  regimes remain WATCH.
- Owner settings define the enabled investment markets and a versioned custom
  risk policy. All seven markets remain researchable, while paper BUY is
  rejected outside the selected set. Single-trade stop risk, position, sector,
  per-market and drawdown limits are revalidated on the server; SELL is never
  blocked by a newly tightened policy.
- China and Japan stock orders may use the audited first-board-lot exception.
  It can exceed exposure limits only for exactly one initial trading unit and
  cannot bypass stop risk, drawdown, cash, quote, signal or entry-zone gates.
- Stock and ETF buckets activate independently only after at least 95% of the
  discovered pool is analyzed and no major corporate-action anomaly exists.
- Public-source output is permanently `SHADOW`; no broker order is submitted.
- A new paper BUY is blocked when the latest quote has left the original entry
  zone. Paper SELL remains available.
- `.github/workflows/provisional-backtest.yml` performs the constrained v2.2
  profile calibration, then runs v2.0 and the selected v2.2 profile against the
  same locked public-data OOS universe and stores setup-level evidence.
  Each market is an independent checkpoint, at most two markets run in
  parallel, and the final upload is rejected unless all seven shards exist.
  History is restored from R2 when available, Yahoo downloads use bounded
  concurrency, and every stage emits durable log progress.

## Cloud configuration

Sites runtime variables:

- `GITHUB_REPOSITORY=owner/meridian-global-research`
- `GITHUB_WORKFLOW_FILE=full-analysis.yml`
- `GITHUB_WORKFLOW_REF=main`
- `GITHUB_ACTIONS_TOKEN`: fine-grained token limited to this repository with
  Actions write permission
- `INGEST_HMAC_SECRET` and optional `MERIDIAN_OWNER_EMAIL`

GitHub Actions Secrets:

- `MERIDIAN_ENDPOINT`: private Sites deployment URL
- `INGEST_HMAC_SECRET`: must match Sites
- `OAI_SITES_BYPASS_TOKEN`: private service token for the owner-only deployment

Never commit these values. The workflow logs only market/coverage information.
Fork and pull-request workflows do not receive repository Secrets.

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build and run contract, localization, risk and rendered-route tests
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
