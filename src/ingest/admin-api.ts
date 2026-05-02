import type { DuckDBConnection } from "@duckdb/node-api";
import { messageId } from "../db/ids.js";
import { paginateUsage } from "./admin-api-client.js";
import type { IngestStats } from "./types.js";

export async function ingestAdminApi(
  conn: DuckDBConnection,
  opts: {
    apiKey: string;
    lookbackDays: number;
    dryRun?: boolean;
  },
): Promise<Pick<IngestStats, "messagesInserted" | "linesRead">> {
  const stats = { messagesInserted: 0, linesRead: 0 };

  const stateReader = await conn.runAndReadAll(
    "SELECT last_ingested_ts FROM ingest_state WHERE source = 'admin_api'",
  );
  const stateRows = stateReader.getRowObjects();
  const lastTs = stateRows[0]?.["last_ingested_ts"];
  const startingAt = lastTs
    ? new Date(String(lastTs)).toISOString()
    : new Date(Date.now() - opts.lookbackDays * 86400_000).toISOString();

  let latestBucketEnd: string | null = null;

  for await (const bucket of paginateUsage(startingAt, opts.apiKey)) {
    stats.linesRead++;
    if (opts.dryRun) continue;

    const id = messageId({
      sessionId: "admin_api",
      isoTs: bucket.starting_at,
      requestId: `${bucket.model}|${bucket.workspace_id ?? ""}`,
    });

    await conn.run(
      `INSERT INTO messages
         (id, session_id, project_cwd, git_branch, ts, model, source,
          input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens)
       VALUES (?, 'admin_api', '', NULL, ?, ?, 'admin_api', ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        bucket.starting_at,
        bucket.model,
        bucket.input_tokens,
        bucket.output_tokens,
        bucket.cache_creation_input_tokens,
        bucket.cache_read_input_tokens,
      ],
    );
    stats.messagesInserted++;
    if (!latestBucketEnd || bucket.ending_at > latestBucketEnd) {
      latestBucketEnd = bucket.ending_at;
    }
  }

  if (!opts.dryRun && latestBucketEnd) {
    await conn.run(
      `INSERT INTO ingest_state (source, last_ingested_ts, last_run_ts)
       VALUES ('admin_api', ?, ?)
       ON CONFLICT (source) DO UPDATE SET last_ingested_ts=excluded.last_ingested_ts,
         last_run_ts=excluded.last_run_ts`,
      [latestBucketEnd, new Date().toISOString()],
    );
  }

  return stats;
}
