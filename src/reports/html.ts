import { writeFile } from "node:fs/promises";
import type { DuckDBConnection } from "@duckdb/node-api";
import type { PriceTable } from "../pricing/types.js";
import { collectHtmlData } from "./html-data.js";
import { buildHtmlTemplate } from "./html-template.js";

export async function renderHtmlReport(
  conn: DuckDBConnection,
  prices: PriceTable,
  currency: "usd" | "eur",
  fxRate: number,
  outputPath: string,
): Promise<string> {
  const data = await collectHtmlData(conn, prices, currency, fxRate);
  const html = await buildHtmlTemplate(data);
  await writeFile(outputPath, html, "utf8");
  return outputPath;
}
