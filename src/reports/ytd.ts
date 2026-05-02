import type { DuckDBConnection } from "@duckdb/node-api";
import { queryYTD } from "./queries.js";
import { renderTable, renderSparkline, formatTokens } from "./render.js";
import { computeRowCost } from "./format.js";
import type { PriceTable } from "../pricing/types.js";

export async function renderYTDCommand(
  conn: DuckDBConnection,
  prices: PriceTable,
  currency: "usd" | "eur",
  fxRate: number,
): Promise<string> {
  const rows = await queryYTD(conn);
  if (rows.length === 0) return "No data for this year.";

  const byDay = new Map<string, number>();
  for (const r of rows) {
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.total_all);
  }
  const days_sorted = [...byDay.keys()].sort();
  const sparkValues = days_sorted.map((d) => byDay.get(d) ?? 0);
  const spark = renderSparkline(sparkValues);

  const table = renderTable(
    ["Date", "Model", "Input", "Output", "CacheW", "CacheR", "Total (gen)", "Total (all)", "Cost"],
    rows.map((r) => [
      r.day,
      r.model,
      formatTokens(r.input),
      formatTokens(r.output),
      formatTokens(r.cache_write),
      formatTokens(r.cache_read),
      formatTokens(r.total),
      formatTokens(r.total_all),
      computeRowCost({ model: r.model, input: r.input, output: r.output, cache_write: r.cache_write, cache_read: r.cache_read, turns: 0 }, prices, currency, fxRate),
    ]),
  );

  const year = new Date().getFullYear();
  const totalToks = sparkValues.reduce((a, b) => a + b, 0);
  return `YTD ${year} — ${formatTokens(totalToks)} total tokens  ${spark}\n\n${table}`;
}

export async function collectYTDCommand(
  conn: DuckDBConnection,
  prices: PriceTable,
  currency: "usd" | "eur",
  fxRate: number,
): Promise<object> {
  const rows = await queryYTD(conn);
  return rows.map((r) => ({
    ...r,
    cost: computeRowCost({ model: r.model, input: r.input, output: r.output, cache_write: r.cache_write, cache_read: r.cache_read, turns: 0 }, prices, currency, fxRate),
  }));
}
