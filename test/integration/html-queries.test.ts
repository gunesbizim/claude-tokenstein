import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";
import { runMigrations } from "../../src/db/migrate.js";
import { queryWeek, queryMonth, queryQuarter } from "../../src/reports/html-queries.js";

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

// Compute ISO week start (Monday) for a given UTC date
function isoWeekStart(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay();
  const diff = dow === 0 ? 6 : dow - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function utcDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} 10:00:00`;
}

function todayUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} 10:00:00`;
}

function quarterStartMonth(): number {
  return Math.floor(new Date().getUTCMonth() / 3) * 3 + 1;
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "tokenstein-html-q-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("queryWeek", () => {
  it("returns only rows from Mon of current ISO week", async () => {
    const { conn, db } = await freshConn("week-filter");
    const weekStart = isoWeekStart(new Date());
    const dayBefore = new Date(weekStart.getTime() - 86400000);
    const beforeStr = `${dayBefore.getUTCFullYear()}-${String(dayBefore.getUTCMonth() + 1).padStart(2, "0")}-${String(dayBefore.getUTCDate()).padStart(2, "0")} 10:00:00`;

    await insertMessage(conn, { ts: beforeStr, model: "model-a", input: 9999, output: 9999 });
    await insertMessage(conn, { ts: todayUtc(), model: "model-a", input: 100, output: 50 });

    const rows = await queryWeek(conn);
    const total = rows.reduce((s, r) => s + r.input, 0);
    expect(total).toBe(100);
    conn.closeSync(); db.closeSync();
  });

  it("groups by day + model — two models on same day give two rows", async () => {
    const { conn, db } = await freshConn("week-group");
    const ts = todayUtc();
    await insertMessage(conn, { ts, model: "model-a", input: 100, output: 50 });
    await insertMessage(conn, { ts, model: "model-b", input: 200, output: 100 });

    const rows = await queryWeek(conn);
    const models = [...new Set(rows.map((r) => r.model))];
    expect(models.length).toBe(2);
    conn.closeSync(); db.closeSync();
  });

  it("total_all = input + output + cache_write + cache_read", async () => {
    const { conn, db } = await freshConn("week-total-all");
    await insertMessage(conn, { ts: todayUtc(), model: "model-a", input: 100, output: 50, cache_write: 30, cache_read: 20 });

    const rows = await queryWeek(conn);
    expect(rows[0]?.total_all).toBe(200);
    conn.closeSync(); db.closeSync();
  });

  it("filters out <synthetic> model rows", async () => {
    const { conn, db } = await freshConn("week-synthetic");
    await insertMessage(conn, { ts: todayUtc(), model: "<synthetic>", input: 999, output: 999 });
    await insertMessage(conn, { ts: todayUtc(), model: "model-a", input: 50, output: 25 });

    const rows = await queryWeek(conn);
    expect(rows.every((r) => r.model !== "<synthetic>")).toBe(true);
    expect(rows.reduce((s, r) => s + r.input, 0)).toBe(50);
    conn.closeSync(); db.closeSync();
  });

  it("includes turns count per row", async () => {
    const { conn, db } = await freshConn("week-turns");
    const ts = todayUtc();
    await insertMessage(conn, { ts, model: "model-a", input: 10, output: 5 });
    await insertMessage(conn, { ts, model: "model-a", input: 20, output: 10 });

    const rows = await queryWeek(conn);
    const modelA = rows.find((r) => r.model === "model-a");
    expect(modelA?.turns).toBe(2);
    conn.closeSync(); db.closeSync();
  });
});

