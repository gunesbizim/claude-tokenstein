import lockfile from "proper-lockfile";
import { lockPath, ensureRuntimeDir } from "../db/paths.js";
import { LockBusyError } from "../errors.js";
import { writeFileSync, existsSync } from "node:fs";

export async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await ensureRuntimeDir();
  const lp = lockPath();
  if (!existsSync(lp)) {
    writeFileSync(lp, "");
  }

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(lp, {
      realpath: false,
      stale: 60_000,
      retries: 0,
    });
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ELOCKED") {
      throw new LockBusyError("ingest already running");
    }
    throw e;
  }

  try {
    return await fn();
  } finally {
    await release?.();
  }
}
