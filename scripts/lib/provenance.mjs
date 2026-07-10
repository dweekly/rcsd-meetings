/**
 * Shared primitives for provenance manifests.
 *
 * The repository intentionally does not depend on a full JSON Schema runtime.
 * The schemas in schemas/provenance/v1/ are the portable contracts; the
 * validators below enforce the high-value structural and cross-field rules
 * used by local generators and release tooling.
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, parse as parsePath } from 'node:path';

export const PROVENANCE_SCHEMA_VERSION = '1.0.0';
export const PROVENANCE_SCHEMA_BASE = 'https://rcsd.info/schemas/provenance/v1';

const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const ID_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const LOCALE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const QUALITY_STATES = new Set([
  'unreviewed',
  'machine-checked',
  'human-reviewed',
  'reconciled',
  'partial',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainObject(value) {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Serialize JSON data deterministically.
 *
 * Object keys are sorted by UTF-16 code unit, matching JSON.stringify/JCS key
 * ordering. Values that JSON.stringify would silently discard or coerce are
 * rejected so two different inputs cannot accidentally acquire the same hash.
 */
export function canonicalJson(value) {
  const ancestors = new WeakSet();

  function serialize(current, location) {
    if (current === null) return 'null';

    switch (typeof current) {
      case 'string':
      case 'boolean':
        return JSON.stringify(current);
      case 'number':
        if (!Number.isFinite(current)) {
          throw new TypeError(`Cannot canonicalize non-finite number at ${location}`);
        }
        return JSON.stringify(current);
      case 'undefined':
      case 'function':
      case 'symbol':
      case 'bigint':
        throw new TypeError(`Cannot canonicalize ${typeof current} at ${location}`);
      case 'object':
        break;
      default:
        throw new TypeError(`Cannot canonicalize value at ${location}`);
    }

    if (ancestors.has(current)) {
      throw new TypeError(`Cannot canonicalize cyclic data at ${location}`);
    }
    ancestors.add(current);

    let result;
    if (Array.isArray(current)) {
      const parts = [];
      for (let index = 0; index < current.length; index += 1) {
        if (!Object.hasOwn(current, index)) {
          throw new TypeError(`Cannot canonicalize sparse array at ${location}/${index}`);
        }
        parts.push(serialize(current[index], `${location}/${index}`));
      }
      result = `[${parts.join(',')}]`;
    } else {
      if (!isPlainObject(current)) {
        throw new TypeError(`Cannot canonicalize non-plain object at ${location}`);
      }
      if (Object.getOwnPropertySymbols(current).length) {
        throw new TypeError(`Cannot canonicalize symbol-keyed object at ${location}`);
      }
      const parts = Object.keys(current).sort().map((key) => (
        `${JSON.stringify(key)}:${serialize(current[key], `${location}/${escapeJsonPointerToken(key)}`)}`
      ));
      result = `{${parts.join(',')}}`;
    }

    ancestors.delete(current);
    return result;
  }

  return serialize(value, '#');
}

/** Return a bare, lowercase SHA-256 hexadecimal digest. */
export function sha256Hex(value) {
  if (typeof value !== 'string' && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
    throw new TypeError('sha256Hex expects a string, ArrayBuffer, Buffer, or typed array');
  }
  const input = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  return createHash('sha256').update(input).digest('hex');
}

/** Return a provenance-formatted SHA-256 digest (`sha256:<hex>`). */
export function sha256(value) {
  return `sha256:${sha256Hex(value)}`;
}

/** Hash deterministic JSON rather than insertion-order-dependent JSON.stringify output. */
export function hashCanonicalJson(value) {
  return sha256(canonicalJson(value));
}

/** Stream a file into SHA-256 without loading large artifacts into memory. */
export function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
  });
}

/**
 * Resolve the exact installed version of a package from its runtime entrypoint.
 * This works even when the package does not export its package.json.
 */
export function getInstalledPackageVersion(packageName, fromUrl = import.meta.url) {
  if (typeof packageName !== 'string' || !packageName) {
    throw new TypeError('packageName must be a non-empty string');
  }
  const require = createRequire(fromUrl);
  let directory = dirname(require.resolve(packageName));
  const root = parsePath(directory).root;

  while (directory !== root) {
    const packagePath = join(directory, 'package.json');
    if (existsSync(packagePath)) {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
      if (pkg.name === packageName && typeof pkg.version === 'string') return pkg.version;
    }
    directory = dirname(directory);
  }
  throw new Error(`Could not locate package.json for ${packageName}`);
}

export class JsonPointerError extends Error {
  constructor(message, pointer) {
    super(`${message}: ${pointer}`);
    this.name = 'JsonPointerError';
    this.pointer = pointer;
  }
}

export function escapeJsonPointerToken(token) {
  return String(token).replaceAll('~', '~0').replaceAll('/', '~1');
}

export function unescapeJsonPointerToken(token, pointer = token) {
  if (/~(?:[^01]|$)/.test(token)) {
    throw new JsonPointerError('Invalid JSON Pointer escape', pointer);
  }
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

/** Parse either RFC 6901 string form (`/a/b`) or URI fragment form (`#/a/b`). */
export function parseJsonPointer(pointer) {
  if (typeof pointer !== 'string') throw new TypeError('JSON Pointer must be a string');
  let decoded = pointer;
  if (decoded.startsWith('#')) {
    try {
      decoded = decodeURIComponent(decoded.slice(1));
    } catch {
      throw new JsonPointerError('Invalid percent-encoding in JSON Pointer fragment', pointer);
    }
  }
  if (decoded === '') return [];
  if (!decoded.startsWith('/')) {
    throw new JsonPointerError('JSON Pointer must be empty or begin with /', pointer);
  }
  return decoded.slice(1).split('/').map((token) => unescapeJsonPointerToken(token, pointer));
}

/** Resolve a JSON Pointer, throwing when any referenced member is absent. */
export function resolveJsonPointer(document, pointer) {
  const tokens = parseJsonPointer(pointer);
  let current = document;

  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(token)) {
        throw new JsonPointerError(`Invalid array index ${JSON.stringify(token)}`, pointer);
      }
      const index = Number(token);
      if (index >= current.length || !Object.hasOwn(current, index)) {
        throw new JsonPointerError(`Array index ${index} does not exist`, pointer);
      }
      current = current[index];
    } else if (isRecord(current)) {
      if (!Object.hasOwn(current, token)) {
        throw new JsonPointerError(`Object member ${JSON.stringify(token)} does not exist`, pointer);
      }
      current = current[token];
    } else {
      throw new JsonPointerError(`Cannot traverse through ${current === null ? 'null' : typeof current}`, pointer);
    }
  }
  return current;
}

