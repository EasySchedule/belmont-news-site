// Test that --from accepts the blogs repository root, as its help text and its
// own comments claim it does.
//
//   node --test test/
//
// The defect this guards (BEL-102) was reachable only by hand, so nothing on the
// publish path caught it: both routes production uses were already correct. That
// is exactly why it needs a test. A reader who follows the help text and points
// --from at the repository root got the root's content/ subtree copied whole, so
// the posts landed at content/content/ and never rendered, while the blogs
// repository's own README.md and CONTRIBUTING.md were copied in beside them as
// if they were posts and failed the build gate.
//
// Zero dependencies, like the script itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = join(HERE, '..');
const SYNC = join(SITE_ROOT, 'scripts', 'sync-content.mjs');

const POST = `---
title: The wall that heals
date: 2026-10-03
byline: Danica Hoyt
sources:
  - https://example.org/belmont-county-council-minutes
---

The wall came down in March.
`;

// A stand-in for the blogs repository: a root holding content/ and corrections/,
// plus the two root-level markdown files that are not posts. Each test gets its
// own temp tree and removes it afterwards, so a failing assertion leaves nothing
// for the next one to trip over.
function makeBlogsStore(t) {
  const dir = join(mkdtempSync(join(tmpdir(), 'sync-content-')), 'blogs');
  mkdirSync(join(dir, 'content', '2026', '10'), { recursive: true });
  mkdirSync(join(dir, 'corrections'), { recursive: true });
  writeFileSync(join(dir, 'content', '2026', '10', '2026-10-03-danica-hoyt--wall-that-heals.md'), POST);
  writeFileSync(join(dir, 'corrections', '2026-10.md'), '# Corrections\n\nNothing yet.\n');
  writeFileSync(join(dir, 'README.md'), '# blogs\n\nNot a post.\n');
  writeFileSync(join(dir, 'CONTRIBUTING.md'), '# Contributing\n\nNot a post.\n');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Every markdown file under dir, as paths relative to dir and sorted. The
// destinations are pointed away from the real content/ and corrections/ trees,
// so the checked-in posts are never the thing under test.
function walkMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(p).map((child) => join(entry.name, child)));
    else if (entry.name.endsWith('.md')) out.push(entry.name);
  }
  return out.sort();
}

const ONE_POST = [join('2026', '10', '2026-10-03-danica-hoyt--wall-that-heals.md')];

// The script stamps .content-synced.json next to itself whatever --dest says,
// so a test run against the real script would otherwise leave a tracked file
// describing a fixture.
//
// This matters more than tidiness. pages.yml runs the sync, then `node --test`,
// then the build, and build.mjs:649 reads that manifest for the contentHead the
// publish drift check compares against. A fixture manifest left in place would
// be stamped onto the published build-info.json, so the site would report the
// store head as unrendered forever. The restore is registered on process exit as
// well as on the test hook, so an assertion failure cannot leave it behind.
const SYNCED = join(SITE_ROOT, '.content-synced.json');
const SYNCED_BEFORE = existsSync(SYNCED) ? readFileSync(SYNCED) : null;
function restoreSyncedManifest() {
  if (SYNCED_BEFORE === null) rmSync(SYNCED, { force: true });
  else writeFileSync(SYNCED, SYNCED_BEFORE);
}
process.once('exit', restoreSyncedManifest);

function runSync(t, from) {
  const out = mkdtempSync(join(tmpdir(), 'sync-content-out-'));
  t.after(() => {
    restoreSyncedManifest();
    rmSync(out, { recursive: true, force: true });
  });
  const dest = join(out, 'content');
  const correctionsDest = join(out, 'corrections');
  return new Promise((resolve) => {
    execFile('node', [SYNC, '--from', from, '--dest', dest, '--corrections-dest', correctionsDest], {
      cwd: out,
      encoding: 'utf8',
    }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code ?? 1) : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        posts: walkMarkdown(dest),
        corrections: walkMarkdown(correctionsDest),
      });
    });
  });
}

test('--from the blogs repository root copies posts at content/YYYY/MM/*.md', async (t) => {
  const store = makeBlogsStore(t);

  const r = await runSync(t, store);

  assert.equal(r.code, 0, r.stderr);
  // One level of nesting, not two: content/2026/10/<post>.md. Before the fix
  // this was content/content/2026/10/<post>.md and the post never rendered.
  assert.deepEqual(r.posts, ONE_POST);
});

test('--from the blogs root does not copy the root markdown files in as posts', async (t) => {
  const store = makeBlogsStore(t);

  const r = await runSync(t, store);

  // README.md and CONTRIBUTING.md are the blogs repository's own documents, not
  // posts. They carry no front matter block, so build.mjs refused them and the
  // build exited 1 on files that were never supposed to be in content/ at all.
  assert.ok(!r.posts.includes('README.md'), `README.md copied in as a post: ${r.posts.join(', ')}`);
  assert.ok(!r.posts.includes('CONTRIBUTING.md'), `CONTRIBUTING.md copied in as a post: ${r.posts.join(', ')}`);
});

test('--from the blogs root still finds the corrections log', async (t) => {
  const store = makeBlogsStore(t);

  const r = await runSync(t, store);

  // blogsRootOf() infers the root from the posts directory, so this only holds
  // while findSource() returns the content/ directory rather than the root. A
  // root returned verbatim put the corrections log under content/ instead.
  assert.deepEqual(r.corrections, ['2026-10.md']);
});

test('--from the content/ directory is still accepted', async (t) => {
  const store = makeBlogsStore(t);

  const r = await runSync(t, join(store, 'content'));

  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.posts, ONE_POST);
  assert.deepEqual(r.corrections, ['2026-10.md']);
});

test('the help text still claims the root, and the code still honours it', () => {
  // The defect was a comment and a help line describing behaviour the code did
  // not have. Assert both halves so the claim cannot drift away from the code
  // again without a test going with it.
  const src = readFileSync(SYNC, 'utf8');
  assert.match(src, /--from accepts either the blogs\s+repository root or its content\/ directory/);
  assert.match(src, /function postsDirOf\(from\)/);
  assert.match(src, /if \(from\) return postsDirOf\(resolve\(from\)\)/);
});
