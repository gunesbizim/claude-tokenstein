export interface MessageRow {
  id: string;
  session_id: string;
  project_cwd: string;
  git_branch: string | null;
  ts: Date;
  model: string;
  service_tier: string | null;
  request_id: string | null;
  claude_version: string | null;
  source: "claude_code" | "admin_api";
  input_tokens: bigint;
  output_tokens: bigint;
  cache_creation_input_tokens: bigint;
  cache_read_input_tokens: bigint;
  cache_eph_1h_tokens: bigint;
  cache_eph_5m_tokens: bigint;
  web_search_requests: bigint;
  web_fetch_requests: bigint;
  user_prompt_id: string | null;
  response_text_id: string | null;
}

export interface PromptRow {
  id: string;
  role: "user" | "assistant";
  text: string;
  char_count: bigint;
}

export interface FilesSeenRow {
  path: string;
  mtime: Date;
  size_bytes: bigint;
  line_count: bigint;
  sha256: string;
}

export interface IngestStateRow {
  source: string;
  last_ingested_ts: Date | null;
  last_run_ts: Date | null;
  cursor: string | null;
}

export interface PriceRow {
  model: string;
  effective_from: Date;
  input_per_mtok_usd: number;
  output_per_mtok_usd: number;
  cache_write_per_mtok_usd: number;
  cache_read_per_mtok_usd: number;
}

export interface FxRateRow {
  date: Date;
  usd_eur: number;
  fetched_at: Date;
  source: string;
}
