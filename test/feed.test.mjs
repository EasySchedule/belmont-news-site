// feed.xml, tested. Run with: node --test
//
// Two rules, both found read-only on the live feed by Grace Okoye on BEL-120 and
// filed as BEL-138, plus the corrections `lastmod` beside them as BEL-137.
//
//   1. The byline travels in a field readers actually read. RSS 2.0 defines
//      <author> as an EMAIL ADDRESS, so the feed used to put a display name in a
//      field whose whole meaning is "this is an address", and every reader that
//      honours the spec dropped it. There was no dc:creator and no Dublin Core
//      namespace, so nothing caught it: the live feed served
//      `<author>Margaret Vance</author>` and the byline survived nowhere a
//      reader's reader would look.
//
//   2. The channel's clock tells the truth about its own content. lastBuildDate
//      was the build instant, so on a quiet newsroom day the feed announced
//      itself rebuilt while every item in it was days old. RSS 2.0 defines that
//      field as the last time the channel's CONTENT changed. There was also no
//      <ttl>, so each reader picked its own cache interval for itself.

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

// 2026-10-05T13:24:00Z, the exact instant the live build-info.json reported on the
// day the audit ran. Pinned so a regression is a fixed diff, not "it moved".
const AUDIT_BUILD_EPOCH = '1791206640';
// The same instant as a number, for the comparisons below. Date.parse on a bare
// epoch string is NaN, and `x <= NaN` is false, so a test that used it would
// fail for a reason that has nothing to do with the feed.
const AUDIT_BUILD_AT = Number(AUDIT_BUILD_EPOCH) * 1000;

function frontMatterFor({ date, slug, byline = 'Nathan Beausoleil', edition = 'column', extra = '' }) {
  return [
    'title: "A headline long enough to pass the schema"',
    'dek: "One sentence under the headline."',
    `date: ${date}`,
    `edition: ${edition}`,
    `byline: ${byline}`,
    'category: weather',
    `slug: ${slug}`,
    ...(extra ? [extra] : []),
    SOURCES,
  ].join('\n');
}

// Render a fixture content tree with the newsroom day and the build clock pinned,
// so the channel's clock is a function of the fixture rather than of today.
// Returns the output directory plus both streams; the caller cleans up.
function buildFixture(posts, { today, corrections, buildEpoch = AUDIT_BUILD_EPOCH } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'belmont-feed-'));
  const content = join(root, 'content');
  for (const p of posts) {
    const file = join(content, ...p.date.split('-'), `reporter--${p.slug}.md`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `---\n${frontMatterFor(p)}\n---\n\n## The roundup\n\nRain tonight.\n`);
  }
  const args = [
    BUILD, '--content', content, '--out', join(root, 'dist'),
    '--site-url', 'https://example.test', '--build-epoch', buildEpoch,
  ];
  if (today !== undefined) args.push('--newsroom-today', today);
  args.push('--corrections', corrections || join(root, 'no-corrections'));
  const r = spawnSync('node', args, { cwd: root, encoding: 'utf8' });
  const base = { code: r.status, root, stdout: r.stdout || '', stderr: r.stderr || '' };
  try {
    const read = (p) => readFileSync(join(root, 'dist', p), 'utf8');
    return {
      ...base,
      feed: read('feed.xml'),
      sitemap: read('sitemap.xml'),
      info: JSON.parse(read('build-info.json')),
    };
  } catch {
    return base;
  }
}

function itemBlock(feed, slug) {
  const m = new RegExp(`<item>[\\s\\S]*?${slug}[\\s\\S]*?</item>`).exec(feed);
  return m ? m[0] : '';
}

// Two posts in the window on the audit's newsroom day, so the feed is not empty
// and the window needs no fallback.
const AUDIT_DAY_POSTS = [
  { date: '2026-10-04', slug: 'today-evening', edition: 'evening', byline: 'Nathan Beausoleil' },
  { date: '2026-10-04', slug: 'today-morning', edition: 'morning', byline: 'Margaret Vance' },
];

// ------------------------------------------------------------- the byline

