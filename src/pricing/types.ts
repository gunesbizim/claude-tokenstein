export interface ModelPrice {
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
}

export type PriceTable = Record<string, ModelPrice>;
