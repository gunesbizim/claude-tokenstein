import type { DuckDBConnection } from "@duckdb/node-api";
import { queryReport } from "./queries.js";
import { renderTable, renderSparkline, formatTokens } from "./render.js";
import { computeRowCost } from "./format.js";
import type { PriceTable } from "../pricing/types.js";

export async function renderReportCommand(
  conn: DuckDBConnection,
  days: number,
  prices: PriceTable,
  currency: "usd" | "eur",
  fxRate: number,
): Promise<string> {
  const rows = await queryReport(conn, days);
  if (rows.length === 0) return `No data for the last ${days} day(s).`;

  const byDay = new Map<string, number>();
  for (const r of rows) {
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.total);
  }
  const days_sorted = [...byDay.keys()].sort();
  const sparkValues = days_sorted.map((d) => byDay.get(d) ?? 0);
  const spark = renderSparkline(sparkValues);

  const table = renderTable(
    ["Date", "Model", "Input", "Output", "CacheW", "CacheR", "Total", "Cost"],
    rows.map((r) => [
      r.day,
      r.model,
      formatTokens(r.input),
      formatTokens(r.output),
      formatTokens(r.cache_write),
      formatTokens(r.cache_read),
      formatTokens(r.total),
      computeRowCost({ model: r.model, input: r.input, output: r.output, cache_write: r.cache_write, cache_read: r.cache_read, turns: 0 }, prices, currency, fxRate),
    ]),
  );

  const totalToks = sparkValues.reduce((a, b) => a + b, 0);
  return `Last ${days} days — ${formatTokens(totalToks)} total tokens  ${spark}\n\n${table}`;
}

export async function collectReportCommand(
  conn: DuckDBConnection,
  days: number,
  prices: PriceTable,
  currency: "usd" | "eur",
  fxRate: number,
): Promise<object> {
  const rows = await queryReport(conn, days);
  return rows.map((r) => ({
    ...r,
    cost: computeRowCost({ model: r.model, input: r.input, output: r.output, cache_write: r.cache_write, cache_read: r.cache_read, turns: 0 }, prices, currency, fxRate),
  }));
}
