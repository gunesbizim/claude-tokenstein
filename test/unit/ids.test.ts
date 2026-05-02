import { describe, it, expect } from "vitest";
import { messageId } from "../../src/db/ids.js";

const BASE = {
  sessionId: "sess-abc",
  isoTs: "2026-05-01T10:00:00.000Z",
  requestId: "req-123",
};

describe("messageId", () => {
  it("produces a valid UUID v4-shaped string", () => {
    const id = messageId(BASE);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("is deterministic — same inputs produce same id", () => {
    expect(messageId(BASE)).toBe(messageId(BASE));
  });

  it("changes when requestId changes", () => {
    expect(messageId(BASE)).not.toBe(messageId({ ...BASE, requestId: "req-456" }));
  });

  it("null requestId path uses filePath/lineOffset/textHashHex", () => {
    const id = messageId({
      sessionId: "sess",
      isoTs: "2026-05-01T10:00:00.000Z",
      requestId: null,
      filePath: "/home/user/file.jsonl",
      lineOffset: 5,
      textHashHex: "aabbcc",
    });
    expect(id).toMatch(/^[0-9a-f]{8}-/);
  });

  it("null requestId — throws without required fallback fields", () => {
    expect(() =>
      messageId({ sessionId: "s", isoTs: "2026-05-01T10:00:00.000Z", requestId: null }),
    ).toThrow();
  });

  it("null requestId — case-insensitive path normalization on Windows-style paths", () => {
    const upper = messageId({
      sessionId: "s",
      isoTs: "2026-05-01T10:00:00.000Z",
      requestId: null,
      filePath: process.platform === "win32" ? "C:\\Users\\Foo\\x.jsonl" : "/home/Foo/x.jsonl",
      lineOffset: 0,
      textHashHex: "abc",
    });
    const lower = messageId({
      sessionId: "s",
      isoTs: "2026-05-01T10:00:00.000Z",
      requestId: null,
      filePath: process.platform === "win32" ? "c:\\users\\foo\\x.jsonl" : "/home/Foo/x.jsonl",
      lineOffset: 0,
      textHashHex: "abc",
    });
    if (process.platform === "win32") {
      expect(upper).toBe(lower);
    } else {
      expect(upper).toBe(lower);
    }
  });
});
