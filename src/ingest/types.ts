export interface IngestStats {
  filesScanned: number;
  filesSkipped: number;
  linesRead: number;
  messagesInserted: number;
  promptsInserted: number;
  skipped: { truncated: number; noUsage: number; parseError: number };
  durationMs: number;
}
