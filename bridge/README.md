# Meridian Windows full-universe bridge

The website no longer treats a fast, on-demand shortlist as a comprehensive scan. This companion process performs the complete background analysis and uploads an auditable completed batch to D1/R2.

Default coverage per run:

- 500 highest-liquidity ordinary stocks per market.
- 100 highest-liquidity non-leveraged ETFs per market.
- US, China A-shares, Hong Kong, Taiwan, Japan, Korea, and Singapore.
- At least 252 daily observations are required.
- Public Yahoo discovery/history remains `delayed` and every signal remains `SHADOW`.

## Run once

Set the variables in `.env.example` in the Windows user environment, then run:

```powershell
py bridge\meridian_bridge.py
```

For a private Sites deployment, set `OAI_SITES_BYPASS_TOKEN` to the private service token. The HMAC secret must match the Sites `INGEST_HMAC_SECRET` value.

## Keep it running

```powershell
py bridge\meridian_bridge.py --loop
```

Use Windows Task Scheduler to start at logon, restart on failure, and run under a dedicated Windows account. The default interval is one day. Each completed run records discovered, analyzed, failed, and fallback counts for every market.

IBKR can later replace the public adapter. Formal signals remain locked until the per-market backtest and 30-trading-day shadow gates pass.
