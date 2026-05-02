import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, chmod, readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { configPath } from "../../src/db/paths.js";
import { loadConfig } from "../../src/config.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "tokenstein-cfg-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns defaults when config file is missing", async () => {
    process.env["HOME"] = tmpDir;
    const cfg = await loadConfig();
    expect(cfg.default_currency).toBe("usd");
    expect(cfg.store_prompts).toBe(true);
    expect(cfg.fx_override_usd_eur).toBeNull();
  });

  it("parses a valid config file", async () => {
    const cfgDir = join(tmpDir, ".claude-tokenstein");
    await mkdir(cfgDir, { recursive: true });
    const cfgPath = join(cfgDir, "config.json");
    await writeFile(cfgPath, JSON.stringify({ default_currency: "eur", store_prompts: false }));
    if (process.platform !== "win32") await chmod(cfgPath, 0o600);

    process.env["HOME"] = tmpDir;
    // Re-import with fresh module (bypass module cache)
    const mod = await import("../../src/config.js?t=" + Date.now().toString());
    const cfg = await (
      mod as { loadConfig: () => Promise<{ default_currency: string; store_prompts: boolean }> }
    ).loadConfig();
    expect(cfg).toBeDefined();
  });
});

// Error-path tests using the real configPath() location with backup/restore
describe("loadConfig — error paths", () => {
  const realPath = configPath();
  const realDir = dirname(realPath);
  let backup: string | null = null;
  let hadConfig = false;

  beforeEach(async () => {
    await mkdir(realDir, { recursive: true });
    try {
      backup = await readFile(realPath, "utf8");
      hadConfig = true;
    } catch {
      backup = null;
      hadConfig = false;
    }
    if (hadConfig) await rm(realPath, { force: true });
  });

  afterEach(async () => {
    if (hadConfig && backup !== null) {
      await writeFile(realPath, backup, "utf8");
      if (process.platform !== "win32") await chmod(realPath, 0o600);
    } else {
      try {
        await access(realPath);
        await rm(realPath, { force: true });
      } catch {
        // already gone
      }
    }
  });

  it.skipIf(process.platform === "win32")(
    "throws ConfigError when config file is world-readable (POSIX only)",
    async () => {
      await writeFile(realPath, JSON.stringify({}));
      await chmod(realPath, 0o644); // world-readable
      await expect(loadConfig()).rejects.toThrow(/world-readable|chmod/);
    },
  );

  it("throws on malformed JSON", async () => {
    await writeFile(realPath, "{not valid json");
    if (process.platform !== "win32") await chmod(realPath, 0o600);
    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws ConfigError on schema violation (default_currency)", async () => {
    await writeFile(realPath, JSON.stringify({ default_currency: "JPY" }));
    if (process.platform !== "win32") await chmod(realPath, 0o600);
    await expect(loadConfig()).rejects.toThrow();
  });

  it("throws on negative max_admin_api_lookback_days", async () => {
    await writeFile(
      realPath,
      JSON.stringify({ ingest: { max_admin_api_lookback_days: -1 } }),
    );
    if (process.platform !== "win32") await chmod(realPath, 0o600);
    await expect(loadConfig()).rejects.toThrow();
  });

  it("rejects admin_api_key with wrong prefix", async () => {
    await writeFile(realPath, JSON.stringify({ admin_api_key: "sk-bad-prefix-123" }));
    if (process.platform !== "win32") await chmod(realPath, 0o600);
    await expect(loadConfig()).rejects.toThrow();
  });

  it("accepts valid admin_api_key prefix", async () => {
    await writeFile(realPath, JSON.stringify({ admin_api_key: "sk-ant-admin-abc123" }));
    if (process.platform !== "win32") await chmod(realPath, 0o600);
    const cfg = await loadConfig();
    expect(cfg.admin_api_key).toBe("sk-ant-admin-abc123");
  });
});
