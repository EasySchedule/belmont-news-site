// The corrections log has to reach the post it names. Run with: node --test
//
// This file is the regression test for BEL-313, and the last test in it is
// deliberately red until BEL-323 lands. Read that one before changing anything
// here.
//
// The defect: readCorrections() parsed corrections/YYYY-MM.md, correctionsBlock()
// rendered whatever `corrections:` front matter a post carried, and nothing ever
// asked whether the two agreed. So a correction could be logged, counted valid,
// published at /corrections/, and linked from the reader's own page -- to a post
// that showed the reader nothing. At eb7cc0c, five entries named
// morning-briefing-2026-10-03 and that page rendered zero Corrections sections,
// while `npm run check` printed "7 correction(s)" and passed clean.
//
// The rule, in one line: for every entry in every log, the post it names must
// carry a `corrections:` front-matter entry with the log entry's date.
//
// The direction is the point, and it is not symmetric with a check that already
// exists on purpose. build.mjs deliberately prints a correction's link to a post
// as plain text when that post is not in the build, because a correction can
// outlive its post and a dead link is worse than plain text. That behaviour is
// untouched here and is asserted below. This is the reverse direction: the log
// must not outrun the post.
//
// What "matching" means is the DATE and nothing else. The log carries the full
// editorial record and the front matter carries the reader-facing summary, so
// requiring identical prose would make this a second copy of the content. Tests
// 4 and 5 pin that down.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reconcileCorrections } from '../scripts/corrections.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(REPO, 'build.mjs');

const POST_DATE = '2026-10-02';
const POST_SLUG = 'morning-briefing-2026-10-02';

const FRONT = [
  'title: "Evening edition: a dry weekend ahead"',
  'dek: "One sentence under the headline."',
  `date: ${POST_DATE}`,
  'edition: evening',
  'byline: Margaret Vance',
  'category: belmont-county',
  `slug: ${POST_SLUG}`,
  'sources:',
  '  - type: document',
  '    title: "Gridpoint forecast PBZ/50,48"',
  '    organization: "National Weather Service, forecast office Pittsburgh PA"',
  '    retrieved: 2026-10-02',
].join('\n');

// `corrections:` front matter for a post, one entry per date given. `corrections`
// is omitted entirely when empty, which is how a post with no corrections looks
// in the store.
function fmCorrections(dates) {
  if (!dates.length) return '';
  return ['corrections:']
    .concat(dates.map((d, i) => `  - date: ${d}\n    correction: "Reader-facing note ${i + 1}."`))
    .join('\n');
}

// One corrections log with one entry per date given.
function log(entries) {
  return [
    '# Belmont News corrections — October 2026',
    '',
    'Standing rule: a correction is appended and never deleted.',
    '',
    ...entries.flatMap((e) => [
      `## ${e.postDate} — ${e.slug}`,
      '',
      `Correction (${e.correctionDate}): ${e.what || 'The section printed the wrong figure.'} / The figure is corrected.`,
      'Published in: the 06:00 edition.',
      'Corrected by: Margaret Vance.',
      '',
    ]),
  ].join('\n');
}

