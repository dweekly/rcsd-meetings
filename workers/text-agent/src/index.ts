// rcsd-text-agent — answers SMS/WhatsApp for the rcsd.info info lines.
//
// Flow: Twilio webhook → signature check → canned-response guards → ack empty
// TwiML immediately (LLM latency is ~6-12 s, far over Twilio's webhook budget) →
// ctx.waitUntil(): KV context → one Claude call (MCP connector runs the
// mcp.rcsd.info tools server-side) → reply via Twilio REST → save context.
//
// See README.md for deploy/cutover/rollback.

import { generateReply, type Turn } from "./agent";
import { ES_LINE, promptsForLine } from "./prompts";
import {
  bumpDailyCounter, conversationKey, GLOBAL_DAILY_CAP, loadContext, saveContext,
  SENDER_DAILY_CAP, senderCounterScope, type StoreEnv,
} from "./store";
import {
  emptyTwiml, messageTwiml, sendMessage, validateTwilioSignature, type TwilioEnv,
} from "./twilio";

export interface Env extends TwilioEnv, StoreEnv {
  ANTHROPIC_API_KEY: string;
  // The exact public base URL Twilio is configured to call (protocol + host).
  // Signature validation must use the URL as Twilio signed it; request.url can't
  // be trusted for this (wrangler rewrites the host to the route's custom domain
  // even under `wrangler dev`). Set in wrangler.toml [vars]; overridden in
  // .dev.vars for local tests.
  PUBLIC_BASE_URL: string;
  // Set in .dev.vars for local integration tests: skips outbound Anthropic/Twilio
  // calls so tests exercise webhook handling without live credentials.
  DRY_RUN?: string;
}

// Carrier-standard opt-out keywords (Twilio Advanced Opt-Out intercepts these on
// SMS before we ever see them; handling them here is defense-in-depth and covers
// WhatsApp, which has no carrier opt-out layer).
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const HELP_WORDS = new Set(["HELP", "INFO", "AYUDA"]);

// Canned texts (no LLM). Rates line must stay verbatim per A2P registration.
const HELP_EN =
  "rcsd.info info line: text me any question about Redwood City School District schools, calendars, menus, or board meetings. Message and data rates may apply. Reply STOP to opt out. Support: team@rcsd.info";
const HELP_ES =
  "Línea de info de rcsd.info: mándame cualquier pregunta sobre las escuelas, calendarios, menús o juntas de la mesa directiva del Distrito Escolar de Redwood City. Pueden aplicar tarifas de mensajes y datos. Responde STOP para cancelar. Ayuda: team@rcsd.info";
const OVER_CAP_EN =
  "You've reached today's message limit for this free service. Please try again tomorrow, or visit rcsd.info.";
const OVER_CAP_ES =
  "Llegaste al límite de mensajes de hoy para este servicio gratuito. Intenta de nuevo mañana, o visita rcsd.info.";
const BUSY_EN = "This free service is very busy right now. Please try again later, or visit rcsd.info.";
const BUSY_ES = "Este servicio gratuito está muy ocupado ahorita. Intenta más tarde, o visita rcsd.info.";
const ERROR_EN = "Sorry, something went wrong on my end. Please try again in a bit, or visit rcsd.info.";
const ERROR_ES = "Perdón, algo salió mal de mi lado. Intenta de nuevo en un ratito, o visita rcsd.info.";
const TEXT_ONLY_EN = "I can only read text messages — please send your question as text.";
const TEXT_ONLY_ES = "Solo puedo leer mensajes de texto — por favor manda tu pregunta escrita.";

