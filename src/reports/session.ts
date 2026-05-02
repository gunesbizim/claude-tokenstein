import type { DuckDBConnection } from "@duckdb/node-api";
import { querySession } from "./queries.js";
import { renderTable, formatTokens } from "./render.js";
import { modelRowToTableRow } from "./format.js";
import { UserError } from "../errors.js";
import type { PriceTable } from "../pricing/types.js";

export async function renderSessionCommand(
  conn: DuckDBConnection,
  sessionId: string | undefined,
  prices: PriceTable,
  currency: "usd" | "eur",
  fxRate: number,
): Promise<string> {
  const sid = sessionId ?? process.env["CLAUDE_SESSION_ID"];
  if (!sid) {
    throw new UserError(
      "No session id provided and CLAUDE_SESSION_ID is not set. Pass a session id as argument.",
    );
  }

  const rows = await querySession(conn, sid);
  if (rows.length === 0) return `No data for session ${sid}`;

  const totalTurns = rows.reduce((a, r) => a + r.turns, 0);
  const header = `Session ${sid} — ${totalTurns} turns`;

  const table = renderTable(
    ["Model", "Input", "Output", "CacheW", "CacheR", "Total", "Turns", "Cost"],
    rows.map((r) => modelRowToTableRow(r, prices, currency, fxRate)),
  );

  const totalAll = rows.reduce((a, r) => a + r.input + r.output + r.cache_write + r.cache_read, 0);
  return `${header} — ${formatTokens(totalAll)} total tokens\n\n${table}`;
}