test('the byline ships in dc:creator, with the Dublin Core namespace declared', () => {
  const r = buildFixture(AUDIT_DAY_POSTS, { today: '2026-10-05' });
  assert.equal(r.code, 0, r.stderr);
  // An undeclared prefix is not XML. A reader that resolves the prefix by name
  // rather than by URI silently drops the element, which is how the byline
  // disappeared in the first place.
  assert.match(r.feed, /xmlns:dc="http:\/\/purl\.org\/dc\/elements\/1\.1\/"/,
    'the Dublin Core namespace must be declared on <rss>');
  assert.match(itemBlock(r.feed, 'today-morning'), /<dc:creator>Margaret Vance<\/dc:creator>/);
  assert.match(itemBlock(r.feed, 'today-evening'), /<dc:creator>Nathan Beausoleil<\/dc:creator>/);
});

test('a byline with no published address emits no author element at all', () => {
  const r = buildFixture(AUDIT_DAY_POSTS, { today: '2026-10-05' });
  assert.equal(r.code, 0, r.stderr);
  // The bug this replaces: `<author>Margaret Vance</author>`. RSS 2.0 defines
  // <author> as an email address, so a reader either drops it or prints an
  // address-shaped lie. Absent is correct; off-spec is not.
  assert.doesNotMatch(r.feed, /<author>[^<]*<\/author>/,
    'no display name may appear in <author>');
  // The name is still there, in the field readers read.
  assert.match(r.feed, /<dc:creator>Margaret Vance<\/dc:creator>/);
  assert.match(r.feed, /<dc:creator>Nathan Beausoleil<\/dc:creator>/);
});

test('a post that supplies an address gets a spec-legal author, and keeps the name too', () => {
  const r = buildFixture([
    { ...AUDIT_DAY_POSTS[0], extra: 'byline_email: desk@belmontnews.example.com' },
    AUDIT_DAY_POSTS[1],
  ], { today: '2026-10-05' });
  assert.equal(r.code, 0, r.stderr);
  const item = itemBlock(r.feed, 'today-evening');
  assert.match(item, /<author>desk@belmontnews\.example\.com<\/author>/);
  assert.match(item, /<dc:creator>Nathan Beausoleil<\/dc:creator>/,
    'an address must never replace the name');
  // Only the post that supplied one gets an author element.
  assert.equal((r.feed.match(/<author>/g) || []).length, 1);
});

test('a byline_email that is not an address stops the build', () => {
  // The same shape as the old bug, reintroduced through the new field. It fails
  // the build rather than publishing, for the same reason an unsourced post
  // does: the only place to catch a broken byline is before the publish.
  const r = buildFixture([
    { ...AUDIT_DAY_POSTS[0], extra: 'byline_email: Nathan Beausoleil' },
  ], { today: '2026-10-05' });
  assert.notEqual(r.code, 0, 'a display name in byline_email must not publish');
  assert.match(r.stderr, /byline_email must be an email address/);
  assert.match(r.stderr, /dc:creator/, 'the message must say where the name still ships');
});

test('an empty byline_email is no address, not a broken one', () => {
  const r = buildFixture([
    { ...AUDIT_DAY_POSTS[0], extra: 'byline_email: ""' },
  ], { today: '2026-10-05' });
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.feed, /<author>/);
  assert.match(r.feed, /<dc:creator>Nathan Beausoleil<\/dc:creator>/);
});

