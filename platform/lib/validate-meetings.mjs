import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const HERE = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(resolve(HERE, '../schemas/meetings.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function schemaErrors() {
  return (validateSchema.errors || []).map((error) => ({
    path: error.instancePath || '/',
    message: error.message || 'schema validation failed',
    keyword: error.keyword,
  }));
}

function customError(path, message, keyword) {
  return { path, message, keyword };
}

function recordEvidence(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
  const axes = ['occurrence', 'agenda', 'minutes', 'recording'];
  const evidence = axes.flatMap((axis) => record[axis]?.evidence || []);
  for (const discrepancy of record.discrepancies || []) {
    evidence.push(...(discrepancy.evidence || []));
  }
  return evidence;
}

/**
 * Validate the portable schema plus cross-record constraints JSON Schema cannot
 * express: stable IDs are unique, district IDs agree, and evidence references a
 * declared source.
 */
export function validateMeetingDataset(value) {
  const validSchema = validateSchema(value);
  const errors = validSchema ? [] : schemaErrors();
  if (!validSchema) return { valid: false, errors };

  const districtId = value.district?.id;
  const sourceIds = new Set((value._metadata?.sources || []).map((source) => source.id));
  const seenSourceIds = new Set();
  for (const [index, source] of (value._metadata?.sources || []).entries()) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    if (seenSourceIds.has(source.id)) {
      errors.push(customError(
        `/_metadata/sources/${index}/id`,
        `duplicate source id: ${source.id}`,
        'uniqueSourceId',
      ));
    }
    seenSourceIds.add(source.id);
  }

  const seenRecordIds = new Set();
  for (const [index, record] of (value.records || []).entries()) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    if (seenRecordIds.has(record.id)) {
      errors.push(customError(
        `/records/${index}/id`,
        `duplicate meeting record id: ${record.id}`,
        'uniqueRecordId',
      ));
    }
    seenRecordIds.add(record.id);

    if (districtId && record.districtId !== districtId) {
      errors.push(customError(
        `/records/${index}/districtId`,
        `must match district.id (${districtId})`,
        'districtIdMatch',
      ));
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: record.timezone });
    } catch {
      errors.push(customError(
        `/records/${index}/timezone`,
        `unknown IANA time zone: ${record.timezone}`,
        'timeZone',
      ));
    }

    const discrepancyIds = new Set();
    for (const [discrepancyIndex, discrepancy] of record.discrepancies.entries()) {
      if (discrepancyIds.has(discrepancy.id)) {
        errors.push(customError(
          `/records/${index}/discrepancies/${discrepancyIndex}/id`,
          `duplicate discrepancy id: ${discrepancy.id}`,
          'uniqueDiscrepancyId',
        ));
      }
      discrepancyIds.add(discrepancy.id);
    }

    for (const evidence of recordEvidence(record)) {
      if (evidence?.sourceId && !sourceIds.has(evidence.sourceId)) {
        errors.push(customError(
          `/records/${index}`,
          `evidence references undeclared source: ${evidence.sourceId}`,
          'sourceReference',
        ));
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
