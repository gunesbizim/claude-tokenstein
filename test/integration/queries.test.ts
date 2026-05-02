import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";
import { runMigrations } from "../../src/db/migrate.js";
import {
  queryReport,
  queryToday,
  querySession,
  queryHourly,
  queryTop,
  queryCost,
} from "../../src/reports/queries.js";

let tmpDir: string;

async function freshConn(name: string): Promise<{ db: DuckDBInstance; conn: DuckDBConnection }> {
  const db = await DuckDBInstance.create(join(tmpDir, `${name}.duckdb`));
  const conn = await db.connect();
  await runMigrations(conn);
  return { db, conn };
}

async function insertMessage(
  conn: DuckDBConnection,
  opts: {
    ts: string;
    model: string;
    input: number;
    output: number;
    cache_write?: number;
    cache_read?: number;
    session_id?: string;
    project_cwd?: string;
  },
): Promise<void> {
  const {
    ts, model, input, output,
    cache_write = 0, cache_read = 0,
    session_id = "test-session",
    project_cwd = "/test",
  } = opts;
  await conn.run(
    `INSERT INTO messages (id, session_id, project_cwd, ts, model, source,
       input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)
     VALUES (gen_random_uuid(), ?, ?, ?::TIMESTAMP, ?, 'test', ?, ?, ?, ?)`,
    [session_id, project_cwd, ts, model, input, output, cache_write, cache_read],
  );
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "tokenstein-q-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const TODAY = new Date();
const today = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`;

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("queryReport", () => {
  it("returns rows from the last N days", async () => {
    const { conn, db } = await freshConn("report-window");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: `${daysAgo(2)} 10:00:00`, model: "m-a", input: 200, output: 100 });
    await insertMessage(conn, { ts: `${daysAgo(10)} 10:00:00`, model: "m-a", input: 9999, output: 0 });

    const rows = await queryReport(conn, 7);
    const totalInput = rows.reduce((s, r) => s + r.input, 0);
    expect(totalInput).toBe(300);

    conn.closeSync();
    db.closeSync();
  });

  it("returns empty for empty DB", async () => {
    const { conn, db } = await freshConn("report-empty");
    const rows = await queryReport(conn, 30);
    expect(rows).toHaveLength(0);
    conn.closeSync();
    db.closeSync();
  });

  it("groups by day + model", async () => {
    const { conn, db } = await freshConn("report-group");
    await insertMessage(conn, { ts: `${today} 09:00:00`, model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "m-a", input: 200, output: 100 });
    await insertMessage(conn, { ts: `${today} 12:00:00`, model: "m-b", input: 300, output: 150 });

    const rows = await queryReport(conn, 7);
    const aRow = rows.find((r) => r.day === today && r.model === "m-a");
    const bRow = rows.find((r) => r.day === today && r.model === "m-b");
    expect(aRow?.input).toBe(300);
    expect(bRow?.input).toBe(300);

    conn.closeSync();
    db.closeSync();
  });

  it("total_all = input + output + cache_write + cache_read", async () => {
    const { conn, db } = await freshConn("report-total-all");
    await insertMessage(conn, {
      ts: `${today} 10:00:00`, model: "m-a",
      input: 100, output: 50, cache_write: 30, cache_read: 20,
    });

    const rows = await queryReport(conn, 7);
    expect(rows[0]?.total_all).toBe(200);
    expect(rows[0]?.total).toBe(150);

    conn.closeSync();
    db.closeSync();
  });
});

describe("queryToday", () => {
  it("returns rows from today only", async () => {
    const { conn, db } = await freshConn("today-window");
    await insertMessage(conn, { ts: `${today} 09:00:00`, model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: `${daysAgo(2)} 12:00:00`, model: "m-a", input: 9999, output: 0 });

    const rows = await queryToday(conn);
    expect(rows.reduce((s, r) => s + r.input, 0)).toBe(100);

    conn.closeSync();
    db.closeSync();
  });

  it("returns empty when no data today", async () => {
    const { conn, db } = await freshConn("today-empty");
    await insertMessage(conn, { ts: `${daysAgo(2)} 10:00:00`, model: "m-a", input: 100, output: 50 });

    const rows = await queryToday(conn);
    expect(rows).toHaveLength(0);

    conn.closeSync();
    db.closeSync();
  });

  it("groups by model", async () => {
    const { conn, db } = await freshConn("today-group");
    await insertMessage(conn, { ts: `${today} 09:00:00`, model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 200, output: 100 });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "m-b", input: 50, output: 25 });

    const rows = await queryToday(conn);
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.model === "m-a");
    expect(a?.input).toBe(300);

    conn.closeSync();
    db.closeSync();
  });

  it("includes turns count", async () => {
    const { conn, db } = await freshConn("today-turns");
    await insertMessage(conn, { ts: `${today} 09:00:00`, model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "m-a", input: 100, output: 50 });

    const rows = await queryToday(conn);
    expect(rows[0]?.turns).toBe(3);

    conn.closeSync();
    db.closeSync();
  });

  it("orders by total tokens desc", async () => {
    const { conn, db } = await freshConn("today-order");
    await insertMessage(conn, { ts: `${today} 09:00:00`, model: "small", input: 10, output: 5 });
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "big", input: 1000, output: 500 });

    const rows = await queryToday(conn);
    expect(rows[0]?.model).toBe("big");
    expect(rows[1]?.model).toBe("small");

    conn.closeSync();
    db.closeSync();
  });
});

describe("querySession", () => {
  it("returns rows for given session id", async () => {
    const { conn, db } = await freshConn("session-id");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50, session_id: "abc" });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "m-a", input: 200, output: 100, session_id: "abc" });
    await insertMessage(conn, { ts: `${today} 12:00:00`, model: "m-a", input: 9999, output: 0, session_id: "xyz" });

    const rows = await querySession(conn, "abc");
    expect(rows[0]?.input).toBe(300);

    conn.closeSync();
    db.closeSync();
  });

  it("returns empty for unknown session id", async () => {
    const { conn, db } = await freshConn("session-missing");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50, session_id: "abc" });

    const rows = await querySession(conn, "does-not-exist");
    expect(rows).toHaveLength(0);

    conn.closeSync();
    db.closeSync();
  });

  it("groups by model with turns count", async () => {
    const { conn, db } = await freshConn("session-group");
    await insertMessage(conn, { ts: `${today} 09:00:00`, model: "m-a", input: 100, output: 50, session_id: "s" });
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50, session_id: "s" });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "m-b", input: 100, output: 50, session_id: "s" });

    const rows = await querySession(conn, "s");
    expect(rows).toHaveLength(2);
    const a = rows.find((r) => r.model === "m-a");
    expect(a?.turns).toBe(2);

    conn.closeSync();
    db.closeSync();
  });

  it("includes cache_write and cache_read fields", async () => {
    const { conn, db } = await freshConn("session-cache");
    await insertMessage(conn, {
      ts: `${today} 10:00:00`, model: "m-a",
      input: 0, output: 0, cache_write: 500, cache_read: 1000,
      session_id: "cache-sess",
    });

    const rows = await querySession(conn, "cache-sess");
    expect(rows[0]?.cache_write).toBe(500);
    expect(rows[0]?.cache_read).toBe(1000);

    conn.closeSync();
    db.closeSync();
  });
});

describe("queryHourly", () => {
  it("returns rows from the last 24 hours", async () => {
    const { conn, db } = await freshConn("hourly-window");
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600_000);
    const ago25h = new Date(now.getTime() - 25 * 3600_000);

    await insertMessage(conn, { ts: oneHourAgo.toISOString(), model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: ago25h.toISOString(), model: "m-a", input: 9999, output: 0 });

    const rows = await queryHourly(conn);
    const total = rows.reduce((s, r) => s + r.total, 0);
    expect(total).toBe(150);

    conn.closeSync();
    db.closeSync();
  });

  it("total includes cache tokens", async () => {
    const { conn, db } = await freshConn("hourly-cache");
    const oneHourAgo = new Date(Date.now() - 3600_000);

    await insertMessage(conn, {
      ts: oneHourAgo.toISOString(), model: "m-a",
      input: 100, output: 50, cache_write: 200, cache_read: 300,
    });

    const rows = await queryHourly(conn);
    expect(rows[0]?.total).toBe(650);

    conn.closeSync();
    db.closeSync();
  });

  it("returns empty when DB has no recent data", async () => {
    const { conn, db } = await freshConn("hourly-empty");
    const ago30h = new Date(Date.now() - 30 * 3600_000);
    await insertMessage(conn, { ts: ago30h.toISOString(), model: "m-a", input: 100, output: 50 });

    const rows = await queryHourly(conn);
    expect(rows).toHaveLength(0);

    conn.closeSync();
    db.closeSync();
  });

  it("orders by hour ascending", async () => {
    const { conn, db } = await freshConn("hourly-order");
    const now = new Date();
    const ago3h = new Date(now.getTime() - 3 * 3600_000);
    const ago1h = new Date(now.getTime() - 1 * 3600_000);
    const ago5h = new Date(now.getTime() - 5 * 3600_000);

    await insertMessage(conn, { ts: ago3h.toISOString(), model: "m-a", input: 100, output: 0 });
    await insertMessage(conn, { ts: ago1h.toISOString(), model: "m-a", input: 200, output: 0 });
    await insertMessage(conn, { ts: ago5h.toISOString(), model: "m-a", input: 50, output: 0 });

    const rows = await queryHourly(conn);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.hour >= rows[i - 1]!.hour).toBe(true);
    }

    conn.closeSync();
    db.closeSync();
  });

  it("returns hour as ISO-like string", async () => {
    const { conn, db } = await freshConn("hourly-format");
    const oneHourAgo = new Date(Date.now() - 3600_000);

    await insertMessage(conn, { ts: oneHourAgo.toISOString(), model: "m-a", input: 100, output: 0 });

    const rows = await queryHourly(conn);
    expect(rows[0]?.hour).toMatch(/^\d{4}-\d{2}-\d{2}/);

    conn.closeSync();
    db.closeSync();
  });
});

describe("queryTop", () => {
  it("by='model' returns top N models by total tokens", async () => {
    const { conn, db } = await freshConn("top-model");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "small", input: 10, output: 0 });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "medium", input: 100, output: 0 });
    await insertMessage(conn, { ts: `${today} 12:00:00`, model: "big", input: 1000, output: 0 });

    const rows = await queryTop(conn, "model", 2);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.bucket).toBe("big");
    expect(rows[1]?.bucket).toBe("medium");

    conn.closeSync();
    db.closeSync();
  });

  it("by='session' groups by session_id", async () => {
    const { conn, db } = await freshConn("top-session");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m", input: 100, output: 0, session_id: "s1" });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "m", input: 200, output: 0, session_id: "s2" });

    const rows = await queryTop(conn, "session", 5);
    const s2Row = rows.find((r) => r.bucket === "s2");
    expect(s2Row?.total_tokens).toBe(200);

    conn.closeSync();
    db.closeSync();
  });

  it("by='project' groups by project_cwd", async () => {
    const { conn, db } = await freshConn("top-project");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m", input: 100, output: 0, project_cwd: "/proj-a" });
    await insertMessage(conn, { ts: `${today} 11:00:00`, model: "m", input: 50, output: 0, project_cwd: "/proj-b" });

    const rows = await queryTop(conn, "project", 5);
    expect(rows.find((r) => r.bucket === "/proj-a")?.total_tokens).toBe(100);

    conn.closeSync();
    db.closeSync();
  });

  it("invalid by throws", async () => {
    const { conn, db } = await freshConn("top-invalid");
    await expect(queryTop(conn, "garbage", 5)).rejects.toThrow();
    conn.closeSync();
    db.closeSync();
  });

  it("respects N limit", async () => {
    const { conn, db } = await freshConn("top-limit");
    for (let i = 0; i < 10; i++) {
      await insertMessage(conn, {
        ts: `${today} 10:00:00`, model: `m-${i}`, input: 100 + i, output: 0,
      });
    }
    const rows = await queryTop(conn, "model", 3);
    expect(rows).toHaveLength(3);
    conn.closeSync();
    db.closeSync();
  });

  it("total includes cache tokens", async () => {
    const { conn, db } = await freshConn("top-cache");
    await insertMessage(conn, {
      ts: `${today} 10:00:00`, model: "m",
      input: 100, output: 50, cache_write: 200, cache_read: 300,
    });
    const rows = await queryTop(conn, "model", 5);
    expect(rows[0]?.total_tokens).toBe(650);
    conn.closeSync();
    db.closeSync();
  });
});

describe("queryCost", () => {
  it("returns rows for given year+month", async () => {
    const { conn, db } = await freshConn("cost-month");
    const yyyy = TODAY.getFullYear();
    const mm = TODAY.getMonth() + 1;
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50 });

    const rows = await queryCost(conn, yyyy, mm);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.input).toBeGreaterThanOrEqual(100);

    conn.closeSync();
    db.closeSync();
  });

  it("excludes other months", async () => {
    const { conn, db } = await freshConn("cost-exclude");
    await insertMessage(conn, { ts: "2025-01-15 10:00:00", model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: "2025-02-15 10:00:00", model: "m-a", input: 9999, output: 0 });

    const rows = await queryCost(conn, 2025, 1);
    const total = rows.reduce((s, r) => s + r.input, 0);
    expect(total).toBe(100);

    conn.closeSync();
    db.closeSync();
  });

  it("returns empty for month with no data", async () => {
    const { conn, db } = await freshConn("cost-empty");
    const rows = await queryCost(conn, 1999, 1);
    expect(rows).toHaveLength(0);
    conn.closeSync();
    db.closeSync();
  });

  it("groups by model with turns count", async () => {
    const { conn, db } = await freshConn("cost-group");
    await insertMessage(conn, { ts: "2025-03-01 10:00:00", model: "m-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: "2025-03-15 10:00:00", model: "m-a", input: 200, output: 100 });
    await insertMessage(conn, { ts: "2025-03-20 10:00:00", model: "m-b", input: 50, output: 25 });

    const rows = await queryCost(conn, 2025, 3);
    const a = rows.find((r) => r.model === "m-a");
    expect(a?.input).toBe(300);
    expect(a?.turns).toBe(2);

    conn.closeSync();
    db.closeSync();
  });

  it("populates cache_write and cache_read fields", async () => {
    const { conn, db } = await freshConn("cost-cache");
    await insertMessage(conn, {
      ts: "2025-04-01 10:00:00", model: "m-a",
      input: 100, output: 50, cache_write: 1000, cache_read: 5000,
    });
    const rows = await queryCost(conn, 2025, 4);
    expect(rows[0]?.cache_write).toBe(1000);
    expect(rows[0]?.cache_read).toBe(5000);
    conn.closeSync();
    db.closeSync();
  });
});
