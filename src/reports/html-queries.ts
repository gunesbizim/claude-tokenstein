import type { DuckDBConnection } from "@duckdb/node-api";
import type { DayRow } from "./queries.js";

export interface HtmlDayRow extends DayRow {
  turns: number;
}

function weekStart(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay();
  const diff = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function quarterStart(now: Date): Date {
  const m = now.getUTCMonth();
  const qm = Math.floor(m / 3) * 3;
  return new Date(Date.UTC(now.getUTCFullYear(), qm, 1));
}

function tomorrow(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

async function runPeriodQuery(
  conn: DuckDBConnection,
  start: Date,
  end: Date,
  groupBy: "day" | "week",
): Promise<HtmlDayRow[]> {
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const dayExpr =
    groupBy === "week"
      ? "strftime('%Y-W%V', ts)"
      : "ts::DATE::VARCHAR";
  const reader = await conn.runAndReadAll(
    `SELECT ${dayExpr}                                     AS day,
            model,
            SUM(input_tokens)::BIGINT                      AS input,
            SUM(output_tokens)::BIGINT                     AS output,
            SUM(cache_creation_input_tokens)::BIGINT       AS cache_write,
            SUM(cache_read_input_tokens)::BIGINT           AS cache_read,
            SUM(input_tokens + output_tokens)::BIGINT      AS total,
            SUM(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens)::BIGINT AS total_all,
            COUNT(*)::BIGINT                               AS turns
     FROM messages
     WHERE ts >= ?::TIMESTAMP
       AND ts < ?::TIMESTAMP
       AND model != '<synthetic>'
     GROUP BY day, model
     ORDER BY day, model`,
    [startIso, endIso],
  );
  return reader.getRowObjects().map((r) => ({
    day: String(r["day"] ?? ""),
    model: String(r["model"] ?? ""),
    input: Number(r["input"] ?? 0),
    output: Number(r["output"] ?? 0),
    cache_write: Number(r["cache_write"] ?? 0),
    cache_read: Number(r["cache_read"] ?? 0),
    total: Number(r["total"] ?? 0),
    total_all: Number(r["total_all"] ?? 0),
    turns: Number(r["turns"] ?? 0),
  }));
}

export async function queryWeek(conn: DuckDBConnection): Promise<HtmlDayRow[]> {
  const now = new Date();
  return runPeriodQuery(conn, weekStart(now), tomorrow(now), "day");
}

export async function queryMonth(conn: DuckDBConnection): Promise<HtmlDayRow[]> {
  const now = new Date();
  return runPeriodQuery(conn, monthStart(now), tomorrow(now), "day");
}

export async function queryQuarter(conn: DuckDBConnection): Promise<HtmlDayRow[]> {
  const now = new Date();
  return runPeriodQuery(conn, quarterStart(now), tomorrow(now), "week");
}

export async function queryTodayHtml(conn: DuckDBConnection): Promise<HtmlDayRow[]> {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return runPeriodQuery(conn, todayStart, tomorrow(now), "day");
}

export async function queryYtdHtml(conn: DuckDBConnection): Promise<HtmlDayRow[]> {
  const now = new Date();
  const ytdStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return runPeriodQuery(conn, ytdStart, tomorrow(now), "day");
}

export async function queryLtdHtml(conn: DuckDBConnection): Promise<HtmlDayRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT strftime('%Y-%m', ts)                          AS day,
            model,
            SUM(input_tokens)::BIGINT                      AS input,
            SUM(output_tokens)::BIGINT                     AS output,
            SUM(cache_creation_input_tokens)::BIGINT       AS cache_write,
            SUM(cache_read_input_tokens)::BIGINT           AS cache_read,
            SUM(input_tokens + output_tokens)::BIGINT      AS total,
            SUM(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens)::BIGINT AS total_all,
            COUNT(*)::BIGINT                               AS turns
     FROM messages
     WHERE model != '<synthetic>'
     GROUP BY day, model
     ORDER BY day, model`,
  );
  return reader.getRowObjects().map((r) => ({
    day: String(r["day"] ?? ""),
    model: String(r["model"] ?? ""),
    input: Number(r["input"] ?? 0),
    output: Number(r["output"] ?? 0),
    cache_write: Number(r["cache_write"] ?? 0),
    cache_read: Number(r["cache_read"] ?? 0),
    total: Number(r["total"] ?? 0),
    total_all: Number(r["total_all"] ?? 0),
    turns: Number(r["turns"] ?? 0),
  }));
}
