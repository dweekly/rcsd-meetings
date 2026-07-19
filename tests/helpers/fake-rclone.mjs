#!/usr/bin/env node
/** Minimal filesystem-backed rclone double for release state-machine tests. */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, resolve } from 'path';

const [command, ...args] = process.argv.slice(2);
const source = args[0];
const destination = args[1];

const failCommand = process.env.FAKE_RCLONE_FAIL_COMMAND;
const failSuffix = process.env.FAKE_RCLONE_FAIL_PATH_SUFFIX;
const failMarker = process.env.FAKE_RCLONE_FAIL_MARKER;
if (
  command === failCommand
  && destination?.endsWith(failSuffix || '__never__')
  && (!failMarker || !existsSync(failMarker))
) {
  if (failMarker) {
    mkdirSync(dirname(failMarker), { recursive: true });
    writeFileSync(failMarker, 'failed once\n');
  }
  console.error(`injected fake-rclone failure: ${command} ${destination}`);
  process.exit(91);
}

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

function fileList() {
  const path = option('--files-from-raw');
  if (!path) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean);
}

function sameBytes(left, right) {
  return existsSync(left)
    && existsSync(right)
    && readFileSync(left).equals(readFileSync(right));
}

function copyOne(from, to, immutable, checksum) {
  if (!existsSync(from)) throw new Error(`source not found: ${from}`);
  if (immutable && existsSync(to)) {
    if (checksum) {
      if (!sameBytes(from, to)) throw new Error(`immutable destination differs: ${to}`);
    } else if (statSync(from).mtimeMs !== statSync(to).mtimeMs) {
      throw new Error(`timestamp mismatch between immutable objects: ${to}`);
    }
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

function positional() {
  return args.filter((arg) => !arg.startsWith('--'));
}

try {
  if (command === 'cat') {
    const path = positional()[0];
    // Match S3-class backends (R2 included): cat of a missing key exits 0
    // with empty output rather than erroring like the filesystem backend.
    if (existsSync(path)) process.stdout.write(readFileSync(path));
  } else if (command === 'lsjson') {
    const path = positional()[0];
    if (!args.includes('--stat')) throw new Error('fake-rclone lsjson only supports --stat');
    if (existsSync(path)) {
      const stat = statSync(path);
      process.stdout.write(`${JSON.stringify({
        Path: path.split('/').pop(),
        Name: path.split('/').pop(),
        Size: stat.size,
        ModTime: stat.mtime.toISOString(),
        IsDir: false,
      })}\n`);
    } else {
      // S3-class backends stat a missing key as a synthetic directory entry.
      process.stdout.write(`${JSON.stringify({
        Path: path.split('/').pop(),
        Name: path.split('/').pop(),
        Size: -1,
        ModTime: '2000-01-01T00:00:00.000000000Z',
        IsDir: true,
      })}\n`);
    }
  } else if (command === 'copyto') {
    if (!args.includes('--dry-run')) copyOne(source, destination, args.includes('--immutable'), args.includes('--checksum'));
  } else if (command === 'copy') {
    if (!args.includes('--dry-run')) {
      for (const relative of fileList()) {
        copyOne(resolve(source, relative), resolve(destination, relative), args.includes('--immutable'), args.includes('--checksum'));
      }
    }
  } else if (command === 'check') {
    for (const relative of fileList()) {
      const left = resolve(source, relative);
      const right = resolve(destination, relative);
      if (!sameBytes(left, right)) throw new Error(`check failed: ${left} != ${right}`);
    }
  } else {
    throw new Error(`unsupported fake-rclone command: ${command}`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(4);
}
