import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";
import { runMigrations } from "../../src/db/migrate.js";
import { renderHtmlReport } from "../../src/reports/html.js";
import type { PriceTable } from "../../src/pricing/types.js";

let tmpDir: string;

const TEST_PRICES: PriceTable = {
  "model-a": { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
  "model-b": { input: 15.0, output: 75.0, cache_write: 18.75, cache_read: 1.5 },
};

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

function todayUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} 10:00:00`;
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "tokenstein-html-int-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("renderHtmlReport", () => {
  it("writes file to specified path", async () => {
    const { conn, db } = await freshConn("write-path");
    await insertMessage(conn, { ts: todayUtc(), model: "model-a", input: 100, output: 50 });

    const outPath = join(tmpDir, "report.html");
    await renderHtmlReport(conn, TEST_PRICES, "usd", 1, outPath);

    const s = await stat(outPath);
    expect(s.size).toBeGreaterThan(0);
    conn.closeSync(); db.closeSync();
  });

  it("file size > 100KB (Chart.js embedded)", async () => {
    const { conn, db } = await freshConn("file-size");
    await insertMessage(conn, { ts: todayUtc(), model: "model-a", input: 100, output: 50 });

    const outPath = join(tmpDir, "report.html");
    await renderHtmlReport(conn, TEST_PRICES, "usd", 1, outPath);

    const s = await stat(outPath);
    expect(s.size).toBeGreaterThan(100_000);
    conn.closeSync(); db.closeSync();
  });

  it("output is valid HTML with DOCTYPE", async () => {
    const { conn, db } = await freshConn("valid-html");
    const outPath = join(tmpDir, "report.html");
    await renderHtmlReport(conn, TEST_PRICES, "usd", 1, outPath);

    const html = await readFile(outPath, "utf8");
    expect(html).toContain("<!DOCTYPE html>");
    conn.closeSync(); db.closeSync();
  });

  it("contains all 6 tab labels", async () => {
    const { conn, db } = await freshConn("tab-labels");
    const outPath = join(tmpDir, "report.html");
    await renderHtmlReport(conn, TEST_PRICES, "usd", 1, outPath);

    const html = await readFile(outPath, "utf8");
    for (const label of ["Today", "This Week", "This Month", "This Quarter", "YTD", "LTD"]) {
      expect(html).toContain(label);
    }
    conn.closeSync(); db.closeSync();
  });

  it("Chart.js is embedded (contains Chart.register)", async () => {
    const { conn, db } = await freshConn("chartjs");
    const outPath = join(tmpDir, "report.html");
    await renderHtmlReport(conn, TEST_PRICES, "usd", 1, outPath);

    const html = await readFile(outPath, "utf8");
    expect(html).toContain(".register(");
    conn.closeSync(); db.closeSync();
  });

  it("REPORT JSON is embedded", async () => {
    const { conn, db } = await freshConn("report-json");
    const outPath = join(tmpDir, "report.html");
    await renderHtmlReport(conn, TEST_PRICES, "usd", 1, outPath);

    const html = await readFile(outPath, "utf8");
    expect(html).toContain("const REPORT =");
    conn.closeSync(); db.closeSync();
  });

  it("no external URLs in output", async () => {
    const { conn, db } = await freshConn("no-external");
    const outPath = join(tmpDir, "report.html");
    await renderHtmlReport(conn, TEST_PRICES, "usd", 1, outPath);

    const html = await readFile(outPath, "utf8");
    expect(html).not.toContain("https://cdn");
    expect(html).not.toContain("https://unpkg");
    conn.closeSync(); db.closeSync();
  });

  it("USD output contains $ symbol", async () => {
    const { conn, db } = await freshConn("usd-sym");
    await insertMessage(conn, { ts: todayUtc(), model: "model-a", input: 1_000_000, output: 0 });
    const outPath = join(tmpDir, "report.html");
    await renderHtmlReport(conn, TEST_PRICES, "usd", 1, outPath);

    const html = await readFile(outPath, "utf8");
    expect(html).toContain("$");
    conn.closeSync(); db.closeSync();
  });

  it("EUR output contains € symbol", async () => {
    const { conn, db } = await freshConn("eur-sym");
    await insertMessage(conn, { ts: todayUtc(), model: "model-a", input: 1_000_000, output: 0 });
    const outPath = join(tmpDir, "report.html");
    await renderHtmlReport(conn, TEST_PRICES, "eur", 0.92, outPath);

    const html = await readFile(outPath, "utf8");
    expect(html).toContain("€");
    conn.closeSync(); db.closeSync();
  });

  it("today section shows today's data", async () => {
    const { conn, db } = await freshConn("today-data");
    await insertMessage(conn, { ts: todayUtc(), model: "model-a", input: 500_000, output: 0 });
    const outPath = join(tmpDir, "report.html");
    await renderHtmlReport(conn, TEST_PRICES, "usd", 1, outPath);

    const html = await readFile(outPath, "utf8");
    expect(html).toContain("500");
    conn.closeSync(); db.closeSync();
  });

  it("returns the output path", async () => {
    const { conn, db } = await freshConn("return-path");
    const outPath = join(tmpDir, "my-report.html");
    const result = await renderHtmlReport(conn, TEST_PRICES, "usd", 1, outPath);
    expect(result).toBe(outPath);
    conn.closeSync(); db.closeSync();
  });

  it("cache-value class present in output (green cache reads)", async () => {
    const { conn, db } = await freshConn("cache-class");
    await insertMessage(conn, { ts: todayUtc(), model: "model-a", input: 0, output: 0, cache_read: 1_000_000 });
    const outPath = join(tmpDir, "report.html");
    await renderHtmlReport(conn, TEST_PRICES, "usd", 1, outPath);

    const html = await readFile(outPath, "utf8");
    expect(html).toContain("cache-value");
    conn.closeSync(); db.closeSync();
  });
});