export function hasJsonPointer(document, pointer) {
  try {
    resolveJsonPointer(document, pointer);
    return true;
  } catch (error) {
    if (error instanceof JsonPointerError) return false;
    throw error;
  }
}

function manifestInputs(manifest) {
  return manifest?.lineage?.inputs ?? manifest?.inputs ?? [];
}

/**
 * Find cycles among dataset manifests. Unknown/external dataset IDs are leaves.
 * Each returned path repeats its starting node at the end (A -> B -> A).
 */
export function findLineageCycles(manifests) {
  const entries = manifests instanceof Map ? [...manifests.entries()] : (manifests ?? []).map((item) => [item.datasetId, item]);
  const byId = new Map();
  for (const [id, manifest] of entries) {
    if (typeof id !== 'string' || !id) throw new TypeError('Every lineage manifest needs a datasetId');
    if (byId.has(id)) throw new Error(`Duplicate datasetId in lineage graph: ${id}`);
    byId.set(id, manifest);
  }

  const state = new Map();
  const stack = [];
  const stackIndex = new Map();
  const cycles = [];

  function visit(id) {
    state.set(id, 'visiting');
    stackIndex.set(id, stack.length);
    stack.push(id);

    const dependencies = new Set(
      manifestInputs(byId.get(id))
        .map((input) => input?.datasetId)
        .filter((dependency) => typeof dependency === 'string' && byId.has(dependency)),
    );
    for (const dependency of dependencies) {
      if (state.get(dependency) === 'visiting') {
        cycles.push([...stack.slice(stackIndex.get(dependency)), dependency]);
      } else if (!state.has(dependency)) {
        visit(dependency);
      }
    }

    stack.pop();
    stackIndex.delete(id);
    state.set(id, 'visited');
  }

  for (const id of byId.keys()) if (!state.has(id)) visit(id);
  return cycles;
}

export class LineageCycleError extends Error {
  constructor(cycles) {
    super(`Dataset lineage contains ${cycles.length} cycle${cycles.length === 1 ? '' : 's'}: ${cycles.map((cycle) => cycle.join(' -> ')).join('; ')}`);
    this.name = 'LineageCycleError';
    this.cycles = cycles;
  }
}

export function assertAcyclicLineage(manifests) {
  const cycles = findLineageCycles(manifests);
  if (cycles.length) throw new LineageCycleError(cycles);
}

function normalizeParameters(parameters) {
  if (!isRecord(parameters)) return parameters ?? null;
  if (Object.hasOwn(parameters, 'sent')) return parameters;
  // Convenience for call sites created before v1: a flat object means exactly
  // those keys were sent and provider defaults were not recorded.
  return { sent: parameters, providerDefaults: 'unknown', unsupported: [] };
}

/**
 * Compute the identity of an LLM transformation.
 *
 * Attempts, timestamps, token usage, cost, and output hashes are deliberately
 * excluded. Everything that can change the requested transformation is kept,
 * including processing/chunking and validation strategy.
 */
export function buildLlmCacheFingerprint(invocation) {
  if (!isRecord(invocation)) throw new TypeError('LLM fingerprint input must be an object');
  const material = {
    fingerprintVersion: '1',
    purpose: invocation.purpose ?? null,
    provider: invocation.provider ?? null,
    model: invocation.model ?? null,
    endpoint: invocation.endpoint ?? null,
    client: invocation.client ?? null,
    parameters: normalizeParameters(invocation.parameters),
    prompts: invocation.prompts ?? null,
    outputContract: invocation.outputContract ?? null,
    inputs: invocation.inputs ?? [],
    localization: invocation.localization ?? null,
    safety: invocation.safety ?? null,
    processing: invocation.processing ?? null,
  };
  return hashCanonicalJson(material);
}

function addError(errors, path, message) {
  errors.push({ path, message });
}

function requiredRecord(value, path, errors) {
  if (!isRecord(value)) {
    addError(errors, path, 'must be an object');
    return false;
  }
  return true;
}

function requiredString(value, path, errors, { pattern, allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    addError(errors, path, 'must be a non-empty string');
    return false;
  }
  if (pattern && !pattern.test(value)) {
    addError(errors, path, 'has an invalid format');
    return false;
  }
  return true;
}

function requiredArray(value, path, errors, { min = 0 } = {}) {
  if (!Array.isArray(value)) {
    addError(errors, path, 'must be an array');
    return false;
  }
  if (value.length < min) addError(errors, path, `must contain at least ${min} item${min === 1 ? '' : 's'}`);
  return true;
}

function validateSchemaVersion(value, errors) {
  if (value !== PROVENANCE_SCHEMA_VERSION) {
    addError(errors, '/schemaVersion', `must equal ${PROVENANCE_SCHEMA_VERSION}`);
  }
}

function validDateTime(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/);
  return Boolean(match && validDate(match[1]) && !Number.isNaN(Date.parse(value)));
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function validateDateTime(value, path, errors) {
  if (!validDateTime(value)) addError(errors, path, 'must be an ISO 8601 date-time with an explicit timezone');
}

function validateHash(value, path, errors, { optional = false, nullable = false } = {}) {
  if (optional && value === undefined) return;
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !HASH_RE.test(value)) addError(errors, path, 'must be a lowercase sha256:<64 hex> digest');
}

function validateId(value, path, errors) {
  requiredString(value, path, errors, { pattern: ID_RE });
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\')) return false;
  const segments = value.split('/');
  return !segments.some((segment) => segment === '' || segment === '.' || segment === '..');
}

function isSafePublicPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return false;
  const stripped = value.startsWith('/') ? value.slice(1) : value;
  return isSafeRelativePath(stripped);
}

function validateRelativePath(value, path, errors) {
  if (!isSafeRelativePath(value)) addError(errors, path, 'must be a normalized repository-relative path without traversal');
}

function validatePublicPath(value, path, errors) {
  if (!isSafePublicPath(value)) addError(errors, path, 'must be a normalized public path without a URL scheme or traversal');
}

function validateUrl(value, path, errors) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('not HTTP');
  } catch {
    addError(errors, path, 'must be an absolute HTTP(S) URL');
  }
}

function validateLocale(value, path, errors) {
  requiredString(value, path, errors, { pattern: LOCALE_RE });
}

function validatePointer(value, path, errors) {
  try {
    parseJsonPointer(value);
  } catch (error) {
    addError(errors, path, error.message);
  }
}

