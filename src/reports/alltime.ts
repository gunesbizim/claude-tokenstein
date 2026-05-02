import type { DuckDBConnection } from "@duckdb/node-api";
import { queryAllTime } from "./queries.js";
import { renderTable, renderSparkline, formatTokens } from "./render.js";
import { computeRowCost } from "./format.js";
import type { PriceTable } from "../pricing/types.js";

export async function renderAllTimeCommand(
  conn: DuckDBConnection,
  prices: PriceTable,
  currency: "usd" | "eur",
  fxRate: number,
): Promise<string> {
  const rows = await queryAllTime(conn);
  if (rows.length === 0) return "No data found.";

  const byMonth = new Map<string, number>();
  for (const r of rows) {
    byMonth.set(r.month, (byMonth.get(r.month) ?? 0) + r.total);
  }
  const months_sorted = [...byMonth.keys()].sort();
  const sparkValues = months_sorted.map((m) => byMonth.get(m) ?? 0);
  const spark = renderSparkline(sparkValues);

  const table = renderTable(
    ["Month", "Model", "Input", "Output", "CacheW", "CacheR", "Total", "Cost"],
    rows.map((r) => [
      r.month,
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
  const span = months_sorted.length > 0 ? `${months_sorted[0]} → ${months_sorted[months_sorted.length - 1]}` : "";
  return `All-time (${span}) — ${formatTokens(totalToks)} total tokens  ${spark}\n\n${table}`;
}

export async function collectAllTimeCommand(
  conn: DuckDBConnection,
  prices: PriceTable,
  currency: "usd" | "eur",
  fxRate: number,
): Promise<object> {
  const rows = await queryAllTime(conn);
  return rows.map((r) => ({
    ...r,
    cost: computeRowCost({ model: r.model, input: r.input, output: r.output, cache_write: r.cache_write, cache_read: r.cache_read, turns: 0 }, prices, currency, fxRate),
  }));
}
