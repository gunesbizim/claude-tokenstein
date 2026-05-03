import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";
import { runMigrations } from "../../src/db/migrate.js";
import { renderTodayCommand, collectTodayCommand } from "../../src/reports/today.js";
import { renderSessionCommand } from "../../src/reports/session.js";
import { renderHourlyCommand, collectHourlyCommand } from "../../src/reports/hourly.js";
import { renderTopCommand, collectTopCommand } from "../../src/reports/top.js";
import { renderCostCommand, collectCostCommand } from "../../src/reports/cost.js";
import type { PriceTable } from "../../src/pricing/types.js";

const PRICES: PriceTable = {
  "m-a": { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
};

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
  tmpDir = await mkdtemp(join(tmpdir(), "tokenstein-rc-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const TODAY = new Date();
const today = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`;

describe("renderTodayCommand", () => {
  it("returns 'No usage recorded today.' when DB empty", async () => {
    const { conn, db } = await freshConn("render-today-empty");
    const out = await renderTodayCommand(conn, PRICES, "usd", 1);
    expect(out).toBe("No usage recorded today.");
    conn.closeSync(); db.closeSync();
  });

  it("returns header + table when data exists", async () => {
    const { conn, db } = await freshConn("render-today-data");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 1000, output: 500 });
    const out = await renderTodayCommand(conn, PRICES, "usd", 1);
    expect(out).toContain("Today");
    expect(out).toContain("m-a");
    conn.closeSync(); db.closeSync();
  });

  it("header total includes all four token types", async () => {
    const { conn, db } = await freshConn("render-today-totalall");
    await insertMessage(conn, {
      ts: `${today} 10:00:00`, model: "m-a",
      input: 100, output: 50, cache_write: 200, cache_read: 300,
    });
    const out = await renderTodayCommand(conn, PRICES, "usd", 1);
    expect(out).toMatch(/650/);
    conn.closeSync(); db.closeSync();
  });

  it("collectTodayCommand returns array with cost field", async () => {
    const { conn, db } = await freshConn("collect-today");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 1_000_000, output: 0 });
    const result = (await collectTodayCommand(conn, PRICES, "usd", 1)) as Array<{ cost: string }>;
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.cost).toBeDefined();
    conn.closeSync(); db.closeSync();
  });
});

describe("renderSessionCommand", () => {
  it("throws UserError when no session id and no env var", async () => {
    const { conn, db } = await freshConn("session-no-id");
    delete process.env["CLAUDE_SESSION_ID"];
    await expect(
      renderSessionCommand(conn, undefined, PRICES, "usd", 1),
    ).rejects.toThrow(/No session id/);
    conn.closeSync(); db.closeSync();
  });

  it("uses CLAUDE_SESSION_ID env var when no arg provided", async () => {
    const { conn, db } = await freshConn("session-env");
    await insertMessage(conn, {
      ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50, session_id: "env-sess",
    });
    process.env["CLAUDE_SESSION_ID"] = "env-sess";
    try {
      const out = await renderSessionCommand(conn, undefined, PRICES, "usd", 1);
      expect(out).toContain("env-sess");
    } finally {
      delete process.env["CLAUDE_SESSION_ID"];
    }
    conn.closeSync(); db.closeSync();
  });

  it("returns 'No data for session X' when session has no rows", async () => {
    const { conn, db } = await freshConn("session-empty");
    const out = await renderSessionCommand(conn, "missing", PRICES, "usd", 1);
    expect(out).toBe("No data for session missing");
    conn.closeSync(); db.closeSync();
  });

  it("returns header with turn count", async () => {
    const { conn, db } = await freshConn("session-turns");
    for (let i = 0; i < 5; i++) {
      await insertMessage(conn, {
        ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50, session_id: "s",
      });
    }
    const out = await renderSessionCommand(conn, "s", PRICES, "usd", 1);
    expect(out).toContain("5 turns");
    conn.closeSync(); db.closeSync();
  });

  it("table contains model rows", async () => {
    const { conn, db } = await freshConn("session-table");
    await insertMessage(conn, {
      ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 50, session_id: "s",
    });
    const out = await renderSessionCommand(conn, "s", PRICES, "usd", 1);
    expect(out).toContain("m-a");
    conn.closeSync(); db.closeSync();
  });
});

describe("renderHourlyCommand", () => {
  it("returns 'No usage in the last 24 hours.' when empty", async () => {
    const { conn, db } = await freshConn("hourly-render-empty");
    const out = await renderHourlyCommand(conn);
    expect(out).toBe("No usage in the last 24 hours.");
    conn.closeSync(); db.closeSync();
  });

  it("returns sparkline + table when data exists", async () => {
    const { conn, db } = await freshConn("hourly-render-data");
    const oneHourAgo = new Date(Date.now() - 3600_000);
    await insertMessage(conn, {
      ts: oneHourAgo.toISOString(), model: "m-a", input: 1000, output: 0,
    });
    const out = await renderHourlyCommand(conn);
    expect(out).toContain("1,000");
    expect(out).toContain("Hour");
    conn.closeSync(); db.closeSync();
  });

  it("renders bar widths in output", async () => {
    const { conn, db } = await freshConn("hourly-bars");
    const ago1 = new Date(Date.now() - 1 * 3600_000);
    const ago2 = new Date(Date.now() - 2 * 3600_000);
    await insertMessage(conn, { ts: ago1.toISOString(), model: "m-a", input: 100, output: 0 });
    await insertMessage(conn, { ts: ago2.toISOString(), model: "m-a", input: 1000, output: 0 });

    const out = await renderHourlyCommand(conn);
    expect(out).toContain("█");
    conn.closeSync(); db.closeSync();
  });

  it("collectHourlyCommand returns rows", async () => {
    const { conn, db } = await freshConn("hourly-collect");
    const oneHourAgo = new Date(Date.now() - 3600_000);
    await insertMessage(conn, { ts: oneHourAgo.toISOString(), model: "m-a", input: 100, output: 0 });
    const rows = (await collectHourlyCommand(conn)) as Array<{ hour: string; total: number }>;
    expect(rows.length).toBeGreaterThan(0);
    conn.closeSync(); db.closeSync();
  });
});

describe("renderTopCommand", () => {
  it("throws UserError on invalid by", async () => {
    const { conn, db } = await freshConn("top-render-invalid");
    await expect(renderTopCommand(conn, "garbage", 5)).rejects.toThrow(/Invalid --by/);
    conn.closeSync(); db.closeSync();
  });

  it("returns 'No data.' when empty", async () => {
    const { conn, db } = await freshConn("top-render-empty");
    const out = await renderTopCommand(conn, "model", 5);
    expect(out).toBe("No data.");
    conn.closeSync(); db.closeSync();
  });

  it("returns table for by='model'", async () => {
    const { conn, db } = await freshConn("top-render-data");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 0 });
    const out = await renderTopCommand(conn, "model", 5);
    expect(out).toContain("m-a");
    expect(out).toContain("Top 5 by model");
    conn.closeSync(); db.closeSync();
  });

  it("truncates long bucket names with leading ellipsis", async () => {
    const { conn, db } = await freshConn("top-truncate");
    const longProject = "/a/very/very/long/project/path/that/exceeds/the/sixty/character/limit/significantly";
    await insertMessage(conn, {
      ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 0, project_cwd: longProject,
    });
    const out = await renderTopCommand(conn, "project", 5);
    expect(out).toContain("…");
    conn.closeSync(); db.closeSync();
  });

  it("collectTopCommand throws on invalid by", async () => {
    const { conn, db } = await freshConn("top-collect-invalid");
    await expect(collectTopCommand(conn, "garbage", 5)).rejects.toThrow(/Invalid --by/);
    conn.closeSync(); db.closeSync();
  });

  it("collectTopCommand returns rows for valid by", async () => {
    const { conn, db } = await freshConn("top-collect-data");
    await insertMessage(conn, { ts: `${today} 10:00:00`, model: "m-a", input: 100, output: 0 });
    const rows = (await collectTopCommand(conn, "model", 5)) as Array<{ bucket: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.bucket).toBe("m-a");
    conn.closeSync(); db.closeSync();
  });
});

describe("renderCostCommand", () => {
  it("throws on month not matching YYYY-MM", async () => {
    const { conn, db } = await freshConn("cost-render-invalid-1");
    await expect(renderCostCommand(conn, "foo", PRICES, "usd", 1)).rejects.toThrow(/Invalid month/);
    conn.closeSync(); db.closeSync();
  });

  it("throws on month=2024-13", async () => {
    const { conn, db } = await freshConn("cost-render-invalid-2");
    await expect(renderCostCommand(conn, "2024-13", PRICES, "usd", 1)).rejects.toThrow(/Invalid month/);
    conn.closeSync(); db.closeSync();
  });

  it("throws on month=2024-00", async () => {
    const { conn, db } = await freshConn("cost-render-invalid-3");
    await expect(renderCostCommand(conn, "2024-00", PRICES, "usd", 1)).rejects.toThrow(/Invalid month/);
    conn.closeSync(); db.closeSync();
  });

  it("returns 'No data for YYYY-MM.' when empty", async () => {
    const { conn, db } = await freshConn("cost-render-empty");
    const out = await renderCostCommand(conn, "1999-01", PRICES, "usd", 1);
    expect(out).toBe("No data for 1999-01.");
    conn.closeSync(); db.closeSync();
  });

  it("returns table with cost column for valid data", async () => {
    const { conn, db } = await freshConn("cost-render-data");
    await insertMessage(conn, { ts: "2025-06-15 10:00:00", model: "m-a", input: 1_000_000, output: 0 });
    const out = await renderCostCommand(conn, "2025-06", PRICES, "usd", 1);
    expect(out).toContain("m-a");
    expect(out).toMatch(/[$]/);
    conn.closeSync(); db.closeSync();
  });

  it("currency=eur prepends FX footer when fxSource provided", async () => {
    const { conn, db } = await freshConn("cost-fx-footer");
    await insertMessage(conn, { ts: "2025-06-15 10:00:00", model: "m-a", input: 1_000_000, output: 0 });
    const out = await renderCostCommand(conn, "2025-06", PRICES, "eur", 0.92, "ECB cached");
    expect(out).toContain("FX source");
    expect(out).toContain("ECB cached");
    conn.closeSync(); db.closeSync();
  });

  it("collectCostCommand throws on invalid month", async () => {
    const { conn, db } = await freshConn("cost-collect-invalid");
    await expect(collectCostCommand(conn, "foo")).rejects.toThrow(/Invalid month/);
    conn.closeSync(); db.closeSync();
  });

  it("collectCostCommand returns rows for a valid month with data (line 48 branch)", async () => {
    const { conn, db } = await freshConn("cost-collect-valid");
    await insertMessage(conn, { ts: "2025-07-10 10:00:00", model: "m-a", input: 500_000, output: 0 });
    const rows = (await collectCostCommand(conn, "2025-07")) as Array<{ model: string }>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    conn.closeSync(); db.closeSync();
  });

  it("currency=eur without fxSource omits FX footer (renderCostCommand EUR no-fxSource branch)", async () => {
    const { conn, db } = await freshConn("cost-eur-no-fxsource");
    await insertMessage(conn, { ts: "2025-06-15 10:00:00", model: "m-a", input: 1_000_000, output: 0 });
    // Pass currency=eur but no fxSource — the `currency === "eur" && fxSource` condition is false
    const out = await renderCostCommand(conn, "2025-06", PRICES, "eur", 0.92);
    expect(out).not.toContain("FX source");
    expect(out).toContain("2025-06");
    conn.closeSync(); db.closeSync();
  });
});
