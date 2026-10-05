// The age notice against a post that has been corrected. Run with: node --test
//
// BEL-271. The notice made three claims. Two survived contact with a correction
// and one did not:
//
//   "It may still be accurate"                    fine, a correction is not a retraction
//   "Nothing here is a standing claim about today" fine, and still what lets the page be read
//   "it is not updated afterwards"                 false the moment a correction lands
//
// The build already knew. correctionsBlock() reads p.fm.corrections and renders
// the entries on the page; ageNotice() read the same post and did not consult it.
// So on 2026-10-05 the Wall That Heals page printed two correction entries under
// a banner asserting that nothing on it had ever been updated. That is worse than
// a missing notice, because a banner reads as an answer.
//
// These tests pin the notice to the front matter the correction block is rendered
// from, in both branches ageNotice() has — out-of-window and declared `expired:` —
// and in both directions. The two cases that matter are opposite and both are
// asserted: a corrected post must not be told it was never corrected, and an
// uncorrected post must keep the plain sentence, because "as published except
// where a correction is recorded" on a page with no corrections is a hedge about
// something that does not exist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(REPO, 'build.mjs');

const SOURCES = [
  'sources:',
  '  - type: document',
  '    title: "The Wall That Heals - Belmont County, Ohio 2026, Event Schedule page"',
  '    organization: "Belmont County Wall That Heals host committee"',
  '    retrieved: 2026-10-02',
].join('\n');

// The false claims, verbatim from the live banner on 2026-10-05.
const NEVER_UPDATED = /not\s+updated afterwards/;
const EXACTLY_AS_PUBLISHED = /left exactly as published/;

// The hedge. It is the reason a reader can read an expired page at all, so it is
// asserted in every case — corrected or not, window or `expired:`.
const HEDGE = /Nothing on this page is a standing claim about today/;

const BODY = [
  '## Tonight',
  '',
  'The wall stands free and open 24 hours today. The closing ceremony is 1:45 p.m. Sunday,',
  'and the grounds close at 2.',
].join('\n');

// One entry, on one line, the way the blogs store writes it. The front-matter
// parser reads one scalar per line, so a wrapped correction value would be read
// as extra list entries — by correctionsBlock() and by this notice alike, which is
// why the fixture does not wrap.
const CORRECTION = [
  'corrections:',
  '  - date: 2026-10-05',
  '    correction: "An update-class correction: the body said the grounds closed at 2 p.m., when the ceremony ended."',
].join('\n');

function post({ date, slug, extra = '' }) {
  return [
    'title: "Last chance: The Wall That Heals closes Sunday at the Fairgrounds"',
    'dek: "One sentence under the headline."',
    `date: ${date}`,
    'edition: morning',
    'byline: Danica Hoyt',
    'category: belmont-county',
    `slug: ${slug}`,
    ...(extra ? [extra] : []),
    SOURCES,
  ].join('\n');
}

