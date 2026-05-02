import { describe, it, expect } from "vitest";
import { costUsd, costEur } from "../../src/pricing/cost.js";
import type { ModelPrice } from "../../src/pricing/types.js";

const opus: ModelPrice = { input: 15.0, output: 75.0, cache_write: 18.75, cache_read: 1.5 };

describe("costUsd", () => {
  it("returns 0 when price is null (unknown model)", () => {
    expect(
      costUsd({ input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, null),
    ).toBe(0);
  });

  it("calculates input cost correctly — 1M input tokens = $15", () => {
    expect(
      costUsd({ input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, opus),
    ).toBeCloseTo(15.0, 6);
  });

  it("calculates output cost correctly — 1M output tokens = $75", () => {
    expect(
      costUsd({ input_tokens: 0, output_tokens: 1_000_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, opus),
    ).toBeCloseTo(75.0, 6);
  });

  it("calculates cache write cost", () => {
    expect(
      costUsd({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 0 }, opus),
    ).toBeCloseTo(18.75, 6);
  });

  it("calculates cache read cost", () => {
    expect(
      costUsd({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000 }, opus),
    ).toBeCloseTo(1.5, 6);
  });

  it("sums all components", () => {
    const row = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 };
    expect(costUsd(row, opus)).toBeCloseTo(15 + 75 + 18.75 + 1.5, 4);
  });
});

describe("costEur", () => {
  it("converts USD to EUR with given rate", () => {
    expect(costEur(10, 0.92)).toBeCloseTo(9.2, 6);
  });
});
