#!/usr/bin/env node
/**
 * Drift watchdog — detects when the published site has fallen behind reality and
 * (optionally) self-heals by dispatching the ingestion pipeline, then alerts.
 *
 * It is deliberately INDEPENDENT of the GitHub Actions pipeline: run it from a
 * plain cron on trogdor (see docs/WATCHDOG.md) so it can also catch the pipeline
 * itself being down (runner offline, cron disabled, transcription silently
 * failing — the exact failure that left 2026-06-10 untranscribed).
 *
 * Checks (each gated on a grace window so fresh items don't flap):
 *   A. untranscribed   — a past meeting with a YouTube id but hasTranscript=false
 *   B. undiscovered    — a channel video whose id isn't in any meeting's `youtube`
 *   C. un-ingested     — a Simbli meeting (mid) absent from meetings-data.json,
 *                        excluding second MIDs for a date we already ingested
 *                        (Simbli re-posts happen; our store is keyed by date)
 *
 * Sources (all public except Simbli, which reuses the repo's scraper):
 *   - published index: https://data.rcsd.info/json/meetings-data.json
 *   - YouTube channel: yt-dlp --flat-playlist
 *   - Simbli listing:  node scripts/scrape-simbli-agendas.mjs --list-only --json
 *
 * On NEW gaps (not alerted within the cooldown): optionally dispatch the pipeline
 * (guarded — never while a run is queued/in-progress, and at most once per
 * cooldown), then notify via ntfy + Mailgun. No news → no notification. Always
 * exits 0 unless the watchdog itself errors, so it's cron-safe.
 *
 * Config via env (see docs/WATCHDOG.md):
 *   WATCHDOG_DATA_URL      default https://data.rcsd.info/json/meetings-data.json
 *   WATCHDOG_GRACE_HOURS   default 36
 *   WATCHDOG_COOLDOWN_HOURS default 12
 *   WATCHDOG_STATE_FILE    default ~/.local/state/rcsd-watchdog/state.json
 *   WATCHDOG_AUTO_TRIGGER  default "1" (set "0" for alert-only)
 *   WATCHDOG_DRY_RUN       set "1" to print decisions without dispatching/notifying
 *   GITHUB_REPO            default dweekly/rcsd-meetings
 *   GH_TOKEN / GITHUB_TOKEN  PAT with actions:write (dispatch) + actions:read
 *   NTFY_TOPIC             ntfy.sh topic for push alerts (optional)
 *   MAILGUN_API_KEY, MAILGUN_DOMAIN, ALERT_EMAIL  email alerts (optional)
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const CFG = {
  dataUrl: process.env.WATCHDOG_DATA_URL || 'https://data.rcsd.info/json/meetings-data.json',
  graceHours: Number(process.env.WATCHDOG_GRACE_HOURS || 36),
  cooldownHours: Number(process.env.WATCHDOG_COOLDOWN_HOURS || 12),
  stateFile: process.env.WATCHDOG_STATE_FILE
    || resolve(homedir(), '.local/state/rcsd-watchdog/state.json'),
  autoTrigger: (process.env.WATCHDOG_AUTO_TRIGGER ?? '1') !== '0',
  dryRun: process.env.WATCHDOG_DRY_RUN === '1',
  repo: process.env.GITHUB_REPO || 'dweekly/rcsd-meetings',
  ghToken: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '',
  ntfyTopic: process.env.NTFY_TOPIC || '',
  mailgunKey: process.env.MAILGUN_API_KEY || '',
  mailgunDomain: process.env.MAILGUN_DOMAIN || '',
  alertEmail: process.env.ALERT_EMAIL || '',
  channelUrl: 'https://www.youtube.com/@redwoodcityschooldistrict/videos',
};

const NOW = Date.now();
const GRACE_MS = CFG.graceHours * 3600_000;
const log = (...a) => console.error('[watchdog]', ...a); // status → stderr

// ---- state (dedup + cooldown) ----
function loadState() {
  try { return JSON.parse(readFileSync(CFG.stateFile, 'utf-8')); }
  catch { return { alerted: {}, lastTriggerAt: null }; }
}
function saveState(s) {
  mkdirSync(dirname(CFG.stateFile), { recursive: true });
  writeFileSync(CFG.stateFile, JSON.stringify(s, null, 2));
}
const withinCooldown = (iso) =>
  iso && (NOW - Date.parse(iso)) < CFG.cooldownHours * 3600_000;

// ---- source fetchers ----
async function fetchPublishedMeetings() {
  const res = await fetch(CFG.dataUrl, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`meetings-data.json HTTP ${res.status}`);
  const d = await res.json();
  return Array.isArray(d) ? d : (d.meetings || []);
}

function fetchChannelVideos() {
  // [{id, date 'YYYY-MM-DD'|null, title}]
  try {
    const raw = execFileSync('yt-dlp', [
      '--flat-playlist', '--print', '%(id)s|%(title)s|%(upload_date)s',
      '--playlist-end', '15', CFG.channelUrl,
    ], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 120_000 });
    return raw.trim().split('\n').filter(Boolean).map(line => {
      const [id, title, up] = line.split('|');
      const date = /^\d{8}$/.test(up || '')
        ? `${up.slice(0, 4)}-${up.slice(4, 6)}-${up.slice(6, 8)}` : null;
      return { id, title, date };
    });
  } catch (err) {
    log(`WARN: yt-dlp channel fetch failed: ${err.message?.slice(0, 120)}`);
    return null; // null = check unavailable (don't treat as "no videos")
  }
}

function fetchSimbliMeetings() {
  // [{date, mid, title, rawType}] — reuses the repo's playwright scraper.
  try {
    const raw = execFileSync('node', [
      resolve(ROOT, 'scripts/scrape-simbli-agendas.mjs'), '--list-only', '--json',
    ], { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 180_000, cwd: ROOT });
    return JSON.parse(raw.trim());
  } catch (err) {
    log(`WARN: Simbli list fetch failed: ${err.message?.slice(0, 120)}`);
    return null;
  }
}

// ---- gap detection ----
const olderThanGrace = (date) => date && (NOW - Date.parse(`${date}T23:59:59Z`)) > GRACE_MS;

// Simbli's listing reaches further back than our Simbli-sourced ingestion does;
// pre-June-2025 meetings came from other sources and have no `mid`, so checking
// them would report every one as un-ingested. Floor check C at the first month
// we ingest agendas from Simbli.
const SIMBLI_FLOOR_DATE = '2025-06-01';

// Returns { gaps, dupes }: `gaps` drive alerts + pipeline dispatch, `dupes` are
// logged only (see check C).
function findGaps(meetings, videos, simbli) {
  const gaps = [];
  const dupes = [];
  const ytIds = new Set(meetings.map(m => m.youtube).filter(Boolean));
  const mids = new Set(meetings.map(m => String(m.mid)).filter(Boolean));

  // A. discovered video, never transcribed, meeting is safely in the past
  for (const m of meetings) {
    if (m.youtube && m.hasTranscript === false && olderThanGrace(m.date)) {
      gaps.push({ key: `untranscribed:${m.youtube}`, kind: 'untranscribed',
        detail: `${m.date} (${m.youtube}) has no transcript` });
    }
  }
  // B. channel video not present in our data at all
  if (videos) {
    for (const v of videos) {
      if (!ytIds.has(v.id) && olderThanGrace(v.date)) {
        gaps.push({ key: `undiscovered:${v.id}`, kind: 'undiscovered',
          detail: `YouTube ${v.id} (${v.date}) "${(v.title || '').slice(0, 60)}" not in meetings-data` });
      }
    }
  }
  // C. Simbli meeting (agenda) we haven't ingested. Past or future — a newly
  //    posted agenda is worth surfacing even before the meeting happens.
  if (simbli) {
    // Dates we already ingested *from Simbli*. Our agenda store is keyed by
    // DATE (data/board-memos/{date}.json), not by MID, so a second Simbli
    // record for an already-ingested date cannot be "ingested" as a separate
    // meeting — it would overwrite the first. Treat it as a duplicate, not a
    // gap. Observed 2026-08-13: Simbli grew MIDs 80379/80380/80381 for the
    // June 11/18/25 2025 meetings already held as MIDs 45272/45380/47153,
    // which pinned the watchdog into alerting (and dispatching a full pipeline
    // run that can never clear it) every cooldown window.
    const ingestedSimbliDates = new Set(
      meetings.filter(m => m.mid).map(m => m.date),
    );
    for (const s of simbli) {
      if (s.date < SIMBLI_FLOOR_DATE || mids.has(String(s.mid))) continue;
      if (ingestedSimbliDates.has(s.date)) {
        dupes.push(`Simbli MID ${s.mid} (${s.date}) "${(s.title || '').slice(0, 60)}" `
          + 'duplicates an already-ingested meeting on that date — ignoring');
        continue;
      }
      gaps.push({ key: `uningested:${s.mid}`, kind: 'uningested',
        detail: `Simbli MID ${s.mid} (${s.date}) "${(s.title || '').slice(0, 60)}" not ingested` });
    }
  }
  return { gaps, dupes };
}

// ---- GitHub: in-flight check + dispatch ----
async function gh(path, init = {}) {
  return fetch(`https://api.github.com/repos/${CFG.repo}${path}`, {
    ...init,
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Bearer ${CFG.ghToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
}
async function pipelineRunInFlight() {
  for (const status of ['in_progress', 'queued']) {
    const r = await gh(`/actions/workflows/pipeline.yml/runs?status=${status}&per_page=1`);
    if (r.ok && (await r.json()).total_count > 0) return true;
  }
  return false;
}
async function dispatchPipeline() {
  const r = await gh('/actions/workflows/pipeline.yml/dispatches', {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs: { quick: 'false', runner: 'self-hosted' } }),
  });
  if (!r.ok) throw new Error(`dispatch HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// ---- notifications ----
async function notify(title, body) {
  if (CFG.dryRun) { log(`DRY-RUN notify: ${title}\n${body}`); return; }
  if (CFG.ntfyTopic) {
    await fetch(`https://ntfy.sh/${CFG.ntfyTopic}`, {
      method: 'POST', body,
      headers: { Title: title, Priority: 'high', Tags: 'warning,rcsd' },
      signal: AbortSignal.timeout(15_000),
    }).catch(e => log(`ntfy failed: ${e.message}`));
  }
  if (CFG.mailgunKey && CFG.mailgunDomain && CFG.alertEmail) {
    const form = new URLSearchParams({
      from: `RCSD Watchdog <watchdog@${CFG.mailgunDomain}>`,
      to: CFG.alertEmail, subject: title, text: body,
    });
    await fetch(`https://api.mailgun.net/v3/${CFG.mailgunDomain}/messages`, {
      method: 'POST', body: form,
      headers: { Authorization: `Basic ${Buffer.from(`api:${CFG.mailgunKey}`).toString('base64')}` },
      signal: AbortSignal.timeout(15_000),
    }).catch(e => log(`mailgun failed: ${e.message}`));
  }
}

// ---- main ----
async function main() {
  const meetings = await fetchPublishedMeetings();
  const videos = fetchChannelVideos();
  const simbli = fetchSimbliMeetings();
  log(`meetings=${meetings.length} videos=${videos ? videos.length : 'n/a'} simbli=${simbli ? simbli.length : 'n/a'}`);

  const { gaps, dupes } = findGaps(meetings, videos, simbli);
  for (const d of dupes) log(`  DUPE ${d}`);
  if (gaps.length === 0) { log('No drift. All clear.'); return; }

  const state = loadState();
  const fresh = gaps.filter(g => !withinCooldown(state.alerted[g.key]));
  log(`gaps=${gaps.length} fresh=${fresh.length}`);
  for (const g of gaps) log(`  ${fresh.includes(g) ? 'NEW ' : 'seen'} ${g.detail}`);

  if (fresh.length === 0) { log('All gaps already alerted within cooldown.'); return; }

  // Self-heal: dispatch the pipeline, guarded.
  let triggered = false, triggerNote = '';
  if (CFG.autoTrigger && CFG.ghToken) {
    if (withinCooldown(state.lastTriggerAt)) {
      triggerNote = `not re-triggering (last dispatch ${state.lastTriggerAt})`;
    } else if (await pipelineRunInFlight()) {
      triggerNote = 'a pipeline run is already queued/in-progress';
    } else if (CFG.dryRun) {
      triggerNote = 'DRY-RUN: would dispatch pipeline';
    } else {
      await dispatchPipeline();
      triggered = true;
      state.lastTriggerAt = new Date(NOW).toISOString();
      triggerNote = 'dispatched pipeline (self-hosted, full)';
    }
  } else {
    triggerNote = CFG.autoTrigger ? 'auto-trigger on but no GH token' : 'auto-trigger disabled';
  }
  log(`trigger: ${triggerNote}`);

  const body = [
    `rcsd.info watchdog found ${fresh.length} new gap(s):`,
    ...fresh.map(g => `• ${g.detail}`),
    '',
    `Action: ${triggered ? '✅ ' : ''}${triggerNote}.`,
    triggered ? 'A full pipeline run is now clearing it.' : 'Manual follow-up may be needed.',
  ].join('\n');
  await notify(`RCSD: ${fresh.length} ingestion gap(s)`, body);

  const stamp = new Date(NOW).toISOString();
  for (const g of fresh) state.alerted[g.key] = stamp;
  // prune entries older than 30d
  for (const k of Object.keys(state.alerted)) {
    if (NOW - Date.parse(state.alerted[k]) > 30 * 86400_000) delete state.alerted[k];
  }
  if (!CFG.dryRun) saveState(state);
}

main().catch(err => { log(`FATAL: ${err.stack || err.message}`); process.exit(1); });
