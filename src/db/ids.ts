import { createHash } from "node:crypto";
import { normalize } from "node:path";

export interface MessageIdInput {
  sessionId: string;
  isoTs: string;
  requestId: string | null;
  filePath?: string;
  lineOffset?: number;
  textHashHex?: string;
}

export function messageId(input: MessageIdInput): string {
  const parts: string[] = [input.sessionId, input.isoTs];
  if (input.requestId !== null) {
    parts.push(input.requestId);
  } else {
    if (!input.filePath || input.lineOffset == null || !input.textHashHex) {
      throw new Error("messageId: requestId null requires filePath/lineOffset/textHashHex");
    }
    const fp =
      process.platform === "win32"
        ? normalize(input.filePath).toLowerCase()
        : normalize(input.filePath);
    parts.push("null", fp, String(input.lineOffset), input.textHashHex);
  }
  const hex = createHash("sha256").update(parts.join("\x00")).digest("hex");
  return formatAsUuid(hex.slice(0, 32));
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
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
