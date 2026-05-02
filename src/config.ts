import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { configPath } from "./db/paths.js";
import { ConfigError } from "./errors.js";

const Schema = z.object({
  admin_api_key: z
    .string()
    .regex(/^sk-ant-admin-/)
    .optional(),
  default_currency: z.enum(["usd", "eur"]).default("usd"),
  fx_override_usd_eur: z.number().positive().nullable().default(null),
  ingest: z
    .object({
      claude_code: z.boolean().default(true),
      admin_api: z.boolean().default(true),
      max_admin_api_lookback_days: z.number().int().positive().default(30),
    })
    .default({}),
  store_prompts: z.boolean().default(true),
});

export type Config = z.infer<typeof Schema>;

export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    if (process.platform !== "win32") {
      const s = await stat(configPath());
      if ((s.mode & 0o077) !== 0) {
        throw new ConfigError(
          `config.json is world-readable (mode ${s.mode.toString(8)}); run: chmod 600 ~/.claude-tokenstein/config.json`,
        );
      }
    }
    raw = await readFile(configPath(), "utf8");
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return Schema.parse({});
    throw e;
  }
  const parsed = Schema.safeParse(JSON.parse(raw) as unknown);
  if (!parsed.success) throw new ConfigError(parsed.error.message);
  return parsed.data;
}
