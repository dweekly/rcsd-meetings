/**
 * Durable Opt-In Alert Subscription, Suppression & Dispatch Guard (Stage 4).
 *
 * Enforces four operational invariants (see sequenced-roadmap.md Stage 4):
 *   1. Double Opt-In State Machine (`pending` -> `active` -> `unsubscribed`):
 *      No alert is ever dispatched to a `pending` or `unsubscribed` record.
 *   2. Durable Suppression: Once `unsubscribed` (via RFC 8058 1-click POST,
 *      link click, or STOP/PARAR/BAJA), the suppression record is permanent
 *      unless the user completes a fresh double opt-in confirmation.
 *   3. Stale-Meeting Expiry Guard: Refuses to dispatch a pre-meeting alert if
 *      `meetingDate < todayDate`, preventing delayed scrapes from spamming
 *      "upcoming meeting" notices for past meetings.
 *   4. Idempotent `(meetingSlug, digestHash)` Deduplication: Re-running the
 *      pipeline on an unchanged agenda never sends a duplicate alert; only a
 *      material change in `digestHash` (e.g. an official addendum) can trigger
 *      an updated notice.
 */

import { createHash, randomBytes } from 'node:crypto';
import { hashCanonicalJson } from './provenance.mjs';

export function subscriberHashId(recipient) {
  const normalized = String(recipient || '').trim().toLowerCase();
  if (!normalized) throw new Error('recipient is required');
  return 'sub:' + createHash('sha256').update(normalized).digest('hex');
}

/**
 * Stable identity of an attachment: Simbli's attachment id plus the archived
 * filename and display name. A revised upload gets a new aid and usually a new
 * filename, so either change yields a new digest.
 */
function attachmentIdentity(att) {
  return {
    aid: att?.aid ?? null,
    filename: att?.filename ?? null,
    name: att?.name ?? att?.title ?? null,
    href: att?.href ?? null,
  };
}

/**
 * Digest of everything about a meeting's agenda that a subscriber would want to
 * be re-notified about. Inputs:
 *   - `meeting`: a `data/meetings-data.json` meeting (item labels, titles,
 *     action types, presenters, attachment identities)
 *   - `docketBrief` (optional): reviewed docket-brief top items
 *   - `boardMemos` (optional): `data/board-memos/{date}.json`; every memo field
 *     (abstract, recommendation, rationale, financial impact, speaker) and each
 *     item's attachment identities are included.
 * Scrape-only metadata (`scrapedAt`, per-item `provenance` editor stamps,
 * `plannedMinutes`) and derived fields (`memoLinks`) are excluded, so a re-scrape
 * of an unchanged agenda keeps the same digest.
 */
export function computeMeetingDigestHash(meeting, docketBrief = null, boardMemos = null) {
  const payload = {
    date: meeting?.date || null,
    slug: meeting?.slug || null,
    type: meeting?.type || null,
    zoom: meeting?.zoom || null,
    items: (meeting?.items || []).map((i) => ({
      itemLabel: i.itemLabel ?? null,
      title: i.title ?? null,
      actionType: i.actionType ?? null,
      speaker: i.speaker ?? null,
      attachments: (i.attachments || []).map(attachmentIdentity),
    })),
    memoItems: (boardMemos?.items || []).map((i) => ({
      order: i.order ?? null,
      title: i.title ?? null,
      memo: i.memo || null,
      attachments: (i.attachments || []).map(attachmentIdentity),
    })),
    briefTopItems: (docketBrief?.topItems || []).map((t) => ({
      itemLabel: t.itemLabel,
      titleEn: t.titleEn,
      whatIsProposedEn: t.whatIsProposedEn,
    })),
  };
  return hashCanonicalJson(payload);
}

/**
 * Generate RFC 8058 compliant List-Unsubscribe headers for email alerts.
 */
