import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";
import { runMigrations } from "../../src/db/migrate.js";
import {
  queryWeek,
  queryMonth,
  queryQuarter,
  queryTodayHtml,
  queryYtdHtml,
  queryLtdHtml,
  weekStart,
  monthStart,
  quarterStart,
  tomorrow,
} from "../../src/reports/html-queries.js";

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

// ---------------------------------------------------------------------------
// Date helpers (pure functions — no DB needed)
// ---------------------------------------------------------------------------

describe("weekStart", () => {
  it("Monday stays on the same day", () => {
    const monday = new Date(Date.UTC(2024, 0, 8)); // 2024-01-08 is Monday
    expect(weekStart(monday).toISOString()).toBe(monday.toISOString());
  });

  it("Sunday → previous Monday (dow===0 branch)", () => {
    const sunday = new Date(Date.UTC(2024, 0, 7)); // 2024-01-07 is Sunday
    const expected = new Date(Date.UTC(2024, 0, 1)); // 2024-01-01 is Monday
    expect(weekStart(sunday).toISOString()).toBe(expected.toISOString());
  });

  it("Wednesday → previous Monday", () => {
    const wed = new Date(Date.UTC(2024, 0, 10)); // 2024-01-10 is Wednesday
    const expected = new Date(Date.UTC(2024, 0, 8)); // 2024-01-08 Monday
    expect(weekStart(wed).toISOString()).toBe(expected.toISOString());
  });

  it("Saturday → previous Monday", () => {
    const sat = new Date(Date.UTC(2024, 0, 13)); // 2024-01-13 is Saturday
    const expected = new Date(Date.UTC(2024, 0, 8)); // 2024-01-08 Monday
    expect(weekStart(sat).toISOString()).toBe(expected.toISOString());
  });

  it("uses current date when no argument provided", () => {
    const result = weekStart();
    const dow = result.getUTCDay();
    expect(dow).toBe(1); // always a Monday
  });
});

describe("monthStart", () => {
  it("returns 1st of month at UTC midnight", () => {
    const d = new Date(Date.UTC(2024, 2, 15)); // March 15
    const ms = monthStart(d);
    expect(ms.getUTCFullYear()).toBe(2024);
    expect(ms.getUTCMonth()).toBe(2); // March
    expect(ms.getUTCDate()).toBe(1);
    expect(ms.getUTCHours()).toBe(0);
  });

  it("works on the 1st — returns same date", () => {
    const d = new Date(Date.UTC(2024, 0, 1)); // Jan 1
    expect(monthStart(d).toISOString()).toBe(d.toISOString());
  });

  it("uses current date when no argument provided", () => {
    const result = monthStart();
    expect(result.getUTCDate()).toBe(1);
  });
});

describe("quarterStart", () => {
  it("Q1 (Jan) → Jan 1", () => {
    const d = new Date(Date.UTC(2024, 0, 15)); // Jan 15
    const qs = quarterStart(d);
    expect(qs.getUTCMonth()).toBe(0);
    expect(qs.getUTCDate()).toBe(1);
  });

  it("Q1 (Feb) → Jan 1", () => {
    const d = new Date(Date.UTC(2024, 1, 20)); // Feb 20
    expect(quarterStart(d).getUTCMonth()).toBe(0);
  });

  it("Q1 (Mar) → Jan 1", () => {
    const d = new Date(Date.UTC(2024, 2, 31)); // Mar 31
    expect(quarterStart(d).getUTCMonth()).toBe(0);
  });

  it("Q2 (Apr) → Apr 1", () => {
    const d = new Date(Date.UTC(2024, 3, 1)); // Apr 1
    expect(quarterStart(d).getUTCMonth()).toBe(3);
  });

  it("Q3 (Jul) → Jul 1", () => {
    const d = new Date(Date.UTC(2024, 6, 4)); // Jul 4
    expect(quarterStart(d).getUTCMonth()).toBe(6);
  });

  it("Q4 (Oct) → Oct 1", () => {
    const d = new Date(Date.UTC(2024, 9, 31)); // Oct 31
    const qs = quarterStart(d);
    expect(qs.getUTCMonth()).toBe(9);
    expect(qs.getUTCDate()).toBe(1);
  });

  it("Q4 (Dec) → Oct 1 same year", () => {
    const d = new Date(Date.UTC(2024, 11, 31)); // Dec 31
    const qs = quarterStart(d);
    expect(qs.getUTCFullYear()).toBe(2024);
    expect(qs.getUTCMonth()).toBe(9); // Oct
  });

  it("uses current date when no argument provided", () => {
    const result = quarterStart();
    expect(result.getUTCDate()).toBe(1);
    expect([0, 3, 6, 9]).toContain(result.getUTCMonth());
  });
});

