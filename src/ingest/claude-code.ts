import { createReadStream, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import type { DuckDBConnection } from "@duckdb/node-api";
import { messageId, sha256Hex } from "../db/ids.js";
import { normalizePromptText } from "../normalize/text.js";
import {
  parseLine,
  resolveUserPrompt,
  extractTextContent,
  type ParsedLine,
} from "./jsonl-parser.js";
import type { IngestStats } from "./types.js";

const BATCH_SIZE = 500;

export async function ingestFile(
  conn: DuckDBConnection,
  filePath: string,
  opts: { dryRun?: boolean },
): Promise<Pick<IngestStats, "linesRead" | "messagesInserted" | "promptsInserted" | "skipped">> {
  const stats = {
    linesRead: 0,
    messagesInserted: 0,
    promptsInserted: 0,
    skipped: { truncated: 0, noUsage: 0, parseError: 0 },
  };

  const fileStat = statSync(filePath);
  const reader = await conn.runAndReadAll(
    "SELECT line_count FROM files_seen WHERE path = ?",
    [filePath],
  );
  const rows = reader.getRowObjects();
  const priorLineCount = rows.length > 0 ? Number(rows[0]?.["line_count"] ?? 0) : 0;

  const mtime = fileStat.mtime.toISOString();
  const sizeBytes = fileStat.size;

  if (rows.length > 0) {
    const seenReader = await conn.runAndReadAll(
      "SELECT mtime, size_bytes FROM files_seen WHERE path = ?",
      [filePath],
    );
    const seen = seenReader.getRowObjects()[0];
    if (seen) {
      const seenMtime = String(seen["mtime"] ?? "");
      const seenSize = Number(seen["size_bytes"] ?? -1);
      if (seenSize === sizeBytes && seenMtime !== "" && mtime.startsWith(seenMtime.slice(0, 19))) {
        return stats;
      }
    }
  }

  const byUuid = new Map<string, ParsedLine>();
  const lines: string[] = [];

  let lineNo = 0;
  let lastCompleteLineNo = priorLineCount;
  let currentGitBranch: string | null = null;
  let pendingMessages: Array<{
    row: Parameters<typeof insertMessage>[1];
    userPromptText: string | null;
    responseText: string | null;
  }> = [];

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of rl) {
    lineNo++;
    lines.push(rawLine);
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine === undefined) continue;
    if (rawLine.trim() === "") continue;
    stats.linesRead++;

    if (i < priorLineCount) {
      const p = parseLine(rawLine);
      if (p?.uuid) byUuid.set(p.uuid, p);
      if (p?.gitBranch) currentGitBranch = p.gitBranch;
      continue;
    }

    const isLastLine = i === lines.length - 1;
    const parsed = parseLine(rawLine);

    if (!parsed) {
      if (isLastLine) {
        stats.skipped.truncated++;
      } else {
        stats.skipped.parseError++;
      }
      continue;
    }

    if (parsed.uuid) byUuid.set(parsed.uuid, parsed);
    if (parsed.gitBranch) currentGitBranch = parsed.gitBranch;

    if (parsed.type !== "assistant" || !parsed.message?.usage) {
      stats.skipped.noUsage++;
      continue;
    }

    const usage = parsed.message.usage;
    const ts = parsed.timestamp;
    const sessionId = parsed.sessionId;
    const model = parsed.message.model;

    if (!ts || !sessionId || !model) {
      stats.skipped.noUsage++;
      continue;
    }

    const userPromptLine = resolveUserPrompt(parsed, byUuid);
    const userPromptText = userPromptLine
      ? normalizePromptText(extractTextContent(userPromptLine.message?.content))
      : null;
    const responseText = normalizePromptText(
      extractTextContent(parsed.message.content),
    );

    const requestId = parsed.message.id ?? null;
    const lineOffset = i;
    const textHashHex = requestId === null ? sha256Hex(responseText.slice(0, 512)) : undefined;

    const id = messageId({
      sessionId,
      isoTs: ts,
      requestId,
      filePath: requestId === null ? filePath : undefined,
      lineOffset: requestId === null ? lineOffset : undefined,
      textHashHex,
    });

    const row = {
      id,
      session_id: sessionId,
      project_cwd: parsed.cwd ?? "",
      git_branch: currentGitBranch,
      ts,
      model,
      service_tier: usage.service_tier ?? null,
      request_id: requestId,
      claude_version: parsed.cliVersion ?? null,
      source: "claude_code" as const,
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_eph_1h_tokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
      cache_eph_5m_tokens: usage.cache_creation?.ephemeral_5m_input_tokens ?? 0,
      web_search_requests: usage.server_tool_use?.web_search_requests ?? 0,
      web_fetch_requests: usage.server_tool_use?.web_fetch_requests ?? 0,
    };

    pendingMessages.push({ row, userPromptText, responseText });
    lastCompleteLineNo = i + 1;

    if (pendingMessages.length >= BATCH_SIZE) {
      if (!opts.dryRun) {
        const inserted = await flushBatch(conn, pendingMessages);
        stats.messagesInserted += inserted.messages;
        stats.promptsInserted += inserted.prompts;
      }
      pendingMessages = [];
    }
  }

  if (pendingMessages.length > 0 && !opts.dryRun) {
    const inserted = await flushBatch(conn, pendingMessages);
    stats.messagesInserted += inserted.messages;
    stats.promptsInserted += inserted.prompts;
    pendingMessages = [];
  }

  if (!opts.dryRun) {
    await conn.run(
      `INSERT INTO files_seen (path, mtime, size_bytes, line_count, sha256)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (path) DO UPDATE SET mtime=excluded.mtime, size_bytes=excluded.size_bytes,
         line_count=excluded.line_count, sha256=excluded.sha256`,
      [
        filePath,
        mtime,
        sizeBytes,
        lastCompleteLineNo,
        createHash("sha256")
          .update(filePath + mtime + String(sizeBytes))
          .digest("hex"),
      ],
    );
  }

  return stats;
}

