#!/usr/bin/env node
// Spike: validate the Anthropic Messages API "MCP connector" against mcp.rcsd.info
// before building the text-agent worker around it.
//
// What this proves (or disproves):
//   1. The beta header + request shape work (anthropic-beta: mcp-client-2025-11-20,
//      per https://platform.claude.com/docs/en/agents-and-tools/mcp-connector).
//   2. Claude executes the rcsd.info MCP tools SERVER-SIDE in one request — the
//      worker will not need its own tool-execution loop.
//   3. Answer quality on the exact question that exposed the Synthflow chat failure
//      (Kennedy start date — correct answer: Tue Aug 12, 2025 for SY 2025-26... the
//      tool output is authoritative, the script prints whatever the model said plus
//      the tool trace so a human can judge).
//   4. Latency + token cost per answer, to sanity-check economics.
//
// Usage:  node spike-mcp-connector.mjs [question]
//         (reads ANTHROPIC_API_KEY from env or repo-root .env)
//
// Kept in the repo as a reproducible diagnostic: if the connector beta changes
// shape or mcp.rcsd.info regresses, re-run this before debugging the worker.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  // repo root .env (two levels up from workers/text-agent)
  try {
    const env = readFileSync(join(__dirname, '..', '..', '.env'), 'utf8');
    const m = env.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* fall through */ }
  console.error('ANTHROPIC_API_KEY not found in env or .env');
  process.exit(1);
}

// Same model the worker will use; house standard for quality work (no date suffix).
const MODEL = 'claude-sonnet-4-6';
const MCP_URL = 'https://mcp.rcsd.info/mcp';
const BETA = 'mcp-client-2025-11-20';

const SYSTEM = `You are "RCSD Info", answering TEXT MESSAGES (SMS) for rcsd.info, an independent, volunteer-run public information website about the Redwood City School District (RCSD) in Redwood City, California. You are NOT the school district and not district staff.
Keep replies SHORT - aim for one SMS (under ~300 characters) and never more than two. Plain text only: no markdown, no bullets.
ALWAYS use tools to answer factual questions. Never guess or invent facts, dates, or menu items.
Calendar rules: to find WHEN something happens (first or last day of school, breaks, holidays), call check-calendar with NO date and read the key-dates list. Only state that an event is on a date if a tool explicitly named that event on that date.`;

const question = process.argv[2] ??
  'What day does school start at Kennedy and when is drop off and pick up time';

const body = {
  model: MODEL,
  max_tokens: 1024,
  system: SYSTEM,
  messages: [{ role: 'user', content: question }],
  mcp_servers: [{ type: 'url', url: MCP_URL, name: 'rcsd-mcp' }],
  tools: [{ type: 'mcp_toolset', mcp_server_name: 'rcsd-mcp' }],
};

const t0 = Date.now();
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': loadApiKey(),
    'anthropic-version': '2023-06-01',
    'anthropic-beta': BETA,
  },
  body: JSON.stringify(body),
});
const ms = Date.now() - t0;

if (!res.ok) {
  console.error(`HTTP ${res.status} after ${ms}ms`);
  console.error(await res.text());
  process.exit(1);
}

const data = await res.json();

console.log(`# Q: ${question}`);
console.log(`# model=${data.model} stop=${data.stop_reason} latency=${ms}ms`);
console.log(`# tokens: in=${data.usage?.input_tokens} out=${data.usage?.output_tokens}`);
console.log('');
for (const block of data.content) {
  if (block.type === 'mcp_tool_use') {
    console.log(`[tool_use] ${block.name}(${JSON.stringify(block.input)})`);
  } else if (block.type === 'mcp_tool_result') {
    const text = (block.content ?? []).map((c) => c.text ?? '').join('').slice(0, 300);
    console.log(`[tool_result${block.is_error ? ' ERROR' : ''}] ${text.replace(/\n/g, ' | ')}…`);
  } else if (block.type === 'text') {
    console.log(`\n=== ANSWER ===\n${block.text}`);
  } else {
    console.log(`[${block.type}]`);
  }
}
