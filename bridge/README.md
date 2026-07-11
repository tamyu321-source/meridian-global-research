# Meridian Windows market bridge

This companion process keeps provider credentials off the website. Until an
IBKR PRO account is active it uses public Yahoo market interfaces and labels
every snapshot `delayed` and every signal `SHADOW`.

1. Copy `.env.example` values into the Windows user environment.
2. Set `MERIDIAN_ENDPOINT` to the private Sites URL and set the same
   `INGEST_HMAC_SECRET` in Sites and Windows.
3. Run `py bridge\meridian_bridge.py --loop` on the dedicated always-on PC.
4. Use Windows Task Scheduler to start it at logon and restart on failure.
5. Run `py bridge\backtest.py` to create the initial ten-year price/volume
   validation artifact.

Before enabling formal signals, open and fund an IBKR PRO account, accept the
Market Data API Agreement, subscribe to Level 1 API feeds for all seven
markets, install IB Gateway, and replace the public snapshot adapter with the
IBKR adapter while keeping the normalized upload contract unchanged.
