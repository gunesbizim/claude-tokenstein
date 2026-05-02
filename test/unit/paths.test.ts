import { describe, it, expect } from "vitest";
import { stat } from "node:fs/promises";
import {
  dbPath,
  configPath,
  lockPath,
  logPath,
  pricesOverridePath,
  reportPath,
  runtimeRoot,
  ensureRuntimeDir,
} from "../../src/db/paths.js";

describe("path helpers", () => {
  it("dbPath() ends with tokens.duckdb under .claude-tokenstein", () => {
    expect(dbPath()).toMatch(/\.claude-tokenstein[/\\]tokens\.duckdb$/);
  });

  it("configPath() ends with config.json", () => {
    expect(configPath()).toMatch(/config\.json$/);
  });

  it("lockPath() ends with ingest.lock", () => {
    expect(lockPath()).toMatch(/ingest\.lock$/);
  });

  it("logPath() ends with logs/ingest.log", () => {
    expect(logPath()).toMatch(/logs[/\\]ingest\.log$/);
  });

  it("pricesOverridePath() ends with prices.json", () => {
    expect(pricesOverridePath()).toMatch(/prices\.json$/);
  });

  it("reportPath() ends with report.html", () => {
    expect(reportPath()).toMatch(/report\.html$/);
  });

  it("runtimeRoot() returns absolute path containing .claude-tokenstein", () => {
    expect(runtimeRoot()).toMatch(/\.claude-tokenstein$/);
  });

  it("all path helpers share the runtimeRoot prefix", () => {
    const root = runtimeRoot();
    expect(dbPath()).toContain(root);
    expect(configPath()).toContain(root);
    expect(lockPath()).toContain(root);
    expect(logPath()).toContain(root);
    expect(pricesOverridePath()).toContain(root);
    expect(reportPath()).toContain(root);
  });

  it("ensureRuntimeDir() creates logs directory and is idempotent", async () => {
    await ensureRuntimeDir();
    await ensureRuntimeDir();
    const s = await stat(logPath().replace(/[/\\]ingest\.log$/, ""));
    expect(s.isDirectory()).toBe(true);
  });
});
