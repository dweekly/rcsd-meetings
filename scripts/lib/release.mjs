import { hashCanonicalJson } from './provenance.mjs';

/**
 * Stable, publication-relevant release identity. Volatile receipt fields such
 * as generatedAt, gitCommit, status, gate timestamps, and publishedAt are
 * deliberately excluded; every artifact descriptor field is included.
 */
export function releaseIdentity({ schemaVersion, districtIds, artifacts }) {
  return {
    schemaVersion,
    districtIds,
    artifacts: artifacts.map(({ immutablePath, ...artifact }) => artifact),
  };
}

export function computeReleaseId(manifest, family = 'policy') {
  const digest = hashCanonicalJson(releaseIdentity(manifest));
  return `${family}-${digest.slice('sha256:'.length, 'sha256:'.length + 24)}`;
}

export function assertReleaseId(manifest, family = 'policy') {
  const expected = computeReleaseId(manifest, family);
  if (manifest.releaseId !== expected) {
    throw new Error(`Release content identity mismatch: expected ${expected}, found ${manifest.releaseId}`);
  }
  return expected;
}

export function sameReleaseContent(left, right) {
  return hashCanonicalJson(releaseIdentity(left)) === hashCanonicalJson(releaseIdentity(right));
}