describe("tomorrow", () => {
  it("advances date by exactly 1 UTC day", () => {
    const d = new Date(Date.UTC(2024, 0, 31)); // Jan 31
    const t = tomorrow(d);
    expect(t.getUTCFullYear()).toBe(2024);
    expect(t.getUTCMonth()).toBe(1); // Feb
    expect(t.getUTCDate()).toBe(1);
  });

  it("rolls over year boundary", () => {
    const d = new Date(Date.UTC(2023, 11, 31)); // Dec 31
    const t = tomorrow(d);
    expect(t.getUTCFullYear()).toBe(2024);
    expect(t.getUTCMonth()).toBe(0); // Jan
    expect(t.getUTCDate()).toBe(1);
  });

  it("uses current date when no argument provided", () => {
    const before = new Date();
    const result = tomorrow();
    // tomorrow() should be at least 1 day after now
    expect(result.getTime()).toBeGreaterThan(before.getTime());
  });
});

// ---------------------------------------------------------------------------
// queryTodayHtml — basic integration smoke test
// ---------------------------------------------------------------------------

describe("queryTodayHtml", () => {
  it("returns only today's rows", async () => {
    const { conn, db } = await freshConn("today-html-basic");
    await insertMessage(conn, { ts: todayUtc(), model: "model-a", input: 77, output: 33 });
    // Insert yesterday — should be excluded
    await insertMessage(conn, { ts: utcDaysAgo(1), model: "model-a", input: 9999, output: 9999 });

    const rows = await queryTodayHtml(conn);
    expect(rows.reduce((s, r) => s + r.input, 0)).toBe(77);
    conn.closeSync(); db.closeSync();
  });

  it("returns empty when no messages today", async () => {
    const { conn, db } = await freshConn("today-html-empty");
    await insertMessage(conn, { ts: utcDaysAgo(1), model: "model-a", input: 50, output: 10 });

    const rows = await queryTodayHtml(conn);
    expect(rows).toHaveLength(0);
    conn.closeSync(); db.closeSync();
  });

  it("includes turns count", async () => {
    const { conn, db } = await freshConn("today-html-turns");
    const ts = todayUtc();
    await insertMessage(conn, { ts, model: "model-a", input: 10, output: 5 });
    await insertMessage(conn, { ts, model: "model-a", input: 20, output: 10 });

    const rows = await queryTodayHtml(conn);
    expect(rows[0]?.turns).toBe(2);
    conn.closeSync(); db.closeSync();
  });
});

// ---------------------------------------------------------------------------
// queryYtdHtml — basic integration smoke test
// ---------------------------------------------------------------------------

