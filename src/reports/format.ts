import { costUsd, costEur } from "../pricing/cost.js";
import { priceFor } from "../pricing/loader.js";
import { formatCurrency, formatTokens } from "./render.js";
import type { PriceTable } from "../pricing/types.js";
import type { ModelRow } from "./queries.js";

export function computeRowCost(
  row: ModelRow,
  prices: PriceTable,
  currency: "usd" | "eur",
  fxRate: number,
): string {
  const p = priceFor(prices, row.model);
  const usd = costUsd(
    {
      input_tokens: row.input,
      output_tokens: row.output,
      cache_creation_input_tokens: row.cache_write,
      cache_read_input_tokens: row.cache_read,
    },
    p,
  );
  const amount = currency === "eur" ? costEur(usd, fxRate) : usd;
  return formatCurrency(amount, currency);
}

export function totalTokens(row: ModelRow): number {
  return row.input + row.output + row.cache_write + row.cache_read;
}

export function modelRowToTableRow(
  row: ModelRow,
  prices: PriceTable,
  currency: "usd" | "eur",
  fxRate: number,
): string[] {
  return [
    row.model,
    formatTokens(row.input),
    formatTokens(row.output),
    formatTokens(row.cache_write),
    formatTokens(row.cache_read),
    formatTokens(row.input + row.output + row.cache_write + row.cache_read),
    String(row.turns),
    computeRowCost(row, prices, currency, fxRate),
  ];
}
