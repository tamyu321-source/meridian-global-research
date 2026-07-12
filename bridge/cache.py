"""Resumable DuckDB/Parquet cache for public market history and PIT universes."""
from __future__ import annotations

import gzip
import json
import os
from datetime import datetime, timezone

try:
    import duckdb
except ImportError as exc:  # explicit diagnostic instead of silently losing persistence
    raise RuntimeError("Install the Windows bridge dependency: pip install 'duckdb>=1.3,<2'") from exc


class MarketCache:
    def __init__(self, root=None):
        self.root = os.path.abspath(root or os.getenv("MERIDIAN_CACHE_DIR") or os.path.join(os.path.dirname(__file__), "data"))
        self.parquet_root = os.path.join(self.root, "parquet")
        self.raw_root = os.path.join(self.root, "raw")
        os.makedirs(self.parquet_root, exist_ok=True)
        os.makedirs(self.raw_root, exist_ok=True)
        self.db = duckdb.connect(os.path.join(self.root, "meridian.duckdb"))
        self.db.execute("""CREATE TABLE IF NOT EXISTS history (
            instrument_id VARCHAR, symbol VARCHAR, market VARCHAR, asset_type VARCHAR,
            timestamp BIGINT, open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
            adj_close DOUBLE, volume DOUBLE, dividend DOUBLE, split_ratio DOUBLE,
            source VARCHAR, fetched_at TIMESTAMP,
            PRIMARY KEY(instrument_id, timestamp)
        )""")
        self.db.execute("""CREATE TABLE IF NOT EXISTS universe_snapshots (
            snapshot_date DATE, market VARCHAR, instrument_id VARCHAR, symbol VARCHAR,
            asset_type VARCHAR, name VARCHAR, sector VARCHAR, source VARCHAR,
            metadata_json VARCHAR, PRIMARY KEY(snapshot_date, instrument_id)
        )""")

    def close(self):
        self.db.close()

    def latest_timestamp(self, instrument_id):
        row = self.db.execute("SELECT max(timestamp) FROM history WHERE instrument_id=?", [instrument_id]).fetchone()
        return int(row[0]) if row and row[0] else None

    def load_history(self, instrument_id):
        rows = self.db.execute("""SELECT timestamp,open,high,low,close,adj_close,volume,dividend,split_ratio
            FROM history WHERE instrument_id=? ORDER BY timestamp""", [instrument_id]).fetchall()
        return [{"timestamp": row[0], "open": row[1], "high": row[2], "low": row[3], "close": row[4], "adjClose": row[5], "volume": row[6], "dividend": row[7], "splitRatio": row[8]} for row in rows]

    def store_history(self, snapshot):
        captured = snapshot.get("capturedAt") or datetime.now(timezone.utc).isoformat()
        values = [(snapshot["instrumentId"], snapshot["symbol"], snapshot["market"], snapshot["assetType"], int(bar["timestamp"]), float(bar["open"]), float(bar["high"]), float(bar["low"]), float(bar["close"]), float(bar.get("adjClose") or bar["close"]), float(bar.get("volume") or 0), float(bar.get("dividend") or 0), float(bar.get("splitRatio") or 1), snapshot.get("source", "public"), captured) for bar in snapshot["bars"]]
        self.db.executemany("""INSERT INTO history VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(instrument_id,timestamp) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,adj_close=excluded.adj_close,volume=excluded.volume,dividend=excluded.dividend,split_ratio=excluded.split_ratio,source=excluded.source,fetched_at=excluded.fetched_at""", values)

    def store_universe(self, market, candidates, source, snapshot_date):
        values = []
        for item in candidates:
            symbol = str(item["symbol"]).upper()
            asset_type = "ETF" if str(item.get("quoteType") or "").upper() == "ETF" else "STOCK"
            values.append((snapshot_date, market, f"{market}:{symbol}", symbol, asset_type, item.get("shortName") or item.get("longName") or symbol, item.get("sector") or item.get("industry") or "Unclassified", source, json.dumps(item, ensure_ascii=False, separators=(",", ":"))))
        self.db.executemany("""INSERT INTO universe_snapshots VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(snapshot_date,instrument_id) DO UPDATE SET asset_type=excluded.asset_type,name=excluded.name,sector=excluded.sector,source=excluded.source,metadata_json=excluded.metadata_json""", values)

    def export_market_parquet(self, market, scan_id):
        directory = os.path.join(self.parquet_root, f"market={market}")
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, f"scan={scan_id}.parquet")
        escaped = path.replace("'", "''")
        self.db.execute(f"COPY (SELECT * FROM history WHERE market=?) TO '{escaped}' (FORMAT PARQUET, COMPRESSION ZSTD)", [market])
        return path

    def save_raw(self, market, symbol, payload, scan_id):
        directory = os.path.join(self.raw_root, scan_id, market)
        os.makedirs(directory, exist_ok=True)
        safe = symbol.replace("/", "_").replace("\\", "_")
        path = os.path.join(directory, safe + ".json.gz")
        with gzip.open(path, "wt", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        return path
