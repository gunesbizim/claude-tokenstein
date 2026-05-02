export interface UsageBucket {
  starting_at: string;
  ending_at: string;
  model: string;
  workspace_id: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface UsagePage {
  data: UsageBucket[];
  has_more: boolean;
  next_page?: string;
}
