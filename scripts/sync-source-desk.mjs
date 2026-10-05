#!/usr/bin/env node
// Regenerates research/source-desk.md from the BEL-1 `sources` document.
//
// The document is the only maintained copy. This file is a build artifact of it.
// Do not hand-edit research/source-desk.md; correct the document and rerun this.
//
//   node scripts/sync-source-desk.mjs          # write the file
//   node scripts/sync-source-desk.mjs --check  # exit 1 if the file has drifted
//
// Credentials come from the environment. Nothing here prints a token.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ISSUE_ID = process.env.SOURCE_DESK_ISSUE_ID ?? '369da72e-672a-47f8-b428-c06e9fb77ab4';
const DOC_KEY = process.env.SOURCE_DESK_DOCUMENT ?? 'sources';
const TARGET = process.env.SOURCE_DESK_TARGET ?? 'research/source-desk.md';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function apiBase() {
  const raw = process.env.PAPERCLIP_API_URL;
  if (!raw) throw new Error('PAPERCLIP_API_URL is not set.');
  return raw.replace(/\/+$/, '').replace(/\/api$/, '');
}

function apiToken() {
  const token = process.env.PAPERCLIP_API_KEY;
  if (!token) throw new Error('PAPERCLIP_API_KEY is not set.');
  return token;
}

async function readSourceDocument() {
  const url = `${apiBase()}/api/issues/${ISSUE_ID}/documents/${encodeURIComponent(DOC_KEY)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiToken()}` },
  });
  if (!response.ok) {
    throw new Error(`Reading ${DOC_KEY} returned HTTP ${response.status}.`);
  }
  const doc = await response.json();
  const body = typeof doc.body === 'string' ? doc.body : '';
  if (!body) throw new Error(`${DOC_KEY} has an empty body. Refusing to write.`);
  return {
    body,
    revisionId: doc.latestRevisionId,
    revisionNumber: doc.latestRevisionNumber,
    updatedAt: doc.updatedAt,
  };
}

function headerFor(doc) {
  const day = String(doc.updatedAt ?? '').slice(0, 10);
  return [
    `<!-- Source of truth: the \`${DOC_KEY}\` document on BEL-1. Generated from BEL-1 ${DOC_KEY} revision ${doc.revisionNumber} (${day}), revision id ${doc.revisionId}. Do not hand-edit this file; correct the document and regenerate with \`node scripts/sync-source-desk.mjs\`. -->`,
    '',
  ].join('\n');
}

function render(doc) {
  return `${headerFor(doc)}\n${doc.body}`;
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const doc = await readSourceDocument();
  const expected = render(doc);
  const target = path.join(repoRoot, TARGET);

  let actual = null;
  try {
    actual = await readFile(target, 'utf8');
  } catch {
    actual = null;
  }

  if (checkOnly) {
    if (actual === expected) {
      const digest = createHash('sha256').update(expected).digest('hex');
      console.log(`${TARGET} matches BEL-1 ${DOC_KEY} revision ${doc.revisionNumber}. sha256 ${digest}`);
      return 0;
    }
    const state = actual === null ? 'missing' : 'drifted';
    console.error(`${TARGET} is ${state} from BEL-1 ${DOC_KEY} revision ${doc.revisionNumber} (${doc.revisionId}).`);
    console.error('Fix the BEL-1 document, then run: node scripts/sync-source-desk.mjs');
    return 1;
  }

  if (actual === expected) {
    console.log(`${TARGET} already matches BEL-1 ${DOC_KEY} revision ${doc.revisionNumber}. Nothing written.`);
    return 0;
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, expected, 'utf8');
  console.log(`Wrote ${TARGET} from BEL-1 ${DOC_KEY} revision ${doc.revisionNumber} (${doc.revisionId}).`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error.message);
    process.exit(2);
  });
