# rcsd-text-agent

Self-hosted SMS/WhatsApp answering service for the rcsd.info info lines —
English **(650) 482-8912**, Spanish **(650) 399-7203**. Replaces the Synthflow
chat agents (whose backend failed server-side, 2026-07-21; voice remains on
Synthflow). Fresh as of 2026-07-21.

## How it works

```
Twilio (SMS via Messaging Service MGdd84695… / WhatsApp via sender webhooks)
  → POST https://text.rcsd.info/twilio/inbound
      1. X-Twilio-Signature validation (HMAC-SHA1 against PUBLIC_BASE_URL —
         request.url can't be trusted: wrangler rewrites the host to the
         custom domain even in dev)
      2. STOP → empty TwiML (carrier Advanced Opt-Out owns SMS opt-out; this is
         defense-in-depth and covers WhatsApp) · HELP/AYUDA → canned bilingual
         reply with the verbatim A2P rates line
      3. KV rate guards (per-sender 30/day, global 500/day; boundary notice
         once, then silence)
      4. Ack empty TwiML immediately, then in ctx.waitUntil():
         KV conversation context (SHA-256 pseudonymous key, 1 h TTL, 12-turn
         window) → ONE Anthropic Messages API call — the MCP connector
         (anthropic-beta: mcp-client-2025-11-20) executes the mcp.rcsd.info
         tools server-side, no tool loop here — → reply via Twilio REST →
         save context.
  → POST /twilio/status → 204, logs failed/undelivered
```

- Model: `claude-sonnet-4-6` (house standard for quality work; no date suffix).
- EN/ES system prompt chosen by which line was texted (`src/prompts.ts`, ported
  from the Synthflow V4 prompts; adds a link whitelist because the spike showed
  URL hallucination under a minimal prompt).
- First reply of a fresh conversation gets a deterministic AI/independence
  disclosure prefix (CA B&P §17941) injected by the worker, not the model.
- Privacy posture matches rcsd.info/privacy/: pseudonymous keys, 1 h context
  TTL, no message archive beyond the rolling window.

## Files

| File | Purpose |
|---|---|
| `src/index.ts` | Webhook routing, validation, guards, async orchestration |
| `src/agent.ts` | Messages API + MCP connector call, SMS sanitization |
| `src/prompts.ts` | EN/ES system prompts + disclosure prefixes |
| `src/store.ts` | KV context + daily counters (documented caps) |
| `src/twilio.ts` | Signature validation, REST send, TwiML helpers |
| `spike-mcp-connector.mjs` | Reproducible diagnostic: proves the MCP connector shape/quality; run if the beta changes or answers regress |
| `test.mjs` | Integration tests vs `wrangler dev` (no live creds; DRY_RUN) |

## Develop & test

```sh
cp .dev.vars.example .dev.vars
npm install
npm run typecheck
npx wrangler dev &          # port 8787
npm test                    # 15 checks: signatures, canned paths, caps, ack latency
node spike-mcp-connector.mjs "When is the next board meeting?"   # live API spike
```

## Deploy

```sh
npx wrangler kv namespace create TEXT_AGENT_KV   # once; id goes in wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TWILIO_ACCOUNT_SID
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler deploy                              # custom domain text.rcsd.info
```

## Cutover / rollback (Twilio console)

Point these at `https://text.rcsd.info/twilio/inbound` (+ `/twilio/status` for
status callbacks):

1. **SMS**: Messaging Service `MGdd84695…` → Integration → Incoming Messages
   "Send a webhook". Service-level config overrides number-level and covers both
   numbers.
2. **WhatsApp**: each sender (Messaging → Senders → WhatsApp senders) →
   Messaging Endpoint Configuration → webhook + status callback URLs. Leave the
   "Messaging service" selector empty.

**Rollback** = restore `https://chat.synthflow.ai/webhooks/twilio/inbound` and
`…/status` in the same fields (Synthflow chat agents are parked, not deleted).

Full A2P/WhatsApp registration playbook: `../../plugin/skills/a2p-campaign/SKILL.md`.