function validateQuality(quality, path, errors) {
  if (!requiredRecord(quality, path, errors)) return;
  if (!QUALITY_STATES.has(quality.state)) addError(errors, `${path}/state`, 'has an unsupported quality state');
  if (quality.checkedAt !== undefined) validateDateTime(quality.checkedAt, `${path}/checkedAt`, errors);
  if (quality.exceptions !== undefined && requiredArray(quality.exceptions, `${path}/exceptions`, errors)) {
    quality.exceptions.forEach((exception, index) => {
      const itemPath = `${path}/exceptions/${index}`;
      if (!requiredRecord(exception, itemPath, errors)) return;
      requiredString(exception.code, `${itemPath}/code`, errors);
      requiredString(exception.message, `${itemPath}/message`, errors);
    });
  }
  if (quality.state === 'partial' && (!Array.isArray(quality.exceptions) || quality.exceptions.length === 0)) {
    addError(errors, `${path}/exceptions`, 'must enumerate at least one exception when state is partial');
  }
}

function validateArtifact(artifact, path, errors) {
  if (!requiredRecord(artifact, path, errors)) return;
  validateRelativePath(artifact.path, `${path}/path`, errors);
  requiredString(artifact.mediaType, `${path}/mediaType`, errors);
  validateHash(artifact.hash, `${path}/hash`, errors);
  if (artifact.bytes !== undefined && (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0)) {
    addError(errors, `${path}/bytes`, 'must be a non-negative safe integer');
  }
}

function validateLineageInput(input, path, errors) {
  if (!requiredRecord(input, path, errors)) return;
  const identifiers = ['datasetId', 'sourceId', 'artifactPath'].filter((key) => input[key] !== undefined);
  if (identifiers.length === 0) addError(errors, path, 'must identify a datasetId, sourceId, or artifactPath');
  if (input.datasetId !== undefined) validateId(input.datasetId, `${path}/datasetId`, errors);
  if (input.sourceId !== undefined) validateId(input.sourceId, `${path}/sourceId`, errors);
  if (input.artifactPath !== undefined) validateRelativePath(input.artifactPath, `${path}/artifactPath`, errors);
  if (input.pointer !== undefined) validatePointer(input.pointer, `${path}/pointer`, errors);
  validateHash(input.hash, `${path}/hash`, errors);
}

function validationResult(errors) {
  return { valid: errors.length === 0, errors };
}

