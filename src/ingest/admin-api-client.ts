import { fetch } from "undici";
import type { UsageBucket, UsagePage } from "./admin-api-types.js";

const API_BASE = "https://api.anthropic.com";
const MAX_RETRIES = 5;

async function retryingFetch(url: string, apiKey: string): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429 || res.status >= 500) {
        const delay = 250 * Math.pow(2, attempt);
        await sleep(delay);
        lastErr = new Error(`HTTP ${res.status.toString()}`);
        continue;
      }
      return res as unknown as Response;
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES - 1) await sleep(250 * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function* paginateUsage(
  startingAt: string,
  apiKey: string,
): AsyncIterable<UsageBucket> {
  let page: string | undefined;
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  while (true) {
    const url = new URL(`${API_BASE}/v1/organizations/usage_report/messages`);
    url.searchParams.set("starting_at", startingAt);
    url.searchParams.set("bucket_width", "1h");
    url.searchParams.set("group_by", "model,workspace_id");
    url.searchParams.set("limit", "100");
    if (page) url.searchParams.set("page", page);

    const res = await retryingFetch(url.toString(), apiKey);
    const body = (await (res as unknown as { json(): Promise<unknown> }).json()) as UsagePage;

    for (const bucket of body.data) {
      if (bucket.starting_at > fiveMinAgo) continue;
      yield bucket;
    }

    if (!body.has_more || !body.next_page) return;
    page = body.next_page;
  }
}
