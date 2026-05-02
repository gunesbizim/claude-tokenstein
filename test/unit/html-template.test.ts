import { describe, it, expect } from "vitest";
import { buildHtmlTemplate } from "../../src/reports/html-template.js";
import type { HtmlReportData, PeriodSummary } from "../../src/reports/html-data.js";

const emptyPeriod = (label: string, period: string): PeriodSummary => ({
  label,
  period,
  rows: [],
  models: [],
  totalGen: 0,
  totalAll: 0,
  totalCacheRead: 0,
  totalCacheReadCost: 0,
  totalCost: 0,
  turns: 0,
});

describe("buildHtmlTemplate", () => {
  it("renders a valid HTML document with empty data", async () => {
    const data: HtmlReportData = {
      generatedAt: "2026-05-02T12:00:00Z",
      currency: "usd",
      periods: [
        emptyPeriod("Today", "today"),
        emptyPeriod("This Week", "week"),
        emptyPeriod("This Month", "month"),
        emptyPeriod("This Quarter", "quarter"),
        emptyPeriod("YTD", "ytd"),
        emptyPeriod("LTD", "ltd"),
      ],
    };

    const html = await buildHtmlTemplate(data);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
    expect(html).toContain("No data");
  });

  it("EUR currency renders € symbol", async () => {
    const data: HtmlReportData = {
      generatedAt: "2026-05-02T12:00:00Z",
      currency: "eur",
      periods: [emptyPeriod("Today", "today")],
    };
    const html = await buildHtmlTemplate(data);
    expect(html).toContain("€");
  });

  it("formats small token values without K/M/B suffix", async () => {
    const data: HtmlReportData = {
      generatedAt: "2026-05-02T12:00:00Z",
      currency: "usd",
      periods: [{
        label: "Today",
        period: "today",
        rows: [{
          day: "2026-05-02",
          model: "m-a",
          input: 5,
          output: 3,
          cache_write: 0,
          cache_read: 0,
          total: 8,
          total_all: 8,
          turns: 1,
          cost: 0.001,
        }],
        models: ["m-a"],
        totalGen: 8,
        totalAll: 8,
        totalCacheRead: 0,
        totalCacheReadCost: 0,
        totalCost: 0.001,
        turns: 1,
      }],
    };
    const html = await buildHtmlTemplate(data);
    expect(html).toMatch(/>8</);
  });

  it("formats K-range tokens (>= 1000)", async () => {
    const data: HtmlReportData = {
      generatedAt: "2026-05-02T12:00:00Z",
      currency: "usd",
      periods: [{
        ...emptyPeriod("Today", "today"),
        totalGen: 5000,
        totalAll: 5000,
      }],
    };
    const html = await buildHtmlTemplate(data);
    expect(html).toMatch(/5\.0K/);
  });

  it("formats M-range tokens", async () => {
    const data: HtmlReportData = {
      generatedAt: "2026-05-02T12:00:00Z",
      currency: "usd",
      periods: [{
        ...emptyPeriod("Today", "today"),
        totalGen: 5_000_000,
        totalAll: 5_000_000,
      }],
    };
    const html = await buildHtmlTemplate(data);
    expect(html).toMatch(/5\.00M/);
  });

  it("formats B-range tokens", async () => {
    const data: HtmlReportData = {
      generatedAt: "2026-05-02T12:00:00Z",
      currency: "usd",
      periods: [{
        ...emptyPeriod("Today", "today"),
        totalGen: 5_000_000_000,
        totalAll: 5_000_000_000,
      }],
    };
    const html = await buildHtmlTemplate(data);
    expect(html).toMatch(/5\.00B/);
  });
});