describe("queryYtdHtml", () => {
  it("includes data from Jan 1 of current year", async () => {
    const { conn, db } = await freshConn("ytd-html-basic");
    const now = new Date();
    const jan1 = `${now.getUTCFullYear()}-01-01 06:00:00`;
    await insertMessage(conn, { ts: jan1, model: "model-a", input: 111, output: 22 });
    await insertMessage(conn, { ts: todayUtc(), model: "model-a", input: 333, output: 44 });

    const rows = await queryYtdHtml(conn);
    expect(rows.reduce((s, r) => s + r.input, 0)).toBe(444);
    conn.closeSync(); db.closeSync();
  });

  it("excludes data from previous year", async () => {
    const { conn, db } = await freshConn("ytd-html-prev-year");
    const now = new Date();
    const prevYear = `${now.getUTCFullYear() - 1}-12-31 23:59:59`;
    await insertMessage(conn, { ts: prevYear, model: "model-a", input: 9999, output: 9999 });
    await insertMessage(conn, { ts: todayUtc(), model: "model-a", input: 42, output: 10 });

    const rows = await queryYtdHtml(conn);
    expect(rows.reduce((s, r) => s + r.input, 0)).toBe(42);
    conn.closeSync(); db.closeSync();
  });

  it("returns empty when no data this year", async () => {
    const { conn, db } = await freshConn("ytd-html-empty");
    const now = new Date();
    const prevYear = `${now.getUTCFullYear() - 1}-06-15 10:00:00`;
    await insertMessage(conn, { ts: prevYear, model: "model-a", input: 100, output: 50 });

    const rows = await queryYtdHtml(conn);
    expect(rows).toHaveLength(0);
    conn.closeSync(); db.closeSync();
  });
});

// ---------------------------------------------------------------------------
// queryLtdHtml — basic integration + ?? fallback via nullable schema
// ---------------------------------------------------------------------------

describe("queryLtdHtml", () => {
  it("returns rows grouped by YYYY-MM", async () => {
    const { conn, db } = await freshConn("ltd-html-basic");
    await insertMessage(conn, { ts: "2024-01-15 10:00:00", model: "model-a", input: 100, output: 50 });
    await insertMessage(conn, { ts: "2024-02-20 10:00:00", model: "model-a", input: 200, output: 80 });
    await insertMessage(conn, { ts: "2024-02-25 10:00:00", model: "model-b", input: 30, output: 10 });

    const rows = await queryLtdHtml(conn);
    const jan = rows.filter((r) => r.day === "2024-01");
    const feb = rows.filter((r) => r.day === "2024-02");
    expect(jan).toHaveLength(1);
    expect(jan[0]?.input).toBe(100);
    expect(feb).toHaveLength(2); // two models
    expect(feb.reduce((s, r) => s + r.input, 0)).toBe(230);
    conn.closeSync(); db.closeSync();
  });

  it("returns empty when no messages exist", async () => {
    const { conn, db } = await freshConn("ltd-html-empty");
    const rows = await queryLtdHtml(conn);
    expect(rows).toHaveLength(0);
    conn.closeSync(); db.closeSync();
  });

  it("filters out <synthetic> model rows", async () => {
    const { conn, db } = await freshConn("ltd-html-synthetic");
    await insertMessage(conn, { ts: "2024-03-10 10:00:00", model: "<synthetic>", input: 9999, output: 9999 });
    await insertMessage(conn, { ts: "2024-03-10 10:00:00", model: "model-a", input: 55, output: 10 });

    const rows = await queryLtdHtml(conn);
    expect(rows.every((r) => r.model !== "<synthetic>")).toBe(true);
    expect(rows.reduce((s, r) => s + r.input, 0)).toBe(55);
    conn.closeSync(); db.closeSync();
  });

  it("includes turns count per month+model group", async () => {
    const { conn, db } = await freshConn("ltd-html-turns");
    await insertMessage(conn, { ts: "2024-04-01 10:00:00", model: "model-a", input: 10, output: 5 });
    await insertMessage(conn, { ts: "2024-04-15 12:00:00", model: "model-a", input: 20, output: 8 });

    const rows = await queryLtdHtml(conn);
    expect(rows[0]?.turns).toBe(2);
    conn.closeSync(); db.closeSync();
  });

  it("total_all = input + output + cache_write + cache_read", async () => {
    const { conn, db } = await freshConn("ltd-html-total-all");
    await insertMessage(conn, {
      ts: "2024-05-10 10:00:00", model: "model-a",
      input: 100, output: 50, cache_write: 30, cache_read: 20,
    });

    const rows = await queryLtdHtml(conn);
    expect(rows[0]?.total_all).toBe(200);
    conn.closeSync(); db.closeSync();
  });
});

