import { DuckDBInstance } from "@duckdb/node-api";
import type { DuckDBConnection } from "@duckdb/node-api";
import { access } from "node:fs/promises";
import { dbPath, ensureRuntimeDir } from "./paths.js";
import { runMigrations } from "./migrate.js";

let writerInstance: DuckDBInstance | null = null;

export async function openWriter(): Promise<DuckDBConnection> {
  await ensureRuntimeDir();
  if (!writerInstance) {
    writerInstance = await DuckDBInstance.create(dbPath());
  }
  const conn = await writerInstance.connect();
  await runMigrations(conn);
  return conn;
}

export async function openReader(): Promise<DuckDBConnection> {
  await ensureRuntimeDir();
  const db = dbPath();
  try {
    await access(db);
  } catch {
    const w = await openWriter();
    w.closeSync();
    writerInstance = null;
  }
  const ro = await DuckDBInstance.create(db, { access_mode: "READ_ONLY" });
  return ro.connect();
}

export function closeWriter(): void {
  if (writerInstance) {
    writerInstance.closeSync();
    writerInstance = null;
  }
}
