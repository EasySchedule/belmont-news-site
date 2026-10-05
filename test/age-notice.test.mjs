// The age notice, tested at the rendered-HTML level. Run with: node --test
//
// BEL-161, Defect 2. Four posts were serving present-tense copy about events that
// had already happened, three of them off the listing where a reader who followed a
// link never learns they were old. Three separate audits found the same fourth
// instance, on the front page, which no `expired` flag on those three would have
// reached: when nothing falls inside the listing window the build fills the front
// page with the newest posts, and those were the least-marked pages on the site.
//
// So these tests cover three surfaces and both reasons:
//   the post's own page      reached by link, bookmark, search
//   the front page card      reached by our own navigation, under "Latest"
//   feed.xml                 reached by a reader's feed reader
//
// and they check the copy, not just the presence of a marker. A banner that only
// labels the page is a third silent success on this issue, so every notice has to
// name a day and tell the reader what to do instead.

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
  '    title: "Gridpoint forecast PBZ/50,48"',
  '    organization: "National Weather Service, forecast office Pittsburgh PA"',
  '    retrieved: 2026-10-03',
].join('\n');

// The words the live pages actually carried, so the tests assert against the defect
// rather than against a paraphrase of it.
const BODY = [
  '## Tonight',
  '',
  'The wall stands free and open 24 hours today and tomorrow. Taps plays at dusk tonight.',
  '',
  'It should tell a reader who has not gone yet that they can still go tonight.',
].join('\n');

function post({ date, slug, extra = '' }) {
  return [
    'title: "The Wall That Heals closes Sunday at the Belmont County Fairgrounds"',
    'dek: "One sentence under the headline."',
    `date: ${date}`,
    'edition: evening',
    'byline: Danica Hoyt',
    'category: news',
    `slug: ${slug}`,
    ...(extra ? [extra] : []),
    SOURCES,
  ].join('\n');
}

function buildFixture(posts, today) {
  const root = mkdtempSync(join(tmpdir(), 'belmont-age-'));
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
    home: read('index.html'),
    feed: read('feed.xml'),
    sitemap: read('sitemap.xml'),
    info: JSON.parse(read('build-info.json')),
    pageFor: (p) => readFileSync(join(out, p.date, p.slug, 'index.html'), 'utf8'),
    clean: () => rmSync(root, { recursive: true, force: true }),
  };
}

const noticeOn = (html) => /<aside class="age-notice[\s\S]*?<\/aside>/.exec(html)?.[0] || '';
const flagOn = (html) => [...html.matchAll(/<span class="age-flag">([^<]*)<\/span>/g)].map((m) => m[1]);

// ------------------------------------------- a post that is no longer current

test('a post that has aged out of the window says so on its own page, with the day', () => {
  const r = buildFixture([{ date: '2026-10-02', slug: 'weather-roundup' }], '2026-10-05');
  try {
    assert.equal(r.code, 0, r.stderr);
    const n = noticeOn(r.pageFor({ date: '2026-10-02', slug: 'weather-roundup' }));
    assert.match(n, /This is the archive, not the news\./);
    assert.match(n, /datetime="2026-10-02"/, 'the notice is dated, not vague');
    // It has to reach the reader before the first present-tense sentence does.
    const page = r.pageFor({ date: '2026-10-02', slug: 'weather-roundup' });
    assert.ok(page.indexOf('age-notice') < page.indexOf('post-body'), 'the notice renders above the body');
  } finally {
    r.clean();
  }
});

test('the notice tells the reader what to do instead of only labelling the page', () => {
  // A marker that only labels is a third silent success. Four things have to be in
  // it: which day, what kind of stale, what to do, and no standing promise.
  const r = buildFixture([{ date: '2026-10-02', slug: 'weather-roundup' }], '2026-10-05');
  try {
    const n = noticeOn(r.pageFor({ date: '2026-10-02', slug: 'weather-roundup' }));
    assert.match(n, /<time datetime="2026-10-02">2026-10-02<\/time>/, 'which day');
    // The source copy is wrapped for the template, so compare on whitespace rather
    // than on the line breaks. A test that pins the wrapping breaks on a reword.
    assert.match(n, /It may still be\s+accurate/, 'what kind of stale this is');
    assert.match(n, /check the sources? named at the foot of this page/, 'what to do instead');
    assert.match(n, /Nothing on this page is a standing claim about today/, 'no standing promise');
  } finally {
    r.clean();
  }
});

test('the notice never claims the story is false when only the window has passed', () => {
  // Grace's audit and Priya's both make the distinction: a 2026-10-03 briefing with
  // every figure bound to a named calendar date is two days old, not false. The copy
  // must not collapse the two or the site starts libel itself.
  const r = buildFixture([{ date: '2026-10-02', slug: 'weather-roundup' }], '2026-10-05');
  try {
    const n = noticeOn(r.pageFor({ date: '2026-10-02', slug: 'weather-roundup' }));
    assert.doesNotMatch(n, /no longer true|stopped being current|is out of date/);
    assert.doesNotMatch(n, /wrong|inaccurate|incorrect/);
  } finally {
    r.clean();
  }
});

