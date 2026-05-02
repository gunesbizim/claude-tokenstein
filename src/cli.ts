import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { initLogger, log } from "./log.js";
import { TokensteinError } from "./errors.js";
import { openWriter, openReader, closeWriter } from "./db/duckdb.js";
import { ingestAll } from "./ingest/orchestrator.js";
import { loadPrices } from "./pricing/loader.js";
import { getRate, fxFooter } from "./pricing/fx.js";
import { loadConfig } from "./config.js";
import { reportPath } from "./db/paths.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function pkgVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(HERE, "..", "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command()
  .name("claude-tokenstein")
  .version(pkgVersion())
  .option("--currency <c>", "usd or eur", "usd")
  .option("--json", "output JSON instead of table")
  .option("--color", "opt-in ANSI color");

function getCurrency(opts: { currency?: string }): "usd" | "eur" {
  return opts.currency === "eur" ? "eur" : "usd";
}

async function resolveRate(
  conn: Parameters<typeof getRate>[0],
  currency: "usd" | "eur",
): Promise<{ rate: number; footer: string | null }> {
  if (currency === "usd") return { rate: 1, footer: null };
  const cfg = await loadConfig();
  const fx = await getRate(conn, new Date(), { override: cfg.fx_override_usd_eur });
  return { rate: fx.rate, footer: fxFooter(fx) };
}

program
  .command("ingest")
  .description("Run an ingest pass over Claude Code transcripts")
  .option("--since-last", "use ingest_state cursors (default)", true)
  .option("--source <s>", "claude_code | admin_api | all", "all")
  .option("--dry-run", "compute work but do not write")
  .option("--with-lock", "acquire JS lockfile")
  .action(
    async (opts: { sinceLast: boolean; source: string; dryRun?: boolean; withLock?: boolean }) => {
      const cfg = await loadConfig();
      const conn = await openWriter();
      try {
        const results = await ingestAll(conn, {
          source: opts.source as "claude_code" | "admin_api" | "all",
          dryRun: opts.dryRun,
          adminApiKey: cfg.admin_api_key,
          lookbackDays: cfg.ingest.max_admin_api_lookback_days,
        });
        if (results.claudeCode) {
          const s = results.claudeCode;
          console.log(
            `claude_code — files:${s.filesScanned} messages:${s.messagesInserted} ` +
              `prompts:${s.promptsInserted} dt:${s.durationMs}ms`,
          );
          log.info("ingest.claude_code.done", s);
        }
        if (results.adminApi) {
          const s = results.adminApi;
          console.log(`admin_api — messages:${s.messagesInserted} buckets:${s.linesRead}`);
          log.info("ingest.admin_api.done", s);
        }
      } finally {
        conn.closeSync();
        closeWriter();
      }
    },
  );

program
  .command("report <days>")
  .description("Last N-day token totals with daily sparkline")
  .action(async (daysStr: string) => {
    const days = parseInt(daysStr, 10);
    if (!days || days < 1) throw new Error("days must be a positive integer");
    const parentOpts = program.opts<{ currency?: string; json?: boolean }>();
    const currency = getCurrency(parentOpts);
    const conn = await openReader();
    const prices = await loadPrices();
    const { rate, footer } = await resolveRate(conn, currency);
    const { renderReportCommand, collectReportCommand } = await import("./reports/report.js");
    const output = parentOpts.json
      ? JSON.stringify(await collectReportCommand(conn, days, prices, currency, rate), null, 2)
      : await renderReportCommand(conn, days, prices, currency, rate);
    console.log(output);
    if (footer) console.log(footer);
    conn.closeSync();
  });

program
  .command("today")
  .description("Today's token totals + per-model split")
  .action(async () => {
    const parentOpts = program.opts<{ currency?: string; json?: boolean }>();
    const currency = getCurrency(parentOpts);
    const conn = await openReader();
    const prices = await loadPrices();
    const { rate, footer } = await resolveRate(conn, currency);
    const { renderTodayCommand, collectTodayCommand } = await import("./reports/today.js");
    const output = parentOpts.json
      ? JSON.stringify(await collectTodayCommand(conn, prices, currency, rate), null, 2)
      : await renderTodayCommand(conn, prices, currency, rate);
    console.log(output);
    if (footer) console.log(footer);
    conn.closeSync();
  });

program
  .command("session [id]")
  .description("Breakdown for current or specified session")
  .action(async (id: string | undefined) => {
    const parentOpts = program.opts<{ currency?: string; json?: boolean }>();
    const currency = getCurrency(parentOpts);
    const conn = await openReader();
    const prices = await loadPrices();
    const { rate } = await resolveRate(conn, currency);
    const { renderSessionCommand } = await import("./reports/session.js");
    const output = await renderSessionCommand(conn, id, prices, currency, rate);
    console.log(output);
    conn.closeSync();
  });

program
  .command("hourly")
  .description("Last 24h, hour-by-hour")
  .action(async () => {
    const parentOpts = program.opts<{ json?: boolean }>();
    const conn = await openReader();
    const { renderHourlyCommand, collectHourlyCommand } = await import("./reports/hourly.js");
    const output = parentOpts.json
      ? JSON.stringify(await collectHourlyCommand(conn), null, 2)
      : await renderHourlyCommand(conn);
    console.log(output);
    conn.closeSync();
  });

