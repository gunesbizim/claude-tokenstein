import type { DuckDBConnection } from "@duckdb/node-api";
import { queryTop } from "./queries.js";
import { renderTable, formatTokens } from "./render.js";
import { UserError } from "../errors.js";

const VALID_BY = ["session", "project", "model"] as const;

export async function renderTopCommand(
  conn: DuckDBConnection,
  by: string,
  n: number,
): Promise<string> {
  if (!(VALID_BY as readonly string[]).includes(by)) {
    throw new UserError(`Invalid --by value: "${by}". Use: session | project | model`);
  }
  const rows = await queryTop(conn, by, n);
  if (rows.length === 0) return "No data.";

  const table = renderTable(
    [`Top ${n} by ${by}`, "Total Tokens", "Turns", "Last Seen"],
    rows.map((r) => [
      r.bucket.length > 60 ? "…" + r.bucket.slice(-57) : r.bucket,
      formatTokens(r.total_tokens),
      String(r.turns),
      r.last_seen.slice(0, 16),
    ]),
  );

  return table;
}

export async function collectTopCommand(
  conn: DuckDBConnection,
  by: string,
  n: number,
): Promise<object> {
  if (!(VALID_BY as readonly string[]).includes(by)) {
    throw new UserError(`Invalid --by value: "${by}". Use: session | project | model`);
  }
  return queryTop(conn, by, n);
}
