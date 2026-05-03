import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBInstance } from "@duckdb/node-api";
import { runMigrations } from "../../src/db/migrate.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "tokenstein-mig-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("runMigrations", () => {
  it("creates all expected tables on a fresh DB", async () => {
    const db = await DuckDBInstance.create(join(tmpDir, "test.duckdb"));
    const conn = await db.connect();
    await runMigrations(conn);

    const reader = await conn.runAndReadAll(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='main' ORDER BY table_name",
    );
    const tables = reader.getRowObjects().map((r) => String(r["table_name"]));
    expect(tables).toContain("messages");
    expect(tables).toContain("prompts");
    expect(tables).toContain("ingest_state");
    expect(tables).toContain("files_seen");
    expect(tables).toContain("prices");
    expect(tables).toContain("fx_rates");
    expect(tables).toContain("_migrations");
    conn.closeSync();
    db.closeSync();
  });

  it("is idempotent — running twice applies migration once", async () => {
    const db = await DuckDBInstance.create(join(tmpDir, "test2.duckdb"));
    const conn = await db.connect();
    await runMigrations(conn);
    await runMigrations(conn);

    const reader = await conn.runAndReadAll("SELECT COUNT(*) AS n FROM _migrations");
    const count = Number(reader.getRowObjects()[0]?.["n"] ?? 0);
    expect(count).toBe(1);
    conn.closeSync();
    db.closeSync();
  });

});