describe("queryMonth", () => {
  it("returns only rows from 1st of current month", async () => {
    const { conn, db } = await freshConn("month-filter");
    const now = new Date();
    const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const dayBefore = new Date(firstOfMonth.getTime() - 86400000);
    const beforeStr = `${dayBefore.getUTCFullYear()}-${String(dayBefore.getUTCMonth() + 1).padStart(2, "0")}-${String(dayBefore.getUTCDate()).padStart(2, "0")} 10:00:00`;

    await insertMessage(conn, { ts: beforeStr, model: "model-a", input: 9999, output: 0 });
    await insertMessage(conn, { ts: todayUtc(), model: "model-a", input: 42, output: 0 });

    const rows = await queryMonth(conn);
    expect(rows.reduce((s, r) => s + r.input, 0)).toBe(42);
    conn.closeSync(); db.closeSync();
  });

  it("returns empty when no data this month", async () => {
    const { conn, db } = await freshConn("month-empty");
    const now = new Date();
    const dayBefore = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    const beforeStr = `${dayBefore.getUTCFullYear()}-${String(dayBefore.getUTCMonth() + 1).padStart(2, "0")}-${String(dayBefore.getUTCDate()).padStart(2, "0")} 10:00:00`;
    await insertMessage(conn, { ts: beforeStr, model: "model-a", input: 100, output: 50 });

    const rows = await queryMonth(conn);
    expect(rows).toHaveLength(0);
    conn.closeSync(); db.closeSync();
  });
});

describe("queryQuarter", () => {
  it("returns rows from Q start, excludes data before Q start", async () => {
    const { conn, db } = await freshConn("quarter-filter");
    const now = new Date();
    const qStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
    const qStart = new Date(Date.UTC(now.getUTCFullYear(), qStartMonth, 1));
    const dayBefore = new Date(qStart.getTime() - 86400000);
    const beforeStr = `${dayBefore.getUTCFullYear()}-${String(dayBefore.getUTCMonth() + 1).padStart(2, "0")}-${String(dayBefore.getUTCDate()).padStart(2, "0")} 10:00:00`;

    await insertMessage(conn, { ts: beforeStr, model: "model-a", input: 9999, output: 0 });
    await insertMessage(conn, { ts: todayUtc(), model: "model-a", input: 77, output: 0 });

    const rows = await queryQuarter(conn);
    expect(rows.reduce((s, r) => s + r.input, 0)).toBe(77);
    conn.closeSync(); db.closeSync();
  });

  it("groups by ISO week + model — multiple days same week → one row per model", async () => {
    const { conn, db } = await freshConn("quarter-week-group");
    const now = new Date();
    const weekMon = isoWeekStart(now);
    const weekTue = new Date(weekMon.getTime() + 86400000);
    const monStr = `${weekMon.getUTCFullYear()}-${String(weekMon.getUTCMonth() + 1).padStart(2, "0")}-${String(weekMon.getUTCDate()).padStart(2, "0")} 09:00:00`;
    const tueStr = `${weekTue.getUTCFullYear()}-${String(weekTue.getUTCMonth() + 1).padStart(2, "0")}-${String(weekTue.getUTCDate()).padStart(2, "0")} 09:00:00`;

    await insertMessage(conn, { ts: monStr, model: "model-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: tueStr, model: "model-a", input: 200, output: 100 });

    const rows = await queryQuarter(conn);
    const modelA = rows.filter((r) => r.model === "model-a");
    expect(modelA.length).toBe(1);
    expect(modelA[0]?.input).toBe(300);
    conn.closeSync(); db.closeSync();
  });

  it("quarter boundary correct: Q start month = " + quarterStartMonth(), async () => {
    const { conn, db } = await freshConn("quarter-boundary");
    const now = new Date();
    const qStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
    const qStart = new Date(Date.UTC(now.getUTCFullYear(), qStartMonth, 1));
    const qStartStr = `${qStart.getUTCFullYear()}-${String(qStart.getUTCMonth() + 1).padStart(2, "0")}-01 00:00:01`;

    await insertMessage(conn, { ts: qStartStr, model: "model-a", input: 55, output: 0 });

    const rows = await queryQuarter(conn);
    expect(rows.reduce((s, r) => s + r.input, 0)).toBe(55);
    conn.closeSync(); db.closeSync();
  });
});