export function validateLlmInvocation(invocation) {
  const errors = [];
  if (!requiredRecord(invocation, '', errors)) return validationResult(errors);
  validateSchemaVersion(invocation.schemaVersion, errors);
  validateId(invocation.invocationId, '/invocationId', errors);
  requiredString(invocation.purpose, '/purpose', errors);
  requiredString(invocation.provider, '/provider', errors);

  if (requiredRecord(invocation.model, '/model', errors)) {
    requiredString(invocation.model.requested, '/model/requested', errors);
    if (invocation.model.resolved !== null) requiredString(invocation.model.resolved, '/model/resolved', errors);
  }
  if (requiredRecord(invocation.endpoint, '/endpoint', errors)) {
    requiredString(invocation.endpoint.api, '/endpoint/api', errors);
    if (invocation.endpoint.revision !== null) requiredString(invocation.endpoint.revision, '/endpoint/revision', errors);
  }
  if (requiredRecord(invocation.client, '/client', errors)) {
    requiredString(invocation.client.name, '/client/name', errors);
    requiredString(invocation.client.version, '/client/version', errors);
  }
  if (requiredRecord(invocation.parameters, '/parameters', errors)) {
    requiredRecord(invocation.parameters.sent, '/parameters/sent', errors);
    if (!['documented', 'unknown', 'none'].includes(invocation.parameters.providerDefaults)) {
      addError(errors, '/parameters/providerDefaults', 'must be documented, unknown, or none');
    }
    if (requiredArray(invocation.parameters.unsupported, '/parameters/unsupported', errors)) {
      invocation.parameters.unsupported.forEach((item, index) => requiredString(item, `/parameters/unsupported/${index}`, errors));
    }
  }
  if (requiredRecord(invocation.prompts, '/prompts', errors)) {
    requiredString(invocation.prompts.systemTemplateId, '/prompts/systemTemplateId', errors);
    validateHash(invocation.prompts.systemTemplateHash, '/prompts/systemTemplateHash', errors);
    if (invocation.prompts.userTemplateId !== null) requiredString(invocation.prompts.userTemplateId, '/prompts/userTemplateId', errors);
    validateHash(invocation.prompts.userTemplateHash, '/prompts/userTemplateHash', errors);
    for (const key of ['renderedSystemHash', 'renderedUserHash']) {
      validateHash(invocation.prompts[key], `/prompts/${key}`, errors, { optional: true });
    }
  }
  if (requiredRecord(invocation.outputContract, '/outputContract', errors)) {
    requiredString(invocation.outputContract.schemaId, '/outputContract/schemaId', errors);
    validateHash(invocation.outputContract.schemaHash, '/outputContract/schemaHash', errors);
    if (requiredArray(invocation.outputContract.toolSchemas, '/outputContract/toolSchemas', errors)) {
      invocation.outputContract.toolSchemas.forEach((tool, index) => {
        const path = `/outputContract/toolSchemas/${index}`;
        if (!requiredRecord(tool, path, errors)) return;
        requiredString(tool.name, `${path}/name`, errors);
        validateHash(tool.hash, `${path}/hash`, errors);
      });
    }
  }
  if (requiredArray(invocation.inputs, '/inputs', errors, { min: 1 })) {
    invocation.inputs.forEach((input, index) => validateLineageInput(input, `/inputs/${index}`, errors));
  }
  if (invocation.localization !== undefined) {
    if (requiredRecord(invocation.localization, '/localization', errors)) {
      validateLocale(invocation.localization.sourceLocale, '/localization/sourceLocale', errors);
      validateLocale(invocation.localization.targetLocale, '/localization/targetLocale', errors);
      validateHash(invocation.localization.glossaryHash, '/localization/glossaryHash', errors, { nullable: true });
    }
  }
  if (requiredRecord(invocation.safety, '/safety', errors)) {
    requiredRecord(invocation.safety.settings, '/safety/settings', errors);
    if (!['documented', 'unknown', 'none'].includes(invocation.safety.providerDefaults)) {
      addError(errors, '/safety/providerDefaults', 'must be documented, unknown, or none');
    }
  }
  if (invocation.processing !== undefined) requiredRecord(invocation.processing, '/processing', errors);

  const attemptNumbers = new Set();
  if (requiredArray(invocation.attempts, '/attempts', errors, { min: 1 })) {
    invocation.attempts.forEach((attempt, index) => {
      const path = `/attempts/${index}`;
      if (!requiredRecord(attempt, path, errors)) return;
      if (!Number.isSafeInteger(attempt.attempt) || attempt.attempt < 1) addError(errors, `${path}/attempt`, 'must be a positive integer');
      if (attemptNumbers.has(attempt.attempt)) addError(errors, `${path}/attempt`, 'must be unique');
      attemptNumbers.add(attempt.attempt);
      validateDateTime(attempt.startedAt, `${path}/startedAt`, errors);
      validateDateTime(attempt.completedAt, `${path}/completedAt`, errors);
      if (validDateTime(attempt.startedAt) && validDateTime(attempt.completedAt)
          && Date.parse(attempt.completedAt) < Date.parse(attempt.startedAt)) {
        addError(errors, `${path}/completedAt`, 'must not precede startedAt');
      }
      if (requiredRecord(attempt.model, `${path}/model`, errors)) {
        requiredString(attempt.model.requested, `${path}/model/requested`, errors);
        if (attempt.model.resolved !== null) requiredString(attempt.model.resolved, `${path}/model/resolved`, errors);
      }
      if (!['succeeded', 'failed', 'rejected'].includes(attempt.outcome)) addError(errors, `${path}/outcome`, 'has an unsupported outcome');
      if (requiredRecord(attempt.validation, `${path}/validation`, errors)) {
        if (!['passed', 'failed', 'not-run'].includes(attempt.validation.status)) addError(errors, `${path}/validation/status`, 'has an unsupported validation status');
        if (requiredArray(attempt.validation.errors, `${path}/validation/errors`, errors)) {
          attempt.validation.errors.forEach((item, errorIndex) => requiredString(item, `${path}/validation/errors/${errorIndex}`, errors));
        }
      }
      if (attempt.finishReason !== null) requiredString(attempt.finishReason, `${path}/finishReason`, errors);
      validateHash(attempt.responseHash, `${path}/responseHash`, errors, { optional: true });
      if (attempt.promptHashes !== undefined && requiredRecord(attempt.promptHashes, `${path}/promptHashes`, errors)) {
        validateHash(attempt.promptHashes.system, `${path}/promptHashes/system`, errors);
        validateHash(attempt.promptHashes.user, `${path}/promptHashes/user`, errors);
        if (attempt.promptHashes.additional !== undefined && requiredArray(attempt.promptHashes.additional, `${path}/promptHashes/additional`, errors)) {
          attempt.promptHashes.additional.forEach((hash, hashIndex) => validateHash(hash, `${path}/promptHashes/additional/${hashIndex}`, errors));
        }
      }
      if (attempt.usage !== undefined && requiredRecord(attempt.usage, `${path}/usage`, errors)) {
        for (const key of ['inputTokens', 'outputTokens']) {
          if (!Number.isSafeInteger(attempt.usage[key]) || attempt.usage[key] < 0) addError(errors, `${path}/usage/${key}`, 'must be a non-negative integer');
        }
      }
      if (attempt.estimatedCost !== undefined && requiredRecord(attempt.estimatedCost, `${path}/estimatedCost`, errors)) {
        if (typeof attempt.estimatedCost.amount !== 'number' || !Number.isFinite(attempt.estimatedCost.amount) || attempt.estimatedCost.amount < 0) {
          addError(errors, `${path}/estimatedCost/amount`, 'must be a non-negative finite number');
        }
        requiredString(attempt.estimatedCost.currency, `${path}/estimatedCost/currency`, errors, { pattern: /^[A-Z]{3}$/ });
      }
    });
  }
  if (!Number.isSafeInteger(invocation.effectiveAttempt) || !attemptNumbers.has(invocation.effectiveAttempt)) {
    addError(errors, '/effectiveAttempt', 'must identify one of the recorded attempts');
  } else {
    const effective = invocation.attempts.find((attempt) => attempt.attempt === invocation.effectiveAttempt);
    if (effective?.outcome !== 'succeeded') addError(errors, '/effectiveAttempt', 'must identify a succeeded attempt');
  }
  validateHash(invocation.outputHash, '/outputHash', errors);
  validateHash(invocation.cacheFingerprint, '/cacheFingerprint', errors);
  if (HASH_RE.test(invocation.cacheFingerprint ?? '')) {
    try {
      const expected = buildLlmCacheFingerprint(invocation);
      if (expected !== invocation.cacheFingerprint) addError(errors, '/cacheFingerprint', `does not match computed fingerprint ${expected}`);
    } catch (error) {
      addError(errors, '/cacheFingerprint', `could not compute fingerprint: ${error.message}`);
    }
  }
  return validationResult(errors);
}

