import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pricesOverridePath } from "../db/paths.js";
import type { ModelPrice, PriceTable } from "./types.js";

export type { ModelPrice, PriceTable };

export const MODEL_ALIASES: Record<string, string> = {
  "claude-opus-4-5-20250929": "claude-opus-4-5",
  "claude-sonnet-4-5-20250929": "claude-sonnet-4-5",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  "claude-opus-latest": "claude-opus-4-7",
  "claude-sonnet-latest": "claude-sonnet-4-6",
  "claude-haiku-latest": "claude-haiku-4-5",
};

export function canonicalModelId(raw: string): string {
  const alias = MODEL_ALIASES[raw];
  if (alias) return alias;
  const m = /^(.+?)-(\d{8})$/.exec(raw);
  return m ? (m[1] ?? raw) : raw;
}

const warnedUnknown = new Set<string>();

export function priceFor(table: PriceTable, model: string): ModelPrice | null {
  const canon = canonicalModelId(model);
  const p = table[canon];
  if (!p) {
    if (!warnedUnknown.has(canon)) warnedUnknown.add(canon);
    return null;
  }
  return p;
}

export async function loadPrices(): Promise<PriceTable> {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const bundled = JSON.parse(
    await readFile(join(HERE, "prices.json"), "utf8"),
  ) as PriceTable;
  let override: PriceTable = {};
  try {
    override = JSON.parse(await readFile(pricesOverridePath(), "utf8")) as PriceTable;
  } catch {
    /* no override file — fine */
  }
  return deepMerge(bundled, override);
}

function deepMerge(a: PriceTable, b: PriceTable): PriceTable {
  const out: PriceTable = { ...a };
  for (const k of Object.keys(b)) {
    const bVal = b[k];
    if (bVal) out[k] = { ...a[k], ...bVal };
  }
  return out;
}
