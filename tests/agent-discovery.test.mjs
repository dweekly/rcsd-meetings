import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { buildAgentDiscovery } from '../scripts/build-agent-discovery.mjs';
import dataWorker from '../workers/r2-browser/index.js';

const ROOT = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(ROOT, path), 'utf8');
const parse = path => JSON.parse(read(path));
buildAgentDiscovery();
const catalog = parse('docs/catalog.json');
const downloads = catalog.dataset.flatMap(d => d.distribution);

test('catalog downloads exist and preserve source-check metadata without inventing freshness', () => {
  const urls = new Set();
  for (const d of downloads) {
    assert.equal(new URL(d.contentUrl).origin, 'https://data.rcsd.info');
    assert.ok(!urls.has(d.contentUrl), `duplicate ${d.contentUrl}`);
    urls.add(d.contentUrl);
    const original = parse(`data/${d.name}`)._metadata || {};
    for (const key of ['source', 'scrapedAt', 'method']) {
      assert.deepEqual(d._metadata[key], original[key] ?? null, `${d.name}: ${key}`);
    }
    assert.doesNotMatch(d.name, /(?:cache|sample|gsc-data|provenance\/)/);
  }
  for (const family of ['schools.json', 'properties.json', 'warrants-index.json', 'attachment-index.json']) {
    assert.ok(downloads.some(d => d.name === family), family);
  }
  for (const family of ['sarc/', 'cde/', 'committees/']) {
    assert.ok(downloads.some(d => d.name.startsWith(family)), family);
  }
});

test('RFC 9727 linkset exposes actual endpoints and documents each one', () => {
  const { linkset } = parse('docs/.well-known/api-catalog');
  const endpoints = linkset[0].item.map(i => i.href);
  assert.deepEqual(new Set(endpoints), new Set(['https://mcp.rcsd.info/mcp', ...downloads.map(d => d.contentUrl)]));
  for (const endpoint of endpoints) {
    const entry = linkset.find(e => e.anchor === endpoint);
    assert.ok(entry?.['service-doc']?.length, endpoint);
    for (const doc of entry['service-doc']) {
      const url = new URL(doc.href);
      assert.ok(existsSync(resolve(ROOT, 'docs', '.' + url.pathname, 'index.html')), doc.href);
    }
  }
});

test('skill discovery verifies the exact bytes a client will download', () => {
  const index = parse('docs/.well-known/agent-skills/index.json');
  assert.equal(index.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json');
  for (const skill of index.skills) {
    const content = readFileSync(resolve(ROOT, 'docs', '.' + new URL(skill.url).pathname));
    assert.equal(skill.digest, 'sha256:' + createHash('sha256').update(content).digest('hex'));
    assert.equal(skill.description, content.toString().match(/^description: (.+)$/m)[1]);
    assert.equal(skill.name, content.toString().match(/^name: (.+)$/m)[1]);
  }
  assert.deepEqual(parse('docs/.well-known/skills/index.json'), index);
  assert.equal(read('docs/agents/data-schema.md'), read('plugin/skills/rcsd-data/references/data-schema.md'));
});

test('bilingual HTML and Markdown expose every catalog download and parseable structured data', () => {
  for (const [route, lang] of [['catalog', 'en'], ['catalogo', 'es']]) {
    const html = read(`docs/${route}/index.html`);
    const markdown = read(`docs/${route}/index.md`);
    assert.ok(html.includes(`<html lang="${lang}">`));
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(ld.dataset.length, catalog.dataset.length);
    for (const d of downloads) {
      assert.ok(html.includes(`href="${d.contentUrl}"`), d.name);
      assert.ok(markdown.includes(`](${d.contentUrl})`), d.name);
    }
  }
});

test('experimental AI catalog targets the shared MCP card without claiming A2A or ACP', () => {
  const card = parse('docs/.well-known/server-card.json');
  assert.deepEqual(card, parse('workers/mcp-server/server-card.json'));
  assert.equal(card.remotes[0].type, 'streamable-http');
  assert.equal(card.remotes[0].url, 'https://mcp.rcsd.info/mcp');
  assert.match(card.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  assert.ok(card.description.length <= 100);
  const ai = parse('docs/.well-known/ai-catalog.json');
  for (const entry of ai.entries) {
    assert.ok(existsSync(resolve(ROOT, 'docs', '.' + new URL(entry.url).pathname)));
    assert.equal(entry.data, undefined);
  }
  for (const unsupported of ['agent-card.json', 'acp.json']) {
    assert.ok(!existsSync(resolve(ROOT, 'docs/.well-known', unsupported)));
  }
});

test('discovery generation is deterministic', () => {
  const paths = ['catalog.json', 'catalog/index.html', 'catalogo/index.html', '.well-known/api-catalog', '.well-known/agent-skills/index.json'];
  const before = paths.map(p => read(`docs/${p}`));
  buildAgentDiscovery();
  assert.deepEqual(paths.map(p => read(`docs/${p}`)), before);
});

test('data-host discovery redirects before accessing R2, including HEAD requests', async () => {
  for (const path of ['api-catalog', 'ai-catalog.json']) {
    for (const method of ['GET', 'HEAD']) {
      const res = await dataWorker.fetch(new Request(`https://data.rcsd.info/.well-known/${path}`, { method }), {}, {});
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('Location'), `https://rcsd.info/.well-known/${path}`);
      assert.match(res.headers.get('Link'), /rel="api-catalog"/);
      assert.equal(await res.text(), '');
    }
  }
});

test('data downloads carry discovery without changing their bytes or cache policy', async () => {
  const body = '{"example":true}';
  const res = await dataWorker.fetch(new Request('https://data.rcsd.info/json/example.json'), {
    BUCKET: { get: async () => ({ body, size: body.length, httpEtag: '"example"' }) },
  }, {});
  assert.equal(await res.text(), body);
  assert.equal(res.headers.get('Content-Type'), 'application/json');
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=3600');
  assert.equal(res.headers.get('Content-Signal'), 'search=yes, ai-input=yes');
  assert.match(res.headers.get('Link'), /rel="api-catalog"/);
  assert.match(res.headers.get('Access-Control-Expose-Headers'), /Link/);
});
