# Meridian canonical full-analysis bridge

The website never treats a fast quote refresh as a comprehensive scan. GitHub
Actions runs this Python bridge for manual and after-close analysis; Windows can
still run the same command as an operator fallback.

Default coverage per run:

- 500 highest-liquidity ordinary stocks per market.
- 100 highest-liquidity non-leveraged ETFs per market.
- US, China A-shares, Hong Kong, Taiwan, Japan, Korea, and Singapore.
- Five years of genuine daily open/high/low/close/volume, adjusted close, dividends and splits are requested; at least 252 observations are required.
- DuckDB provides resumable local storage, Parquet is archived to R2, and dated universe snapshots accumulate point-in-time evidence.
- `model_v2.py` is the only scoring implementation used by both scanning and backtesting.
- Public data remains `delayed`; BUY is always `SHADOW`, with at most 3 stocks and 1 ETF per market per day.

## GitHub Actions

`../.github/workflows/full-analysis.yml` expands a request into market/asset
buckets with at most two running concurrently. Progress is signed and reported
as `DISCOVERY → HISTORY → ENRICHMENT → SCORING → UPLOADING → COMPLETE`.
Each scheduled trigger also attempts any earlier market whose local after-close
time has passed; D1 skips buckets already completed for that local trading day.

The runner installs versions locked by `requirements-cloud.txt`, restores only
Parquet attached to a previously successful scan, applies a seven-day overlap,
and uploads a new immutable artifact. A failed bucket retains the last active
output.

## Run once from Windows (operator fallback)

Set the variables in `.env.example` in the Windows user environment, then run:

```powershell
py -m pip install "duckdb>=1.3,<2"
py bridge\meridian_bridge.py
```

For a private Sites deployment, set `OAI_SITES_BYPASS_TOKEN` to the private service token. The HMAC secret must match the Sites `INGEST_HMAC_SECRET` value.

## Optional Windows schedule

```powershell
py bridge\meridian_bridge.py --loop
```

GitHub Actions is the production scheduler. Windows Task Scheduler is optional
and uses the same HMAC ingestion path and canonical model.

Run `py bridge\backtest.py` for the same-model walk-forward test. Public-source history has survivorship bias, so its status is permanently `PROVISIONAL_BACKTEST` and can never unlock `FORMAL`.
