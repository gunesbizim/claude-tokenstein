import { describe, it, expect } from "vitest";
import { canonicalModelId, priceFor } from "../../src/pricing/loader.js";
import type { PriceTable } from "../../src/pricing/types.js";

const TABLE: PriceTable = {
  "claude-opus-4-7": { input: 15, output: 75, cache_write: 18.75, cache_read: 1.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
};

describe("canonicalModelId", () => {
  it("strips 8-digit date suffix", () => {
    expect(canonicalModelId("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
  });

  it("passes through already-canonical ids", () => {
    expect(canonicalModelId("claude-opus-4-7")).toBe("claude-opus-4-7");
  });

  it("resolves known alias", () => {
    expect(canonicalModelId("claude-opus-latest")).toBe("claude-opus-4-7");
  });
});

describe("priceFor", () => {
  it("finds price for known model", () => {
    const p = priceFor(TABLE, "claude-opus-4-7");
    expect(p?.input).toBe(15);
  });

  it("returns null for unknown model", () => {
    expect(priceFor(TABLE, "claude-unknown-99")).toBeNull();
  });

  it("resolves via canonical alias before lookup", () => {
    const p = priceFor(TABLE, "claude-opus-latest");
    expect(p?.input).toBe(15);
  });
});
