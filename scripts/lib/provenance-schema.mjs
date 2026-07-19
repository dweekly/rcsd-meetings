/** Draft 2020-12 validation for the public provenance contracts. */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA_DIR = resolve(ROOT, 'schemas/provenance/v1');
const files = [
  'common.schema.json',
  'dataset-provenance.schema.json',
  'claim.schema.json',
  'llm-invocation.schema.json',
  'district-source-manifest.schema.json',
  'release-manifest.schema.json',
];

// `strictRequired` rejects valid conditionals whose required properties are
// declared in an enclosing schema. Keep every other strict-mode check active.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const schemas = new Map();
for (const filename of files) {
  const schema = JSON.parse(readFileSync(resolve(SCHEMA_DIR, filename), 'utf8'));
  schemas.set(filename, schema);
  ajv.addSchema(schema);
}

const kindFiles = {
  dataset: 'dataset-provenance.schema.json',
  claim: 'claim.schema.json',
  llm: 'llm-invocation.schema.json',
  district: 'district-source-manifest.schema.json',
  release: 'release-manifest.schema.json',
};

const compiled = new Map(Object.entries(kindFiles).map(([kind, filename]) => [kind, ajv.getSchema(schemas.get(filename).$id)]));

export function validateJsonSchema(kind, value) {
  const validate = compiled.get(kind);
  if (!validate) throw new Error(`Unknown provenance schema kind: ${kind}`);
  const valid = validate(value);
  return {
    valid: !!valid,
    errors: valid ? [] : (validate.errors || []).map((error) => ({
      path: error.instancePath || '/',
      message: error.message || 'schema validation failed',
      keyword: error.keyword,
    })),
  };
}