// Stage a one-post site with a corrections log beside it, and run the real gate
// over it. `--check` is what refuses; the same tree without it is what
// publishes, and both are exercised here.
function stage({ logText, frontMatter = FRONT, args = ['--check'] }) {
  const root = mkdtempSync(join(tmpdir(), 'belmont-reconcile-'));
  try {
    const post = join(root, 'content', '2026', '10', POST_DATE, `margaret-vance--${POST_SLUG}.md`);
    mkdirSync(dirname(post), { recursive: true });
    writeFileSync(post, ['---', frontMatter, '---', '', '## The evening', '', 'A dry weekend.', ''].join('\n'));
    if (logText !== null) {
      mkdirSync(join(root, 'corrections'), { recursive: true });
      writeFileSync(join(root, 'corrections', '2026-10.md'), logText);
    }
    const out = join(root, 'dist');
    const r = spawnSync('node', [BUILD, '--content', join(root, 'content'), '--corrections', join(root, 'corrections'), '--out', out, '--site-url', 'https://example.test', ...args], {
      cwd: root, encoding: 'utf8',
    });
    let monthHtml = null;
    try {
      monthHtml = readFileSync(join(out, 'corrections', '2026-10', 'index.html'), 'utf8');
    } catch { /* the gate refused before writing, which is a result here */ }
    let info = null;
    try {
      info = JSON.parse(readFileSync(join(out, 'build-info.json'), 'utf8'));
    } catch { /* same */ }
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', monthHtml, info, out };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------ the rule holds

test('a logged correction the post carries passes the gate', () => {
  const r = stage({
    logText: log([{ postDate: POST_DATE, slug: POST_SLUG, correctionDate: '2026-10-03' }]),
    frontMatter: `${FRONT}\n${fmCorrections(['2026-10-03'])}`,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /corrections reconciled with the posts they name: 1\/1 entry\(ies\)/);
});

test('a logged correction the post does not carry refuses the gate, by name', () => {
  // The whole point. The post is in the build and carries no corrections at all,
  // which is exactly the state BEL-313 shipped: `7 correction(s)` valid, zero
  // Corrections sections rendered.
  const r = stage({
    logText: log([{ postDate: POST_DATE, slug: POST_SLUG, correctionDate: '2026-10-03' }]),
  });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /1 logged correction\(s\) name a post that does not carry them/);
  assert.match(r.stderr, new RegExp(`/${POST_DATE}/${POST_SLUG}/`), 'the refusal names the post');
  assert.match(r.stderr, /needs 1 corrections front-matter entry\(ies\) dated 2026-10-03/);
});

test('every unreconciled entry is counted, and same-day entries are counted separately', () => {
  // Three corrections on one date are three front-matter entries. Grouping them
  // into one "dated 2026-10-02" would tell the desk to write one entry and fix
  // two thirds of the defect.
  const r = stage({
    logText: log([
      { postDate: POST_DATE, slug: POST_SLUG, correctionDate: '2026-10-02', what: 'First.' },
      { postDate: POST_DATE, slug: POST_SLUG, correctionDate: '2026-10-02', what: 'Second.' },
      { postDate: POST_DATE, slug: POST_SLUG, correctionDate: '2026-10-03', what: 'Third.' },
    ]),
  });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /3 logged correction\(s\)/);
  assert.match(r.stderr, /needs 2 corrections front-matter entry\(ies\) dated 2026-10-02, 2026-10-02/);
  assert.match(r.stderr, /needs 1 corrections front-matter entry\(ies\) dated 2026-10-03/);
});

test('a post carrying a correction on another date has not reconciled this one', () => {
  // The date is the match. A post that carries some correction is not thereby
  // carrying this one.
  const r = stage({
    logText: log([{ postDate: POST_DATE, slug: POST_SLUG, correctionDate: '2026-10-03' }]),
    frontMatter: `${FRONT}\n${fmCorrections(['2026-10-02'])}`,
  });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /it carries 2026-10-02/, 'the refusal says what the post does carry');
});

test('the prose does not have to match the log, only the date', () => {
  // The log carries the full editorial record and the front matter carries the
  // reader-facing summary. Requiring identical prose would make this a second
  // copy of the content, and the first reword would break the gate.
  const r = stage({
    logText: log([{ postDate: POST_DATE, slug: POST_SLUG, correctionDate: '2026-10-03' }]),
    frontMatter: `${FRONT}\n${fmCorrections(['2026-10-03'])}`,
  });
  assert.equal(r.status, 0, r.stderr);
});

// ------------------------------- the dead-link direction must not regress

test('a correction that outlives its post is a warning, never a refusal', () => {
  // The inverse rule, and it exists on purpose. build.mjs prints the date and
  // slug as plain text rather than linking to a page that is not in the build,
  // because a dead link in a corrections log is worse than plain text. This new
  // gate must not turn that honest record into an unpublishable one.
  const r = stage({
    logText: log([{ postDate: '2026-09-30', slug: 'a-post-that-is-not-here', correctionDate: '2026-10-03' }]),
    args: [],
  });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /does not carry them/, 'nothing about a missing post is a refusal');
  assert.ok(r.monthHtml, 'the corrections page still publishes');
  const kicker = (/<p class="kicker">([\s\S]*?)<\/p>/.exec(r.monthHtml) || [])[1] || '';
  assert.match(kicker, /2026-09-30<\/time> — a-post-that-is-not-here/, 'the entry still names its post');
  assert.doesNotMatch(kicker, /<a\s/, 'the name is plain text: no dead link to a post outside the build');
});

test('--check passes, prints the warning, and the build record carries it', () => {
  // "The post is not in this build" has to be visible in both places the newsroom
  // looks, because it is the one correction verdict that is allowed. A silent
  // allowance is indistinguishable from a reconciled entry.
  const entry = { postDate: '2026-09-30', slug: 'a-post-that-is-not-here', correctionDate: '2026-10-03' };
  const gate = stage({ logText: log([entry]) });
  assert.equal(gate.status, 0, gate.stderr);
  assert.match(gate.stdout, /warning {2}corrections\/2026-10\.md {2}2026-09-30 — a-post-that-is-not-here {2}correction \(2026-10-03\)/);
  assert.match(gate.stdout, /corrections reconciled with the posts they name: 0\/1 entry\(ies\)/);

  const built = stage({ logText: log([entry]), args: [] });
  assert.equal(built.status, 0, built.stderr);
  assert.deepEqual(built.info.correctionsReconciliation.postNotInBuild, [{ file: 'corrections/2026-10.md', ...entry }]);
  assert.deepEqual(built.info.correctionsReconciliation.unreconciled, [], 'a missing post is never counted as unreconciled');
});