export function buildRfc8058Headers(unsubscribeUrl, supportEmail = 'team@rcsd.info') {
  if (!unsubscribeUrl || !/^https?:\/\//.test(unsubscribeUrl)) {
    throw new Error('unsubscribeUrl must be a valid HTTP(S) URL');
  }
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:${supportEmail}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * Create an in-memory or JSON-serializable subscription store.
 */
export function createSubscriptionStore(initialState = {}) {
  return {
    subscribers: { ...(initialState.subscribers || {}) },
    tokens: { ...(initialState.tokens || {}) },
    dispatchLog: { ...(initialState.dispatchLog || {}) },
  };
}

/** Remove a record's outstanding verification token from the lookup table. */
function revokeVerifyToken(store, sub) {
  if (sub?.verifyToken) delete store.tokens[`verify:${sub.verifyToken}`];
  if (sub) sub.verifyToken = null;
}

/**
 * Initiate a subscription request (Double Opt-In Step 1).
 *
 * - New, pending or unsubscribed recipient: the record becomes `pending` and
 *   any earlier verification token is revoked, so only the newest link works.
 * - Already-active recipient: the active record and its confirmed settings are
 *   left untouched. The requested settings are held in `pendingChange` and only
 *   applied when the new verification token is confirmed; until then alerts keep
 *   flowing under the confirmed settings.
 */
export function requestSubscription(
  store,
  {
    recipient,
    lang = 'en',
    channel = 'email',
    nowIso = new Date().toISOString(),
  }
) {
  const id = subscriberHashId(recipient);
  const verifyToken = randomBytes(24).toString('hex');
  const requestedLang = lang === 'es' ? 'es' : 'en';

  const existing = store.subscribers[id];
  if (existing) revokeVerifyToken(store, existing);

  if (existing?.status === 'active') {
    existing.verifyToken = verifyToken;
    existing.pendingChange = { lang: requestedLang, channel, requestedAt: nowIso };
    store.tokens[`verify:${verifyToken}`] = id;
    return {
      subscriberId: id,
      status: existing.status,
      pendingChange: true,
      verifyToken,
      unsubscribeToken: existing.unsubscribeToken,
    };
  }

  const record = {
    id,
    lang: requestedLang,
    channel,
    status: 'pending',
    requestedAt: nowIso,
    confirmedAt: null,
    unsubscribedAt: existing?.unsubscribedAt || null,
    unsubscribeReason: existing?.unsubscribeReason || null,
    verifyToken,
    pendingChange: null,
    unsubscribeToken: existing?.unsubscribeToken || randomBytes(24).toString('hex'),
  };

  store.subscribers[id] = record;
  store.tokens[`verify:${verifyToken}`] = id;
  store.tokens[`unsub:${record.unsubscribeToken}`] = id;

  return {
    subscriberId: id,
    status: record.status,
    pendingChange: false,
    verifyToken,
    unsubscribeToken: record.unsubscribeToken,
  };
}

/**
 * Confirm a double opt-in token (Step 2).
 *
 * The token must be the record's *current* verification token, and the record
 * must be awaiting it: `pending` (transitions to `active`) or `active` with a
 * `pendingChange` (the change is applied). A token revoked by a later request
 * or by an unsubscribe is rejected, so an old confirmation link can never lift
 * a suppression.
 */
export function confirmSubscription(store, verifyToken, nowIso = new Date().toISOString()) {
  const key = `verify:${verifyToken}`;
  const id = store.tokens[key];
  const sub = id ? store.subscribers[id] : null;
  const awaiting =
    sub && (sub.status === 'pending' || (sub.status === 'active' && sub.pendingChange));
  if (!sub || !verifyToken || sub.verifyToken !== verifyToken || !awaiting) {
    if (id) delete store.tokens[key];
    return { ok: false, error: 'invalid-verify-token' };
  }

  if (sub.status === 'active') {
    sub.lang = sub.pendingChange.lang;
    sub.channel = sub.pendingChange.channel;
  } else {
    sub.status = 'active';
    sub.unsubscribedAt = null;
    sub.unsubscribeReason = null;
  }
  sub.confirmedAt = nowIso;
  sub.pendingChange = null;
  revokeVerifyToken(store, sub);
  return { ok: true, subscriberId: id, status: sub.status };
}

/**
 * Permanently unsubscribe a recipient via their RFC 8058 one-click token or STOP command.
 * Any outstanding verification token (and pending settings change) is revoked.
 */
export function unsubscribeByToken(
  store,
  unsubscribeToken,
  reason = 'rfc8058-one-click',
  nowIso = new Date().toISOString()
) {
  const id = store.tokens[`unsub:${unsubscribeToken}`];
  if (!id || !store.subscribers[id]) {
    return { ok: false, error: 'invalid-unsubscribe-token' };
  }
  const sub = store.subscribers[id];
  sub.status = 'unsubscribed';
  sub.unsubscribedAt = nowIso;
  sub.unsubscribeReason = reason;
  sub.pendingChange = null;
  revokeVerifyToken(store, sub);
  return { ok: true, subscriberId: id, status: sub.status };
}

/**
 * Evaluate whether a pre-meeting alert may be dispatched to a subscriber,
 * and record the dispatch idempotently when permitted.
 */
export function evaluateAndRecordDispatch(
  store,
  {
    subscriberId,
    meetingSlug,
    meetingDate,
    digestHash,
    todayDate,
    nowIso = new Date().toISOString(),
  }
) {
  if (!meetingDate || !todayDate) {
    return { dispatch: false, reason: 'missing-date-parameters' };
  }

  // 1. Stale-meeting expiry guard: never send "upcoming meeting" alert for a past meeting
  if (meetingDate < todayDate) {
    return { dispatch: false, reason: 'stale-meeting-expired' };
  }

  // 2. Subscriber status & suppression guard
  const sub = store.subscribers[subscriberId];
  if (!sub) {
    return { dispatch: false, reason: 'subscriber-not-found' };
  }
  if (sub.status === 'unsubscribed') {
    return { dispatch: false, reason: 'subscriber-suppressed' };
  }
  if (sub.status !== 'active') {
    return { dispatch: false, reason: 'subscriber-pending-confirmation' };
  }

  // 3. Idempotent (meetingSlug, digestHash) deduplication guard
  const key = `${subscriberId}|${meetingSlug}`;
  const prior = store.dispatchLog[key];
  if (prior && prior.digestHash === digestHash) {
    return { dispatch: false, reason: 'duplicate-digest-suppressed', previousDispatch: prior };
  }

  const isUpdate = Boolean(prior && prior.digestHash !== digestHash);
  const entry = {
    subscriberId,
    meetingSlug,
    meetingDate,
    digestHash,
    dispatchedAt: nowIso,
    kind: isUpdate ? 'material-addendum-update' : 'initial-notice',
  };
  store.dispatchLog[key] = entry;

  return {
    dispatch: true,
    reason: entry.kind,
    entry,
  };
}