// -------------------------------------------------- a declared expiry

test('a post that declares itself expired names the day and says the story is false', () => {
  // Published 2026-10-03, subject shut 2026-10-04 at 14:00. On the 5th it is inside
  // its own two-day window, so nothing but the declaration can catch it.
  const r = buildFixture([{ date: '2026-10-03', slug: 'wall-that-heals', extra: 'expired: 2026-10-04' }], '2026-10-05');
  try {
    assert.equal(r.code, 0, r.stderr);
    const n = noticeOn(r.pageFor({ date: '2026-10-03', slug: 'wall-that-heals' }));
    assert.match(n, /This story stopped being current on <time datetime="2026-10-04">2026-10-04<\/time>/);
    assert.match(n, /its subject ended on/);
    assert.match(n, /describes that day and not this one/);
    assert.match(n, /Nothing on this page is a standing claim about today/);
  } finally {
    r.clean();
  }
});

test('a bare expired true gets a notice that does not invent a day', () => {
  const r = buildFixture([{ date: '2026-10-03', slug: 'wall-that-heals', extra: 'expired: true' }], '2026-10-05');
  try {
    const n = noticeOn(r.pageFor({ date: '2026-10-03', slug: 'wall-that-heals' }));
    assert.match(n, /This story is no longer current\./);
    assert.match(n, /has not given a single day for it/);
    // A named day nobody can verify is worse than no day.
    assert.doesNotMatch(n, /stopped being current on/);
  } finally {
    r.clean();
  }
});

test('an expired day that has not arrived yet leaves the post alone', () => {
  // The flag must be writable on publication day, because the moment a story goes
  // stale nobody is watching. A post marked for tomorrow reads exactly as it did.
  const r = buildFixture([{ date: '2026-10-05', slug: 'today-morning', extra: 'expired: 2026-10-06' }], '2026-10-05');
  try {
    assert.equal(flagOn(r.home).length, 0, 'no card flag on a live post');
    assert.equal(noticeOn(r.pageFor({ date: '2026-10-05', slug: 'today-morning' })), '', 'no notice on a live post');
    assert.doesNotMatch(r.feed, /<category>archive<\/category>/);
  } finally {
    r.clean();
  }
});

test('a declared expired post keeps its own page, its sources, and its sitemap entry', () => {
  // Dropping it from the listing is the point. Withdrawing it is not: the permalink
  // in every already-delivered feed guid has to keep resolving.
  const r = buildFixture([
    { date: '2026-10-05', slug: 'today-morning' },
    { date: '2026-10-03', slug: 'wall-that-heals', extra: 'expired: 2026-10-04' },
  ], '2026-10-05');
  try {
    const page = r.pageFor({ date: '2026-10-03', slug: 'wall-that-heals' });
    assert.match(page, /<h1>The Wall That Heals closes Sunday/, 'the post still renders in full');
    assert.match(page, /National Weather Service, forecast office Pittsburgh PA/, 'sources still name who');
    assert.match(page, /<h2>Sources<\/h2>/);
    assert.match(r.sitemap, /2026-10-03\/wall-that-heals\//);
    assert.doesNotMatch(r.home, /wall-that-heals/, 'and it is off the front page');
    assert.doesNotMatch(r.feed, /wall-that-heals/, 'and out of the forward-looking feed');
    // The story text is untouched. The notice sits above it; it does not rewrite it.
    assert.match(page, /The wall stands free and open 24 hours today and tomorrow/);
  } finally {
    r.clean();
  }
});

// ------------------------------------------- the fallback, the first instance

test('a post on the front page by fallback is dated, flagged, and the page says why', () => {
  // The instance three audits found and an `expired` flag alone cannot reach. No post
  // falls inside the window, so the newest are shown anyway — under a nav link that
  // reads "Latest".
  const r = buildFixture([
    { date: '2026-10-03', slug: 'wall-that-heals' },
    { date: '2026-10-03', slug: 'morning-briefing' },
    { date: '2026-10-02', slug: 'weather-roundup' },
  ], '2026-10-05');
  try {
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /WARNING no post is inside the 2-day listing window/);
    assert.equal(r.info.listing.fallback, true);

    // Every card on the page is flagged with the day it was published.
    assert.deepEqual(flagOn(r.home).sort(), ['From the archive, published 2026-10-03', 'From the archive, published 2026-10-03']);

    // And the page as a whole says it is not current news, once, at the top.
    const n = noticeOn(r.home);
    assert.match(n, /Nothing has been filed inside the listing window for/);
    assert.match(n, /datetime="2026-10-05"/);
    assert.match(n, /These are not the current news/);
    assert.ok(r.home.indexOf('age-notice') < r.home.indexOf('class="card"'), 'the notice is above the cards');

    // The lead card a reader lands on is the one that was serving false copy.
    const card = /<article class="card">[\s\S]*?<\/article>/.exec(r.home)[0];
    assert.match(card, /From the archive, published 2026-10-03/);
  } finally {
    r.clean();
  }
});