export function validateDatasetProvenance(manifest) {
  const errors = [];
  if (!requiredRecord(manifest, '', errors)) return validationResult(errors);
  validateSchemaVersion(manifest.schemaVersion, errors);
  validateId(manifest.datasetId, '/datasetId', errors);
  validateId(manifest.districtId, '/districtId', errors);
  if (!['source-mirror', 'normalized', 'derived', 'translation'].includes(manifest.kind)) {
    addError(errors, '/kind', 'has an unsupported dataset kind');
  }

  const hasArtifact = manifest.artifact !== undefined;
  const hasArtifacts = manifest.artifacts !== undefined;
  if (hasArtifact === hasArtifacts) addError(errors, '', 'must contain exactly one of artifact or artifacts');
  if (hasArtifact) validateArtifact(manifest.artifact, '/artifact', errors);
  if (hasArtifacts && requiredArray(manifest.artifacts, '/artifacts', errors, { min: 1 })) {
    const paths = new Set();
    manifest.artifacts.forEach((artifact, index) => {
      validateArtifact(artifact, `/artifacts/${index}`, errors);
      if (typeof artifact?.path === 'string' && paths.has(artifact.path)) addError(errors, `/artifacts/${index}/path`, 'must be unique');
      paths.add(artifact?.path);
    });
  }
  const artifactPaths = new Set([
    ...(hasArtifact && manifest.artifact?.path ? [manifest.artifact.path] : []),
    ...(Array.isArray(manifest.artifacts) ? manifest.artifacts.map((artifact) => artifact?.path).filter(Boolean) : []),
  ]);

  if (requiredRecord(manifest.authority, '/authority', errors)) {
    if (!['official', 'derived', 'unofficial', 'mixed'].includes(manifest.authority.status)) addError(errors, '/authority/status', 'has an unsupported authority status');
    if (manifest.authority.officialLanguage !== undefined) validateLocale(manifest.authority.officialLanguage, '/authority/officialLanguage', errors);
  }
  if (manifest.reportingPeriod !== undefined && requiredRecord(manifest.reportingPeriod, '/reportingPeriod', errors)) {
    if (manifest.reportingPeriod.from !== undefined && !validDate(manifest.reportingPeriod.from)) addError(errors, '/reportingPeriod/from', 'must be an ISO date');
    if (manifest.reportingPeriod.to !== undefined && !validDate(manifest.reportingPeriod.to)) addError(errors, '/reportingPeriod/to', 'must be an ISO date');
    if (validDate(manifest.reportingPeriod.from) && validDate(manifest.reportingPeriod.to)
        && manifest.reportingPeriod.to < manifest.reportingPeriod.from) addError(errors, '/reportingPeriod/to', 'must not precede from');
  }

  const sourceIds = new Set();
  const sourcesById = new Map();
  if (requiredArray(manifest.sources, '/sources', errors)) {
    manifest.sources.forEach((source, index) => {
      const path = `/sources/${index}`;
      if (!requiredRecord(source, path, errors)) return;
      validateId(source.sourceId, `${path}/sourceId`, errors);
      if (sourceIds.has(source.sourceId)) addError(errors, `${path}/sourceId`, 'must be unique');
      sourceIds.add(source.sourceId);
      sourcesById.set(source.sourceId, source);
      validateUrl(source.url, `${path}/url`, errors);
      validateDateTime(source.acquiredAt, `${path}/acquiredAt`, errors);
      if (source.effectiveAt !== undefined && !validDate(source.effectiveAt) && !validDateTime(source.effectiveAt)) addError(errors, `${path}/effectiveAt`, 'must be an ISO date or date-time');
      validateHash(source.hash, `${path}/hash`, errors, { optional: true });
      if (source.snapshot !== undefined) validateArtifact(source.snapshot, `${path}/snapshot`, errors);
      if (source.hash !== undefined && source.snapshot?.hash !== undefined && source.hash !== source.snapshot.hash) {
        addError(errors, `${path}/hash`, 'must match snapshot.hash when both are present');
      }
    });
  }

  if (requiredRecord(manifest.lineage, '/lineage', errors)) {
    validateDateTime(manifest.lineage.generatedAt, '/lineage/generatedAt', errors);
    if (requiredRecord(manifest.lineage.generator, '/lineage/generator', errors)) {
      validateRelativePath(manifest.lineage.generator.script, '/lineage/generator/script', errors);
      if (manifest.lineage.generator.version !== undefined) requiredString(manifest.lineage.generator.version, '/lineage/generator/version', errors);
      if (manifest.lineage.generator.gitCommit !== undefined) requiredString(manifest.lineage.generator.gitCommit, '/lineage/generator/gitCommit', errors, { pattern: /^[0-9a-f]{7,40}$/ });
    }
    if (requiredArray(manifest.lineage.inputs, '/lineage/inputs', errors)) {
      manifest.lineage.inputs.forEach((input, index) => {
        validateLineageInput(input, `/lineage/inputs/${index}`, errors);
        if (input?.sourceId !== undefined && !sourceIds.has(input.sourceId)) addError(errors, `/lineage/inputs/${index}/sourceId`, 'must resolve to sources[]');
      });
    }
  }
  if ((manifest.sources?.length ?? 0) === 0 && (manifest.lineage?.inputs?.length ?? 0) === 0) {
    addError(errors, '', 'must contain at least one source or lineage input');
  }
  validateQuality(manifest.quality, '/quality', errors);

  const invocationIds = new Set();
  if (manifest.llmInvocations !== undefined && requiredArray(manifest.llmInvocations, '/llmInvocations', errors)) {
    manifest.llmInvocations.forEach((invocation, index) => {
      const result = validateLlmInvocation(invocation);
      result.errors.forEach((error) => addError(errors, `/llmInvocations/${index}${error.path}`, error.message));
      if (invocationIds.has(invocation?.invocationId)) addError(errors, `/llmInvocations/${index}/invocationId`, 'must be unique');
      invocationIds.add(invocation?.invocationId);
    });
  }
  if (manifest.recordLineage !== undefined && requiredArray(manifest.recordLineage, '/recordLineage', errors)) {
    manifest.recordLineage.forEach((record, index) => {
      const path = `/recordLineage/${index}`;
      if (!requiredRecord(record, path, errors)) return;
      validateRelativePath(record.outputArtifactPath, `${path}/outputArtifactPath`, errors);
      if (typeof record.outputArtifactPath === 'string' && !artifactPaths.has(record.outputArtifactPath)) {
        addError(errors, `${path}/outputArtifactPath`, 'must resolve to artifact or artifacts[]');
      }
      validatePointer(record.outputPointer, `${path}/outputPointer`, errors);
      if (requiredArray(record.inputs, `${path}/inputs`, errors, { min: 1 })) {
        record.inputs.forEach((input, inputIndex) => {
          validateLineageInput(input, `${path}/inputs/${inputIndex}`, errors);
          if (input?.sourceId !== undefined && !sourceIds.has(input.sourceId)) addError(errors, `${path}/inputs/${inputIndex}/sourceId`, 'must resolve to sources[]');
          const source = sourcesById.get(input?.sourceId);
          if (source?.hash !== undefined && input?.hash !== source.hash) {
            addError(errors, `${path}/inputs/${inputIndex}/hash`, 'must match the referenced source hash');
          }
        });
      }
      if (record.llmInvocationId !== undefined) {
        validateId(record.llmInvocationId, `${path}/llmInvocationId`, errors);
        if (!invocationIds.has(record.llmInvocationId)) addError(errors, `${path}/llmInvocationId`, 'must resolve to llmInvocations[]');
      }
    });
  }
  return validationResult(errors);
}

export function validateClaim(claim) {
  const errors = [];
  if (!requiredRecord(claim, '', errors)) return validationResult(errors);
  validateSchemaVersion(claim.schemaVersion, errors);
  validateId(claim.claimId, '/claimId', errors);
  validateId(claim.datasetId, '/datasetId', errors);
  validatePointer(claim.outputPointer, '/outputPointer', errors);
  const derivedKinds = new Set(['derived', 'summary', 'translation', 'classification']);
  if (!['fact', ...derivedKinds, 'editorial'].includes(claim.kind)) addError(errors, '/kind', 'has an unsupported claim kind');
  validateLocale(claim.language, '/language', errors);
  if (claim.text !== undefined) requiredString(claim.text, '/text', errors);
  if (requiredArray(claim.sources, '/sources', errors, { min: 1 })) {
    claim.sources.forEach((source, index) => validateLineageInput(source, `/sources/${index}`, errors));
  }
  if (derivedKinds.has(claim.kind) && !isRecord(claim.derivation)) addError(errors, '/derivation', 'is required for a derived claim');
  if (claim.derivation !== undefined && requiredRecord(claim.derivation, '/derivation', errors)) {
    requiredString(claim.derivation.method, '/derivation/method', errors);
    if (claim.derivation.script !== undefined) validateRelativePath(claim.derivation.script, '/derivation/script', errors);
    if (claim.derivation.llmInvocationId !== undefined) validateId(claim.derivation.llmInvocationId, '/derivation/llmInvocationId', errors);
  }
  validateQuality(claim.quality, '/quality', errors);
  return validationResult(errors);
}