test('build-info.json reports the byline state and the channel clock', () => {
  const r = buildFixture([
    { ...AUDIT_DAY_POSTS[0], extra: 'byline_email: desk@belmontnews.example.com' },
    AUDIT_DAY_POSTS[1],
  ], { today: '2026-10-05' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.info.feed.authorsWithAddress, 1);
  const evening = r.info.feed.entries.find((e) => e.url.includes('today-evening'));
  const morning = r.info.feed.entries.find((e) => e.url.includes('today-morning'));
  assert.equal(evening.byline, 'Nathan Beausoleil');
  assert.equal(evening.author, 'desk@belmontnews.example.com');
  assert.equal(morning.byline, 'Margaret Vance');
  assert.equal(morning.author, null, 'no published address is reported as null, not guessed');
  assert.equal(typeof r.info.feed.ttlMinutes, 'number');
});

// ------------------------------------------------------ the channel's clock

test('lastBuildDate is the newest item, not the instant the build ran', () => {
  const r = buildFixture(AUDIT_DAY_POSTS, { today: '2026-10-05' });
  assert.equal(r.code, 0, r.stderr);
  const lastBuild = /<lastBuildDate>([^<]+)<\/lastBuildDate>/.exec(r.feed)[1];
  const pubDates = [...r.feed.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((m) => m[1]);
  const newest = Date.parse(pubDates[0]);
  assert.equal(Date.parse(lastBuild), newest,
    'lastBuildDate must be the moment the channel last gained content');
  // The exact regression: the build instant is 2026-10-05T13:24:00Z and the
  // newest item is 2026-10-05T06:00-04:00. Announcing the build as the feed's
  // freshness told a reader "new" over items up to two days old.
  assert.notEqual(lastBuild, new Date(AUDIT_BUILD_AT).toUTCString());
  // The evening edition is the newer of the two: 20:00 EDT on 2026-10-04 is
  // 2026-10-05T00:00Z, which is already the 5th in UTC. Naming the expected
  // string rather than only comparing against pubDates[0] is the point: it is
  // what pins the order instead of the assertion to whichever item came first.
  assert.equal(lastBuild, 'Mon, 05 Oct 2026 00:00:00 GMT');
});

test('no item and no build can put lastBuildDate in the future', () => {
  const r = buildFixture(AUDIT_DAY_POSTS, { today: '2026-10-05' });
  const lastBuild = Date.parse(/<lastBuildDate>([^<]+)<\/lastBuildDate>/.exec(r.feed)[1]);
  for (const m of r.feed.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)) {
    assert.ok(Date.parse(m[1]) <= lastBuild, 'an item may never postdate the channel');
  }
  assert.ok(lastBuild <= AUDIT_BUILD_AT,
    'the channel clock is capped at the build like every other timestamp');
});

test('a rebuild that changes nothing does not claim the feed is new', () => {
  // Two builds of the same fixture with the same pinned epoch are byte-identical,
  // so a scheduled rebuild on a quiet newsroom day reports the same
  // lastBuildDate instead of announcing fresh content it did not publish.
  const a = buildFixture(AUDIT_DAY_POSTS, { today: '2026-10-05' });
  const b = buildFixture(AUDIT_DAY_POSTS, { today: '2026-10-05' });
  assert.equal(a.feed, b.feed);
});

test('the feed carries a ttl, and build-info reports the same number', () => {
  const r = buildFixture(AUDIT_DAY_POSTS, { today: '2026-10-05' });
  const ttl = /<ttl>(\d+)<\/ttl>/.exec(r.feed);
  assert.ok(ttl, 'a feed with no <ttl> leaves every reader to pick its own interval');
  assert.ok(Number(ttl[1]) > 0, 'a ttl of zero minutes means poll continuously');
  assert.equal(r.info.feed.ttlMinutes, Number(ttl[1]));
  assert.equal(r.info.feed.lastBuildDate, /<lastBuildDate>([^<]+)<\/lastBuildDate>/.exec(r.feed)[1]);
});

test('an empty channel still carries a ttl and a clock that is not in the future', () => {
  // The listing can come up empty on a quiet newsroom day. The build warns and
  // falls back, and the feed still has to be a valid document.
  const r = buildFixture([{ date: '2026-09-01', slug: 'long-gone' }], { today: '2026-10-05' });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.feed, /<ttl>\d+<\/ttl>/);
  const lastBuild = Date.parse(/<lastBuildDate>([^<]+)<\/lastBuildDate>/.exec(r.feed)[1]);
  assert.ok(lastBuild <= AUDIT_BUILD_AT);
});

// -------------------------------------- the corrections page's own lastmod

