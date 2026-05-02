import type { DuckDBConnection } from "@duckdb/node-api";
import { globProjects } from "./walk.js";
import { ingestFile } from "./claude-code.js";
import type { IngestStats } from "./types.js";

export async function ingestClaudeCode(
  conn: DuckDBConnection,
  opts: { sinceLast?: boolean; dryRun?: boolean },
): Promise<IngestStats> {
  const start = Date.now();
  const total: IngestStats = {
    filesScanned: 0,
    filesSkipped: 0,
    linesRead: 0,
    messagesInserted: 0,
    promptsInserted: 0,
    skipped: { truncated: 0, noUsage: 0, parseError: 0 },
    durationMs: 0,
  };

  await conn.run(
    `INSERT INTO ingest_state (source, last_run_ts)
     VALUES ('claude_code', ?)
     ON CONFLICT (source) DO UPDATE SET last_run_ts=excluded.last_run_ts`,
    [new Date().toISOString()],
  );

  for await (const filePath of globProjects()) {
    total.filesScanned++;
    const fileStats = await ingestFile(conn, filePath, { dryRun: opts.dryRun });
    if (fileStats.linesRead === 0 && fileStats.messagesInserted === 0) {
      total.filesSkipped++;
    }
    total.linesRead += fileStats.linesRead;
    total.messagesInserted += fileStats.messagesInserted;
    total.promptsInserted += fileStats.promptsInserted;
    total.skipped.truncated += fileStats.skipped.truncated;
    total.skipped.noUsage += fileStats.skipped.noUsage;
    total.skipped.parseError += fileStats.skipped.parseError;
  }

  if (!opts.dryRun && total.messagesInserted > 0) {
    await conn.run(
      `UPDATE ingest_state SET last_ingested_ts=? WHERE source='claude_code'`,
      [new Date().toISOString()],
    );
  }

  total.durationMs = Date.now() - start;
  return total;
}
