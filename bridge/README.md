# Meridian Windows full-universe bridge

The website no longer treats a fast, on-demand shortlist as a comprehensive scan. This companion process performs the complete background analysis and uploads an auditable completed batch to D1/R2.

Default coverage per run:

- 500 highest-liquidity ordinary stocks per market.
- 100 highest-liquidity non-leveraged ETFs per market.
- US, China A-shares, Hong Kong, Taiwan, Japan, Korea, and Singapore.
- Five years of genuine daily open/high/low/close/volume, adjusted close, dividends and splits are requested; at least 252 observations are required.
- DuckDB provides resumable local storage, Parquet is archived to R2, and dated universe snapshots accumulate point-in-time evidence.
- `model_v2.py` is the only scoring implementation used by both scanning and backtesting.
- Public data remains `delayed`; BUY is always `SHADOW`, with at most 3 stocks and 1 ETF per market per day.

## Run once

Set the variables in `.env.example` in the Windows user environment, then run:

```powershell
py -m pip install -r bridge\windows-bridge-dependencies.txt
py bridge\meridian_bridge.py
```

For a private Sites deployment, set `OAI_SITES_BYPASS_TOKEN` to the private service token. The HMAC secret must match the Sites `INGEST_HMAC_SECRET` value.

## Keep it running

```powershell
py bridge\meridian_bridge.py --loop
```

Use Windows Task Scheduler to start at logon, restart on failure, and run under a dedicated Windows account. The default interval is one day. Each completed run records discovered, analyzed, failed, and fallback counts for every market.

Run `py bridge\backtest.py` for the same-model walk-forward test. Public-source history has survivorship bias, so its status is permanently `PROVISIONAL_BACKTEST` and can never unlock `FORMAL`.