program
  .command("top")
  .description("Top-N by total tokens or cost")
  .option("--by <col>", "session | project | model", "model")
  .option("--n <n>", "how many rows", "10")
  .action(async (opts: { by: string; n: string }) => {
    const parentOpts = program.opts<{ json?: boolean }>();
    const n = parseInt(opts.n, 10) || 10;
    const conn = await openReader();
    const { renderTopCommand, collectTopCommand } = await import("./reports/top.js");
    const output = parentOpts.json
      ? JSON.stringify(await collectTopCommand(conn, opts.by, n), null, 2)
      : await renderTopCommand(conn, opts.by, n);
    console.log(output);
    conn.closeSync();
  });

program
  .command("ytd")
  .description("Year-to-date token totals with daily sparkline")
  .action(async () => {
    const parentOpts = program.opts<{ currency?: string; json?: boolean }>();
    const currency = getCurrency(parentOpts);
    const conn = await openReader();
    const prices = await loadPrices();
    const { rate, footer } = await resolveRate(conn, currency);
    const { renderYTDCommand, collectYTDCommand } = await import("./reports/ytd.js");
    const output = parentOpts.json
      ? JSON.stringify(await collectYTDCommand(conn, prices, currency, rate), null, 2)
      : await renderYTDCommand(conn, prices, currency, rate);
    console.log(output);
    if (footer) console.log(footer);
    conn.closeSync();
  });

program
  .command("all-time")
  .description("All-time token totals grouped by month")
  .action(async () => {
    const parentOpts = program.opts<{ currency?: string; json?: boolean }>();
    const currency = getCurrency(parentOpts);
    const conn = await openReader();
    const prices = await loadPrices();
    const { rate, footer } = await resolveRate(conn, currency);
    const { renderAllTimeCommand, collectAllTimeCommand } = await import("./reports/alltime.js");
    const output = parentOpts.json
      ? JSON.stringify(await collectAllTimeCommand(conn, prices, currency, rate), null, 2)
      : await renderAllTimeCommand(conn, prices, currency, rate);
    console.log(output);
    if (footer) console.log(footer);
    conn.closeSync();
  });

program
  .command("cost <month>")
  .description("Per-model cost breakdown for YYYY-MM")
  .action(async (month: string) => {
    const parentOpts = program.opts<{ currency?: string; json?: boolean }>();
    const currency = getCurrency(parentOpts);
    const conn = await openReader();
    const prices = await loadPrices();
    const { rate, footer } = await resolveRate(conn, currency);
    const { renderCostCommand, collectCostCommand } = await import("./reports/cost.js");
    const output = parentOpts.json
      ? JSON.stringify(await collectCostCommand(conn, month), null, 2)
      : await renderCostCommand(conn, month, prices, currency, rate, footer ?? undefined);
    console.log(output);
    conn.closeSync();
  });

program
  .command("html")
  .description("Generate a self-contained HTML report for all time periods")
  .option("--output <path>", "output file path", reportPath())
  .option("--open", "open in browser after generation")
  .action(async (opts: { output: string; open?: boolean }) => {
    const parentOpts = program.opts<{ currency?: string }>();
    const currency = getCurrency(parentOpts);
    const conn = await openReader();
    const prices = await loadPrices();
    const { rate } = await resolveRate(conn, currency);
    const { renderHtmlReport } = await import("./reports/html.js");
    const outPath = await renderHtmlReport(conn, prices, currency, rate, opts.output);
    console.log(`Report written to: ${outPath}`);
    if (opts.open) {
      const { exec } = await import("node:child_process");
      const opener =
        process.platform === "win32" ? "start" :
        process.platform === "darwin" ? "open" : "xdg-open";
      exec(`${opener} "${outPath}"`);
    }
    conn.closeSync();
  });

const debugCmd = program.command("debug").description("Debugging subcommands");

debugCmd
  .command("list-models")
  .description("List distinct model values and price-table coverage")
  .action(async () => {
    const conn = await openReader();
    const reader = await conn.runAndReadAll(
      "SELECT model, COUNT(*) AS turns FROM messages GROUP BY model ORDER BY turns DESC",
    );
    const rows = reader.getRowObjects();
    if (rows.length === 0) {
      console.log("No messages ingested yet.");
    } else {
      console.log("model\t\t\t\t\tturns");
      for (const r of rows) {
        console.log(`${String(r["model"])}\t${String(r["turns"])}`);
      }
    }
    conn.closeSync();
  });

program
  .command("mcp")
  .description("Start MCP server (used by Claude Code plugin host)")
  .action(async () => {
    const { startMcpServer } = await import("./mcp/server.js");
    await startMcpServer();
  });

try {
  await initLogger();
  await program.parseAsync(process.argv);
} catch (e) {
  log.error("uncaught", e);
  if (e instanceof TokensteinError) process.exit(e.exitCode);
  process.exit(1);
}
