import { describe, it, expect } from "vitest";
import { totalTokens, modelRowToTableRow, computeRowCost } from "../../src/reports/format.js";
import type { ModelRow } from "../../src/reports/queries.js";
import type { PriceTable } from "../../src/pricing/types.js";

const PRICES: PriceTable = {
  "model-a": { input: 3.0, output: 15.0, cache_write: 3.75, cache_read: 0.3 },
  "model-b": { input: 15.0, output: 75.0, cache_write: 18.75, cache_read: 1.5 },
};

const sampleRow = (overrides: Partial<ModelRow> = {}): ModelRow => ({
  model: "model-a",
  input: 1000,
  output: 500,
  cache_write: 200,
  cache_read: 100,
  turns: 5,
  ...overrides,
});

describe("totalTokens", () => {
  it("sums all four token fields", () => {
    expect(totalTokens(sampleRow())).toBe(1000 + 500 + 200 + 100);
  });

  it("returns 0 for all-zero row", () => {
    expect(
      totalTokens(sampleRow({ input: 0, output: 0, cache_write: 0, cache_read: 0 })),
    ).toBe(0);
  });

  it("does NOT include turns in the sum", () => {
    const row = sampleRow({ input: 0, output: 0, cache_write: 0, cache_read: 0, turns: 999 });
    expect(totalTokens(row)).toBe(0);
  });

  it("handles large values", () => {
    const row = sampleRow({
      input: 1_000_000,
      output: 2_000_000,
      cache_write: 3_000_000,
      cache_read: 4_000_000,
    });
    expect(totalTokens(row)).toBe(10_000_000);
  });
});

describe("modelRowToTableRow", () => {
  it("returns 8-element array", () => {
    const result = modelRowToTableRow(sampleRow(), PRICES, "usd", 1);
    expect(result).toHaveLength(8);
  });

  it("first element is model name", () => {
    const result = modelRowToTableRow(sampleRow({ model: "model-b" }), PRICES, "usd", 1);
    expect(result[0]).toBe("model-b");
  });

  it("indexes 1-4 are input/output/cache_write/cache_read formatted", () => {
    const result = modelRowToTableRow(sampleRow(), PRICES, "usd", 1);
    expect(result[1]).toMatch(/1[,.]?000/);
    expect(result[2]).toMatch(/500/);
    expect(result[3]).toMatch(/200/);
    expect(result[4]).toMatch(/100/);
  });

  it("index 5 is total of all four token types", () => {
    const result = modelRowToTableRow(sampleRow(), PRICES, "usd", 1);
    // 1000+500+200+100 = 1800
    expect(result[5]).toMatch(/1[,.]?800/);
  });

  it("index 6 is turns count as string", () => {
    const result = modelRowToTableRow(sampleRow({ turns: 42 }), PRICES, "usd", 1);
    expect(result[6]).toBe("42");
  });

  it("index 7 contains $ when currency=usd", () => {
    const result = modelRowToTableRow(sampleRow(), PRICES, "usd", 1);
    expect(result[7]).toMatch(/[$]/);
  });

  it("index 7 contains € when currency=eur", () => {
    const result = modelRowToTableRow(sampleRow(), PRICES, "eur", 0.92);
    expect(result[7]).toMatch(/€/);
  });

  it("unknown model produces $0 cost", () => {
    const result = modelRowToTableRow(sampleRow({ model: "unknown-model" }), PRICES, "usd", 1);
    expect(result[7]).toMatch(/0/);
  });
});

describe("computeRowCost", () => {
  it("formats USD with $ symbol", () => {
    const cost = computeRowCost(sampleRow(), PRICES, "usd", 1);
    expect(cost).toMatch(/[$]/);
  });

  it("formats EUR with € symbol", () => {
    const cost = computeRowCost(sampleRow(), PRICES, "eur", 0.92);
    expect(cost).toMatch(/€/);
  });

  it("EUR cost is USD cost × fxRate (verified by parsing digits)", () => {
    const usdCost = computeRowCost(sampleRow(), PRICES, "usd", 1);
    const eurCost = computeRowCost(sampleRow(), PRICES, "eur", 0.5);
    const usdNum = parseFloat(usdCost.replace(/[^\d.]/g, ""));
    const eurNum = parseFloat(eurCost.replace(/[^\d.]/g, ""));
    expect(eurNum).toBeCloseTo(usdNum * 0.5, 4);
  });

  it("returns 0-formatted cost for unknown model", () => {
    const cost = computeRowCost(sampleRow({ model: "unknown" }), PRICES, "usd", 1);
    expect(cost).toMatch(/0/);
  });
});
