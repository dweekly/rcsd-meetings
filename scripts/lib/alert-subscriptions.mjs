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

export function computeMeetingDigestHash(meeting, docketBrief = null) {
  const payload = {
    date: meeting?.date || null,
    slug: meeting?.slug || null,
    type: meeting?.type || null,
    zoom: meeting?.zoom || null,
    itemTitles: (meeting?.items || []).map((i) => i.title),
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

/**
 * Initiate a subscription request (Double Opt-In Step 1: status = "pending").
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
  const unsubscribeToken = randomBytes(24).toString('hex');

  const existing = store.subscribers[id];
  const record = {
    id,
    lang: lang === 'es' ? 'es' : 'en',
    channel,
    status: 'pending',
    requestedAt: nowIso,
    confirmedAt: null,
    unsubscribedAt: existing?.unsubscribedAt || null,
    unsubscribeReason: existing?.unsubscribeReason || null,
    verifyToken,
    unsubscribeToken: existing?.unsubscribeToken || unsubscribeToken,
  };

  store.subscribers[id] = record;
  store.tokens[`verify:${verifyToken}`] = id;
  store.tokens[`unsub:${record.unsubscribeToken}`] = id;

  return {
    subscriberId: id,
    status: record.status,
    verifyToken,
    unsubscribeToken: record.unsubscribeToken,
  };
}

/**
 * Confirm double opt-in token (Step 2: transitions `pending` -> `active`).
 */
export function confirmSubscription(store, verifyToken, nowIso = new Date().toISOString()) {
  const id = store.tokens[`verify:${verifyToken}`];
  if (!id || !store.subscribers[id]) {
    return { ok: false, error: 'invalid-verify-token' };
  }
  const sub = store.subscribers[id];
  sub.status = 'active';
  sub.confirmedAt = nowIso;
  sub.unsubscribedAt = null;
  sub.unsubscribeReason = null;
  delete store.tokens[`verify:${verifyToken}`];
  sub.verifyToken = null;
  return { ok: true, subscriberId: id, status: sub.status };
}

/**
 * Permanently unsubscribe a recipient via their RFC 8058 one-click token or STOP command.
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
  sub.verifyToken = null;
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
