import { fetch } from "undici";
import type { DuckDBConnection } from "@duckdb/node-api";
import { FxUnavailableError } from "../errors.js";
import { readRate, readMostRecentRate, cacheRate } from "./fx-cache.js";

export interface FxRate {
  rate: number;
  source: "manual" | "frankfurter" | "fallback";
  asOf: Date;
}

export async function getRate(
  conn: DuckDBConnection,
  date: Date,
  cfg: { override: number | null },
): Promise<FxRate> {
  if (cfg.override !== null) {
    return { rate: cfg.override, source: "manual", asOf: date };
  }

  const cached = await readRate(conn, date);
  if (cached) return cached;

  try {
    const fetched = await fetchFromFrankfurter(date);
    await cacheRate(conn, fetched);
    return fetched;
  } catch {
    const last = await readMostRecentRate(conn);
    if (last) return { ...last, source: "fallback" };
    throw new FxUnavailableError("no FX rate available — try again when online");
  }
}

async function fetchFromFrankfurter(date: Date): Promise<FxRate> {
  const dateStr = isoDate(date);
  const url = `https://api.frankfurter.app/${dateStr}?from=USD&to=EUR`;
  const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
  if (!res.ok) throw new Error(`frankfurter HTTP ${res.status.toString()}`);
  const body = (await res.json()) as { date: string; rates: { EUR: number } };
  return {
    rate: body.rates.EUR,
    source: "frankfurter",
    asOf: new Date(body.date),
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function fxFooter(fx: FxRate): string | null {
  if (fx.source === "manual") return null;
  if (fx.source === "fallback") return `[stale fx: ${isoDate(fx.asOf)}]`;
  return null;
}
