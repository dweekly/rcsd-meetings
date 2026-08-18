#!/usr/bin/env node
/**
 * Extract the student CLUBS and extracurricular ACTIVITIES each RCSD school
 * mentions during its annual "school site presentation" to the Board of
 * Trustees, from the board-meeting transcripts.
 *
 * WHY transcripts (not the decks): the site-presentation PDF decks are
 * data decks (LCAP goals, CAASPP/i-Ready, attendance) and mention clubs only
 * incidentally, often as images that don't extract. Principals NAME their
 * clubs aloud, so the AssemblyAI transcripts are the richest source.
 *
 * This is BEST-EFFORT, AI-EXTRACTED data — it reflects only what a principal
 * chose to say on their presentation night, not an authoritative club roster.
 * Output is labeled as such and every club carries an evidence quote.
 *
 * Method: for each school-presentation meeting (last 3 years), slice the
 * transcript text and ask Claude (claude-sonnet-4-6) to list named clubs
 * attributed to the correct presenting school. Cached per meeting so re-runs
 * only call the API for new/uncached meetings.
 *
 * Output: data/school-clubs.json
 *
 * Usage:
 *   node scripts/extract-school-clubs.mjs           # process uncached meetings
 *   node scripts/extract-school-clubs.mjs --force    # re-extract all
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
// @anthropic-ai/sdk is imported lazily (only when a meeting is uncached) so a
// fully-cached re-run needs neither the SDK nor an API key.

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CACHE_DIR = resolve(ROOT, 'data/school-clubs-cache');
const MODEL = 'claude-sonnet-5';
const FORCE = process.argv.includes('--force');

const SCHOOL_SLUGS = {
  adelante: 'adelante-selby', selby: 'adelante-selby', clifford: 'clifford',
  garfield: 'garfield', 'henry ford': 'henry-ford', hoover: 'hoover',
  kennedy: 'kennedy', mckinley: 'mckinley-mit', mit: 'mckinley-mit',
  'institute of tech': 'mckinley-mit', 'north star': 'north-star',
  northstar: 'north-star', nsa: 'north-star', orion: 'orion',
  roosevelt: 'roosevelt', 'roy cloud': 'roy-cloud', taft: 'taft',
};
const SCHOOL_NAMES = {
  'adelante-selby': 'Adelante Selby', clifford: 'Clifford', garfield: 'Garfield',
  'henry-ford': 'Henry Ford', hoover: 'Hoover', kennedy: 'Kennedy',
  'mckinley-mit': 'McKinley / MIT', 'north-star': 'North Star', orion: 'Orion',
  roosevelt: 'Roosevelt', 'roy-cloud': 'Roy Cloud', taft: 'Taft',
};

const CATEGORIES = 'environmental | arts | stem | sports | service | academic | social | other';

// --- Fuzzy club-name matching (per-school dedup across years) ---
// Filler/stop words that vary between years or carry no identity.
const CLUB_STOP = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'at', 'to', 'with',
  'program', 'club', 'initiative', 'group']);
// Normalize a club name to its set of significant tokens: lowercase, drop
// parentheticals, stem mentor*, strip punctuation and filler/stop words.
function clubTokens(name) {
  return new Set(
    String(name).toLowerCase()
      .replace(/\([^)]*\)/g, ' ')                 // drop "(Associated Student Body)"
      .replace(/mentorship|mentoring/g, 'mentor')  // mentoring ≈ mentorship
      .replace(/[^a-z0-9]+/g, ' ')                 // punctuation → space
      .split(' ')
      .filter(t => t && !CLUB_STOP.has(t))
  );
}
// Two clubs are the same if their token sets are equal, or one is a subset of
// the other AND the smaller set has ≥2 significant tokens — so "Rainbow Cloud"
// folds into "GSA / Rainbow Cloud", but a lone shared word ("Math") never merges
// distinct clubs ("Math Club" vs "Math Olympiad").
function sameClub(a, b) {
  if (!a || !b || a.size === 0 || b.size === 0) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  if (![...small].every(t => big.has(t))) return false;
  return small.size === big.size || small.size >= 2;
}

function transcriptText(path) {
  const j = JSON.parse(readFileSync(path, 'utf-8'));
  if (Array.isArray(j.utterances)) {
    return j.utterances.map(u => `${u.speaker || '?'}: ${u.text || ''}`).join('\n');
  }
  return typeof j.text === 'string' ? j.text : '';
}

// Presentation nights (last 3 school years) → presenting school slugs.
function findPresentationNights() {
  const meetings = JSON.parse(readFileSync(resolve(ROOT, 'data/meetings-data.json'), 'utf-8')).meetings;
  const yt = JSON.parse(readFileSync(resolve(ROOT, 'data/youtube-index.json'), 'utf-8'));
  const videoByDate = {};
  for (const e of yt) if (e.kind === 'board' && e.date && !videoByDate[e.date]) videoByDate[e.date] = e.id;

  const rx = /School Presentation|Presentation for the 20|School Report/i;
  const nights = {};
  for (const m of meetings) {
    const date = m.date || '';
    if (date < '2023-08') continue;
    for (const it of m.items || []) {
      const t = it.title || '';
      if (!rx.test(t)) continue;
      const low = t.toLowerCase();
      const slugs = new Set(nights[date] || []);
      for (const [kw, slug] of Object.entries(SCHOOL_SLUGS)) if (low.includes(kw)) slugs.add(slug);
      if (slugs.size) nights[date] = [...slugs];
    }
  }
  return Object.entries(nights)
    .map(([date, schools]) => ({ date, schools, videoId: videoByDate[date] }))
    .filter(n => n.videoId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function getClient() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic();
}

async function extractNight(getClientFn, night) {
  const cachePath = resolve(CACHE_DIR, `${night.date}.json`);
  if (!FORCE && existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'));
    // Legacy cache entries are a bare clubs array with no model attribution;
    // all were generated by claude-sonnet-4-6 (pre-2026-08-18, before the
    // Sonnet 5 migration). Current entries are { model, clubs } so provenance
    // survives model changes without invalidating paid extractions.
    return Array.isArray(cached)
      ? { model: 'claude-sonnet-4-6', clubs: cached }
      : { model: cached.model, clubs: cached.clubs };
  }

  const tPath = resolve(ROOT, 'artifacts/transcripts-aai', `${night.videoId}.json`);
  if (!existsSync(tPath)) {
    console.log(`  [${night.date}] no transcript (${night.videoId}) — skipped`);
    return { model: null, clubs: [] };
  }
  const text = transcriptText(tPath);
  const schoolList = night.schools.map(s => `${SCHOOL_NAMES[s] || s} (${s})`).join(', ');

  const prompt = `You are extracting the STUDENT CLUBS and extracurricular ACTIVITIES that each Redwood City School District (RCSD) school mentions during its annual "school site presentation" to the Board of Trustees.

This transcript is the board meeting of ${night.date}. Schools presenting: ${schoolList}. Each school's principal/team presents a segment (the chair introduces "the X School presentation").

For EACH school, extract every named student club or extracurricular activity offered AT THAT SCHOOL.
INCLUDE named clubs/activities students join: Garden Club, Green Team, Chess Club, Robotics, Coding, Student Council/Leadership, Drama/Theater, Choir/Band/Ukulele, Dungeons & Dragons, Knitting, Book Club, Homework Club, Kindness Club, Safe School Ambassadors, intramural sports, specifically-named after-school enrichment.
EXCLUDE academic programs/curricula (MTSS, PBIS, ELD, iReady, SPSA), the generic "Boys & Girls Club" partnership, and staff-only initiatives.
Attribute each club to the correct school using the presentation boundaries. Only extract what is actually stated — never invent. Categorize each: ${CATEGORIES}.

Respond with ONLY a JSON array (no markdown):
[{"school_slug":"...","meetingDate":"${night.date}","club_name":"...","category":"...","evidence_quote":"<=20 word quote"}]

Transcript:
${text}`;

  const client = await getClientFn();
  const resp = await client.messages.create({
    model: MODEL,
    // Disable Sonnet 5's default adaptive thinking — list extraction doesn't
    // need billed reasoning tokens.
    thinking: { type: 'disabled' },
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });
  let raw = resp.content[0].text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  let clubs;
  try { clubs = JSON.parse(raw); }
  catch { console.log(`  [${night.date}] JSON parse failed`); clubs = []; }

  mkdirSync(CACHE_DIR, { recursive: true });
  // Cache carries the generating model so a later model migration can't
  // silently relabel old extractions (provenance requirement).
  writeFileSync(cachePath, JSON.stringify({ model: MODEL, clubs }, null, 2) + '\n');
  console.log(`  [${night.date}] ${schoolList}: ${clubs.length} clubs`);
  return { model: MODEL, clubs };
}

async function main() {
  const nights = findPresentationNights();
  console.log(`Extracting clubs from ${nights.length} presentation nights…`);

  // Lazily created on first cache miss so fully-cached runs need no API key.
  let clientPromise = null;
  const getClientFn = () => (clientPromise ||= getClient());

  const all = [];
  const modelsUsed = new Set();
  for (const night of nights) {
    const { model, clubs } = await extractNight(getClientFn, night);
    if (model && clubs.length > 0) modelsUsed.add(model);
    all.push(...clubs);
  }

  // Group by school; dedupe clubs that are the same across years despite phrasing
  // drift (e.g. "Friends for Youth Mentoring Program" vs "...Mentorship Program",
  // "ASB (Student Body Leadership)" vs "ASB (Associated Student Body)", "Rainbow
  // Cloud" vs "GSA / Rainbow Cloud"). Keep the most recent name/category/evidence
  // and preserve every mention date. Matching is per-school only.
  const schools = {};
  for (const c of all) {
    if (!c.school_slug || !c.club_name) continue;
    const bucket = (schools[c.school_slug] ||= { clubs: [] });
    const tokens = clubTokens(c.club_name);
    const existing = bucket.clubs.find(x => sameClub(x._tokens, tokens));
    if (existing) {
      existing.mentions = [...new Set([...existing.mentions, c.meetingDate])].sort().reverse();
      if (c.meetingDate >= existing.lastMentioned) {
        // Newest mention wins for the displayed name/category/evidence.
        existing.lastMentioned = c.meetingDate;
        existing.name = c.club_name.trim();
        existing.category = c.category || existing.category;
        existing.evidence = c.evidence_quote || existing.evidence;
        existing._tokens = tokens;
      }
    } else {
      bucket.clubs.push({
        name: c.club_name.trim(),
        category: c.category || 'other',
        evidence: c.evidence_quote || '',
        lastMentioned: c.meetingDate,
        mentions: [c.meetingDate],
        _tokens: tokens,
      });
    }
  }
  for (const s of Object.values(schools)) {
    s.clubs.sort((a, b) => b.lastMentioned.localeCompare(a.lastMentioned) || a.name.localeCompare(b.name));
    for (const club of s.clubs) delete club._tokens; // internal matching field only
  }

  const out = {
    _metadata: {
      generated: new Date().toISOString().slice(0, 10),
      method: `AI-extracted from board-presentation transcripts via ${[...modelsUsed].sort().join(' + ') || MODEL}. BEST-EFFORT, NOT AUTHORITATIVE: reflects only clubs a principal named aloud on their presentation night, not a complete school club roster. Every club carries an evidence quote and the meeting date(s) it was mentioned.`,
      // Every model that produced any of the (cached or fresh) extractions in
      // this output; per-night attribution lives in data/school-clubs-cache/.
      models: [...modelsUsed].sort(),
      source: 'AssemblyAI transcripts of RCSD board school-site-presentation meetings (last 3 school years)',
      retrieved: new Date().toISOString().slice(0, 10),
      schoolYearsCovered: [...new Set(nights.map(n => n.date))].length + ' meetings',
    },
    schools,
  };
  writeFileSync(resolve(ROOT, 'data/school-clubs.json'), JSON.stringify(out, null, 2) + '\n');

  const totalClubs = Object.values(schools).reduce((n, s) => n + s.clubs.length, 0);
  console.log(`\nschool-clubs: ${totalClubs} distinct clubs across ${Object.keys(schools).length} schools.`);
}

main();
