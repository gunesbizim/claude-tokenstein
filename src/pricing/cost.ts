import type { ModelPrice } from "./types.js";

export interface TokenRow {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export function costUsd(row: TokenRow, p: ModelPrice | null): number {
  if (!p) return 0;
  return (
    (row.input_tokens / 1e6) * p.input +
    (row.output_tokens / 1e6) * p.output +
    (row.cache_creation_input_tokens / 1e6) * p.cache_write +
    (row.cache_read_input_tokens / 1e6) * p.cache_read
  );
}

export function costEur(usd: number, rate: number): number {
  return usd * rate;
}
