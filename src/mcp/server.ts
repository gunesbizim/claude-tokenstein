import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { DuckDBConnection } from "@duckdb/node-api";
import { openReader, openWriter, closeWriter } from "../db/duckdb.js";
import { loadPrices } from "../pricing/loader.js";
import { getRate, fxFooter } from "../pricing/fx.js";
import { loadConfig } from "../config.js";
import { ingestAll } from "../ingest/orchestrator.js";
import { renderTodayCommand } from "../reports/today.js";
import { renderYTDCommand } from "../reports/ytd.js";
import { renderAllTimeCommand } from "../reports/alltime.js";
import { renderReportCommand } from "../reports/report.js";
import { renderSessionCommand } from "../reports/session.js";
import { renderHourlyCommand } from "../reports/hourly.js";
import { renderTopCommand } from "../reports/top.js";
import { renderCostCommand } from "../reports/cost.js";

function parseCurrency(args: Record<string, unknown>): "usd" | "eur" {
  return args["currency"] === "eur" ? "eur" : "usd";
}

async function resolveRate(
  conn: DuckDBConnection,
  currency: "usd" | "eur",
): Promise<{ rate: number; footer: string | null }> {
  if (currency === "usd") return { rate: 1, footer: null };
  const cfg = await loadConfig();
  const fx = await getRate(conn, new Date(), { override: cfg.fx_override_usd_eur });
  return { rate: fx.rate, footer: fxFooter(fx) };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: "claude-tokenstein", version: "0.2.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "tokenstein_today",
        description: "Today's Claude token totals and per-model split",
        inputSchema: {
          type: "object" as const,
          properties: {
            currency: { type: "string", enum: ["usd", "eur"], description: "Currency for cost display" },
          },
        },
      },
      {
        name: "tokenstein_ytd",
        description: "Year-to-date Claude token totals with daily sparkline",
        inputSchema: {
          type: "object" as const,
          properties: {
            currency: { type: "string", enum: ["usd", "eur"] },
          },
        },
      },
      {
        name: "tokenstein_alltime",
        description: "All-time Claude token totals grouped by month",
        inputSchema: {
          type: "object" as const,
          properties: {
            currency: { type: "string", enum: ["usd", "eur"] },
          },
        },
      },
      {
        name: "tokenstein_report",
        description: "Last N-day token totals with daily sparkline",
        inputSchema: {
          type: "object" as const,
          required: ["days"],
          properties: {
            days: { type: "number", description: "Number of days to look back" },
            currency: { type: "string", enum: ["usd", "eur"] },
          },
        },
      },
      {
        name: "tokenstein_session",
        description: "Token breakdown for a specific session",
        inputSchema: {
          type: "object" as const,
          properties: {
            session_id: { type: "string", description: "Session ID (defaults to CLAUDE_SESSION_ID env var)" },
            currency: { type: "string", enum: ["usd", "eur"] },
          },
        },
      },
      {
        name: "tokenstein_hourly",
        description: "Last 24 hours of Claude token usage broken down by hour",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "tokenstein_top",
        description: "Top N Claude token consumers by session, project, or model",
        inputSchema: {
          type: "object" as const,
          properties: {
            by: { type: "string", enum: ["session", "project", "model"], description: "Group by dimension (default: model)" },
            n: { type: "number", description: "Number of results (default: 10)" },
          },
        },
      },
      {
        name: "tokenstein_cost",
        description: "Per-model cost breakdown for a given month",
        inputSchema: {
          type: "object" as const,
          required: ["month"],
          properties: {
            month: { type: "string", description: "Month in YYYY-MM format" },
            currency: { type: "string", enum: ["usd", "eur"] },
          },
        },
      },
      {
        name: "tokenstein_ingest",
        description: "Force a token usage ingest from Claude Code transcripts and Admin API",
        inputSchema: {
          type: "object" as const,
          properties: {
            source: { type: "string", enum: ["claude_code", "admin_api", "all"], description: "Ingest source (default: all)" },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const { name } = req.params;

    if (name === "tokenstein_today") {
      const currency = parseCurrency(args);
      const conn = await openReader();
      try {
        const prices = await loadPrices();
        const { rate, footer } = await resolveRate(conn, currency);
        let out = await renderTodayCommand(conn, prices, currency, rate);
        if (footer) out += `\n${footer}`;
        return textResult(out);
      } finally {
        conn.closeSync();
      }
    }

    if (name === "tokenstein_ytd") {
      const currency = parseCurrency(args);
      const conn = await openReader();
      try {
        const prices = await loadPrices();
        const { rate, footer } = await resolveRate(conn, currency);
        let out = await renderYTDCommand(conn, prices, currency, rate);
        if (footer) out += `\n${footer}`;
        return textResult(out);
      } finally {
        conn.closeSync();
      }
    }

    if (name === "tokenstein_alltime") {
      const currency = parseCurrency(args);
      const conn = await openReader();
      try {
        const prices = await loadPrices();
        const { rate, footer } = await resolveRate(conn, currency);
        let out = await renderAllTimeCommand(conn, prices, currency, rate);
        if (footer) out += `\n${footer}`;
        return textResult(out);
      } finally {
        conn.closeSync();
      }
    }

    if (name === "tokenstein_report") {
      const days =
        typeof args["days"] === "number"
          ? args["days"]
          : parseInt(String(args["days"] ?? "7"), 10);
      const currency = parseCurrency(args);
      const conn = await openReader();
      try {
        const prices = await loadPrices();
        const { rate, footer } = await resolveRate(conn, currency);
        let out = await renderReportCommand(conn, days, prices, currency, rate);
        if (footer) out += `\n${footer}`;
        return textResult(out);
      } finally {
        conn.closeSync();
      }
    }

    if (name === "tokenstein_session") {
      const sessionId =
        typeof args["session_id"] === "string" ? args["session_id"] : undefined;
      const currency = parseCurrency(args);
      const conn = await openReader();
      try {
        const prices = await loadPrices();
        const { rate } = await resolveRate(conn, currency);
        const out = await renderSessionCommand(conn, sessionId, prices, currency, rate);
        return textResult(out);
      } finally {
        conn.closeSync();
      }
    }

    if (name === "tokenstein_hourly") {
      const conn = await openReader();
      try {
        const out = await renderHourlyCommand(conn);
        return textResult(out);
      } finally {
        conn.closeSync();
      }
    }

    if (name === "tokenstein_top") {
      const by = typeof args["by"] === "string" ? args["by"] : "model";
      const n = typeof args["n"] === "number" ? args["n"] : 10;
      const conn = await openReader();
      try {
        const out = await renderTopCommand(conn, by, n);
        return textResult(out);
      } finally {
        conn.closeSync();
      }
    }

    if (name === "tokenstein_cost") {
      const month = String(args["month"] ?? "");
      const currency = parseCurrency(args);
      const conn = await openReader();
      try {
        const prices = await loadPrices();
        const { rate, footer } = await resolveRate(conn, currency);
        const out = await renderCostCommand(conn, month, prices, currency, rate, footer ?? undefined);
        return textResult(out);
      } finally {
        conn.closeSync();
      }
    }

    if (name === "tokenstein_ingest") {
      const source =
        typeof args["source"] === "string" ? args["source"] : "all";
      const cfg = await loadConfig();
      const conn = await openWriter();
      try {
        const results = await ingestAll(conn, {
          source: source as "claude_code" | "admin_api" | "all",
          ...(cfg.admin_api_key !== undefined ? { adminApiKey: cfg.admin_api_key } : {}),
          lookbackDays: cfg.ingest.max_admin_api_lookback_days,
        });
        const parts: string[] = [];
        if (results.claudeCode) {
          const s = results.claudeCode;
          parts.push(
            `claude_code — files:${s.filesScanned} messages:${s.messagesInserted} prompts:${s.promptsInserted} dt:${s.durationMs}ms`,
          );
        }
        if (results.adminApi) {
          const s = results.adminApi;
          parts.push(`admin_api — messages:${s.messagesInserted} buckets:${s.linesRead}`);
        }
        return textResult(parts.join("\n") || "Ingest complete.");
      } finally {
        conn.closeSync();
        closeWriter();
      }
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
