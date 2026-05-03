/**
 * Separate test file for coverage of edge-case branches in runMigrations.
 * Uses vi.mock (hoisted by vitest) to control what readdir/readFile return.
 *
 * Covers:
 *   - lines 38-39: catch/ROLLBACK when migration SQL throws
 *   - line 24: `if (!versionStr) continue` — file with no underscore
 *   - line 26: `if (Number.isNaN(version)) continue` — file with non-numeric prefix
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DuckDBInstance } from "@duckdb/node-api";

// ---------------------------------------------------------------------------
// Mode flags — set before each test to control mock behaviour
// ---------------------------------------------------------------------------
let injectBadSql = false;
let injectEdgeCaseFiles = false;

// vi.mock is hoisted to the top of the module by vitest's transformer.
// We mock node:fs/promises to control readdir and readFile results.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readdir: vi.fn(async (path: unknown, ...args: unknown[]) => {
      if (injectEdgeCaseFiles) {
        // Return filenames that exercise the versionStr / NaN guard branches:
        //   "noseparator.sql"  → split("_")[0] is "noseparator.sql", but parseInt gives NaN
        //   Wait: split("_")[0] on "noseparator.sql" is "noseparator.sql" (truthy) so NaN branch
        //   "_init.sql"        → split("_")[0] is "" (falsy) → !versionStr branch
        //   "abc_init.sql"     → split("_")[0] is "abc", parseInt("abc") = NaN → NaN branch
        return ["_init.sql", "abc_init.sql"] as unknown as string[];
      }
      // Real readdir for all other cases
      return (actual.readdir as (...a: unknown[]) => unknown)(path, ...args);
    }),
    readFile: vi.fn(async (path: unknown, ...args: unknown[]) => {
      if (injectBadSql && typeof path === "string" && path.endsWith(".sql")) {
        // Return deliberately invalid SQL to trigger the catch/ROLLBACK path
        return "THIS IS NOT VALID SQL !!!;";
      }
      // Fall through to real readFile for non-SQL files
      return (actual.readFile as (...a: unknown[]) => unknown)(path, ...args);
    }),
  };
});

// Import AFTER vi.mock so the mocked module is in effect
import { runMigrations } from "../../src/db/migrate.js";

let tmpDir: string;

beforeEach(async () => {
  injectBadSql = false;
  injectEdgeCaseFiles = false;
  tmpDir = await mkdtemp(join(tmpdir(), "tokenstein-mig-rb-"));
});

afterEach(async () => {
  injectBadSql = false;
  injectEdgeCaseFiles = false;
  await rm(tmpDir, { recursive: true, force: true });
});

describe("runMigrations — ROLLBACK catch path (lines 38-39)", () => {
  it("rolls back and rethrows when migration SQL is invalid", async () => {
    injectBadSql = true;
    const db = await DuckDBInstance.create(join(tmpDir, "rollback.duckdb"));
    const conn = await db.connect();

    // runMigrations should throw because readFile returns invalid SQL
    await expect(runMigrations(conn)).rejects.toThrow();

    // Verify no migration version was committed (ROLLBACK happened)
    const reader = await conn.runAndReadAll("SELECT COUNT(*) AS n FROM _migrations");
    const count = Number(reader.getRowObjects()[0]?.["n"] ?? 0);
    expect(count).toBe(0);

    conn.closeSync();
    db.closeSync();
  });
});

describe("runMigrations — edge-case filename branches (lines 24, 26)", () => {
  it("skips files with no numeric prefix (both !versionStr and NaN branches)", async () => {
    injectEdgeCaseFiles = true;
    const db = await DuckDBInstance.create(join(tmpDir, "edge-files.duckdb"));
    const conn = await db.connect();

    // Both injected files should be skipped without error:
    //   "_init.sql"   → versionStr = "" → !versionStr → continue  (line 24 branch)
    //   "abc_init.sql" → parseInt("abc") = NaN → Number.isNaN → continue  (line 26 branch)
    // So runMigrations completes without applying any migration
    await runMigrations(conn);

    // No migrations should be recorded since all files were skipped
    const reader = await conn.runAndReadAll("SELECT COUNT(*) AS n FROM _migrations");
    const count = Number(reader.getRowObjects()[0]?.["n"] ?? 0);
    expect(count).toBe(0);

    conn.closeSync();
    db.closeSync();
  });
});