export function validateDistrictSourceManifest(manifest) {
  const errors = [];
  if (!requiredRecord(manifest, '', errors)) return validationResult(errors);
  validateSchemaVersion(manifest.schemaVersion, errors);
  validateId(manifest.manifestId, '/manifestId', errors);
  if (!['reconnaissance', 'pilot', 'active', 'retired'].includes(manifest.status)) addError(errors, '/status', 'has an unsupported manifest status');
  if (!validDate(manifest.lastReviewedAt)) addError(errors, '/lastReviewedAt', 'must be an ISO date');
  if (requiredRecord(manifest.publication, '/publication', errors)) {
    if (typeof manifest.publication.automatic !== 'boolean') addError(errors, '/publication/automatic', 'must be a boolean');
    if (!['internal-reconnaissance-config', 'public-config', 'public-redacted-config'].includes(manifest.publication.classification)) {
      addError(errors, '/publication/classification', 'has an unsupported publication classification');
    }
  }

  let gradeSourceId;
  if (requiredRecord(manifest.district, '/district', errors)) {
    validateId(manifest.district.id, '/district/id', errors);
    validateId(manifest.district.slug, '/district/slug', errors);
    requiredString(manifest.district.name, '/district/name', errors);
    requiredString(manifest.district.publicName, '/district/publicName', errors);
    if (requiredArray(manifest.district.aliases, '/district/aliases', errors)) {
      const aliases = new Set();
      manifest.district.aliases.forEach((alias, index) => {
        requiredString(alias, `/district/aliases/${index}`, errors);
        if (aliases.has(alias)) addError(errors, `/district/aliases/${index}`, 'must be unique');
        aliases.add(alias);
      });
    }
    if (requiredRecord(manifest.district.jurisdiction, '/district/jurisdiction', errors)) {
      requiredString(manifest.district.jurisdiction.country, '/district/jurisdiction/country', errors, { pattern: /^[A-Z]{2}$/ });
      requiredString(manifest.district.jurisdiction.state, '/district/jurisdiction/state', errors, { pattern: /^[A-Z]{2}$/ });
      requiredString(manifest.district.jurisdiction.county, '/district/jurisdiction/county', errors);
    }
    if (requiredRecord(manifest.district.identifiers, '/district/identifiers', errors)) {
      const identifiers = Object.entries(manifest.district.identifiers);
      if (identifiers.length === 0) addError(errors, '/district/identifiers', 'must contain at least one identifier');
      identifiers.forEach(([key, value]) => requiredString(value, `/district/identifiers/${escapeJsonPointerToken(key)}`, errors));
    }
    requiredString(manifest.district.districtType, '/district/districtType', errors);
    if (requiredRecord(manifest.district.gradeSpan, '/district/gradeSpan', errors)) {
      requiredString(manifest.district.gradeSpan.low, '/district/gradeSpan/low', errors);
      requiredString(manifest.district.gradeSpan.high, '/district/gradeSpan/high', errors);
      validateId(manifest.district.gradeSpan.sourceId, '/district/gradeSpan/sourceId', errors);
      gradeSourceId = manifest.district.gradeSpan.sourceId;
    }
    requiredString(manifest.district.timezone, '/district/timezone', errors);
    if (typeof manifest.district.timezone === 'string') {
      try {
        new Intl.DateTimeFormat('en', { timeZone: manifest.district.timezone }).format();
      } catch {
        addError(errors, '/district/timezone', 'must be a recognized IANA timezone');
      }
    }
    validateUrl(manifest.district.officialWebsite, '/district/officialWebsite', errors);
  }

  const locales = new Set();
  let languageEvidence = [];
  if (requiredRecord(manifest.languages, '/languages', errors)) {
    requiredString(manifest.languages.coverageRule, '/languages/coverageRule', errors);
    if (requiredArray(manifest.languages.orderedPilotLocales, '/languages/orderedPilotLocales', errors, { min: 1 })) {
      manifest.languages.orderedPilotLocales.forEach((language, index) => {
        const path = `/languages/orderedPilotLocales/${index}`;
        if (!requiredRecord(language, path, errors)) return;
        validateLocale(language.locale, `${path}/locale`, errors);
        requiredString(language.role, `${path}/role`, errors);
        requiredString(language.status, `${path}/status`, errors);
        if (locales.has(language.locale)) addError(errors, `${path}/locale`, 'must be unique');
        locales.add(language.locale);
      });
    }
    if (requiredArray(manifest.languages.evidenceSourceIds, '/languages/evidenceSourceIds', errors, { min: 1 })) {
      languageEvidence = manifest.languages.evidenceSourceIds;
      languageEvidence.forEach((sourceId, index) => validateId(sourceId, `/languages/evidenceSourceIds/${index}`, errors));
    }
  }

  const bodyIds = new Set();
  const bodySourceReferences = [];
  let primaryBodies = 0;
  if (requiredArray(manifest.governingBodies, '/governingBodies', errors, { min: 1 })) {
    manifest.governingBodies.forEach((body, index) => {
      const path = `/governingBodies/${index}`;
      if (!requiredRecord(body, path, errors)) return;
      validateId(body.id, `${path}/id`, errors);
      requiredString(body.name, `${path}/name`, errors);
      requiredString(body.type, `${path}/type`, errors);
      if (typeof body.primary !== 'boolean') addError(errors, `${path}/primary`, 'must be a boolean');
      if (body.primary === true) primaryBodies += 1;
      if (bodyIds.has(body.id)) addError(errors, `${path}/id`, 'must be unique');
      bodyIds.add(body.id);
      if (requiredArray(body.sourceIds, `${path}/sourceIds`, errors, { min: 1 })) {
        body.sourceIds.forEach((sourceId, sourceIndex) => {
          validateId(sourceId, `${path}/sourceIds/${sourceIndex}`, errors);
          bodySourceReferences.push({ sourceId, path: `${path}/sourceIds/${sourceIndex}` });
        });
      }
    });
  }
  if (primaryBodies !== 1) addError(errors, '/governingBodies', 'must identify exactly one primary governing body');

  const sourceIds = new Set();
  if (requiredArray(manifest.sources, '/sources', errors, { min: 1 })) {
    manifest.sources.forEach((source, index) => {
      const path = `/sources/${index}`;
      if (!requiredRecord(source, path, errors)) return;
      validateId(source.id, `${path}/id`, errors);
      if (sourceIds.has(source.id)) addError(errors, `${path}/id`, 'must be unique');
      sourceIds.add(source.id);
      requiredString(source.domain, `${path}/domain`, errors);
      if (requiredArray(source.artifactTypes, `${path}/artifactTypes`, errors, { min: 1 })) {
        source.artifactTypes.forEach((type, typeIndex) => requiredString(type, `${path}/artifactTypes/${typeIndex}`, errors));
      }
      validateUrl(source.url, `${path}/url`, errors);
      requiredString(source.authority, `${path}/authority`, errors);
      if (source.adapter !== undefined) requiredString(source.adapter, `${path}/adapter`, errors);
      if (requiredRecord(source.vendor, `${path}/vendor`, errors)) {
        if (!['high', 'medium', 'low', 'unknown'].includes(source.vendor.confidence)) addError(errors, `${path}/vendor/confidence`, 'must be high, medium, low, or unknown');
        if (source.vendor.confidence === 'unknown') {
          if (source.vendor.name !== null) requiredString(source.vendor.name, `${path}/vendor/name`, errors);
          if (source.vendor.product !== null) requiredString(source.vendor.product, `${path}/vendor/product`, errors);
        } else {
          requiredString(source.vendor.name, `${path}/vendor/name`, errors);
          requiredString(source.vendor.product, `${path}/vendor/product`, errors);
        }
        requiredString(source.vendor.basis, `${path}/vendor/basis`, errors);
      }
      if (requiredRecord(source.cadence, `${path}/cadence`, errors)) {
        requiredString(source.cadence.kind, `${path}/cadence/kind`, errors);
        requiredString(source.cadence.expectation, `${path}/cadence/expectation`, errors);
      }
      requiredString(source.archiveNotes, `${path}/archiveNotes`, errors);
      if (!validDate(source.checkedAt)) addError(errors, `${path}/checkedAt`, 'must be an ISO date');
    });
  }

  if (gradeSourceId && !sourceIds.has(gradeSourceId)) addError(errors, '/district/gradeSpan/sourceId', 'must resolve to sources[]');
  languageEvidence.forEach((sourceId, index) => {
    if (!sourceIds.has(sourceId)) addError(errors, `/languages/evidenceSourceIds/${index}`, 'must resolve to sources[]');
  });
  bodySourceReferences.forEach(({ sourceId, path }) => {
    if (!sourceIds.has(sourceId)) addError(errors, path, 'must resolve to sources[]');
  });

  function validTemporalValue(value, precision) {
    if (typeof value !== 'string') return false;
    if (precision === 'day') return validDate(value);
    if (precision === 'month') return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);
    if (precision === 'school-year') return /^\d{4}-\d{2}$/.test(value);
    return false;
  }
  function validObservedValue(value) {
    return validDate(value) || /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) || /^\d{4}-\d{2}$/.test(value);
  }
  const regimeIds = new Set();
  if (requiredArray(manifest.sourceRegimes, '/sourceRegimes', errors, { min: 1 })) {
    manifest.sourceRegimes.forEach((regime, index) => {
      const path = `/sourceRegimes/${index}`;
      if (!requiredRecord(regime, path, errors)) return;
      validateId(regime.id, `${path}/id`, errors);
      if (regimeIds.has(regime.id)) addError(errors, `${path}/id`, 'must be unique');
      regimeIds.add(regime.id);
      requiredString(regime.domain, `${path}/domain`, errors);
      if (requiredArray(regime.sourceIds, `${path}/sourceIds`, errors, { min: 1 })) {
        regime.sourceIds.forEach((sourceId, sourceIndex) => {
          validateId(sourceId, `${path}/sourceIds/${sourceIndex}`, errors);
          if (!sourceIds.has(sourceId)) addError(errors, `${path}/sourceIds/${sourceIndex}`, 'must resolve to sources[]');
        });
      }
      if (!['day', 'month', 'school-year', 'unknown'].includes(regime.precision)) addError(errors, `${path}/precision`, 'must be day, month, school-year, or unknown');
      for (const key of ['fromInclusive', 'toExclusive']) {
        if (regime[key] !== null && !validTemporalValue(regime[key], regime.precision)) {
          addError(errors, `${path}/${key}`, `must be null or match ${regime.precision} precision`);
        }
      }
      if (regime.precision === 'unknown' && (regime.fromInclusive !== null || regime.toExclusive !== null)) {
        addError(errors, path, 'unknown-precision asserted bounds must be null');
      }
      if (typeof regime.fromInclusive === 'string' && typeof regime.toExclusive === 'string' && regime.toExclusive <= regime.fromInclusive) {
        addError(errors, `${path}/toExclusive`, 'must be later than fromInclusive');
      }
      for (const key of ['observedFrom', 'observedThrough']) {
        if (regime[key] !== null && !validObservedValue(regime[key])) addError(errors, `${path}/${key}`, 'must be null, a date, a month, or a school year');
      }
      requiredString(regime.boundaryConfidence, `${path}/boundaryConfidence`, errors);
      requiredString(regime.notes, `${path}/notes`, errors);
    });
  }

  function validateBooleanPolicy(policy, path, keys) {
    if (!requiredRecord(policy, path, errors)) return;
    requiredString(policy.policyStatus, `${path}/policyStatus`, errors);
    keys.forEach((key) => {
      if (typeof policy[key] !== 'boolean') addError(errors, `${path}/${key}`, 'must be a boolean');
    });
  }
  validateBooleanPolicy(manifest.accessibility, '/accessibility', [
    'auditHtmlSemantics',
    'auditPdfTextAndReadingOrder',
    'auditVideoCaptions',
    'provideLowBandwidthTextAlternative',
    'neverTreatVendorAccessibilityClaimsAsArtifactVerification',
  ]);
  validateBooleanPolicy(manifest.privacy, '/privacy', [
    'sourceBeingPublicIsNotSufficientForRepublication',
    'reviewPersonalNamesBeforeIndexing',
    'suppressProtectedSmallCells',
    'doNotPublishStudentRecordsOrMeetingCredentials',
    'classifyEveryMirroredArtifactBeforeRelease',
  ]);

  if (requiredRecord(manifest.pilot, '/pilot', errors)) {
    requiredString(manifest.pilot.role, '/pilot/role', errors);
    if (manifest.pilot.validationTemplate !== undefined) validateRelativePath(manifest.pilot.validationTemplate, '/pilot/validationTemplate', errors);
    if (requiredArray(manifest.pilot.sampleTargets, '/pilot/sampleTargets', errors, { min: 1 })) {
      manifest.pilot.sampleTargets.forEach((target, index) => {
        const path = `/pilot/sampleTargets/${index}`;
        if (!requiredRecord(target, path, errors)) return;
        requiredString(target.domain, `${path}/domain`, errors);
        requiredString(target.selection, `${path}/selection`, errors);
        if (target.unit !== undefined) requiredString(target.unit, `${path}/unit`, errors);
        const hasCount = Number.isSafeInteger(target.count) && target.count > 0;
        const hasRange = Number.isSafeInteger(target.minimum) && target.minimum > 0
          && Number.isSafeInteger(target.maximum) && target.maximum >= target.minimum;
        if (!hasCount && !hasRange) addError(errors, path, 'must define a positive count or a valid minimum/maximum range');
      });
    }
    if (requiredArray(manifest.pilot.successSignals, '/pilot/successSignals', errors, { min: 1 })) {
      manifest.pilot.successSignals.forEach((signal, index) => requiredString(signal, `/pilot/successSignals/${index}`, errors));
    }
  }
  if (requiredArray(manifest.openQuestions, '/openQuestions', errors)) {
    manifest.openQuestions.forEach((question, index) => requiredString(question, `/openQuestions/${index}`, errors));
  }
  return validationResult(errors);
}

