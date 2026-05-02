import type { DuckDBConnection } from "@duckdb/node-api";
import { queryHourly } from "./queries.js";
import { renderTable, renderSparkline, formatTokens } from "./render.js";

export async function renderHourlyCommand(conn: DuckDBConnection): Promise<string> {
  const rows = await queryHourly(conn);
  if (rows.length === 0) return "No usage in the last 24 hours.";

  const spark = renderSparkline(rows.map((r) => r.total));
  const table = renderTable(
    ["Hour (UTC)", "Total Tokens", "Bar"],
    rows.map((r) => {
      const barLen = Math.round((r.total / Math.max(...rows.map((x) => x.total))) * 20);
      return [r.hour.slice(0, 16), formatTokens(r.total), "█".repeat(barLen)];
    }),
  );

  const grand = rows.reduce((a, r) => a + r.total, 0);
  return `Last 24h — ${formatTokens(grand)} total tokens  ${spark}\n\n${table}`;
}

export async function collectHourlyCommand(conn: DuckDBConnection): Promise<object> {
  return queryHourly(conn);
}
