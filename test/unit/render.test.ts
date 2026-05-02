import { describe, it, expect } from "vitest";
import {
  renderTable,
  renderSparkline,
  formatCurrency,
  formatTokens,
  formatDate,
} from "../../src/reports/render.js";

describe("renderTable", () => {
  it("renders a table with header row only when no data rows", () => {
    const out = renderTable(["A", "B", "C"], []);
    expect(out).toContain("A");
    expect(out).toContain("B");
    expect(out).toContain("C");
  });

  it("renders multiple rows", () => {
    const out = renderTable(["X", "Y"], [["1", "2"], ["3", "4"]]);
    expect(out).toContain("1");
    expect(out).toContain("4");
  });

  it("accepts mixed string/number row values", () => {
    const out = renderTable(["X"], [[1], ["b"]]);
    expect(out).toContain("1");
    expect(out).toContain("b");
  });
});

describe("renderSparkline", () => {
  it("returns empty string for empty array", () => {
    expect(renderSparkline([])).toBe("");
  });

  it("returns single-character mid-glyph for single value", () => {
    const out = renderSparkline([5]);
    expect(out).toHaveLength(1);
  });

  it("returns equal-glyph string when all values are equal (max==min branch)", () => {
    const out = renderSparkline([5, 5, 5]);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBe(out[2]);
  });

  it("returns rising sparkline for increasing values", () => {
    const out = renderSparkline([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(out).toHaveLength(8);
    expect(out[0]).toBe("▁");
    expect(out[7]).toBe("█");
  });

  it("handles zero values correctly", () => {
    const out = renderSparkline([0, 0, 5, 0]);
    expect(out).toHaveLength(4);
  });
});

describe("formatCurrency", () => {
  it("formats USD with digits", () => {
    const out = formatCurrency(12.34, "usd");
    expect(out).toMatch(/12[.,]34/);
  });

  it("formats EUR with digits", () => {
    const out = formatCurrency(12.34, "eur");
    expect(out).toMatch(/12[.,]34/);
  });

  it("preserves up to 4 fractional digits", () => {
    const out = formatCurrency(0.1234, "usd");
    expect(out).toMatch(/0[.,]1234/);
  });

  it("rounds to minimum 2 fractional digits", () => {
    const out = formatCurrency(1, "usd");
    expect(out).toMatch(/1[.,]00/);
  });
});

describe("formatTokens", () => {
  it("formats integer with thousands separator", () => {
    expect(formatTokens(1234)).toMatch(/1[,.]?234/);
  });

  it("formats 0", () => {
    expect(formatTokens(0)).toBe("0");
  });

  it("handles bigint input", () => {
    const out = formatTokens(BigInt(1_000_000));
    expect(out).toMatch(/1[,.]000[,.]000/);
  });

  it("handles BigInt zero", () => {
    expect(formatTokens(BigInt(0))).toBe("0");
  });
});

describe("formatDate", () => {
  it("formats a Date object as a non-empty string", () => {
    const out = formatDate(new Date("2026-05-02T12:00:00Z"));
    expect(out).toBeTruthy();
    expect(out.length).toBeGreaterThan(0);
  });

  it("output contains digits from the year", () => {
    const out = formatDate(new Date("2026-05-02T12:00:00Z"));
    expect(out).toMatch(/2026|26/);
  });
});
