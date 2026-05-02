import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { initLogger, log } from "./log.js";
import { TokensteinError } from "./errors.js";
import { openWriter, closeWriter } from "./db/duckdb.js";
import { ingestClaudeCode } from "./ingest/orchestrator.js";

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

program
  .command("ingest")
  .description("Run an ingest pass over Claude Code transcripts")
  .option("--since-last", "use ingest_state cursors (default)", true)
  .option("--source <s>", "claude_code | admin_api | all", "all")
  .option("--dry-run", "compute work but do not write")
  .option("--with-lock", "acquire JS lockfile")
  .action(async (opts: { sinceLast: boolean; source: string; dryRun?: boolean; withLock?: boolean }) => {
    const conn = await openWriter();
    try {
      if (opts.source === "claude_code" || opts.source === "all") {
        const stats = await ingestClaudeCode(conn, { dryRun: opts.dryRun });
        console.log(
          `ingest done — files:${stats.filesScanned} messages:${stats.messagesInserted} ` +
            `prompts:${stats.promptsInserted} dt:${stats.durationMs}ms`,
        );
        log.info("ingest.done", stats);
      }
    } finally {
      conn.closeSync();
      closeWriter();
    }
  });

program
  .command("debug")
  .description("Debugging subcommands")
  .command("list-models")
  .description("List distinct model values and price-table coverage")
  .action(async () => {
    const { openReader } = await import("./db/duckdb.js");
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
