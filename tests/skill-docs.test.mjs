// The rcsd-data skill is the map every agent reads before touching `data/`, so a
// number written into its prose is quoted back as fact long after the pipeline has
// moved on. The skill therefore states no record counts at all: it describes each
// file's shape and points at the `stats` / `_metadata` blocks that carry the live
// figures. These tests hold that line.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const SKILL_DIR = new URL('../plugin/skills/rcsd-data/', import.meta.url).pathname;

async function skillDocs() {
  const out = [];
  for (const entry of ['.', 'references']) {
    const dir = join(SKILL_DIR, entry);
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.md')) continue;
      const rel = entry === '.' ? name : `${entry}/${name}`;
      out.push({ rel, text: await readFile(join(dir, name), 'utf8') });
    }
  }
  assert.ok(out.length >= 4, 'expected to find the skill markdown files');
  return out;
}

// Units that name a record in a dataset the pipeline rewrites. A number in front of
// one of these is a count that will drift. District structure the board decides
// (schools, students, trustees, charters) is not in this list.
const RECORD_UNITS = [
  'entries', 'attachments', 'meetings', 'policies', 'documents', 'records',
  'videos', 'transcripts', 'offsets', 'recordings', 'rows', 'JSONs', 'lines',
  'agenda items', 'summaries',
];

const COUNT = new RegExp(String.raw`(?<![-\w./])~?\d[\d,]*\+?\s+(?:${RECORD_UNITS.join('|')})\b`, 'gi');

test('the skill states no dataset record counts', async () => {
  const offenders = [];
  for (const { rel, text } of await skillDocs()) {
    text.split('\n').forEach((line, i) => {
      if (line.includes('<!-- allow-count -->')) return;
      for (const hit of line.matchAll(COUNT)) {
        offenders.push(`${rel}:${i + 1}: ${hit[0].trim()}  —  ${line.trim().slice(0, 100)}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    `Counts drift on every pipeline run; describe the shape and point at stats/_metadata instead:\n${offenders.join('\n')}`);
});

test('the skill does not claim a subset file is current', async () => {
  // "June 2025 -> present" outlived the generator that filled the file.
  for (const { rel, text } of await skillDocs()) {
    assert.doesNotMatch(text, /(?:→|->)\s*present/,
      `${rel}: a coverage range ending in "present" asserts freshness the file cannot guarantee; ` +
      `say where the range is readable instead`);
  }
});

test('the skill points at the host that actually serves the data', async () => {
  for (const { rel, text } of await skillDocs()) {
    // rcsd.info serves the site; data.rcsd.info serves the JSON. Local absolute
    // paths (…/rcsd/rcsd.info/data/) are fine, a URL is not.
    const bad = text.match(/https?:\/\/(?:www\.)?rcsd\.info\/(?:data|json)\//g) ?? [];
    assert.deepEqual(bad, [], `${rel}: ${bad.join(', ')} — JSON is published at https://data.rcsd.info/json/`);
  }
});

// The pointer table replaced the counts, so a wrong key there is the same defect one
// indirection out — and a reader following it gets a plausible wrong number rather than
// an error. Parse the table out of the doc and resolve every path it names.
test('every count pointer the skill names resolves to something countable', async () => {
  const skill = await readFile(join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const table = skill.match(/\| Where to read it \| Files \|\n\|[^\n]*\|\n((?:\|[^\n]*\|\n)+)/);
  assert.ok(table, 'could not find the count-pointer table in SKILL.md');

  const DATA = new URL('../data/', import.meta.url).pathname;
  const rows = table[1].trimEnd().split('\n');
  let checked = 0;

  for (const row of rows) {
    const [, where, files] = row.split('|').map((c) => c.trim());
    for (const [, file, , key] of files.matchAll(/`([a-z0-9][\w./-]*\.json)`(\s*→\s*`\.(\w+)`)?/gi)) {
      const raw = await readFile(join(DATA, file), 'utf8').catch(() => null);
      assert.ok(raw, `SKILL.md points at data/${file}, which does not exist`);
      const doc = JSON.parse(raw);
      const target = key ? doc[key] : doc;

      assert.ok(target !== undefined, `SKILL.md points at data/${file} → .${key}, which is absent`);
      if (/^`?stats`?/.test(where)) {
        assert.equal(typeof doc.stats, 'object', `${file}: skill promises a stats block`);
        assert.ok('generated' in doc, `${file}: skill promises generated alongside stats`);
      } else if (where.includes('_metadata.counts')) {
        assert.ok(doc._metadata?.counts, `${file}: skill promises _metadata.counts`);
      } else if (where.includes('_metadata')) {
        assert.ok(doc._metadata, `${file}: skill promises a _metadata block`);
      } else if (where.startsWith('Length')) {
        // Counting this must give a record count, not a handful of wrapper keys.
        const n = Array.isArray(target) ? target.length : Object.keys(target).length;
        assert.ok(n > 4,
          `${file}${key ? ` → .${key}` : ''}: counting this yields ${n}, which looks like ` +
          `wrapper keys rather than records — the skill is pointing one level too high`);
      }
      checked += 1;
    }
  }
  assert.ok(checked >= 20, `expected to resolve the whole pointer table, only checked ${checked}`);
});