test('a corrections page reports the newest date it prints, not the oldest entry', () => {
  // entries[0] is the OLDEST entry, because the log is append-only. Reading the
  // newest content's date off it pinned lastmod to the day before the two
  // superseding corrections landed on the page, and a crawler that trusts
  // lastmod then stops re-reading it. BEL-137.
  const dir = mkdtempSync(join(tmpdir(), 'belmont-corrections-'));
  writeFileSync(join(dir, '2026-10.md'), `# Belmont News corrections — October 2026

## 2026-10-03 — morning-briefing-2026-10-03

Correction (2026-10-02): the first correction, the oldest one.
Published in: an edition.
Corrected by: A Person.

## 2026-10-04 — morning-briefing-2026-10-04

Correction (2026-10-05): the third correction, the newest one.
Published in: an edition.
Corrected by: A Person.
`);
  try {
    const r = buildFixture(AUDIT_DAY_POSTS, { today: '2026-10-05', corrections: dir });
    assert.equal(r.code, 0, r.stderr);
    const month = /<loc>https:\/\/example\.test\/corrections\/2026-10\/<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/.exec(r.sitemap);
    assert.ok(month, 'the corrections month page must carry a lastmod');
    assert.equal(month[1], '2026-10-05', 'the newest correction date is the newest content on the page');
    // The index is as current as the newest entry on any page beneath it.
    const index = /<loc>https:\/\/example\.test\/corrections\/<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/.exec(r.sitemap);
    assert.equal(index[1], '2026-10-05');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrections entry naming a later-dated post moves the page lastmod too', () => {
  // A page can change because a correction was appended and because the entry
  // names a post dated later. Both dates are printed, so the max is the page.
  const dir = mkdtempSync(join(tmpdir(), 'belmont-corrections-'));
  writeFileSync(join(dir, '2026-10.md'), `# Log

## 2026-10-09 — a-post-dated-later

Correction (2026-10-03): a correction filed against a post dated later than itself.
Published in: an edition.
Corrected by: A Person.
`);
  try {
    const r = buildFixture(AUDIT_DAY_POSTS, { today: '2026-10-05', corrections: dir });
    assert.equal(r.code, 0, r.stderr);
    const month = /<loc>https:\/\/example\.test\/corrections\/2026-10\/<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/.exec(r.sitemap);
    assert.equal(month[1], '2026-10-09');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a newsroom with no corrections log omits lastmod rather than guessing a partial date', () => {
  // The old fallback was the month, `2026-10`, which is not a date the sitemap
  // protocol accepts and which many parsers reject or coerce. An absent optional
  // element is honest; an invented one is not.
  const r = buildFixture(AUDIT_DAY_POSTS, { today: '2026-10-05' });
  assert.equal(r.code, 0, r.stderr);
  const index = /<loc>https:\/\/example\.test\/corrections\/<\/loc>([\s\S]*?)<\/url>/.exec(r.sitemap);
  assert.ok(index);
  assert.doesNotMatch(index[1], /<lastmod>/, 'no corrections means no modification date to report');
});
// ------------------------------------------------ the corrections log, linked
//
// RSS 2.0 has no channel element for "see also", so the Atom extension is the only
// spec-legal place a feed can carry a second URL. The board chose this on
// 2026-10-05 for BEL-138 over leaving the feed with no route to the log and over
// publishing every correction as a feed item.

test('the channel carries an Atom link to the corrections log', () => {
  const r = buildFixture(AUDIT_DAY_POSTS, { today: '2026-10-05' });
  assert.equal(r.code, 0, r.stderr);
  assert.match(
    r.feed,
    /<atom:link href="https:\/\/example\.test\/corrections\/" rel="related" type="text\/html" title="Corrections" \/>/,
    'the corrections log must be reachable from the feed document itself',
  );
});

test('the corrections link sits beside the self link and does not replace it', () => {
  const r = buildFixture(AUDIT_DAY_POSTS, { today: '2026-10-05' });
  const channel = /<channel>[\s\S]*?<\/channel>/.exec(r.feed)[0];
  const links = [...channel.matchAll(/<atom:link [^>]*rel="(\w+)"[^>]*\/>/g)].map((m) => m[1]);
  // Both, and both inside <channel>. A self link that got clobbered by a related
  // one breaks the feed in the aggregators that use it to dedupe entries.
  assert.deepEqual(links.sort(), ['related', 'self']);
  assert.match(channel, /rel="self"/);
  // Two atom:link elements and no more: this is one link, not a menu.
  assert.equal((channel.match(/<atom:link /g) || []).length, 2);
});

test('the corrections link is a channel element and never enters a reader story list', () => {
  const r = buildFixture(AUDIT_DAY_POSTS, { today: '2026-10-05' });
  // The reason this option was chosen over corrections-as-items: a subscriber
  // must not get an unread correction in their story stream.
  for (const item of r.feed.match(/<item>[\s\S]*?<\/item>/g) || []) {
    assert.doesNotMatch(item, /corrections\//, 'a corrections URL inside an <item> would be a correction item');
  }
  assert.equal((r.feed.match(/corrections\//g) || []).length, 1);
});

test('the corrections link resolves even with no corrections log at all', () => {
  // The link must never be a 404. This fixture builds no corrections directory,
  // and /corrections/ is still written on every build.
  const r = buildFixture(AUDIT_DAY_POSTS, { today: '2026-10-05' });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.feed, /href="https:\/\/example\.test\/corrections\/" rel="related"/);
  const page = readFileSync(join(r.root, 'dist', 'corrections', 'index.html'), 'utf8');
  assert.match(page, /<h1 class="page-title">Corrections<\/h1>/,
    'the link target must exist on a build that has logged no correction');
});
