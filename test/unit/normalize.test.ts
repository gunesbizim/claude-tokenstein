import { describe, it, expect } from "vitest";
import { normalizePromptText } from "../../src/normalize/text.js";

describe("normalizePromptText", () => {
  it("collapses inline whitespace in prose", () => {
    expect(normalizePromptText("hello   world")).toBe("hello world");
  });

  it("collapses 3+ blank lines to 1", () => {
    const input = "a\n\n\n\nb";
    const result = normalizePromptText(input);
    expect(result).toBe("a\n\nb");
  });

  it("preserves code block content verbatim", () => {
    const input = "prose\n```python\n  x = 1 + 2\n  y = 3\n```\nafter";
    const result = normalizePromptText(input);
    expect(result).toContain("  x = 1 + 2");
    expect(result).not.toContain("prose   ");
    expect(result).toContain("after");
  });

  it("normalizes CRLF to LF before processing", () => {
    const input = "hello   world\r\nfoo   bar";
    const result = normalizePromptText(input);
    expect(result).not.toContain("\r");
    expect(result).toBe("hello world\nfoo bar");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizePromptText("  \n\nhello\n\n  ")).toBe("hello");
  });

  it("unbalanced fence — treats remainder as code, no change after orphan", () => {
    const input = "prose\n```\ncode block without closing fence\n  indented";
    const result = normalizePromptText(input);
    expect(result).toContain("  indented");
  });

  it("empty string returns empty string", () => {
    expect(normalizePromptText("")).toBe("");
  });

  it("preserves single blank line between paragraphs", () => {
    const input = "para1\n\npara2";
    expect(normalizePromptText(input)).toBe("para1\n\npara2");
  });
});
