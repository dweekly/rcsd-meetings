#!/usr/bin/env node
/**
 * Transcribe board meeting audio with AssemblyAI Universal 3 Pro.
 *
 * For each meeting with a YouTube video:
 *   1. Check if we already have a cached AssemblyAI transcript
 *   2. Download audio via yt-dlp to a temp file
 *   3. Upload to AssemblyAI, transcribe with speaker diarization
 *   4. Cache the full JSON response, clean up temp audio
 *
 * Cache: artifacts/transcripts-aai/{videoId}.json  (full AAI response)
 *
 * Usage:
 *   node scripts/transcribe-assemblyai.mjs                    # all unprocessed
 *   node scripts/transcribe-assemblyai.mjs --date 2026-01-14  # single meeting
 *   node scripts/transcribe-assemblyai.mjs --force            # reprocess all
 *   node scripts/transcribe-assemblyai.mjs --limit 5          # process at most 5
 *   node scripts/transcribe-assemblyai.mjs --oldest-first     # chronological order
 *
 * Env: ASSEMBLYAI_API_KEY (or pass via --key)
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { AssemblyAI } from 'assemblyai';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CACHE_DIR = resolve(ROOT, 'artifacts/transcripts-aai');
const AUDIO_DIR = resolve(ROOT, 'artifacts/audio');

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(AUDIO_DIR, { recursive: true });

// ---- Parse CLI args ----
const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}
const forceAll = args.includes('--force');
const oldestFirst = args.includes('--oldest-first');
const filterDate = arg('date');
const limit = arg('limit') ? parseInt(arg('limit'), 10) : Infinity;

if (process.env.RUNNER_ENVIRONMENT === 'github-hosted') {
  console.log('\n============================================================');
  console.log('WARNING: Running on a GitHub-hosted runner (github-hosted).');
  console.log('Skipping AssemblyAI transcription for any untranscribed videos');
  console.log('since audio cannot be downloaded from YouTube on datacenter IPs.');
  console.log('To transcribe new videos, run this pipeline on a self-hosted');
  console.log('residential runner from your home network.');
  console.log('============================================================\n');
  process.exit(0);
}

const apiKey = arg('key') || process.env.ASSEMBLYAI_API_KEY;

if (!apiKey) {
  console.error('Error: Set ASSEMBLYAI_API_KEY or pass --key <key>');
  process.exit(1);
}

const client = new AssemblyAI({ apiKey });

// ---- Load meetings ----
// Board meetings (kind 'board') from meetings-data.json plus committee recordings
// (kind = committee id, e.g. 'cboc') from data/committees/*.json. The AAI cache is keyed
// by video ID, so both kinds share all download/transcribe/cache machinery; only the
// prompt branches on kind.
const meetingsRaw = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8'));
const boardMeetings = (meetingsRaw.meetings || meetingsRaw)
  .filter(m => m.youtube)
  .map(m => ({ ...m, kind: m.kind ?? 'board' }));

const committeeMeetings = [];
const committeesDir = resolve(ROOT, 'data/committees');
if (existsSync(committeesDir)) {
  for (const file of readdirSync(committeesDir).filter(f => f.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(resolve(committeesDir, file), 'utf-8'));
    for (const m of c.meetings || []) {
      if (!m.youtube) continue;
      committeeMeetings.push({ ...m, kind: c.id, committeeType: c.type, committeeName: c.nameEn });
    }
  }
}

const meetings = [...boardMeetings, ...committeeMeetings]
  .sort((a, b) => oldestFirst
    ? a.date.localeCompare(b.date)
    : b.date.localeCompare(a.date));

console.log(`${meetings.length} meetings with video (${boardMeetings.length} board, ${committeeMeetings.length} committee)`);

function cachePath(videoId) {
  return resolve(CACHE_DIR, `${videoId}.json`);
}

async function hasCachedOrRestored(videoId, date) {
  const local = cachePath(videoId);
  if (!forceAll && existsSync(local)) return true;

  if (!forceAll) {
    try {
      const url = `https://data.rcsd.info/transcripts-aai/${videoId}.json`;
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        const data = JSON.parse(text);
        if (data.status === 'completed' || data.text) {
          writeFileSync(local, JSON.stringify(data, null, 2));
          console.log(`  [Cache Restore] Restored raw AssemblyAI transcript for ${date} (${videoId}) from CDN`);
          return true;
        }
      }
    } catch (err) {
      console.warn(`  [Cache Restore] Failed to check CDN cache for ${videoId}: ${err.message}`);
    }
  }
  return false;
}

/**
 * Download audio from YouTube to a local file via yt-dlp.
 * Skips download if audio already cached locally.
 * Returns the path to the audio file.
 */
