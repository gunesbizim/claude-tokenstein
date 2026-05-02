import { describe, it, expect } from "vitest";
import {
  parseLine,
  isHumanUserLine,
  resolveUserPrompt,
  extractTextContent,
  type ParsedLine,
} from "../../src/ingest/jsonl-parser.js";

describe("parseLine", () => {
  it("parses a valid JSON line", () => {
    const result = parseLine('{"type":"user","uuid":"abc"}');
    expect(result?.type).toBe("user");
    expect(result?.uuid).toBe("abc");
  });

  it("returns null for malformed JSON", () => {
    expect(parseLine("not json")).toBeNull();
    expect(parseLine("{invalid}")).toBeNull();
    expect(parseLine("")).toBeNull();
  });

  it("strips trailing carriage return", () => {
    const result = parseLine('{"type":"user"}\r');
    expect(result?.type).toBe("user");
    expect(result?.raw).not.toContain("\r");
  });
});

describe("isHumanUserLine", () => {
  it("returns false for non-user types", () => {
    expect(isHumanUserLine({ raw: "", type: "assistant" })).toBe(false);
    expect(isHumanUserLine({ raw: "", type: "system" })).toBe(false);
  });

  it("returns true for user with string content", () => {
    expect(
      isHumanUserLine({ raw: "", type: "user", message: { content: "hi" } }),
    ).toBe(true);
  });

  it("returns false for user with non-array non-string content", () => {
    expect(
      isHumanUserLine({ raw: "", type: "user", message: { content: undefined } }),
    ).toBe(false);
  });

  it("returns true for user with content array containing non-tool_result block", () => {
    expect(
      isHumanUserLine({
        raw: "",
        type: "user",
        message: { content: [{ type: "text", text: "hi" }] },
      }),
    ).toBe(true);
  });

  it("returns false for user with only tool_result blocks", () => {
    expect(
      isHumanUserLine({
        raw: "",
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "x", content: "y" }],
        },
      }),
    ).toBe(false);
  });
});

describe("resolveUserPrompt", () => {
  it("returns null when no parentUuid", () => {
    const map = new Map<string, ParsedLine>();
    expect(resolveUserPrompt({ raw: "" }, map)).toBeNull();
  });

  it("returns null when chain has no human user line", () => {
    const map = new Map<string, ParsedLine>();
    map.set("a", { raw: "", uuid: "a", type: "assistant" });
    expect(
      resolveUserPrompt({ raw: "", parentUuid: "a" }, map),
    ).toBeNull();
  });

  it("returns first human user ancestor", () => {
    const map = new Map<string, ParsedLine>();
    const userLine: ParsedLine = {
      raw: "",
      uuid: "u1",
      type: "user",
      message: { content: "hi" },
    };
    map.set("u1", userLine);
    map.set("a1", { raw: "", uuid: "a1", parentUuid: "u1", type: "assistant" });
    const result = resolveUserPrompt(
      { raw: "", parentUuid: "a1" },
      map,
    );
    expect(result?.uuid).toBe("u1");
  });

  it("stops after 50 hops", () => {
    const map = new Map<string, ParsedLine>();
    // Build chain of 60 assistants
    for (let i = 0; i < 60; i++) {
      const parentUuid = i > 0 ? `n${i - 1}` : undefined;
      map.set(`n${i}`, {
        raw: "",
        uuid: `n${i}`,
        ...(parentUuid !== undefined ? { parentUuid } : {}),
        type: "assistant",
      });
    }
    expect(
      resolveUserPrompt({ raw: "", parentUuid: "n59" }, map),
    ).toBeNull();
  });
});

describe("extractTextContent", () => {
  it("returns empty string for undefined content", () => {
    expect(extractTextContent(undefined)).toBe("");
  });

  it("returns string content as-is", () => {
    expect(extractTextContent("hello world")).toBe("hello world");
  });

  it("joins text blocks with newline", () => {
    const blocks = [
      { type: "text" as const, text: "first" },
      { type: "tool_use" as const, name: "foo", input: {}, id: "x" },
      { type: "text" as const, text: "second" },
    ];
    expect(extractTextContent(blocks)).toBe("first\nsecond");
  });

  it("returns empty string for array of non-text blocks", () => {
    const blocks = [
      { type: "tool_use" as const, name: "foo", input: {}, id: "x" },
    ];
    expect(extractTextContent(blocks)).toBe("");
  });
});
