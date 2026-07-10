#!/usr/bin/env node
/** Verify the promoted release through its public English, Spanish, and data URLs. */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { sha256 } from './lib/provenance.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const REQUIRED_GATES = ['remote-r2-bytes', 'stable-r2-bytes', 'pages-deployed'];

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function nonnegativeInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer.`);
  return parsed;
}

function assertIncludes(body, value, label) {
  if (!body.includes(value)) throw new Error(`${label} is missing ${JSON.stringify(value)}.`);
}

function assertMatches(body, pattern, label) {
  if (!pattern.test(body)) throw new Error(`${label} does not match ${pattern}.`);
}

export function assertEnglishPolicyPage(body) {
  assertMatches(body, /<html\b[^>]*\blang=["']en["']/i, 'English policy page');
  assertIncludes(body, '<link rel="canonical" href="https://rcsd.info/policies/5132-bp/">', 'English policy page');
  assertIncludes(body, '<span class="policy-code">5132</span>', 'English policy page');
  assertMatches(body, /class=["'][^"']*\bpolicy-provenance\b[^"']*["']/i, 'English policy page');
  assertIncludes(body, 'Source &amp; methodology', 'English policy page');
  assertIncludes(body, 'https://data.rcsd.info/json/provenance/rcsd.board-policies.json', 'English policy page');
}

export function assertSpanishPolicyPage(body) {
  assertMatches(body, /<html\b[^>]*\blang=["']es["']/i, 'Spanish policy page');
  assertIncludes(body, '<link rel="canonical" href="https://rcsd.info/politicas/5132-bp/">', 'Spanish policy page');
  assertIncludes(body, '<span class="policy-code">5132</span>', 'Spanish policy page');
  assertMatches(body, /class=["'][^"']*\bpolicy-provenance\b[^"']*["']/i, 'Spanish policy page');
  assertIncludes(body, 'Fuente y metodología', 'Spanish policy page');
  assertIncludes(body, 'https://data.rcsd.info/json/provenance/rcsd.board-policies-es.json', 'Spanish policy page');
}

export function assertPolicyProvenance(value) {
  if (value?.schemaVersion !== '1.0.0') throw new Error('Policy provenance has an unexpected schemaVersion.');
  if (value?.datasetId !== 'rcsd.board-policies') throw new Error('Policy provenance has an unexpected datasetId.');
  if (!Array.isArray(value?.artifacts) || value.artifacts.length === 0) {
    throw new Error('Policy provenance has no artifacts.');
  }
}

export function assertReleaseArtifact(body, expectedRelease, sourcePath) {
  const artifact = expectedRelease?.artifacts?.find((item) => item.sourcePath === sourcePath);
  if (!artifact) throw new Error(`Promoted manifest has no artifact for ${sourcePath}.`);
  const bytes = Buffer.byteLength(body);
  if (bytes !== artifact.bytes) {
    throw new Error(`${sourcePath} returned ${bytes} bytes, expected ${artifact.bytes}.`);
  }
  const hash = sha256(body);
  if (hash !== artifact.hash) {
    throw new Error(`${sourcePath} returned hash ${hash}, expected ${artifact.hash}.`);
  }
}

export function assertPublishedRelease(value, expectedReleaseId) {
  if (typeof expectedReleaseId !== 'string' || expectedReleaseId.length === 0) {
    throw new Error('Expected release has no releaseId.');
  }
  if (value?.releaseId !== expectedReleaseId) {
    throw new Error(`Public current release is ${value?.releaseId || '(missing)'}, expected ${expectedReleaseId}.`);
  }
  if (value.status !== 'published') throw new Error('Public current release is not published.');
  for (const name of REQUIRED_GATES) {
    const gate = value.qualityGates?.find((item) => item.name === name);
    if (gate?.status !== 'passed') throw new Error(`Public current release is missing passed gate ${name}.`);
  }
}

function endpoint(base, path, cacheToken, attempt) {
  const url = new URL(path, `${base.replace(/\/$/, '')}/`);
  url.searchParams.set('_rcsd_smoke', `${cacheToken}-${attempt}`);
  return url;
}

async function fetchBody(fetchImpl, url, timeoutMs, expectedType) {
  const response = await fetchImpl(url, {
    redirect: 'error',
    headers: {
      accept: 'text/html, application/json;q=0.9',
      'cache-control': 'no-cache',
      pragma: 'no-cache',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${url.pathname} returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  if (!contentType.includes(expectedType)) {
    throw new Error(`${url.pathname} returned ${contentType || 'no content type'}, expected ${expectedType}.`);
  }
  return response.text();
}

function parseJson(body, label) {
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`${label} did not return valid JSON.`, { cause: error });
  }
}

const wait = (milliseconds) => new Promise((accept) => setTimeout(accept, milliseconds));

export async function verifyProductionRelease({
  expectedRelease,
  siteBase = 'https://rcsd.info',
  dataBase = 'https://data.rcsd.info',
  attempts = 8,
  delayMs = 5_000,
  timeoutMs = 10_000,
  fetchImpl = fetch,
  logger = console,
} = {}) {
  assertPublishedRelease(expectedRelease, expectedRelease?.releaseId);
  const releaseId = expectedRelease.releaseId;
  const cacheToken = `${releaseId}-${randomUUID()}`;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const [englishBody, spanishBody, provenanceBody, currentBody] = await Promise.all([
        fetchBody(fetchImpl, endpoint(siteBase, 'policies/5132-bp/', cacheToken, attempt), timeoutMs, 'text/html'),
        fetchBody(fetchImpl, endpoint(siteBase, 'politicas/5132-bp/', cacheToken, attempt), timeoutMs, 'text/html'),
        fetchBody(fetchImpl, endpoint(dataBase, 'json/provenance/rcsd.board-policies.json', cacheToken, attempt), timeoutMs, 'application/json'),
        fetchBody(fetchImpl, endpoint(dataBase, 'json/releases/current.json', cacheToken, attempt), timeoutMs, 'application/json'),
      ]);

      assertEnglishPolicyPage(englishBody);
      assertSpanishPolicyPage(spanishBody);
      assertReleaseArtifact(provenanceBody, expectedRelease, 'data/provenance/rcsd.board-policies.json');
      assertPolicyProvenance(parseJson(provenanceBody, 'Policy provenance'));
      const currentRelease = parseJson(currentBody, 'Current release');
      assertPublishedRelease(currentRelease, releaseId);
      if (!isDeepStrictEqual(currentRelease, expectedRelease)) {
        throw new Error(`Public current release ${releaseId} differs from the promoted manifest.`);
      }

      logger.log(`PASS English policy page: ${siteBase}/policies/5132-bp/`);
      logger.log(`PASS Spanish policy page: ${siteBase}/politicas/5132-bp/`);
      logger.log(`PASS policy provenance: ${dataBase}/json/provenance/rcsd.board-policies.json`);
      logger.log(`PASS promoted release: ${releaseId}`);
      return;
    } catch (error) {
      lastError = error;
      logger.warn(`Production smoke attempt ${attempt}/${attempts} failed: ${error.message}`);
      if (attempt < attempts) await wait(delayMs);
    }
  }

  throw new Error(`Production smoke failed after ${attempts} attempts. See RELEASE-RUNBOOK.md.`, { cause: lastError });
}

async function fetchAdvertisedRelease({ dataBase, attempts, delayMs, timeoutMs }) {
  const cacheToken = `operator-check-${randomUUID()}`;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const body = await fetchBody(
        fetch,
        endpoint(dataBase, 'json/releases/current.json', cacheToken, attempt),
        timeoutMs,
        'application/json',
      );
      const release = parseJson(body, 'Current release');
      assertPublishedRelease(release, release?.releaseId);
      return release;
    } catch (error) {
      lastError = error;
      console.warn(`Current-release lookup ${attempt}/${attempts} failed: ${error.message}`);
      if (attempt < attempts) await wait(delayMs);
    }
  }
  throw new Error(`Unable to read the release production currently advertises after ${attempts} attempts.`, { cause: lastError });
}

async function main() {
  const siteBase = process.env.RCSD_SITE_URL || 'https://rcsd.info';
  const dataBase = process.env.RCSD_DATA_URL || 'https://data.rcsd.info';
  const attempts = positiveInteger(process.env.RCSD_SMOKE_ATTEMPTS, 8, 'RCSD_SMOKE_ATTEMPTS');
  const delayMs = nonnegativeInteger(process.env.RCSD_SMOKE_DELAY_MS, 5_000, 'RCSD_SMOKE_DELAY_MS');
  const timeoutMs = positiveInteger(process.env.RCSD_SMOKE_TIMEOUT_MS, 10_000, 'RCSD_SMOKE_TIMEOUT_MS');
  const againstCurrent = process.argv.includes('--against-current');
  let expectedRelease;
  if (againstCurrent) {
    expectedRelease = await fetchAdvertisedRelease({ dataBase, attempts, delayMs, timeoutMs });
    console.log(`Checking the release production currently advertises: ${expectedRelease.releaseId || '(missing)'}`);
  } else {
    const manifestPath = resolve(ROOT, process.env.RCSD_RELEASE_MANIFEST || 'tmp/releases/current.json');
    expectedRelease = JSON.parse(readFileSync(manifestPath, 'utf8'));
  }
  await verifyProductionRelease({
    expectedRelease,
    siteBase,
    dataBase,
    attempts,
    delayMs,
    timeoutMs,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    if (error.cause) console.error(`Last failure: ${error.cause.message}`);
    process.exitCode = 1;
  });
}
