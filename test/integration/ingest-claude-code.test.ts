import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { runMigrations } from "../../src/db/migrate.js";
import { ingestFile } from "../../src/ingest/claude-code.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "../fixtures/jsonl");

let tmpDir: string;

async function freshConn(name: string) {
  const db = await DuckDBInstance.create(join(tmpDir, `${name}.duckdb`));
  const conn = await db.connect();
  await runMigrations(conn);
  return { db, conn };
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "tokenstein-ingest-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("ingestFile — happy 3-turn fixture", () => {
  it("inserts exactly 3 message rows", async () => {
    const { conn, db } = await freshConn("happy");
    const stats = await ingestFile(conn, join(FIXTURES, "happy-3-turn.jsonl"), {});
    expect(stats.messagesInserted).toBe(3);
    const reader = await conn.runAndReadAll("SELECT COUNT(*) AS n FROM messages");
    expect(Number(reader.getRowObjects()[0]?.["n"])).toBe(3);
    conn.closeSync();
    db.closeSync();
  });

  it("is idempotent — re-ingesting inserts 0 new rows", async () => {
    const { conn, db } = await freshConn("happy-dedup");
    await ingestFile(conn, join(FIXTURES, "happy-3-turn.jsonl"), {});
    const stats2 = await ingestFile(conn, join(FIXTURES, "happy-3-turn.jsonl"), {});
    expect(stats2.messagesInserted).toBe(0);
    conn.closeSync();
    db.closeSync();
  });

  it("records cache tokens correctly", async () => {
    const { conn, db } = await freshConn("happy-cache");
    await ingestFile(conn, join(FIXTURES, "happy-3-turn.jsonl"), {});
    const reader = await conn.runAndReadAll(
      "SELECT cache_creation_input_tokens, cache_read_input_tokens FROM messages ORDER BY ts",
    );
    const rows = reader.getRowObjects();
    expect(Number(rows[1]?.["cache_creation_input_tokens"])).toBe(500);
    expect(Number(rows[2]?.["cache_read_input_tokens"])).toBe(500);
    conn.closeSync();
    db.closeSync();
  });
});

describe("ingestFile — tool_result fixture", () => {
  it("resolves user_prompt_id to human turn, skipping tool_result", async () => {
    const { conn, db } = await freshConn("tool");
    const stats = await ingestFile(conn, join(FIXTURES, "tool-result-between.jsonl"), {});
    expect(stats.messagesInserted).toBe(2);

    const reader = await conn.runAndReadAll(
      "SELECT m.user_prompt_id, p.role, p.text FROM messages m LEFT JOIN prompts p ON m.user_prompt_id=p.id ORDER BY m.ts",
    );
    const rows = reader.getRowObjects();
    const lastRow = rows[rows.length - 1];
    expect(String(lastRow?.["role"] ?? "")).toBe("user");
    expect(String(lastRow?.["text"] ?? "")).toContain("Run a search");
    conn.closeSync();
    db.closeSync();
  });
});

describe("ingestFile — no-usage fixture", () => {
  it("inserts 0 messages when no usage fields present", async () => {
    const { conn, db } = await freshConn("nousage");
    const stats = await ingestFile(conn, join(FIXTURES, "no-usage-only.jsonl"), {});
    expect(stats.messagesInserted).toBe(0);
    conn.closeSync();
    db.closeSync();
  });
});

describe("ingestFile — ephemeral cache fixture", () => {
  it("records cache_eph_5m_tokens and cache_eph_1h_tokens", async () => {
    const { conn, db } = await freshConn("eph");
    await ingestFile(conn, join(FIXTURES, "cache-eph.jsonl"), {});
    const reader = await conn.runAndReadAll(
      "SELECT cache_eph_5m_tokens, cache_eph_1h_tokens FROM messages",
    );
    const row = reader.getRowObjects()[0];
    expect(Number(row?.["cache_eph_5m_tokens"])).toBe(42);
    expect(Number(row?.["cache_eph_1h_tokens"])).toBe(7);
    conn.closeSync();
    db.closeSync();
  });
});
