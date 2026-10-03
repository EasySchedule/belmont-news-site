#!/usr/bin/env node
// sync-content.mjs - copy the markdown store from belmont-news/blogs into this
// repository so a Netlify or GitHub Pages build is self-contained.
//
//   node scripts/sync-content.mjs                        # ../belmont-news/blogs/content
//   node scripts/sync-content.mjs --from <dir>           # a local path
//   node scripts/sync-content.mjs --from-github <repo>@<ref>   # pull content from GitHub
//
// Two trees are copied, and the second one matters as much as the first:
//
//   blogs/content/**/*.md   -> content/         posts. Gated by build.mjs.
//   blogs/corrections/*.md  -> corrections/     the corrections log. Not posts.
//
// The blogs repository is the source of truth. The copies here exist so a
// single-repo deploy works without a network fetch at build time.

import { readdirSync, statSync, mkdirSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = resolve(HERE, '..');
const DEST = join(SITE_ROOT, 'content');
const CORRECTIONS_DEST = join(SITE_ROOT, 'corrections');
const SYNCED = join(SITE_ROOT, '.content-synced.json');

const USAGE = `sync-content.mjs - copy belmont-news/blogs markdown into this repository

Usage: node scripts/sync-content.mjs [options]

  --from <dir>            local directory holding the markdown store
  --from-github <repo>@<ref>  clone that repository and use its content/
  --dest <dir>            posts destination (default content)
  --corrections-dest <dir>   corrections destination (default corrections)
  --help                  this text

With no options it looks for a sibling checkout at ../belmont-news/blogs/content
and then for a sibling directory named blogs. --from accepts either the blogs
repository root or its content/ directory.

Two trees are copied. blogs/content/**/*.md lands in content/ and is gated by
build.mjs: a post with no sources fails the build. blogs/corrections/YYYY-MM.md
lands in corrections/ and is rendered at /corrections/: a correction is not an
article, carries no front matter, and is not gated as one. Either tree may be
empty; a missing corrections directory is not an error.
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

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

// --from may name the blogs repository root or its content/ directory. Both are
// accepted, as the help text says, so the directory that holds YYYY/MM/*.md is
// worked out here. Without this the root's content/ subtree was copied whole and
// the posts landed at content/content/, while the root's own README.md and
// CONTRIBUTING.md were copied in beside them as posts and failed the build gate.
function postsDirOf(from) {
  return isDir(join(from, 'content')) ? join(from, 'content') : from;
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
  if (from) return postsDirOf(resolve(from));
  for (const cand of [
    join(SITE_ROOT, '..', 'belmont-news', 'blogs', 'content'),
    join(SITE_ROOT, '..', 'blogs', 'content'),
    join(SITE_ROOT, '..', 'blogs'),
  ]) {
    if (isDir(cand)) return cand;
  }
  return null;
}

// --from may name the blogs repository root or its content/ directory. Both are
// accepted, and the corrections log is only findable from the root, so the root
// is worked out here rather than assumed.
function blogsRootOf(src) {
  return isDir(join(src, 'content')) ? src : dirname(src);
}

// One directory of markdown, copied wholesale. The caller empties the
// destination first, so a deleted post does not linger on the site.
function copyTree(from, to) {
  if (!isDir(from)) return 0;
  let n = 0;
  for (const name of readdirSync(from).sort()) {
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) {
      mkdirSync(dst, { recursive: true });
      n += copyTree(src, dst);
    } else if (name.endsWith('.md')) {
      mkdirSync(dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      n++;
    }
  }
  return n;
}

// Mirror a directory into a destination that is emptied first. Returns the
// markdown files copied, so the caller can drop the directory when it is empty.
function mirrorTree(src, dest) {
  if (!isDir(src)) return [];
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  copyTree(src, dest);
  return readdirSync(dest).filter((f) => f.endsWith('.md')).sort();
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
const correctionsDest = resolve(arg('--corrections-dest') || CORRECTIONS_DEST);
const root = blogsRootOf(src);
const fromLabel = arg('--from-github') ? arg('--from-github') : relative(process.cwd(), src);

let head = null;
try {
  head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch { /* a plain directory has no git head; that is fine */ }

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
const n = copyTree(src, dest);

// The corrections log. blogs/corrections/*.md only, one level, because the
// month in the filename is the URL. A newsroom that has logged nothing yet
// leaves an absent directory, and an absent directory is not an error.
const correctionsSrc = join(root, 'corrections');
const correctionsFiles = mirrorTree(correctionsSrc, correctionsDest);
const c = correctionsFiles.length;

writeFileSync(SYNCED, `${JSON.stringify({
  syncedAt: new Date().toISOString(),
  source: fromLabel,
  sourceHead: head,
  markdownFiles: n,
  destination: relative(SITE_ROOT, dest),
  correctionsSource: relative(root, correctionsSrc),
  correctionsFiles: c,
  correctionsFilesList: correctionsFiles,
  correctionsDestination: relative(SITE_ROOT, correctionsDest),
}, null, 2)}\n`);

process.stderr.write(`sync-content: ${n} markdown file(s) copied from ${fromLabel} into ${relative(process.cwd(), dest)}\n`);
process.stderr.write(`sync-content: ${c} corrections log(s) copied from ${fromLabel === relative(process.cwd(), src) ? relative(process.cwd(), root) : fromLabel} into ${relative(process.cwd(), correctionsDest) || '.'}${correctionsFiles.length ? `: ${correctionsFiles.join(', ')}` : ''}\n`);
process.stdout.write(`${n}\n`);