test('a newsroom with no corrections log at all still passes the gate', () => {
  // A missing corrections directory has never been an error and this gate must
  // not make it one. The reconcile of zero entries is zero unreconciled entries.
  const r = stage({ logText: null });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no corrections log found under/);
});

// --------------------------------------------------------- the published site

test('the site still builds with an unreconciled log, and says so in build-info.json', () => {
  // --check refuses; `npm run build` does not. A correction that is already on
  // the record stays published -- deleting it would be the worse failure, and the
  // log is append-only -- so the site keeps building and the build record says
  // how much of the log reached a reader. A red gate and a working site are both
  // required; neither is a substitute for the other.
  const r = stage({
    logText: log([
      { postDate: POST_DATE, slug: POST_SLUG, correctionDate: '2026-10-03' },
      { postDate: '2026-09-30', slug: 'a-post-that-is-not-here', correctionDate: '2026-10-02' },
    ]),
    args: [],
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.monthHtml, 'the corrections page publishes');
  const rec = r.info.correctionsReconciliation;
  assert.equal(rec.checked, 2);
  assert.equal(rec.reconciled, 0);
  assert.equal(rec.unreconciled.length + rec.postNotInBuild.length, rec.checked);
  assert.deepEqual(rec.unreconciled.map((u) => u.correctionDate), ['2026-10-03']);
  assert.equal(r.info.corrections[0].entries, 2, 'the log still counts both entries as published');
});

// ------------------------------------------------------------- the rule itself

test('reconcileCorrections separates the three verdicts without conflating them', () => {
  // The unit under the subprocess tests above. A post not in the build is not
  // the same finding as a post in the build that does not carry the correction,
  // and the build prints them differently on purpose.
  const post = (date, slug, corrections) => ({ url: `${date}/${slug}/`, fm: { date, slug, corrections } });
  const entry = (postDate, slug, correctionDate) => ({ postDate, slug, correctionDate });
  const out = reconcileCorrections({
    logs: [{ month: '2026-10', entries: [
      entry('2026-10-02', 'kept', '2026-10-03'),
      entry('2026-10-02', 'kept', '2026-10-04'),
      entry('2026-09-30', 'gone', '2026-10-03'),
    ] }],
    posts: [post('2026-10-02', 'kept', [{ date: '2026-10-03' }])],
  });
  assert.equal(out.checked, 3);
  assert.equal(out.reconciled, 1);
  assert.deepEqual(out.unknownPost.map((u) => u.slug), ['gone']);
  assert.deepEqual(out.unreconciled.map((u) => u.correctionDate), ['2026-10-04']);
  assert.deepEqual(out.unreconciled[0].postDates, ['2026-10-03'], 'the report carries what the post does have');
});

test('reconcileCorrections reads nothing it was not given', () => {
  // No posts, no logs, or no corrections front matter at all are all ordinary
  // states for a fresh clone and a newsroom that has logged nothing.
  assert.deepEqual(reconcileCorrections({ logs: [], posts: [] }), { checked: 0, reconciled: 0, unreconciled: [], unknownPost: [] });
  assert.deepEqual(reconcileCorrections({ logs: [{ month: '2026-10', entries: [] }], posts: [] }).checked, 0);
  const out = reconcileCorrections({
    logs: [{ month: '2026-10', entries: [{ postDate: '2026-10-02', slug: 's', correctionDate: '2026-10-03' }] }],
    posts: [{ url: '2026-10-02/s/', fm: { corrections: undefined } }],
  });
  assert.equal(out.unreconciled.length, 1);
  assert.deepEqual(out.unreconciled[0].postDates, []);
});

// --------------------------------------------------- the committed correction log
//
// RED UNTIL BEL-323 LANDS. This is the definition of done for the gate, and it
// is the reason the gate can be trusted afterwards.
//
// It reads this repository's own content/ and corrections/ rather than a
// fixture, so it cannot pass by being written against a tree the newsroom does
// not publish. At the commit this branch is based on it fails, naming six
// entries: five against morning-briefing-2026-10-03, which BEL-323 is
// correcting, and one against morning-briefing-2026-10-02-evening, which needs
// superseding entries of its own.
//
// The fix is content, not code, and it is BEL-323's to make. When the store
// carries the front matter this test goes green on its own and nobody has to come
// back and delete it. Do not allowlist these entries to make it pass: an
// allowlist of exactly the entries this gate was written to catch would have
// swallowed BEL-313 whole.

test('every logged correction is reflected on the post it names', () => {
  const r = spawnSync('node', [BUILD, '--content', 'content', '--corrections', 'corrections', '--check'], {
    cwd: REPO, encoding: 'utf8',
  });
  assert.equal(
    r.status, 0,
    'the committed corrections log is ahead of the committed copy.\n'
    + `Every entry in corrections/YYYY-MM.md must be carried by the \`corrections:\` front matter of\n`
    + 'the post it names, on the same date. The log is append-only: add the front matter, do not\n'
    + 'delete the log entry.\n\n'
    + (r.stderr || ''),
  );
});