function downloadAudio(videoId) {
  // Check if we already have it cached
  for (const ext of ['webm', 'm4a', 'opus', 'ogg', 'mp3']) {
    const p = resolve(AUDIO_DIR, `${videoId}.${ext}`);
    if (existsSync(p)) return p;
  }

  const outTemplate = resolve(AUDIO_DIR, `${videoId}.%(ext)s`);
  execFileSync('yt-dlp', [
    '-f', 'bestaudio',
    '--no-warnings',
    '-o', outTemplate,
    `https://www.youtube.com/watch?v=${videoId}`,
  ], { encoding: 'utf-8', timeout: 300_000, stdio: 'pipe' });

  for (const ext of ['webm', 'm4a', 'opus', 'ogg', 'mp3']) {
    const p = resolve(AUDIO_DIR, `${videoId}.${ext}`);
    if (existsSync(p)) return p;
  }
  throw new Error(`Audio file not found after download for ${videoId}`);
}

// ---- Board composition by date range ----
// Source: approved board minutes attendance sections
// Source: approved board minutes attendance records and swearing-in dates
const BOARD_ERAS = [
  {
    start: '2020-04-01', end: '2020-12-10',
    trustees: ['Dennis McBride', 'Janet Lawson', 'Alisa MacAvoy', 'María Díaz-Slocum', 'Cecilia I. Márquez'],
    superintendent: 'Dr. John R. Baker',
  },
  {
    start: '2020-12-11', end: '2022-12-13',
    trustees: ['Janet Lawson', 'Alisa MacAvoy', 'María Díaz-Slocum', 'Cecilia I. Márquez', 'Mike Wells'],
    superintendent: 'Dr. John R. Baker',
    // McBride departed Dec 2020; Wells, MacAvoy, Lawson sworn in
  },
  {
    start: '2022-12-14', end: '2024-12-16',
    trustees: ['Janet Lawson', 'Alisa MacAvoy', 'Cecilia I. Márquez', 'Mike Wells', 'David Weekly'],
    superintendent: 'Dr. John R. Baker',
    // Díaz-Slocum departed Dec 2022; Weekly and Márquez sworn in
  },
  {
    start: '2024-12-17', end: '2099-12-31',
    trustees: ['Cecilia I. Márquez', 'Mike Wells', 'David Weekly', 'David Li', 'Jennifer Ng Kwing King'],
    superintendent: 'Dr. John R. Baker (to Feb 2026), Dr. Christian Rubalcaba (from Mar 2026)',
    // Lawson and MacAvoy departed Dec 2024; Li and Ng Kwing King sworn in
  },
];

// Key district staff who frequently present at board meetings
const DISTRICT_STAFF = [
  'Wendy Kelly', 'Rick Edson', 'Anna Herrera', 'Patrinia Redd',
  'Martín Cervantes', 'Will Robertson', 'Carlos Reyna',
  'Evelyn Campos', 'Melissa Bowdoin', 'Kristy Jackson',
];

function getBoardEra(date) {
  for (const era of BOARD_ERAS) {
    if (date >= era.start && date <= era.end) return era;
  }
  return BOARD_ERAS[BOARD_ERAS.length - 1]; // fallback to latest
}

/**
 * Build a transcription prompt for a committee recording (kind !== 'board').
 * Committees have no board roster/agenda; CBOC gets bond-oversight context, other
 * committee types get a generic district-committee prompt. meeting.committeeName and
 * meeting.committeeType are attached when committee meetings are loaded.
 */
function buildCommitteePrompt(meeting) {
  const date = meeting.date;
  const name = meeting.committeeName || 'a district committee';

  if (meeting.committeeType === 'cboc' || meeting.kind === 'cboc') {
    return `You are transcribing a recording of a meeting of the Redwood City School District's Citizens' Bond Oversight Committee (CBOC) on ${date}. Accurately transcribe and diarize speakers. Do not include disfluencies or repetitions. If there is silence, produce no output for that segment. The meeting is mostly in English; some public comments may be in Spanish.

This committee provides independent oversight of how the district spends voter-approved general obligation bond funds — Measure S and Measure T — for school construction, modernization, and facilities projects. Discussion typically covers the bond program, capital projects, construction and budget updates, financial and performance audits, expenditure reports, and citizen oversight. Speakers include the committee chair, citizen committee members, and district staff (notably Rick Edson, Chief Business Official; plus facilities, construction, and finance staff).

Key terms: RCSD, CBOC, Citizens' Bond Oversight Committee, Measure S, Measure T, general obligation bond, GO bond, bond program, Proposition 39, Prop 39, financial audit, performance audit, expenditure report, capital projects, modernization, Master Facilities Plan, Brown Act, Rick Edson.`;
  }

  return `You are transcribing a recording of a meeting of ${name} (a committee of the Redwood City School District) on ${date}. Accurately transcribe and diarize speakers. Do not include disfluencies or repetitions. If there is silence, produce no output for that segment. The meeting is mostly in English; some public comments may be in Spanish. Speakers include the committee chair, committee members, and district staff. Key terms: RCSD, LCAP, Brown Act, English learners, DELAC, ELAC, SSC, SPSA.`;
}

