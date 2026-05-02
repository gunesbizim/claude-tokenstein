import type { DuckDBConnection } from "@duckdb/node-api";

export interface DayRow {
  day: string;
  model: string;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
  total: number;
  total_all: number;
}

export interface ModelRow {
  model: string;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
  turns: number;
}

export interface HourRow {
  hour: string;
  total: number;
}

export interface TopRow {
  bucket: string;
  total_tokens: number;
  turns: number;
  last_seen: string;
}

export async function queryReport(conn: DuckDBConnection, days: number): Promise<DayRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT ts::DATE::VARCHAR              AS day,
            model,
            SUM(input_tokens)::BIGINT      AS input,
            SUM(output_tokens)::BIGINT     AS output,
            SUM(cache_creation_input_tokens)::BIGINT AS cache_write,
            SUM(cache_read_input_tokens)::BIGINT     AS cache_read,
            SUM(input_tokens + output_tokens)::BIGINT AS total,
            SUM(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens)::BIGINT AS total_all
     FROM messages
     WHERE ts >= (CURRENT_DATE - INTERVAL (${days.toString()}) DAY)::TIMESTAMP
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
  }));
}

export async function queryToday(conn: DuckDBConnection): Promise<ModelRow[]> {
  const now = new Date();
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nextMidnight = new Date(localMidnight.getTime() + 86400000);
  const reader = await conn.runAndReadAll(
    `SELECT model,
            SUM(input_tokens)::BIGINT      AS input,
            SUM(output_tokens)::BIGINT     AS output,
            SUM(cache_creation_input_tokens)::BIGINT AS cache_write,
            SUM(cache_read_input_tokens)::BIGINT     AS cache_read,
            COUNT(*)::BIGINT               AS turns
     FROM messages
     WHERE ts >= ? AND ts < ?
     GROUP BY model
     ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC`,
    [localMidnight.toISOString(), nextMidnight.toISOString()],
  );
  return reader.getRowObjects().map((r) => ({
    model: String(r["model"] ?? ""),
    input: Number(r["input"] ?? 0),
    output: Number(r["output"] ?? 0),
    cache_write: Number(r["cache_write"] ?? 0),
    cache_read: Number(r["cache_read"] ?? 0),
    turns: Number(r["turns"] ?? 0),
  }));
}

export async function querySession(
  conn: DuckDBConnection,
  sessionId: string,
): Promise<ModelRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT model,
            SUM(input_tokens)::BIGINT      AS input,
            SUM(output_tokens)::BIGINT     AS output,
            SUM(cache_creation_input_tokens)::BIGINT AS cache_write,
            SUM(cache_read_input_tokens)::BIGINT     AS cache_read,
            COUNT(*)::BIGINT               AS turns
     FROM messages
     WHERE session_id = ?
     GROUP BY model
     ORDER BY turns DESC`,
    [sessionId],
  );
  return reader.getRowObjects().map((r) => ({
    model: String(r["model"] ?? ""),
    input: Number(r["input"] ?? 0),
    output: Number(r["output"] ?? 0),
    cache_write: Number(r["cache_write"] ?? 0),
    cache_read: Number(r["cache_read"] ?? 0),
    turns: Number(r["turns"] ?? 0),
  }));
}

export async function queryHourly(conn: DuckDBConnection): Promise<HourRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT date_trunc('hour', ts)::VARCHAR           AS hour,
            SUM(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens)::BIGINT AS total
     FROM messages
     WHERE ts >= (NOW() - INTERVAL 24 HOUR)
     GROUP BY date_trunc('hour', ts)
     ORDER BY hour`,
  );
  return reader.getRowObjects().map((r) => ({
    hour: String(r["hour"] ?? ""),
    total: Number(r["total"] ?? 0),
  }));
}

const TOP_BY_COLS: Record<string, string> = {
  session: "session_id",
  project: "project_cwd",
  model: "model",
};

