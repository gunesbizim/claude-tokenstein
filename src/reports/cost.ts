import type { DuckDBConnection } from "@duckdb/node-api";
import { queryCost } from "./queries.js";
import { renderTable } from "./render.js";
import { modelRowToTableRow } from "./format.js";
import type { PriceTable } from "../pricing/types.js";

export async function renderCostCommand(
  conn: DuckDBConnection,
  month: string,
  prices: PriceTable,
  currency: "usd" | "eur",
  fxRate: number,
  fxSource?: string,
): Promise<string> {
  const [yearStr, monthStr] = month.split("-");
  const year = parseInt(yearStr ?? "0", 10);
  const mo = parseInt(monthStr ?? "0", 10);
  if (!year || !mo || mo < 1 || mo > 12) {
    throw new Error(`Invalid month format: "${month}". Use YYYY-MM.`);
  }

  const rows = await queryCost(conn, year, mo);
  if (rows.length === 0) return `No data for ${month}.`;

  const table = renderTable(
    ["Model", "Input", "Output", "CacheW", "CacheR", "Total", "Turns", `Cost (${currency.toUpperCase()})`],
    rows.map((r) => modelRowToTableRow(r, prices, currency, fxRate)),
  );

  let footer = `${month}`;
  if (currency === "eur" && fxSource) {
    footer += `\n[FX source: ${fxSource}]`;
  }

  return `${footer}\n\n${table}`;
}

export async function collectCostCommand(
  conn: DuckDBConnection,
  month: string,
): Promise<object> {
  const [yearStr, monthStr] = month.split("-");
  const year = parseInt(yearStr ?? "0", 10);
  const mo = parseInt(monthStr ?? "0", 10);
  if (!year || !mo || mo < 1 || mo > 12) {
    throw new Error(`Invalid month format: "${month}". Use YYYY-MM.`);
  }
  return queryCost(conn, year, mo);
}
