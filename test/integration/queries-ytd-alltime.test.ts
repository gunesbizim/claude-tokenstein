import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBInstance } from "@duckdb/node-api";
import { runMigrations } from "../../src/db/migrate.js";
import { queryYTD, queryAllTime } from "../../src/reports/queries.js";
import { renderYTDCommand } from "../../src/reports/ytd.js";
import { renderAllTimeCommand } from "../../src/reports/alltime.js";
import type { DuckDBConnection } from "@duckdb/node-api";

let tmpDir: string;

async function freshConn(name: string): Promise<{ db: DuckDBInstance; conn: DuckDBConnection }> {
  const db = await DuckDBInstance.create(join(tmpDir, `${name}.duckdb`));
  const conn = await db.connect();
  await runMigrations(conn);
  return { db, conn };
}

async function insertMessage(
  conn: DuckDBConnection,
  opts: { ts: string; model: string; input: number; output: number; cache_write?: number; cache_read?: number },
): Promise<void> {
  const { ts, model, input, output, cache_write = 0, cache_read = 0 } = opts;
  await conn.run(
    `INSERT INTO messages (id, session_id, project_cwd, ts, model, source,
       input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)
     VALUES (gen_random_uuid(), 'test-session', '/test', ?::TIMESTAMP, ?, 'test', ?, ?, ?, ?)`,
    [ts, model, input, output, cache_write, cache_read],
  );
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "tokenstein-ytd-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const CURRENT_YEAR = new Date().getFullYear();
const PREV_YEAR = CURRENT_YEAR - 1;

describe("queryYTD", () => {
  it("returns only rows from Jan 1 of the current year", async () => {
    const { conn, db } = await freshConn("ytd-filter");

    await insertMessage(conn, { ts: `${PREV_YEAR}-12-15 10:00:00`, model: "model-a", input: 1000, output: 500 });
    await insertMessage(conn, { ts: `${CURRENT_YEAR}-01-10 10:00:00`, model: "model-a", input: 200, output: 100 });
    await insertMessage(conn, { ts: `${CURRENT_YEAR}-03-20 10:00:00`, model: "model-a", input: 400, output: 200 });

    const rows = await queryYTD(conn);
    expect(rows.every((r) => r.day.startsWith(String(CURRENT_YEAR)))).toBe(true);
    const totalInput = rows.reduce((s, r) => s + r.input, 0);
    expect(totalInput).toBe(600);

    conn.closeSync();
    db.closeSync();
  });

  it("returns empty array when no data in current year", async () => {
    const { conn, db } = await freshConn("ytd-empty");

    await insertMessage(conn, { ts: `${PREV_YEAR}-06-01 10:00:00`, model: "model-a", input: 100, output: 50 });

    const rows = await queryYTD(conn);
    expect(rows).toHaveLength(0);

    conn.closeSync();
    db.closeSync();
  });

  it("groups by day and model", async () => {
    const { conn, db } = await freshConn("ytd-group");

    const day = `${CURRENT_YEAR}-02-14`;
    await insertMessage(conn, { ts: `${day} 09:00:00`, model: "model-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: `${day} 11:00:00`, model: "model-a", input: 200, output: 100 });
    await insertMessage(conn, { ts: `${day} 12:00:00`, model: "model-b", input: 300, output: 150 });

    const rows = await queryYTD(conn);
    const modelA = rows.find((r) => r.day === day && r.model === "model-a");
    const modelB = rows.find((r) => r.day === day && r.model === "model-b");

    expect(modelA?.input).toBe(300);
    expect(modelA?.output).toBe(150);
    expect(modelA?.total).toBe(450);
    expect(modelB?.input).toBe(300);

    conn.closeSync();
    db.closeSync();
  });

  it("total field equals input + output", async () => {
    const { conn, db } = await freshConn("ytd-total");

    await insertMessage(conn, { ts: `${CURRENT_YEAR}-04-01 10:00:00`, model: "model-a", input: 1234, output: 5678 });

    const rows = await queryYTD(conn);
    expect(rows[0]?.total).toBe(1234 + 5678);

    conn.closeSync();
    db.closeSync();
  });
});

describe("queryAllTime", () => {
  it("returns rows from all years grouped by month", async () => {
    const { conn, db } = await freshConn("alltime-years");

    await insertMessage(conn, { ts: `${PREV_YEAR}-06-15 10:00:00`, model: "model-a", input: 500, output: 250 });
    await insertMessage(conn, { ts: `${CURRENT_YEAR}-01-20 10:00:00`, model: "model-a", input: 800, output: 400 });
    await insertMessage(conn, { ts: `${CURRENT_YEAR}-03-10 10:00:00`, model: "model-a", input: 600, output: 300 });

    const rows = await queryAllTime(conn);
    const months = rows.map((r) => r.month);
    expect(months).toContain(`${PREV_YEAR}-06`);
    expect(months).toContain(`${CURRENT_YEAR}-01`);
    expect(months).toContain(`${CURRENT_YEAR}-03`);

    conn.closeSync();
    db.closeSync();
  });

  it("aggregates multiple days in the same month into one row per model", async () => {
    const { conn, db } = await freshConn("alltime-month-agg");

    await insertMessage(conn, { ts: `${CURRENT_YEAR}-02-01 10:00:00`, model: "model-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: `${CURRENT_YEAR}-02-15 10:00:00`, model: "model-a", input: 200, output: 100 });
    await insertMessage(conn, { ts: `${CURRENT_YEAR}-02-28 10:00:00`, model: "model-a", input: 300, output: 150 });

    const rows = await queryAllTime(conn);
    const feb = rows.filter((r) => r.month === `${CURRENT_YEAR}-02` && r.model === "model-a");
    expect(feb).toHaveLength(1);
    expect(feb[0]?.input).toBe(600);
    expect(feb[0]?.total).toBe(900);

    conn.closeSync();
    db.closeSync();
  });

  it("returns empty array for empty DB", async () => {
    const { conn, db } = await freshConn("alltime-empty");
    const rows = await queryAllTime(conn);
    expect(rows).toHaveLength(0);
    conn.closeSync();
    db.closeSync();
  });
});

describe("renderYTDCommand", () => {
  it("returns no-data message when DB empty for current year", async () => {
    const { conn, db } = await freshConn("render-ytd-empty");
    const out = await renderYTDCommand(conn, {}, "usd", 1);
    expect(out).toBe("No data for this year.");
    conn.closeSync();
    db.closeSync();
  });

  it("includes year and token total in header", async () => {
    const { conn, db } = await freshConn("render-ytd-header");
    await insertMessage(conn, { ts: `${CURRENT_YEAR}-04-01 10:00:00`, model: "model-a", input: 1000, output: 500 });
    const out = await renderYTDCommand(conn, {}, "usd", 1);
    expect(out).toContain(`YTD ${CURRENT_YEAR}`);
    expect(out).toContain("1,500");
    conn.closeSync();
    db.closeSync();
  });
});

describe("renderAllTimeCommand", () => {
  it("returns no-data message when DB empty", async () => {
    const { conn, db } = await freshConn("render-alltime-empty");
    const out = await renderAllTimeCommand(conn, {}, "usd", 1);
    expect(out).toBe("No data found.");
    conn.closeSync();
    db.closeSync();
  });

  it("header contains date span", async () => {
    const { conn, db } = await freshConn("render-alltime-span");
    await insertMessage(conn, { ts: `${PREV_YEAR}-11-01 10:00:00`, model: "model-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: `${CURRENT_YEAR}-03-01 10:00:00`, model: "model-a", input: 200, output: 100 });
    const out = await renderAllTimeCommand(conn, {}, "usd", 1);
    expect(out).toContain(`${PREV_YEAR}-11`);
    expect(out).toContain(`${CURRENT_YEAR}-03`);
    conn.closeSync();
    db.closeSync();
  });
});