// ---------------------------------------------------------------------------
// ?? fallback branches — recreate messages table without NOT NULL constraints
// so that SUM() of all-NULL groups returns NULL, triggering the ?? 0 paths
// in both runPeriodQuery.map and queryLtdHtml.map
// ---------------------------------------------------------------------------

async function freshConnNullable(name: string): Promise<{ db: DuckDBInstance; conn: DuckDBConnection }> {
  const db = await DuckDBInstance.create(join(tmpDir, `${name}.duckdb`));
  const conn = await db.connect();
  await runMigrations(conn);
  // Recreate messages without NOT NULL on token columns so we can insert NULLs
  await conn.run(`DROP TABLE messages CASCADE`);
  await conn.run(`
    CREATE TABLE messages (
      id              UUID PRIMARY KEY,
      session_id      VARCHAR NOT NULL,
      project_cwd     VARCHAR NOT NULL,
      git_branch      VARCHAR,
      ts              TIMESTAMP NOT NULL,
      model           VARCHAR NOT NULL,
      service_tier    VARCHAR,
      request_id      VARCHAR,
      claude_version  VARCHAR,
      source          VARCHAR NOT NULL,
      input_tokens                BIGINT,
      output_tokens               BIGINT,
      cache_creation_input_tokens BIGINT,
      cache_read_input_tokens     BIGINT
    )
  `);
  return { db, conn };
}

async function insertNullableMessage(
  conn: DuckDBConnection,
  opts: { ts: string; model: string },
): Promise<void> {
  await conn.run(
    `INSERT INTO messages (id, session_id, project_cwd, ts, model, source,
       input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)
     VALUES (gen_random_uuid(), 'test-session', '/test', ?::TIMESTAMP, ?, 'test', NULL, NULL, NULL, NULL)`,
    [opts.ts, opts.model],
  );
}

describe("?? fallback branches — runPeriodQuery (queryWeek path)", () => {
  it("null token columns default to 0 in returned row", async () => {
    const { conn, db } = await freshConnNullable("null-period-week");
    await insertNullableMessage(conn, { ts: todayUtc(), model: "model-a" });

    const rows = await queryWeek(conn);
    // SUM(NULL) = NULL → ?? 0 fires for every numeric column
    expect(rows).toHaveLength(1);
    expect(rows[0]?.input).toBe(0);
    expect(rows[0]?.output).toBe(0);
    expect(rows[0]?.cache_write).toBe(0);
    expect(rows[0]?.cache_read).toBe(0);
    expect(rows[0]?.total).toBe(0);
    expect(rows[0]?.total_all).toBe(0);
    expect(rows[0]?.turns).toBe(1); // COUNT(*) is never NULL
    expect(rows[0]?.day).toBeTruthy();
    expect(rows[0]?.model).toBe("model-a");
    conn.closeSync(); db.closeSync();
  });
});

describe("?? fallback branches — queryLtdHtml path", () => {
  it("null token columns default to 0 in returned row", async () => {
    const { conn, db } = await freshConnNullable("null-ltd");
    await insertNullableMessage(conn, { ts: "2024-06-15 10:00:00", model: "model-a" });

    const rows = await queryLtdHtml(conn);
    // SUM(NULL) = NULL → ?? 0 fires for every numeric column
    expect(rows).toHaveLength(1);
    expect(rows[0]?.input).toBe(0);
    expect(rows[0]?.output).toBe(0);
    expect(rows[0]?.cache_write).toBe(0);
    expect(rows[0]?.cache_read).toBe(0);
    expect(rows[0]?.total).toBe(0);
    expect(rows[0]?.total_all).toBe(0);
    expect(rows[0]?.turns).toBe(1);
    expect(rows[0]?.day).toBe("2024-06");
    expect(rows[0]?.model).toBe("model-a");
    conn.closeSync(); db.closeSync();
  });
});
