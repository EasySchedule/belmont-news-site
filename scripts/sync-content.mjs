#!/usr/bin/env node
// sync-content.mjs - copy the markdown store from belmont-news/blogs into this
// repository so a Netlify or GitHub Pages build is self-contained.
//
//   node scripts/sync-content.mjs                        # ../belmont-news/blogs/content
//   node scripts/sync-content.mjs --from <dir>           # a local path
//   node scripts/sync-content.mjs --from-github <repo>@<ref>   # pull content from GitHub
//
// The blogs repository is the source of truth. The copy in content/ exists so a
// single-repo deploy works without a network fetch at build time.

import { readdirSync, statSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = resolve(HERE, '..');
const DEST = join(SITE_ROOT, 'content');
const SYNCED = join(SITE_ROOT, '.content-synced.json');

const USAGE = `sync-content.mjs - copy belmont-news/blogs markdown into this repository

Usage: node scripts/sync-content.mjs [options]

  --from <dir>            local directory holding the markdown store
  --from-github <repo>@<ref>  clone that repository and use its content/
  --dest <dir>            destination (default content)
  --help                  this text

With no options it looks for a sibling checkout at ../belmont-news/blogs/content
and then for a sibling directory named blogs.
`;

const args = process.argv.slice(2);
if (args.includes('--help')) {
  process.stdout.write(USAGE);
  process.exit(0);
}

function arg(name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

function findSource() {
  const gh = arg('--from-github');
  if (gh) {
    const [repo, ref = 'main'] = gh.split('@');
    const tmp = join(SITE_ROOT, '.sync-tmp');
    rmSync(tmp, { recursive: true, force: true });
    process.stderr.write(`sync-content: cloning ${repo}@${ref}\n`);
    execFileSync('git', ['clone', '--depth', '1', '--branch', ref, `https://github.com/${repo}.git`, tmp], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    return join(tmp, 'content');
  }
  const from = arg('--from');
  if (from) return resolve(from);
  for (const cand of [
    join(SITE_ROOT, '..', 'belmont-news', 'blogs', 'content'),
    join(SITE_ROOT, '..', 'blogs', 'content'),
    join(SITE_ROOT, '..', 'blogs'),
  ]) {
    try {
      if (statSync(cand).isDirectory()) return cand;
    } catch { /* keep looking */ }
  }
  return null;
}

function copyTree(from, to, count = { n: 0 }) {
  for (const name of readdirSync(from).sort()) {
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) {
      mkdirSync(dst, { recursive: true });
      copyTree(src, dst, count);
    } else if (name.endsWith('.md')) {
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      count.n++;
    }
  }
  return count.n;
}

const src = findSource();
if (!src) {
  process.stderr.write(`sync-content: no markdown source found.\n${USAGE}\n`);
  process.exit(2);
}
try {
  statSync(src);
} catch {
  process.stderr.write(`sync-content: ${src} does not exist\n`);
  process.exit(2);
}

const dest = resolve(arg('--dest') || DEST);
const fromLabel = arg('--from-github') ? arg('--from-github') : relative(process.cwd(), src);

let head = null;
try {
  head = execFileSync('git', ['-C', resolve(src, '..', '..'), 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch { /* a plain directory has no git head; that is fine */ }

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
const n = copyTree(src, dest);

writeFileSync(SYNCED, `${JSON.stringify({
  syncedAt: new Date().toISOString(),
  source: fromLabel,
  sourceHead: head,
  markdownFiles: n,
  destination: relative(SITE_ROOT, dest),
}, null, 2)}\n`);

process.stderr.write(`sync-content: ${n} markdown file(s) copied from ${fromLabel} into ${relative(process.cwd(), dest)}\n`);
process.stdout.write(`${n}\n`);