function buildFixture(posts, today) {
  const root = mkdtempSync(join(tmpdir(), 'belmont-age-corrections-'));
  for (const p of posts) {
    const file = join(root, 'content', ...p.date.split('-'), `danica-hoyt--${p.slug}.md`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `---\n${post(p)}\n---\n\n${BODY}\n`);
  }
  const out = join(root, 'dist');
  const r = spawnSync('node', [BUILD, '--content', join(root, 'content'), '--out', out, '--site-url', 'https://example.test', '--newsroom-today', today], {
    cwd: root, encoding: 'utf8',
  });
  const read = (p) => readFileSync(join(out, p), 'utf8');
  return {
    code: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    root,
    pageFor: (p) => readFileSync(join(out, p.date, p.slug, 'index.html'), 'utf8'),
    home: read('index.html'),
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

const noticeOn = (html) => /<aside class="age-notice[\s\S]*?<\/aside>/.exec(html)?.[0] || '';
const correctionsBlockOn = (html) => /<section class="corrections">[\s\S]*?<\/section>/.exec(html)?.[0] || '';

// ------------------------------------------------ out of window, corrected

test('a corrected post that aged out of the window is not told it was never updated', () => {
  const r = buildFixture([{ date: '2026-10-03', slug: 'wall-that-heals', extra: CORRECTION }], '2026-10-06');
  try {
    assert.equal(r.code, 0, r.stderr);
    const page = r.pageFor({ date: '2026-10-03', slug: 'wall-that-heals' });
    const n = noticeOn(page);
    assert.ok(n, 'the notice still renders');
    assert.doesNotMatch(n, NEVER_UPDATED, 'the false claim, on the page the board read at 16:22Z');
    assert.doesNotMatch(n, EXACTLY_AS_PUBLISHED);
    assert.match(n, HEDGE, 'the hedge is not what gets fixed');
  } finally {
    r.clean();
  }
});

test('that notice says where the change is recorded, and the pointers resolve on the page', () => {
  // A notice that only stops denying the correction leaves the reader to guess
  // where the truth is. The two pointers have to exist on the page it points at:
  // the Corrections block, and the log index that block links to.
  const r = buildFixture([{ date: '2026-10-03', slug: 'wall-that-heals', extra: CORRECTION }], '2026-10-06');
  try {
    const page = r.pageFor({ date: '2026-10-03', slug: 'wall-that-heals' });
    const n = noticeOn(page);
    assert.match(n, /except where a correction is recorded/i);
    assert.match(n, /Corrections/, 'it names the block on the page');
    assert.match(n, /href="\/corrections\/"/, 'and links the full log, not just names it');
    // And the block it points at is actually rendered, with the entry in it.
    assert.ok(correctionsBlockOn(page), 'the Corrections block renders on this page');
    assert.match(correctionsBlockOn(page), /An update-class correction/);
  } finally {
    r.clean();
  }
});

// ------------------------------------- out of window, never corrected

test('a post with no corrections keeps the plain "not updated afterwards" sentence', () => {
  // The other direction, and the reason this is not a blanket reword. On a page
  // with no corrections that sentence is exactly true, and swapping it for a
  // hedge about corrections would put the notice referring to something absent.
  const r = buildFixture([{ date: '2026-10-03', slug: 'wall-that-heals' }], '2026-10-06');
  try {
    const page = r.pageFor({ date: '2026-10-03', slug: 'wall-that-heals' });
    const n = noticeOn(page);
    assert.match(n, NEVER_UPDATED);
    assert.doesNotMatch(n, EXACTLY_AS_PUBLISHED);
    assert.match(n, HEDGE);
    assert.equal(correctionsBlockOn(page), '', 'and there is no Corrections block to point at');
    assert.doesNotMatch(n, /href="\/corrections\/"/, 'so the notice must not point at one');
  } finally {
    r.clean();
  }
});

// ------------------------------------------------- expired, both ways

test('the expired branch is corrected the same way, before the flag is ever used', () => {
  // The second branch. Nothing sets `expired:` today, so this copy has never
  // rendered — which is why it would have shipped still false and surfaced the
  // first time the desk used the flag. It is fixed in the same change.
  const r = buildFixture([{ date: '2026-10-03', slug: 'wall-that-heals', extra: ['expired: 2026-10-04', CORRECTION].join('\n') }], '2026-10-06');
  try {
    assert.equal(r.code, 0, r.stderr);
    const page = r.pageFor({ date: '2026-10-03', slug: 'wall-that-heals' });
    const n = noticeOn(page);
    assert.match(n, /stopped being current/, 'the expired notice still renders');
    assert.doesNotMatch(n, EXACTLY_AS_PUBLISHED, '"left exactly as published" is the same false claim');
    assert.doesNotMatch(n, NEVER_UPDATED);
    assert.match(n, /except where a correction is recorded/i);
    assert.match(n, HEDGE);
  } finally {
    r.clean();
  }
});

test('the expired branch keeps the plain sentence when nothing has been corrected', () => {
  const r = buildFixture([{ date: '2026-10-03', slug: 'wall-that-heals', extra: 'expired: 2026-10-04' }], '2026-10-06');
  try {
    const n = noticeOn(r.pageFor({ date: '2026-10-03', slug: 'wall-that-heals' }));
    assert.match(n, EXACTLY_AS_PUBLISHED, 'true today, and still true when the flag lands');
    assert.doesNotMatch(n, /except where a correction is recorded/i);
    assert.match(n, HEDGE);
  } finally {
    r.clean();
  }
});

// ------------------------------------------------------- counting and edges

test('two corrections are counted, and one reads as one', () => {
  // The clause states how many, so it has to be right on both sides of singular.
  const two = [
    CORRECTION,
    '  - date: 2026-10-06',
    '    correction: "A second correction, one day later."',
  ].join('\n');
  const r = buildFixture([
    { date: '2026-10-03', slug: 'two-corrections', extra: two },
    { date: '2026-10-03', slug: 'one-correction', extra: CORRECTION },
  ], '2026-10-08');
  try {
    const two_ = noticeOn(r.pageFor({ date: '2026-10-03', slug: 'two-corrections' }));
    const one = noticeOn(r.pageFor({ date: '2026-10-03', slug: 'one-correction' }));
    assert.match(two_, /carries the 2 corrections/, 'the count is stated when it is not one');
    assert.doesNotMatch(two_, /carries the correction\b/, 'and not read as a single one');
    assert.match(one, /carries the correction\b/, 'one reads as one, with no numeral');
    assert.doesNotMatch(one, /\d+ corrections/);
  } finally {
    r.clean();
  }
});

test('an empty corrections list is treated as no corrections, not as one', () => {
  // `corrections:` with nothing under it parses to an empty list. correctionsBlock()
  // already refuses it, and the notice has to agree, or the notice points at a
  // block the build chose not to render.
  const r = buildFixture([{ date: '2026-10-03', slug: 'wall-that-heals', extra: 'corrections: []' }], '2026-10-06');
  try {
    const page = r.pageFor({ date: '2026-10-03', slug: 'wall-that-heals' });
    const n = noticeOn(page);
    assert.match(n, NEVER_UPDATED, 'nothing was corrected, so the plain sentence holds');
    assert.equal(correctionsBlockOn(page), '', 'and no block renders');
    assert.doesNotMatch(n, /except where a correction is recorded/i);
  } finally {
    r.clean();
  }
});

test('a current post with corrections gets no notice and is not rewritten', () => {
  // Nothing is wrong with a corrected post that is still current — the hedge is
  // what covers it, and the notice is only about being out of window. Fixing the
  // banner must not add one to a live page.
  const r = buildFixture([{ date: '2026-10-06', slug: 'today-morning', extra: CORRECTION }], '2026-10-06');
  try {
    const page = r.pageFor({ date: '2026-10-06', slug: 'today-morning' });
    assert.equal(noticeOn(page), '', 'no notice on a current post');
    assert.ok(correctionsBlockOn(page), 'but its correction is still printed');
    assert.doesNotMatch(r.home, /age-notice/, 'and no page-level notice either');
  } finally {
    r.clean();
  }
});