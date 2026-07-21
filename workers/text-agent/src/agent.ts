// One-shot Claude call with the MCP connector: the Messages API executes the
// mcp.rcsd.info tools server-side within a single request, so this worker never
// runs a tool loop. Verified by ../spike-mcp-connector.mjs (2026-07-21).
// Docs: https://platform.claude.com/docs/en/agents-and-tools/mcp-connector

// House model for quality work in this repo (see scripts/translate-policy-titles.mjs);
// Claude API model IDs carry no date suffix.
const MODEL = "claude-sonnet-4-6";
const MCP_URL = "https://mcp.rcsd.info/mcp";
const MCP_CONNECTOR_BETA = "mcp-client-2025-11-20";
// Replies are instructed to fit ~1 SMS; 1024 tokens is generous headroom for the
// model's tool-calling turns plus the final answer.
const MAX_TOKENS = 1024;
// Twilio rejects message bodies over 1600 chars; stay under with margin.
const MAX_REPLY_CHARS = 1500;

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface ContentBlock {
  type: string;
  text?: string;
}

/**
 * Ask Claude to answer `turns` (last turn is the new user message) with the
 * rcsd.info MCP tools. Returns the final reply text (last text block — earlier
 * text blocks are pre-tool narration we don't want in an SMS).
 */
export async function generateReply(
  apiKey: string,
  system: string,
  turns: Turn[],
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": MCP_CONNECTOR_BETA,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: turns,
      mcp_servers: [{ type: "url", url: MCP_URL, name: "rcsd-mcp" }],
      tools: [{ type: "mcp_toolset", mcp_server_name: "rcsd-mcp" }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API error: HTTP ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { content: ContentBlock[] };
  const textBlocks = data.content.filter((b) => b.type === "text" && b.text);
  const answer = textBlocks.length ? textBlocks[textBlocks.length - 1].text! : "";
  return sanitizeForSms(answer);
}

/** Strip markdown artifacts and cap length for SMS delivery. */
export function sanitizeForSms(text: string): string {
  let out = text
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1") // italics
    .replace(/^#+\s*/gm, "") // headings
    .replace(/^\s*[-•]\s+/gm, "") // bullets
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 $2") // links -> text + url
    .trim();
  if (out.length > MAX_REPLY_CHARS) out = out.slice(0, MAX_REPLY_CHARS - 1) + "…";
  return out;
}
