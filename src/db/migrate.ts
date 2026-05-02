import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DuckDBConnection } from "@duckdb/node-api";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "migrations");

export async function runMigrations(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL
    );
  `);
  const reader = await conn.runAndReadAll("SELECT version FROM _migrations");
  const appliedSet = new Set(
    reader.getRowObjects().map((r) => Number(r["version"])),
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const versionStr = f.split("_")[0];
    if (!versionStr) continue;
    const version = parseInt(versionStr, 10);
    if (Number.isNaN(version)) continue;
    if (appliedSet.has(version)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, f), "utf8");
    await conn.run("BEGIN");
    try {
      await conn.run(sql);
      await conn.run("INSERT INTO _migrations VALUES (?, ?)", [
        version,
        new Date().toISOString(),
      ]);
      await conn.run("COMMIT");
    } catch (e) {
      await conn.run("ROLLBACK");
      throw e;
    }
  }
}