const LANDING = `rcsd-text-agent — SMS/WhatsApp answering service for the rcsd.info info lines.
English: (650) 482-8912 · Español: (650) 399-7203
Webhooks: POST /twilio/inbound, POST /twilio/status
Data & privacy: https://rcsd.info/privacy/ · Terms: https://rcsd.info/terms/
Source: https://github.com/dweekly/rcsd-meetings (workers/text-agent)`;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(LANDING, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (request.method === "POST" && url.pathname === "/twilio/inbound") {
      return handleInbound(request, env, ctx);
    }
    if (request.method === "POST" && url.pathname === "/twilio/status") {
      return handleStatus(request, env);
    }
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function readValidatedParams(
  request: Request,
  env: Env,
): Promise<URLSearchParams | null> {
  const bodyText = await request.text();
  const params = new URLSearchParams(bodyText);
  const url = new URL(request.url);
  const signedUrl = env.PUBLIC_BASE_URL + url.pathname + url.search;
  const ok = await validateTwilioSignature(
    env.TWILIO_AUTH_TOKEN,
    signedUrl,
    params,
    request.headers.get("x-twilio-signature"),
  );
  return ok ? params : null;
}

async function handleInbound(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const params = await readValidatedParams(request, env);
  if (!params) return new Response("invalid signature", { status: 403 });

  const rawFrom = params.get("From") ?? ""; // "whatsapp:+1415..." or "+1415..."
  const rawTo = params.get("To") ?? ""; // our line, same prefix convention
  const body = (params.get("Body") ?? "").trim();
  if (!rawFrom || !rawTo) return new Response("bad request", { status: 400 });

  const channel = rawFrom.startsWith("whatsapp:") ? "whatsapp" : "sms";
  const line = rawTo.replace(/^whatsapp:/, "");
  const user = rawFrom.replace(/^whatsapp:/, "");
  const isSpanish = line === ES_LINE;

  const keyword = body.toUpperCase();
  if (STOP_WORDS.has(keyword)) return emptyTwiml(); // carrier layer owns the confirmation
  if (HELP_WORDS.has(keyword)) return messageTwiml(isSpanish ? HELP_ES : HELP_EN);
  if (!body) return messageTwiml(isSpanish ? TEXT_ONLY_ES : TEXT_ONLY_EN);

  // Rate guards: notify exactly once at the boundary, then go silent (a chatty
  // over-cap reply to every message would itself be an abuse vector).
  const sender = await bumpDailyCounter(env, await senderCounterScope(user), SENDER_DAILY_CAP);
  if (sender.overCap) {
    return sender.count === SENDER_DAILY_CAP + 1
      ? messageTwiml(isSpanish ? OVER_CAP_ES : OVER_CAP_EN)
      : emptyTwiml();
  }
  const global = await bumpDailyCounter(env, "global", GLOBAL_DAILY_CAP);
  if (global.overCap) {
    return global.count === GLOBAL_DAILY_CAP + 1
      ? messageTwiml(isSpanish ? BUSY_ES : BUSY_EN)
      : emptyTwiml();
  }

  if (env.DRY_RUN) {
    // Integration tests: record the turn, skip external calls.
    ctx.waitUntil(recordDryRun(env, channel, user, line, body));
    return emptyTwiml();
  }

  ctx.waitUntil(answerAsync(env, { channel, user, line, rawFrom, rawTo, body, isSpanish }));
  return emptyTwiml();
}

interface InboundMsg {
  channel: string;
  user: string;
  line: string;
  rawFrom: string;
  rawTo: string;
  body: string;
  isSpanish: boolean;
}

async function answerAsync(env: Env, msg: InboundMsg): Promise<void> {
  const { system, disclosure } = promptsForLine(msg.line);
  const key = await conversationKey(msg.channel, msg.user, msg.line);
  try {
    const history = await loadContext(env, key);
    const isFirstContact = history.length === 0;
    const turns: Turn[] = [...history, { role: "user", content: msg.body }];

    let reply = await generateReply(env.ANTHROPIC_API_KEY, system, turns);
    if (!reply) reply = msg.isSpanish ? ERROR_ES : ERROR_EN;
    if (isFirstContact) reply = disclosure + reply;

    await sendMessage(env, msg.rawTo, msg.rawFrom, reply);
    await saveContext(env, key, [...turns, { role: "assistant", content: reply }]);
  } catch (err) {
    console.error("answerAsync failed", { channel: msg.channel, line: msg.line, err: String(err) });
    try {
      await sendMessage(env, msg.rawTo, msg.rawFrom, msg.isSpanish ? ERROR_ES : ERROR_EN);
    } catch (sendErr) {
      console.error("error-reply send failed", String(sendErr));
    }
  }
}

async function recordDryRun(
  env: Env, channel: string, user: string, line: string, body: string,
): Promise<void> {
  const key = await conversationKey(channel, user, line);
  const history = await loadContext(env, key);
  await saveContext(env, key, [...history, { role: "user", content: body }]);
}

async function handleStatus(request: Request, env: Env): Promise<Response> {
  const params = await readValidatedParams(request, env);
  if (!params) return new Response("invalid signature", { status: 403 });
  const status = params.get("MessageStatus") ?? "";
  if (status === "failed" || status === "undelivered") {
    console.error("delivery failure", {
      sid: params.get("MessageSid"),
      to: params.get("To"),
      status,
      errorCode: params.get("ErrorCode"),
    });
  }
  return new Response(null, { status: 204 });
}

