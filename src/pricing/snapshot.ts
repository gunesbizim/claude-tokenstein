import type { DuckDBConnection } from "@duckdb/node-api";
import type { PriceTable } from "./types.js";

export async function snapshotPrices(
  conn: DuckDBConnection,
  table: PriceTable,
  effectiveFrom: Date,
): Promise<number> {
  let inserted = 0;
  for (const [model, p] of Object.entries(table)) {
    const result = await conn.run(
      `INSERT INTO prices (model, effective_from, input_per_mtok_usd, output_per_mtok_usd,
                           cache_write_per_mtok_usd, cache_read_per_mtok_usd)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (model, effective_from) DO NOTHING`,
      [
        model,
        effectiveFrom.toISOString().slice(0, 10),
        p.input,
        p.output,
        p.cache_write,
        p.cache_read,
      ],
    );
    inserted += result.rowsChanged;
  }
  return inserted;
}