type MessageRow = {
  id: string;
  session_id: string;
  project_cwd: string;
  git_branch: string | null;
  ts: string;
  model: string;
  service_tier: string | null;
  request_id: string | null;
  claude_version: string | null;
  source: "claude_code";
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cache_eph_1h_tokens: number;
  cache_eph_5m_tokens: number;
  web_search_requests: number;
  web_fetch_requests: number;
};

async function insertMessage(conn: DuckDBConnection, row: MessageRow): Promise<boolean> {
  const result = await conn.run(
    `INSERT INTO messages
       (id, session_id, project_cwd, git_branch, ts, model, service_tier, request_id,
        claude_version, source, input_tokens, output_tokens, cache_creation_input_tokens,
        cache_read_input_tokens, cache_eph_1h_tokens, cache_eph_5m_tokens,
        web_search_requests, web_fetch_requests)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [
      row.id, row.session_id, row.project_cwd, row.git_branch, row.ts, row.model,
      row.service_tier, row.request_id, row.claude_version, row.source,
      row.input_tokens, row.output_tokens, row.cache_creation_input_tokens,
      row.cache_read_input_tokens, row.cache_eph_1h_tokens, row.cache_eph_5m_tokens,
      row.web_search_requests, row.web_fetch_requests,
    ],
  );
  return result.rowsChanged > 0;
}

async function upsertPrompt(
  conn: DuckDBConnection,
  role: "user" | "assistant",
  text: string,
): Promise<{ id: string; inserted: boolean }> {
  const id = sha256Hex(text);
  const formatted = formatAsUuid(id.slice(0, 32));
  const result = await conn.run(
    `INSERT INTO prompts (id, role, text, char_count)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO NOTHING`,
    [formatted, role, text, text.length],
  );
  return { id: formatted, inserted: result.rowsChanged > 0 };
}

function formatAsUuid(hex32: string): string {
  return [
    hex32.slice(0, 8),
    hex32.slice(8, 12),
    hex32.slice(12, 16),
    hex32.slice(16, 20),
    hex32.slice(20, 32),
  ].join("-");
}

async function flushBatch(
  conn: DuckDBConnection,
  batch: Array<{ row: MessageRow; userPromptText: string | null; responseText: string | null }>,
): Promise<{ messages: number; prompts: number }> {
  let messages = 0;
  let prompts = 0;

  await conn.run("BEGIN");
  try {
    for (const { row, userPromptText, responseText } of batch) {
      let userPromptId: string | null = null;
      let responseTextId: string | null = null;

      if (userPromptText) {
        const up = await upsertPrompt(conn, "user", userPromptText);
        userPromptId = up.id;
        if (up.inserted) prompts++;
      }
      if (responseText) {
        const rp = await upsertPrompt(conn, "assistant", responseText);
        responseTextId = rp.id;
        if (rp.inserted) prompts++;
      }

      const inserted = await insertMessage(conn, row);
      if (inserted) {
        if (userPromptId || responseTextId) {
          await conn.run(
            "UPDATE messages SET user_prompt_id=?, response_text_id=? WHERE id=?",
            [userPromptId, responseTextId, row.id],
          );
        }
        messages++;
      }
    }
    await conn.run("COMMIT");
  } catch (e) {
    await conn.run("ROLLBACK");
    throw e;
  }

  return { messages, prompts };
}
