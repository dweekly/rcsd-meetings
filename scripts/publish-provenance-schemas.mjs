#!/usr/bin/env node
/** Copy the versioned public provenance contracts into the static site. */

import { copyFileSync, mkdirSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SOURCE = resolve(ROOT, 'schemas/provenance/v1');
const TARGET = resolve(ROOT, 'docs/schemas/provenance/v1');
const files = readdirSync(SOURCE).filter((name) => name.endsWith('.json')).sort();

if (files.length !== 6) {
  throw new Error(`Expected 6 provenance schema files, found ${files.length}: ${files.join(', ')}`);
}

mkdirSync(TARGET, { recursive: true });
for (const file of files) copyFileSync(resolve(SOURCE, file), resolve(TARGET, file));
console.log(`Published ${files.length} provenance schemas to docs/schemas/provenance/v1/.`);
