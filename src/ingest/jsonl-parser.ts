export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: unknown; id: string }
  | { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: string; [k: string]: unknown };

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  service_tier?: string;
  server_tool_use?: {
    web_search_requests?: number;
    web_fetch_requests?: number;
  };
}

export interface ParsedLine {
  raw: string;
  uuid?: string;
  parentUuid?: string | null;
  type?: "user" | "assistant" | "system" | "summary" | string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  cliVersion?: string;
  message?: {
    role?: "user" | "assistant";
    content?: ContentBlock[] | string;
    model?: string;
    usage?: Usage;
    id?: string;
  };
}

export function parseLine(raw: string): ParsedLine | null {
  try {
    const trimmed = raw.replace(/\r$/, "");
    return { raw: trimmed, ...(JSON.parse(trimmed) as object) } as ParsedLine;
  } catch {
    return null;
  }
}

export function isHumanUserLine(p: ParsedLine): boolean {
  if (p.type !== "user") return false;
  const content = p.message?.content;
  if (typeof content === "string") return true;
  if (!Array.isArray(content)) return false;
  return content.some((b) => b.type !== "tool_result");
}

export function resolveUserPrompt(
  current: ParsedLine,
  byUuid: Map<string, ParsedLine>,
): ParsedLine | null {
  let cursor = current.parentUuid ? byUuid.get(current.parentUuid) : undefined;
  let hops = 0;
  while (cursor && hops < 50) {
    if (isHumanUserLine(cursor)) return cursor;
    cursor = cursor.parentUuid ? byUuid.get(cursor.parentUuid) : undefined;
    hops++;
  }
  return null;
}

export function extractTextContent(content: ContentBlock[] | string | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}