export async function queryTop(
  conn: DuckDBConnection,
  by: string,
  n: number,
): Promise<TopRow[]> {
  const col = TOP_BY_COLS[by];
  if (!col) throw new Error(`Invalid --by value: ${by}. Use session|project|model`);
  const reader = await conn.runAndReadAll(
    `SELECT ${col}                                      AS bucket,
            SUM(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens)::BIGINT AS total_tokens,
            COUNT(*)::BIGINT                            AS turns,
            MAX(ts)::VARCHAR                            AS last_seen
     FROM messages
     WHERE ${col} IS NOT NULL
     GROUP BY ${col}
     ORDER BY total_tokens DESC
     LIMIT ${n.toString()}`,
  );
  return reader.getRowObjects().map((r) => ({
    bucket: String(r["bucket"] ?? ""),
    total_tokens: Number(r["total_tokens"] ?? 0),
    turns: Number(r["turns"] ?? 0),
    last_seen: String(r["last_seen"] ?? ""),
  }));
}

export async function queryYTD(conn: DuckDBConnection): Promise<DayRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT ts::DATE::VARCHAR              AS day,
            model,
            SUM(input_tokens)::BIGINT      AS input,
            SUM(output_tokens)::BIGINT     AS output,
            SUM(cache_creation_input_tokens)::BIGINT AS cache_write,
            SUM(cache_read_input_tokens)::BIGINT     AS cache_read,
            SUM(input_tokens + output_tokens)::BIGINT AS total,
            SUM(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens)::BIGINT AS total_all
     FROM messages
     WHERE ts >= make_date(YEAR(CURRENT_DATE), 1, 1)::TIMESTAMP
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
  }));
}

export interface MonthRow {
  month: string;
  model: string;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
  total: number;
  total_all: number;
}

export async function queryAllTime(conn: DuckDBConnection): Promise<MonthRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT strftime('%Y-%m', ts)          AS month,
            model,
            SUM(input_tokens)::BIGINT      AS input,
            SUM(output_tokens)::BIGINT     AS output,
            SUM(cache_creation_input_tokens)::BIGINT AS cache_write,
            SUM(cache_read_input_tokens)::BIGINT     AS cache_read,
            SUM(input_tokens + output_tokens)::BIGINT AS total,
            SUM(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens)::BIGINT AS total_all
     FROM messages
     GROUP BY month, model
     ORDER BY month, model`,
  );
  return reader.getRowObjects().map((r) => ({
    month: String(r["month"] ?? ""),
    model: String(r["model"] ?? ""),
    input: Number(r["input"] ?? 0),
    output: Number(r["output"] ?? 0),
    cache_write: Number(r["cache_write"] ?? 0),
    cache_read: Number(r["cache_read"] ?? 0),
    total: Number(r["total"] ?? 0),
    total_all: Number(r["total_all"] ?? 0),
  }));
}

export async function queryCost(
  conn: DuckDBConnection,
  year: number,
  month: number,
): Promise<ModelRow[]> {
  const reader = await conn.runAndReadAll(
    `SELECT model,
            SUM(input_tokens)::BIGINT      AS input,
            SUM(output_tokens)::BIGINT     AS output,
            SUM(cache_creation_input_tokens)::BIGINT AS cache_write,
            SUM(cache_read_input_tokens)::BIGINT     AS cache_read,
            COUNT(*)::BIGINT               AS turns
     FROM messages
     WHERE ts >= make_date(${year.toString()}, ${month.toString()}, 1)::TIMESTAMP
       AND ts <  (make_date(${year.toString()}, ${month.toString()}, 1) + INTERVAL 1 MONTH)::TIMESTAMP
     GROUP BY model
     ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC`,
  );
  return reader.getRowObjects().map((r) => ({
    model: String(r["model"] ?? ""),
    input: Number(r["input"] ?? 0),
    output: Number(r["output"] ?? 0),
    cache_write: Number(r["cache_write"] ?? 0),
    cache_read: Number(r["cache_read"] ?? 0),
    turns: Number(r["turns"] ?? 0),
  }));
}
