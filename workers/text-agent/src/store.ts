// KV-backed conversation context and rate counters.
//
// Privacy posture (matches the published policy at rcsd.info/privacy/, which
// discloses "conversation logs so the service works (e.g., follow-up questions)
// and to prevent abuse"): conversation keys are salted-hash pseudonymous, values
// expire after CONTEXT_TTL_S, and only the rolling turn window is kept.

import type { Turn } from "./agent";

// Follow-up context window: how long a thread stays "warm" after the last message.
export const CONTEXT_TTL_S = 60 * 60; // 1 hour
// Rolling window of turns sent back to the model (user+assistant messages).
export const MAX_CONTEXT_TURNS = 12;
// Abuse/cost guards. A family asking real questions sends a handful of texts a
// day; 30 is far above organic use but caps a runaway or hostile sender.
export const SENDER_DAILY_CAP = 30;
// Global backstop so a mass event can't run an unbounded API bill (~$0.03/answer
// at spike-measured token counts → worst case well under $20/day).
export const GLOBAL_DAILY_CAP = 500;

export interface StoreEnv {
  TEXT_AGENT_KV: KVNamespace;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Pseudonymous conversation key: same sender+line+channel → same thread. */
export async function conversationKey(
  channel: string,
  user: string,
  line: string,
): Promise<string> {
  return "conv:" + (await sha256Hex(`${channel}|${user}|${line}`));
}

export async function loadContext(env: StoreEnv, key: string): Promise<Turn[]> {
  const raw = await env.TEXT_AGENT_KV.get(key);
  if (!raw) return [];
  try {
    const turns = JSON.parse(raw) as Turn[];
    return Array.isArray(turns) ? turns : [];
  } catch {
    return [];
  }
}

export async function saveContext(env: StoreEnv, key: string, turns: Turn[]): Promise<void> {
  const window = turns.slice(-MAX_CONTEXT_TURNS);
  await env.TEXT_AGENT_KV.put(key, JSON.stringify(window), { expirationTtl: CONTEXT_TTL_S });
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Increment a daily counter and report whether `cap` is exceeded.
 * KV has no atomic increment; the read-modify-write race can undercount slightly,
 * which is acceptable for an abuse guard (caps are soft limits, not billing).
 */
export async function bumpDailyCounter(
  env: StoreEnv,
  scope: string,
  cap: number,
): Promise<{ count: number; overCap: boolean }> {
  const key = `cnt:${todayUtc()}:${scope}`;
  const count = parseInt((await env.TEXT_AGENT_KV.get(key)) ?? "0", 10) + 1;
  await env.TEXT_AGENT_KV.put(key, String(count), { expirationTtl: 2 * 86400 });
  return { count, overCap: count > cap };
}

export async function senderCounterScope(user: string): Promise<string> {
  return "sender:" + (await sha256Hex(user)).slice(0, 16);
}
