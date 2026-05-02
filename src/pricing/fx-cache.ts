import type { DuckDBConnection } from "@duckdb/node-api";
import type { FxRate } from "./fx.js";

export async function readRate(conn: DuckDBConnection, date: Date): Promise<FxRate | null> {
  const dateStr = date.toISOString().slice(0, 10);
  const reader = await conn.runAndReadAll(
    "SELECT usd_eur, source, date FROM fx_rates WHERE date = ?",
    [dateStr],
  );
  const rows = reader.getRowObjects();
  if (rows.length === 0) return null;
  const r = rows[0];
  if (!r) return null;
  return {
    rate: Number(r["usd_eur"]),
    source: String(r["source"]) as FxRate["source"],
    asOf: new Date(String(r["date"])),
  };
}

export async function readMostRecentRate(conn: DuckDBConnection): Promise<FxRate | null> {
  const reader = await conn.runAndReadAll(
    "SELECT usd_eur, source, date FROM fx_rates ORDER BY date DESC LIMIT 1",
  );
  const rows = reader.getRowObjects();
  if (rows.length === 0) return null;
  const r = rows[0];
  if (!r) return null;
  return {
    rate: Number(r["usd_eur"]),
    source: String(r["source"]) as FxRate["source"],
    asOf: new Date(String(r["date"])),
  };
}

export async function cacheRate(conn: DuckDBConnection, fx: FxRate): Promise<void> {
  const dateStr = fx.asOf.toISOString().slice(0, 10);
  await conn.run(
    `INSERT INTO fx_rates (date, usd_eur, fetched_at, source)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (date) DO UPDATE SET usd_eur=excluded.usd_eur,
       fetched_at=excluded.fetched_at, source=excluded.source`,
    [dateStr, fx.rate, new Date().toISOString(), fx.source],
  );
}