/**
 * Build a transcription prompt with meeting context.
 * Universal-3 Pro supports up to 1,500 words of prompt context.
 * Note: prompt and keyterms_prompt are mutually exclusive in the API,
 * so we embed key terms directly in the prompt text.
 */
function buildPrompt(meeting) {
  if (meeting.kind && meeting.kind !== 'board') return buildCommitteePrompt(meeting);
  const date = meeting.date;
  const type = meeting.type || 'Board Meeting';
  const era = getBoardEra(date);

  const trusteesStr = era.trustees.map(t => `Trustee ${t.split(' ').pop()} (${t})`).join(', ');

  // Collect agenda item titles if available
  const agendaItems = (meeting.items || [])
    .filter(item => item.title)
    .map(item => item.title);
  const agendaSnippet = agendaItems.length > 0
    ? `\n\nAgenda items for this meeting:\n${agendaItems.slice(0, 40).join('\n')}`
    : '';

  return `You are transcribing a recording of a meeting of the Redwood City School District's Board of Trustees on ${date}. Accurately transcribe and diarize speakers. Do not include disfluencies or repetitions. If there is silence, produce no output for that segment. The meeting is mostly in English; some public comments may be in Spanish with a translation read aloud afterward.

Board of Trustees: ${trusteesStr}. Superintendent: ${era.superintendent}. Staff: ${DISTRICT_STAFF.join(', ')}.

Schools: Adelante Selby, Clifford, Garfield, Henry Ford, Hoover, Kennedy, McKinley Institute of Technology (MIT), North Star Academy, Orion, Roosevelt, Roy Cloud, Taft.

Key terms: RCSD, LCAP, SPSA, CAASPP, ELPAC, SARC, Measure U, Measure S, Measure T, Brown Act, ParentSquare, Simbli, RCTA, CSEA, DELAC, ELAC, IEP, MTSS, PBIS, TK, UCP, Williams, i-Ready, EL, SED, SWD, FRL.${agendaSnippet}`;
}

/**
 * Upload local audio to AssemblyAI and transcribe with diarization.
 * Uses Universal-3.5 Pro with a contextual prompt for best accuracy.
 * Falls back to Universal-2 for non-supported languages via speech_models array.
 * Returns the full transcript object.
 */
async function transcribe(audioPath, meeting) {
  const prompt = buildPrompt(meeting);

  const transcript = await client.transcripts.transcribe({
    audio: audioPath,
    speech_models: ['universal-3-5-pro', 'universal-2'], // Universal-3.5 Pro + Universal-2 fallback
    speaker_labels: true,
    speakers_expected: 10, // board meetings typically have 7-15 distinct speakers
    language_detection: true, // handle English/Spanish code-switching
    disfluencies: false, // omit um, uh, stutters
    remove_audio_tags: 'all', // strip [MUSIC], [APPLAUSE], etc.
    temperature: 0.1, // slight exploration for better accuracy per AAI docs
    prompt,
  });

  return transcript;
}

// ---- Main ----
async function main() {
  const toProcess = [];
  for (const m of meetings) {
    if (filterDate && m.date !== filterDate) continue;
    if (await hasCachedOrRestored(m.youtube, m.date)) continue;
    toProcess.push(m);
  }

  if (toProcess.length === 0) {
    console.log('All meetings already transcribed.');
    return;
  }

  const batch = toProcess.slice(0, limit);
  console.log(`Transcribing ${batch.length} meetings (${toProcess.length} total remaining)...\n`);

  let done = 0;
  let failed = 0;
  const totalHours = batch.reduce((s, m) => s + (m.durationSeconds || 0), 0) / 3600;
  console.log(`Estimated audio: ${totalHours.toFixed(1)} hours (~$${(totalHours * 0.37).toFixed(2)} at $0.37/hr)\n`);

  for (const mtg of batch) {
    const videoId = mtg.youtube;
    const label = `[${done + failed + 1}/${batch.length}] ${mtg.date} (${mtg.duration || '?'})`;
    let audioPath = null;

    try {
      console.log(`${label} — Downloading audio...`);
      audioPath = downloadAudio(videoId);
      console.log(`${label} — Uploading & transcribing with AssemblyAI...`);
      const transcript = await transcribe(audioPath, mtg);

      if (transcript.status === 'error') {
        console.error(`${label} — AssemblyAI error: ${transcript.error}`);
        failed++;
        continue;
      }

      // Cache full response
      writeFileSync(cachePath(videoId), JSON.stringify(transcript, null, 2));
      const words = transcript.words?.length || 0;
      const speakers = new Set(transcript.utterances?.map(u => u.speaker) || []).size;
      console.log(`${label} — Done: ${words} words, ${speakers} speakers\n`);
      done++;

    } catch (err) {
      console.error(`${label} — Failed: ${err.message?.slice(0, 200)}`);
      failed++;
    }
  }

  console.log(`\nComplete: ${done} transcribed, ${failed} failed, ${meetings.length - toProcess.length} already cached`);
  if (done > 0) {
    console.log(`Cached to: ${CACHE_DIR}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