export function validateReleaseManifest(manifest) {
  const errors = [];
  if (!requiredRecord(manifest, '', errors)) return validationResult(errors);
  validateSchemaVersion(manifest.schemaVersion, errors);
  validateId(manifest.releaseId, '/releaseId', errors);
  if (requiredArray(manifest.districtIds, '/districtIds', errors, { min: 1 })) {
    const seen = new Set();
    manifest.districtIds.forEach((districtId, index) => {
      validateId(districtId, `/districtIds/${index}`, errors);
      if (seen.has(districtId)) addError(errors, `/districtIds/${index}`, 'must be unique');
      seen.add(districtId);
    });
  }
  validateDateTime(manifest.generatedAt, '/generatedAt', errors);
  if (manifest.publishedAt !== undefined) validateDateTime(manifest.publishedAt, '/publishedAt', errors);
  requiredString(manifest.gitCommit, '/gitCommit', errors, { pattern: /^[0-9a-f]{7,40}$/ });
  if (!['candidate', 'published', 'superseded'].includes(manifest.status)) addError(errors, '/status', 'has an unsupported release status');
  if (manifest.previousReleaseId !== undefined) validateId(manifest.previousReleaseId, '/previousReleaseId', errors);

  const publicPaths = new Set();
  const immutablePaths = new Set();
  if (requiredArray(manifest.artifacts, '/artifacts', errors, { min: 1 })) {
    manifest.artifacts.forEach((artifact, index) => {
      const path = `/artifacts/${index}`;
      if (!requiredRecord(artifact, path, errors)) return;
      if (!['r2', 'pages'].includes(artifact.channel)) addError(errors, `${path}/channel`, 'must be r2 or pages');
      validateRelativePath(artifact.sourcePath, `${path}/sourcePath`, errors);
      validatePublicPath(artifact.path, `${path}/path`, errors);
      const normalizedPublicPath = typeof artifact.path === 'string' ? artifact.path.replace(/^\//, '') : artifact.path;
      if (publicPaths.has(normalizedPublicPath)) addError(errors, `${path}/path`, 'must be unique after normalizing a leading slash');
      publicPaths.add(normalizedPublicPath);
      if (artifact.channel === 'r2') {
        validateRelativePath(artifact.immutablePath, `${path}/immutablePath`, errors);
        if (immutablePaths.has(artifact.immutablePath)) addError(errors, `${path}/immutablePath`, 'must be unique');
        immutablePaths.add(artifact.immutablePath);
      } else if (artifact.immutablePath !== undefined && artifact.immutablePath !== null) {
        addError(errors, `${path}/immutablePath`, 'must be null or omitted for pages artifacts');
      }
      requiredString(artifact.mediaType, `${path}/mediaType`, errors);
      validateHash(artifact.hash, `${path}/hash`, errors);
      if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) addError(errors, `${path}/bytes`, 'must be a non-negative safe integer');
      validateId(artifact.datasetId, `${path}/datasetId`, errors);
      if (artifact.language !== undefined) validateLocale(artifact.language, `${path}/language`, errors);
      if (!['public-source-record', 'public-derived-record', 'public-redacted-record'].includes(artifact.publicationClass)) {
        addError(errors, `${path}/publicationClass`, 'must be an allowlisted public classification');
      }
    });
  }
  if (requiredArray(manifest.qualityGates, '/qualityGates', errors, { min: 1 })) {
    const names = new Set();
    manifest.qualityGates.forEach((gate, index) => {
      const path = `/qualityGates/${index}`;
      if (!requiredRecord(gate, path, errors)) return;
      requiredString(gate.name, `${path}/name`, errors);
      if (names.has(gate.name)) addError(errors, `${path}/name`, 'must be unique');
      names.add(gate.name);
      if (!['passed', 'failed', 'waived'].includes(gate.status)) addError(errors, `${path}/status`, 'must be passed, failed, or waived');
      if (gate.status === 'waived') requiredString(gate.details, `${path}/details`, errors);
    });
  }
  if (manifest.status === 'published' && manifest.qualityGates?.some((gate) => gate.status === 'failed')) {
    addError(errors, '/qualityGates', 'a published release cannot contain failed quality gates');
  }
  if (manifest.status === 'published' && manifest.publishedAt === undefined) {
    addError(errors, '/publishedAt', 'is required for a published release');
  }
  return validationResult(errors);
}

export function assertValidProvenance(kind, value) {
  const validators = {
    dataset: validateDatasetProvenance,
    claim: validateClaim,
    llm: validateLlmInvocation,
    district: validateDistrictSourceManifest,
    release: validateReleaseManifest,
  };
  const validator = validators[kind];
  if (!validator) throw new Error(`Unknown provenance document kind: ${kind}`);
  const result = validator(value);
  if (!result.valid) {
    const error = new Error(`${kind} provenance validation failed:\n${result.errors.map((item) => `- ${item.path || '/'}: ${item.message}`).join('\n')}`);
    error.name = 'ProvenanceValidationError';
    error.validationErrors = result.errors;
    throw error;
  }
  return value;
}
