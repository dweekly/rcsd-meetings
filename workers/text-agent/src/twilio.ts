// Twilio helpers: webhook signature validation + sending replies via the REST API.
//
// Signature scheme (https://www.twilio.com/docs/usage/security#validating-requests):
//   X-Twilio-Signature = Base64( HMAC-SHA1( authToken,
//       fullRequestUrl + concat(paramName + paramValue, sorted by name) ) )
// for application/x-www-form-urlencoded POSTs.

export interface TwilioEnv {
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
}

const encoder = new TextEncoder();

export async function computeTwilioSignature(
  authToken: string,
  url: string,
  params: URLSearchParams,
): Promise<string> {
  let data = url;
  for (const key of [...new Set([...params.keys()])].sort()) {
    // Twilio concatenates every value for repeated keys in order received.
    for (const value of params.getAll(key)) data += key + value;
  }
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

/** Constant-time string comparison (both inputs are short base64 strings). */
function timingSafeEqual(a: string, b: string): boolean {
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

export async function validateTwilioSignature(
  authToken: string,
  url: string,
  params: URLSearchParams,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const expected = await computeTwilioSignature(authToken, url, params);
  return timingSafeEqual(expected, signatureHeader);
}

/**
 * Send an outbound message via the Twilio REST API. `from`/`to` must carry the
 * channel prefix when replying on WhatsApp (e.g. "whatsapp:+1650...").
 */
export async function sendMessage(
  env: TwilioEnv,
  from: string,
  to: string,
  body: string,
): Promise<void> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }),
  });
  if (!res.ok) {
    throw new Error(`Twilio send failed: HTTP ${res.status} ${await res.text()}`);
  }
}

/** Empty TwiML — acknowledges the webhook without sending a reply. */
export function emptyTwiml(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    headers: { "content-type": "text/xml" },
  });
}

/** TwiML that sends one immediate reply (used for canned responses, no LLM). */
export function messageTwiml(text: string): Response {
  const escaped = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`,
    { headers: { "content-type": "text/xml" } },
  );
}
