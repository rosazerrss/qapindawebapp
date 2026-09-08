#!/usr/bin/env node
/**
 * Copies /shared into src/shared and functions/src/shared.
 *
 * Firebase only uploads the functions/ folder, and Next.js only bundles what is
 * reachable from src/. Rather than maintain two copies of the business rules —
 * which drift, and drift silently — there is one canonical folder and this
 * script mirrors it into both places with a "do not edit" banner on every file.
 */

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'shared');
const targets = [join(root, 'src', 'shared'), join(root, 'functions', 'src', 'shared')];

const BANNER = `/* eslint-disable */
// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Copied from /shared by \`npm run sync:shared\`. Edit the original.
// ---------------------------------------------------------------------------
`;

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else files.push(full);
  }
  return files;
}

const files = await listFiles(source);

for (const target of targets) {
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  for (const file of files) {
    const rel = relative(source, file);
    const destination = join(target, rel);
    await mkdir(dirname(destination), { recursive: true });

    if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      await writeFile(destination, BANNER + (await readFile(file, 'utf8')), 'utf8');
    } else {
      await cp(file, destination);
    }
  }
}

console.log(`✅ shared → src/shared, functions/src/shared (${files.length} fayl)`);
