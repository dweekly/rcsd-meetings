import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256 } from '../scripts/lib/provenance.mjs';
import { verifyProductionRelease } from '../scripts/verify-production-release.mjs';

const RELEASE_ID = 'policy-50dd16d68c4c3625f094974e';
const english = '<html lang="en"><head><link rel="canonical" href="https://rcsd.info/policies/5132-bp/"></head><span class="policy-code">5132</span><aside class="policy-provenance"><h2>Source &amp; methodology</h2><a href="https://data.rcsd.info/json/provenance/rcsd.board-policies.json">data</a></aside></html>';
const spanish = '<html lang="es"><head><link rel="canonical" href="https://rcsd.info/politicas/5132-bp/"></head><span class="policy-code">5132</span><aside class="policy-provenance"><h2>Fuente y metodología</h2><a href="https://data.rcsd.info/json/provenance/rcsd.board-policies-es.json">datos</a></aside></html>';
const provenance = { schemaVersion: '1.0.0', datasetId: 'rcsd.board-policies', artifacts: [{}] };
const provenanceBody = JSON.stringify(provenance);
const publishedRelease = {
  releaseId: RELEASE_ID,
  status: 'published',
  artifacts: [{
    sourcePath: 'data/provenance/rcsd.board-policies.json',
    bytes: Buffer.byteLength(provenanceBody),
    hash: sha256(provenanceBody),
  }],
  qualityGates: [
    { name: 'remote-r2-bytes', status: 'passed' },
    { name: 'stable-r2-bytes', status: 'passed' },
    { name: 'pages-deployed', status: 'passed' },
  ],
};

function response(value, contentType) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    headers: { 'content-type': contentType },
  });
}

function routes({ current = publishedRelease } = {}) {
  return async (url) => {
    switch (url.pathname) {
      case '/policies/5132-bp/': return response(english, 'text/html; charset=utf-8');
      case '/politicas/5132-bp/': return response(spanish, 'text/html; charset=utf-8');
      case '/json/provenance/rcsd.board-policies.json': return response(provenanceBody, 'application/json; charset=utf-8');
      case '/json/releases/current.json': return response(current, 'application/json; charset=utf-8');
      default: return new Response('not found', { status: 404 });
    }
  };
}

const silentLogger = { log() {}, warn() {} };

test('production smoke verifies English, Spanish, provenance, and the promoted release', async () => {
  await verifyProductionRelease({
    expectedRelease: publishedRelease,
    siteBase: 'https://site.example',
    dataBase: 'https://data.example',
    attempts: 1,
    delayMs: 0,
    timeoutMs: 100,
    fetchImpl: routes(),
    logger: silentLogger,
  });
});

test('production smoke retries bounded stale current state, then succeeds', async () => {
  let currentRequests = 0;
  const fetchImpl = async (url, options) => {
    if (url.pathname === '/json/releases/current.json') {
      currentRequests += 1;
      if (currentRequests === 1) return response({ ...publishedRelease, releaseId: 'policy-older' }, 'application/json');
    }
    return routes()(url, options);
  };

  await verifyProductionRelease({
    expectedRelease: publishedRelease,
    siteBase: 'https://site.example',
    dataBase: 'https://data.example',
    attempts: 2,
    delayMs: 0,
    timeoutMs: 100,
    fetchImpl,
    logger: silentLogger,
  });
  assert.equal(currentRequests, 2);
});

test('production smoke fails closed after its retry budget', async () => {
  await assert.rejects(
    verifyProductionRelease({
      expectedRelease: publishedRelease,
      siteBase: 'https://site.example',
      dataBase: 'https://data.example',
      attempts: 1,
      delayMs: 0,
      timeoutMs: 100,
      fetchImpl: routes({ current: { ...publishedRelease, releaseId: 'policy-older' } }),
      logger: silentLogger,
    }),
    /Production smoke failed after 1 attempts/,
  );
});