test('the fallback carries the feed too, so a feed reader sees the same claim', () => {
  const r = buildFixture([{ date: '2026-10-03', slug: 'wall-that-heals' }], '2026-10-05');
  try {
    assert.match(r.feed, /<category>archive<\/category>/);
    assert.match(r.feed, /<category>news<\/category>/, 'the real category is still there, first');
  } finally {
    r.clean();
  }
});

test('a fallback page never marks a post that is genuinely current', () => {
  // The other direction. A notice on a post filed this morning would train readers to
  // ignore it, which is the same failure in reverse.
  const r = buildFixture([
    { date: '2026-10-05', slug: 'today-morning' },
    { date: '2026-10-03', slug: 'wall-that-heals' },
  ], '2026-10-05');
  try {
    assert.equal(r.info.listing.fallback, false, 'something is in window, so no fallback runs');
    assert.equal(noticeOn(r.home), '', 'no page-level notice when the window is satisfied');
    assert.deepEqual(flagOn(r.home), []);
    assert.doesNotMatch(r.feed, /<category>archive<\/category>/);
  } finally {
    r.clean();
  }
});

test('a post that declares itself expired is never a fallback candidate', () => {
  // The desk said the story stopped being true. Resurrecting it onto the front page
  // because it is merely recent would publish "free and open tonight" by the exact
  // mechanism built to stop it.
  const r = buildFixture([
    { date: '2026-10-05', slug: 'today-morning' },
    { date: '2026-10-03', slug: 'wall-that-heals', extra: 'expired: 2026-10-04' },
    { date: '2026-10-03', slug: 'morning-briefing' },
  ], '2026-10-09');
  try {
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /WARNING no post is inside the 2-day listing window/);
    assert.doesNotMatch(r.home, /wall-that-heals/, 'not on the front page');
    assert.match(r.home, /morning-briefing/, 'the next newest story is promoted instead');
  } finally {
    r.clean();
  }
});

test('when every post has expired the front page says so rather than serving a false one', () => {
  const r = buildFixture([
    { date: '2026-10-03', slug: 'wall-that-heals', extra: 'expired: 2026-10-04' },
    { date: '2026-10-03', slug: 'morning-briefing', extra: 'expired: true' },
  ], '2026-10-09');
  try {
    assert.equal(r.code, 0, 'the archive still publishes');
    assert.equal(r.info.listing.empty, true);
    const n = noticeOn(r.home);
    assert.match(n, /Nothing on this page is current/);
    assert.match(n, /Every story in the archive has been marked no longer current/);
    assert.equal((r.home.match(/class="card"/g) || []).length, 0, 'no cards at all');
    // And the archive itself is untouched.
    assert.match(r.sitemap, /2026-10-03\/wall-that-heals\//);
    assert.match(r.sitemap, /2026-10-03\/morning-briefing\//);
    assert.equal(r.info.listing.listed + r.info.listing.expired, r.info.posts, 'no post is lost');
  } finally {
    r.clean();
  }
});

// ------------------------------------------------------------- the report

test('build-info.json says why each post is on or off the page', () => {
  // "expired" reads as one thing. It is two, and only one of them means the story
  // is no longer true. A reader of build-info.json needs to tell them apart.
  const r = buildFixture([
    { date: '2026-10-05', slug: 'today-morning' },
    { date: '2026-10-03', slug: 'wall-that-heals', extra: 'expired: 2026-10-04' },
    { date: '2026-10-02', slug: 'weather-roundup' },
  ], '2026-10-05');
  try {
    const by = Object.fromEntries(r.info.listing.posts.map((p) => [p.url, p]));
    assert.equal(by['/2026-10-05/today-morning/'].listed, true);
    assert.equal(by['/2026-10-05/today-morning/'].reason, null);
    assert.equal(by['/2026-10-05/today-morning/'].notice, null);

    assert.equal(by['/2026-10-03/wall-that-heals/'].reason, 'declared-expired');
    assert.equal(by['/2026-10-03/wall-that-heals/'].declaredDay, '2026-10-04');
    assert.equal(by['/2026-10-03/wall-that-heals/'].notice, 'expired');

    assert.equal(by['/2026-10-02/weather-roundup/'].reason, 'out-of-window');
    assert.equal(by['/2026-10-02/weather-roundup/'].notice, 'out-of-window');
    assert.equal(by['/2026-10-02/weather-roundup/'].declaredExpired, false);
  } finally {
    r.clean();
  }
});

test('build-info.json marks a fallback-listed post as on the page but not current', () => {
  const r = buildFixture([{ date: '2026-10-03', slug: 'wall-that-heals' }], '2026-10-05');
  try {
    const p = r.info.listing.posts[0];
    assert.equal(p.listed, true, 'it is on the page');
    assert.equal(p.fallbackListed, true, 'and it is not there because it is current');
    assert.equal(p.reason, 'out-of-window');
  } finally {
    r.clean();
  }
});