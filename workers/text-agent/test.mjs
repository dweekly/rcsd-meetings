#!/usr/bin/env node
// Integration tests for rcsd-text-agent, run against `wrangler dev` with the
// .dev.vars.example credentials (DRY_RUN=1 → no live Anthropic/Twilio calls).
//
//   cp .dev.vars.example .dev.vars && npx wrangler dev &   # port 8787
//   npm test          # or: node test.mjs http://localhost:8787
//
// House pattern: like workers/mcp-server/test.mjs, this hits a running endpoint
// rather than unit-testing internals.

import { createHmac } from 'node:crypto';

const BASE = process.argv[2] ?? 'http://localhost:8787';
// Must match TWILIO_AUTH_TOKEN in .dev.vars
const AUTH_TOKEN = 'dummy-auth-token';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.error(`FAIL  ${name} ${detail}`); }
}

// Twilio signature: Base64(HMAC-SHA1(token, url + sortedKey+value...))
function sign(url, params) {
  const sorted = [...params.keys()].sort();
  let data = url;
  for (const k of sorted) for (const v of params.getAll(k)) data += k + v;
  return createHmac('sha1', AUTH_TOKEN).update(data).digest('base64');
}

async function post(path, params, { signed = true, badSig = false } = {}) {
  const url = `${BASE}${path}`;
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  if (signed) headers['x-twilio-signature'] = badSig ? 'bogus=' : sign(url, params);
  const res = await fetch(url, { method: 'POST', headers, body: params });
  return { status: res.status, text: await res.text() };
}

function inboundParams(overrides = {}) {
  return new URLSearchParams({
    MessageSid: 'SMtest' + Math.random().toString(36).slice(2, 10),
    AccountSid: 'ACdummy',
    From: '+14155550100',
    To: '+16504828912',
    Body: 'test question',
    ...overrides,
  });
}

// ---- landing ----
{
  const res = await fetch(`${BASE}/`);
  const text = await res.text();
  check('GET / is 200', res.status === 200);
  check('landing names both lines', text.includes('482-8912') && text.includes('399-7203'));
}

// ---- signature enforcement ----
{
  const r1 = await post('/twilio/inbound', inboundParams(), { signed: false });
  check('inbound without signature → 403', r1.status === 403);
  const r2 = await post('/twilio/inbound', inboundParams(), { badSig: true });
  check('inbound with bad signature → 403', r2.status === 403);
  const r3 = await post('/twilio/status', new URLSearchParams({ MessageStatus: 'delivered' }), { signed: false });
  check('status without signature → 403', r3.status === 403);
}

// ---- canned handling (valid signatures from here on) ----
{
  const stop = await post('/twilio/inbound', inboundParams({ Body: 'STOP' }));
  check('STOP → 200 empty TwiML', stop.status === 200 && !stop.text.includes('<Message>'), stop.text);

  const helpEn = await post('/twilio/inbound', inboundParams({ Body: 'HELP' }));
  check('HELP (EN line) → canned English incl. verbatim rates line',
    helpEn.text.includes('<Message>') && helpEn.text.includes('Message and data rates may apply'),
    helpEn.text);

  const helpEs = await post('/twilio/inbound', inboundParams({ Body: 'AYUDA', To: '+16503997203' }));
  check('AYUDA (ES line) → canned Spanish', helpEs.text.includes('rcsd.info') && helpEs.text.includes('cancelar'), helpEs.text);

  const empty = await post('/twilio/inbound', inboundParams({ Body: '  ' }));
  check('empty body → text-only nudge', empty.text.includes('<Message>'), empty.text);
}

// ---- normal question ack (DRY_RUN: no external calls, must ack fast+empty) ----
{
  const t0 = Date.now();
  const res = await post('/twilio/inbound', inboundParams({ Body: 'When does school start?' }));
  const ms = Date.now() - t0;
  check('question → 200 empty TwiML (async pattern)', res.status === 200 && !res.text.includes('<Message>'), res.text);
  check(`ack under 2s (was ${ms}ms)`, ms < 2000);
}

// ---- WhatsApp variant ----
{
  const res = await post('/twilio/inbound', inboundParams({
    From: 'whatsapp:+14155550100', To: 'whatsapp:+16504828912', Body: 'hola',
  }));
  check('whatsapp-prefixed inbound accepted', res.status === 200, res.text);
}

// ---- sender rate cap: boundary notice once, then silence ----
{
  const from = '+14155550' + String(100 + Math.floor(Math.random() * 899)); // fresh sender
  let capNotice = null, afterCap = null;
  // cap is 30; send 32 (cheap: DRY_RUN skips LLM)
  for (let i = 1; i <= 32; i++) {
    const res = await post('/twilio/inbound', inboundParams({ From: from, Body: `q${i}` }));
    if (i === 31) capNotice = res.text;
    if (i === 32) afterCap = res.text;
  }
  check('31st message → over-cap notice', capNotice?.includes('<Message>'), capNotice ?? '');
  check('32nd message → silent empty TwiML', afterCap !== null && !afterCap.includes('<Message>'), afterCap ?? '');
}

// ---- status callback ----
{
  const params = new URLSearchParams({ MessageSid: 'SMx', MessageStatus: 'failed', ErrorCode: '30003', To: '+1' });
  const res = await post('/twilio/status', params);
  check('signed status callback → 204', res.status === 204);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
