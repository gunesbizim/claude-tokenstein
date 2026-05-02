import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const ROOT = join(homedir(), ".claude-tokenstein");

export const dbPath = () => join(ROOT, "tokens.duckdb");
export const configPath = () => join(ROOT, "config.json");
export const lockPath = () => join(ROOT, "ingest.lock");
export const logPath = () => join(ROOT, "logs", "ingest.log");
export const pricesOverridePath = () => join(ROOT, "prices.json");

export async function ensureRuntimeDir(): Promise<void> {
  await mkdir(join(ROOT, "logs"), { recursive: true, mode: 0o700 });
}

export function runtimeRoot(): string {
  return ROOT;
}
