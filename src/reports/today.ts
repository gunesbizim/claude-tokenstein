import type { DuckDBConnection } from "@duckdb/node-api";
import { queryToday } from "./queries.js";
import { renderTable, formatTokens } from "./render.js";
import { modelRowToTableRow } from "./format.js";
import type { PriceTable } from "../pricing/types.js";

export async function renderTodayCommand(
  conn: DuckDBConnection,
  prices: PriceTable,
  currency: "usd" | "eur",
  fxRate: number,
): Promise<string> {
  const rows = await queryToday(conn);
  if (rows.length === 0) return "No usage recorded today.";

  const totalInput = rows.reduce((a, r) => a + r.input, 0);
  const totalOutput = rows.reduce((a, r) => a + r.output, 0);
  const header = `Today — ${formatTokens(totalInput + totalOutput)} total tokens`;

  const table = renderTable(
    ["Model", "Input", "Output", "CacheW", "CacheR", "Turns", "Cost"],
    rows.map((r) => modelRowToTableRow(r, prices, currency, fxRate)),
  );

  return `${header}\n\n${table}`;
}

export async function collectTodayCommand(
  conn: DuckDBConnection,
  prices: PriceTable,
  currency: "usd" | "eur",
  fxRate: number,
): Promise<object> {
  const rows = await queryToday(conn);
  return rows.map((r) => ({
    ...r,
    cost: modelRowToTableRow(r, prices, currency, fxRate)[6],
  }));
}
