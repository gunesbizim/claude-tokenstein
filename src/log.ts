import { createWriteStream, statSync, renameSync } from "node:fs";
import { logPath, ensureRuntimeDir } from "./db/paths.js";

let stream: ReturnType<typeof createWriteStream> | null = null;

export async function initLogger(): Promise<void> {
  await ensureRuntimeDir();
  rotateIfBig();
  stream = createWriteStream(logPath(), { flags: "a" });
}

function rotateIfBig(): void {
  try {
    const s = statSync(logPath());
    if (s.size <= 10 * 1024 * 1024) return;
    if (stream) {
      stream.end();
      stream = null;
    }
    renameSync(logPath(), logPath() + ".1");
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

function emit(level: "INFO" | "WARN" | "ERROR", msg: string, meta?: object): void {
  const line =
    `${new Date().toISOString()} [${level.padEnd(5)}] ${msg}` +
    (meta ? " " + JSON.stringify(meta) : "");
  stream?.write(line + "\n");
  if (process.env["TOKENSTEIN_DEBUG"]) console.error(line);
}

export const log = {
  info: (m: string, meta?: object) => emit("INFO", m, redact(meta)),
  warn: (m: string, meta?: object) => emit("WARN", m, redact(meta)),
  error: (m: string, e?: unknown) => emit("ERROR", m, { error: serialize(e) }),
};

function redact(meta?: object): object | undefined {
  if (!meta) return undefined;
  const json = JSON.stringify(meta).replace(/sk-ant-[A-Za-z0-9_-]+/g, "sk-ant-***");
  return JSON.parse(json) as object;
}

function serialize(e: unknown): unknown {
  if (e instanceof Error) return { message: e.message, stack: e.stack };
  return String(e);
}
