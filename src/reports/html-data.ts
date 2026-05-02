import type { DuckDBConnection } from "@duckdb/node-api";
import { costUsd, costEur } from "../pricing/cost.js";
import { priceFor } from "../pricing/loader.js";
import type { PriceTable } from "../pricing/types.js";
import type { HtmlDayRow } from "./html-queries.js";
import {
  queryTodayHtml,
  queryWeek,
  queryMonth,
  queryQuarter,
  queryYtdHtml,
  queryLtdHtml,
} from "./html-queries.js";

export interface PeriodRow {
  day: string;
  model: string;
  input: number;
  output: number;
  cache_write: number;
  cache_read: number;
  total: number;
  total_all: number;
  turns: number;
  cost: number;
}

export interface PeriodSummary {
  label: string;
  period: string;
  rows: PeriodRow[];
  models: string[];
  totalGen: number;
  totalAll: number;
  totalCacheRead: number;
  totalCacheReadCost: number;
  totalCost: number;
  turns: number;
}

export interface HtmlReportData {
  generatedAt: string;
  currency: "usd" | "eur";
  periods: PeriodSummary[];
}

function buildSummary(
  label: string,
  period: string,
  rows: HtmlDayRow[],
  prices: PriceTable,
  currency: "usd" | "eur",
  fxRate: number,
): PeriodSummary {
  const periodRows: PeriodRow[] = rows.map((r) => {
    const p = priceFor(prices, r.model);
    const usd = costUsd(
      { input_tokens: r.input, output_tokens: r.output, cache_creation_input_tokens: r.cache_write, cache_read_input_tokens: r.cache_read },
      p,
    );
    const cost = currency === "eur" ? costEur(usd, fxRate) : usd;
    return { ...r, cost };
  });

  const models = [...new Set(rows.map((r) => r.model))].sort((a, b) => {
    const ta = rows.filter((r) => r.model === a).reduce((s, r) => s + r.total_all, 0);
    const tb = rows.filter((r) => r.model === b).reduce((s, r) => s + r.total_all, 0);
    return tb - ta;
  });

  return {
    label,
    period,
    rows: periodRows,
    models,
    totalGen: rows.reduce((s, r) => s + r.total, 0),
    totalAll: rows.reduce((s, r) => s + r.total_all, 0),
    totalCacheRead: rows.reduce((s, r) => s + r.cache_read, 0),
    totalCacheReadCost: (() => {
      let sum = 0;
      for (const r of rows) {
        const p = priceFor(prices, r.model);
        const usd = p ? (r.cache_read / 1e6) * p.cache_read : 0;
        sum += currency === "eur" ? costEur(usd, fxRate) : usd;
      }
      return sum;
    })(),
    totalCost: periodRows.reduce((s, r) => s + r.cost, 0),
    turns: rows.reduce((s, r) => s + r.turns, 0),
  };
}

export async function collectHtmlData(
  conn: DuckDBConnection,
  prices: PriceTable,
  currency: "usd" | "eur",
  fxRate: number,
): Promise<HtmlReportData> {
  const [todayRows, weekRows, monthRows, quarterRows, ytdRows, ltdRows] = await Promise.all([
    queryTodayHtml(conn),
    queryWeek(conn),
    queryMonth(conn),
    queryQuarter(conn),
    queryYtdHtml(conn),
    queryLtdHtml(conn),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    currency,
    periods: [
      buildSummary("Today", "today", todayRows, prices, currency, fxRate),
      buildSummary("This Week", "week", weekRows, prices, currency, fxRate),
      buildSummary("This Month", "month", monthRows, prices, currency, fxRate),
      buildSummary("This Quarter", "quarter", quarterRows, prices, currency, fxRate),
      buildSummary("YTD", "ytd", ytdRows, prices, currency, fxRate),
      buildSummary("LTD", "ltd", ltdRows, prices, currency, fxRate),
    ],
  };
}
