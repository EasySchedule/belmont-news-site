// The listing expiry rule, tested. Run with: node --test
//
// The rule is a recency rule for two surfaces, the root listing and feed.xml. The
// cases that matter most here are the ones that could quietly take something away
// from a reader: an expired post must keep its own page, must keep its sitemap
// entry, and must never leave a reader who already has the feed item with a dead
// permalink. Dropping it from the listing is the whole point; dropping it from
// anywhere else is a bug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { calendarDay, addDays, NEWSROOM_TZ } from '../scripts/dates.mjs';
import { DEFAULT_LISTING_DAYS, listingExpiry, expiryError, isCalendarDay, publicationDay } from '../scripts/expiry.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(REPO, 'build.mjs');

const SOURCES = [
  'sources:',
  '  - type: document',
  '    title: "Gridpoint forecast PBZ/50,48"',
  '    organization: "National Weather Service, forecast office Pittsburgh PA"',
  '    retrieved: 2026-10-02',
].join('\n');

function post({ date, slug, extra = '' }) {
  return [
    'title: "A headline long enough to pass the schema"',
    'dek: "One sentence under the headline."',
    `date: ${date}`,
    'edition: morning',
    'byline: Nathan Beausoleil',
    'category: weather',
    `slug: ${slug}`,
    ...(extra ? [extra] : []),
    SOURCES,
  ].join('\n');
}

// Build a fixture content tree and render it with the newsroom day pinned, so the
// rule is exercised deterministically instead of against whatever day it runs on.
// Returns the output directory, which the caller cleans up.
//
// spawnSync rather than execFileSync, for one reason: execFileSync hands back only
// stdout, and the empty-window case reports itself on stderr. Asserting that a
// build warned about something it only warns about on stderr needs both streams.
function buildFixture(posts, { today, listingDays } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'belmont-expiry-'));
  const content = join(root, 'content');
  for (const p of posts) {
    const file = join(content, ...p.date.split('-'), `nathan-beausoleil--${p.slug}.md`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `---\n${post(p)}\n---\n\n## The roundup\n\nRain tonight.\n`);
  }
  const out = join(root, 'dist');
  const args = [BUILD, '--content', content, '--out', out, '--site-url', 'https://example.test'];
  if (today !== undefined) args.push('--newsroom-today', today);
  // `listingDays !== undefined`, not a truthiness test: 0 is exactly the value
  // this suite needs to prove is refused, and `if (listingDays)` would drop it.
  if (listingDays !== undefined) args.push('--listing-days', String(listingDays));
  const r = spawnSync('node', args, { cwd: root, encoding: 'utf8' });
  const base = { code: r.status, root, stdout: r.stdout || '', stderr: r.stderr || '' };
  try {
    const read = (p) => readFileSync(join(out, p), 'utf8');
    return {
      ...base,
      home: read('index.html'),
      feed: read('feed.xml'),
      sitemap: read('sitemap.xml'),
      info: JSON.parse(read('build-info.json')),
      pageFor: (p) => readFileSync(join(out, p.date, p.slug, 'index.html'), 'utf8'),
    };
  } catch {
    return base;
  }
}

const TWO_DAYS = [
  { date: '2026-10-04', slug: 'today-morning' },
  { date: '2026-10-04', slug: 'today-evening-two' },
  { date: '2026-10-03', slug: 'yesterday-morning' },
  { date: '2026-10-02', slug: 'two-days-ago' },
  { date: '2026-10-01', slug: 'three-days-ago' },
];

// ------------------------------------------------------------- the window

test('a post is listed for its own news day and the next, and not after that', () => {
  const fm = { date: '2026-10-02' };
  assert.equal(listingExpiry(fm, { today: '2026-10-02' }).listed, true);
  assert.equal(listingExpiry(fm, { today: '2026-10-03' }).listed, true);
  // On the expiry day it is already out. A boundary of "after" would keep it for
  // one extra full day and quietly make the window days+1 long.
  assert.equal(listingExpiry(fm, { today: '2026-10-04' }).listed, false);
  assert.equal(listingExpiry(fm, { today: '2026-10-05' }).listed, false);
});

test('the default window is two newsroom days, and it says so', () => {
  assert.equal(DEFAULT_LISTING_DAYS, 2);
  assert.equal(listingExpiry({ date: '2026-10-02' }, {}).expires, '2026-10-04');
  assert.equal(listingExpiry({ date: '2026-10-02' }, { days: 1 }).expires, '2026-10-03');
  assert.equal(listingExpiry({ date: '2026-10-02' }, { days: 7 }).expires, '2026-10-09');
});

test('an expires override replaces the default window and is marked as the source', () => {
  const fm = { date: '2026-10-02', expires: '2026-10-30' };
  const l = listingExpiry(fm, { today: '2026-10-20' });
  assert.equal(l.listed, true, 'an override must be able to hold a post past the default window');
  assert.equal(l.expires, '2026-10-30');
  assert.equal(l.from, 'front-matter');
  assert.equal(listingExpiry(fm, { today: '2026-10-30' }).listed, false);
  assert.equal(listingExpiry({ date: '2026-10-02' }, { today: '2026-10-20' }).from, 'default-window');
});

// ----------------------------------------------------- what is refused

test('an expires carrying a time of day is refused rather than guessed at', () => {
  // The newsroom switches EST/EDT on 2026-11-01. A rule that read the date part
  // and dropped the offset would be right for half the year and wrong for the
  // other half, which is why there is one accepted shape.
  assert.match(expiryError({ date: '2026-10-02', expires: '2026-10-05T06:00:00-04:00' }, 'p.md'), /real calendar day/);
  assert.match(expiryError({ date: '2026-10-02', expires: 'tomorrow' }, 'p.md'), /real calendar day/);
  assert.match(expiryError({ date: '2026-10-02', expires: '2026-10-05T06:00:00-04:00' }, 'p.md'), /p\.md/);
});

test('an expires before the post date is refused as a typo', () => {
  assert.match(expiryError({ date: '2026-10-02', expires: '2026-10-01' }, 'p.md'), /before the post's own date/);
  assert.equal(expiryError({ date: '2026-10-02', expires: '2026-10-02' }, 'p.md'), null, 'same day is allowed');
});

test('an expires day that does not exist is refused, not compared as text', () => {
  // 2026-13-45 has the right shape and is not a date. Compared as text it sorts
  // after every real day, so a shape-only check would hold this post listed
  // forever and report no problem, which is the defect this rule was added to fix
  // arriving through the front door.
  for (const day of ['2026-13-45', '2026-02-30', '2026-00-10', '2026-10-00', '2026-1-5']) {
    assert.match(expiryError({ date: '2026-10-02', expires: day }, 'p.md'), /real calendar day/, `${day} is not a day`);
  }
  assert.equal(isCalendarDay('2026-02-29'), false, '2026 is not a leap year');
  assert.equal(isCalendarDay('2024-02-29'), true, '2024 is');
  assert.equal(isCalendarDay('2026-10-05T06:00:00-04:00'), false);
});

test('an absent or empty expires is not an error, and does not become an override', () => {
  assert.equal(expiryError({ date: '2026-10-02' }, 'p.md'), null);
  assert.equal(expiryError({ date: '2026-10-02', expires: '' }, 'p.md'), null);
  assert.equal(listingExpiry({ date: '2026-10-02', expires: '' }, { today: '2026-10-02' }).from, 'default-window');
});

test('a post with a bad expires fails the build instead of being listed forever', () => {
  const r = buildFixture(
    [{ date: '2026-10-02', slug: 'broken-expiry', extra: 'expires: 2026-10-05T06:00:00-04:00' }],
    { today: '2026-10-02' },
  );
  assert.equal(r.code, 1);
  assert.match(r.stderr, /expires must be a real calendar day/);
});

// ------------------------------------------------- the newsroom day

test('the newsroom day is the America/New_York day, not the UTC day', () => {
  // 2026-10-04T03:00Z is 23:00 on 2026-10-03 in Belmont County. Asking for the
  // UTC date would roll the listing over before the newsroom day actually ends.
  assert.equal(calendarDay(Date.parse('2026-10-04T03:00:00Z'), NEWSROOM_TZ), '2026-10-03');
  assert.equal(calendarDay(Date.parse('2026-10-04T13:00:00Z'), NEWSROOM_TZ), '2026-10-04');
  // Either side of the 2026-11-01 fall-back hour, the calendar day does not shift.
  assert.equal(calendarDay(Date.parse('2026-11-01T04:30:00Z'), NEWSROOM_TZ), '2026-11-01');
  assert.equal(calendarDay(Date.parse('2026-11-01T06:30:00Z'), NEWSROOM_TZ), '2026-11-01');
});

test('adding days is calendar arithmetic, so no DST boundary can move a post a day early', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-11-01', 2), '2026-11-03');
  assert.equal(addDays('2026-03-07', 1), '2026-03-08', 'the spring-forward day');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01', '2026 is not a leap year');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-10-02', 0), '2026-10-02');
});

test('the listing day is read from the same characters the post URL uses', () => {
  // A post stamped with a full instant still resolves to the day directory its
  // URL carries, so a page can never fall off the front page on a different day
  // than its own address says.
  assert.equal(publicationDay({ date: '2026-10-03T06:00:00-04:00' }), '2026-10-03');
  assert.equal(publicationDay({ date: '2026-10-03' }), '2026-10-03');
  assert.equal(isCalendarDay('2026-10-03'), true);
  assert.equal(isCalendarDay('2026-10-03T06:00:00-04:00'), false);
});

// ------------------------------------------- the surfaces, end to end

test('the front page and the feed carry the window, and nothing older', () => {
  const r = buildFixture(TWO_DAYS, { today: '2026-10-04' });
  try {
    assert.equal(r.code, 0, r.stderr);
    assert.equal((r.home.match(/class="card"/g) || []).length, 3, 'three posts are inside the window');
    assert.equal((r.feed.match(/<item>/g) || []).length, 3);
    for (const slug of ['today-morning', 'today-evening-two', 'yesterday-morning']) {
      assert.match(r.home, new RegExp(slug), `${slug} belongs on the front page`);
      assert.match(r.feed, new RegExp(slug), `${slug} belongs in the feed`);
    }
    for (const slug of ['two-days-ago', 'three-days-ago']) {
      assert.doesNotMatch(r.home, new RegExp(slug), `${slug} has aged out of the front page`);
      assert.doesNotMatch(r.feed, new RegExp(slug), `${slug} has aged out of the feed`);
    }
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('an expired post keeps its own page, its 200, its sources, and its sitemap entry', () => {
  // This is the half of the rule that is easy to get wrong. Ageing a listing must
  // never withdraw a page: the archive is the record, and yesterday's weather
  // roundup is still the correct answer to "what was the forecast yesterday?".
  const r = buildFixture(TWO_DAYS, { today: '2026-10-04' });
  try {
    assert.equal(r.code, 0, r.stderr);
    const page = r.pageFor({ date: '2026-10-02', slug: 'two-days-ago' });
    assert.match(page, /A headline long enough to pass the schema/, 'the expired post still has a page');
    assert.match(page, /Gridpoint forecast PBZ\/50,48/, 'the expired post still names its sources');
    assert.match(r.sitemap, /2026-10-02\/two-days-ago\//, 'the expired post stays in the sitemap');
    assert.match(r.sitemap, /2026-10-01\/three-days-ago\//, 'an expired post is not deindexed');
    // One loc per post, whatever the listing decided, plus the root and the
    // corrections index. A corrections log is not present in this fixture, so
    // there is no month page to count and none is asserted.
    assert.equal((r.sitemap.match(/<loc>/g) || []).length, TWO_DAYS.length + 2);
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('the sitemap does not change when the listing does', () => {
  // The same content on a different newsroom day: the front page and the feed
  // must differ, and the sitemap must be byte-identical. This is the assertion
  // that would catch the sitemap being wired into the expiry rule by accident.
  //
  // Both days sit inside a populated window on purpose. Move either far enough
  // out and the window empties, the empty-window fallback takes over, and the
  // comparison stops being about the rule.
  const early = buildFixture(TWO_DAYS, { today: '2026-10-04' });
  const late = buildFixture(TWO_DAYS, { today: '2026-10-05' });
  try {
    assert.equal(early.sitemap, late.sitemap, 'sitemap.xml must not depend on the listing window');
    assert.notEqual(early.feed, late.feed, 'the feed must follow the window');
    assert.equal((early.feed.match(/<item>/g) || []).length, 3);
    assert.equal((late.feed.match(/<item>/g) || []).length, 2);
    // On the later day the 2026-10-03 post has crossed its expiry day of
    // 2026-10-05 and the two 2026-10-04 posts have not.
    assert.match(early.feed, /yesterday-morning/);
    assert.doesNotMatch(late.feed, /yesterday-morning/);
    assert.match(late.feed, /today-morning/);
  } finally {
    rmSync(early.root, { recursive: true, force: true });
    rmSync(late.root, { recursive: true, force: true });
  }
});

test('the guid of an expired item is still a permalink that resolves', () => {
  // RSS readers cache by guid and this feed's guid is the permalink, so dropping
  // an item must never orphan a guid a reader already holds. The page is still
  // built at the guid's own path, which is the only thing that keeps that true.
  const r = buildFixture(TWO_DAYS, { today: '2026-10-04' });
  try {
    const guids = [...r.feed.matchAll(/<guid isPermaLink="true">([^<]+)<\/guid>/g)].map((m) => m[1]);
    assert.equal(guids.length, 3);
    assert.equal(new Set(guids).size, 3, 'guids are unique');
    for (const g of guids) assert.match(g, /^https:\/\/example\.test\/2026-10-0[34]\//);
    assert.match(r.sitemap, /three-days-ago/, 'an aged-out post is still indexed, so its guid still resolves');
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('an expires override holds a post on the front page past the default window', () => {
  const r = buildFixture([
    { date: '2026-10-02', slug: 'held-by-override', extra: 'expires: 2026-10-30' },
    { date: '2026-10-02', slug: 'aged-out-normally' },
  ], { today: '2026-10-20' });
  try {
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.home, /held-by-override/);
    assert.match(r.feed, /held-by-override/);
    assert.doesNotMatch(r.home, /aged-out-normally/);
    assert.equal(r.info.listing.expired, 1);
    assert.deepEqual(r.info.listing.expiredUrls, ['/2026-10-02/aged-out-normally/']);
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

// ------------------------------------------------- the window coming up empty

test('an empty window never publishes an empty front page', () => {
  // The window can come up empty when the archive has a gap wider than it, for
  // instance over a holiday when nothing is filed. A blank front page is the
  // worst outcome available, so the listing falls back to the newest posts, says
  // so loudly, and records it. It does not fail the build: refusing to publish
  // would be worse than showing a slightly older story.
  const r = buildFixture(TWO_DAYS, { today: '2026-11-20' });
  try {
    assert.equal(r.code, 0, 'the build still succeeds');
    assert.match(r.stderr, /WARNING no post is inside the 2-day listing window/);
    assert.match(r.stderr, /archive is the record/);
    assert.equal((r.home.match(/class="card"/g) || []).length, DEFAULT_LISTING_DAYS, 'the newest posts are shown instead');
    assert.equal(r.info.listing.fallback, true);
    // The fallback posts are on the page, so they are listed and not also
    // expired. The report is a partition of the archive, which is the invariant
    // the real-archive check further down holds the build to.
    assert.equal(r.info.listing.listed, DEFAULT_LISTING_DAYS);
    assert.equal(r.info.listing.expired, TWO_DAYS.length - DEFAULT_LISTING_DAYS);
    assert.equal(r.info.listing.listed + r.info.listing.expired, TWO_DAYS.length);
    assert.equal((r.sitemap.match(/<loc>/g) || []).length, TWO_DAYS.length + 2, 'the sitemap is unaffected either way');
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('build-info.json reports the window, so a deployed site can be audited and rolled', () => {
  // check-listing-stale.mjs reads newsroomToday to decide whether the front page
  // needs rebuilding. Without this field the listing could only move on a day
  // somebody happened to commit something.
  const r = buildFixture(TWO_DAYS, { today: '2026-10-04' });
  try {
    assert.equal(r.info.listing.newsroomToday, '2026-10-04');
    assert.equal(r.info.listing.windowDays, DEFAULT_LISTING_DAYS);
    assert.equal(r.info.listing.listed, 3);
    assert.equal(r.info.listing.expired, 2);
    assert.deepEqual(r.info.listing.expiredUrls.sort(), [
      '/2026-10-01/three-days-ago/',
      '/2026-10-02/two-days-ago/',
    ]);
    assert.equal(r.info.posts, TWO_DAYS.length, 'every post is still built and reported');
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('the listing day is not taken from SOURCE_DATE_EPOCH', () => {
  // CI sets SOURCE_DATE_EPOCH from the commit being deployed. If the listing read
  // that, a scheduled rebuild dispatched with no new commit would judge the
  // window against the day of the last commit and the front page would stop
  // rolling altogether. The regression is silent: the build still succeeds and
  // the listing just quietly freezes, so it is pinned here.
  //
  // The commit here is a week older than the newsroom day the build is told it
  // is. Under the wrong behaviour the post would still be listed, with no expiry.
  //
  // The archive needs a second post inside the window. With one post and none
  // in range the window comes up empty, the listing falls back to the newest
  // post, and that post is on the front page however the day was computed. The
  // expiry this test is pinning would then never be reported, for the right
  // reason on a wrong day, and the assertion would pass for the wrong reason on
  // a wrong day too.
  const root = mkdtempSync(join(tmpdir(), 'belmont-sde-'));
  try {
    const content = join(root, 'content');
    const file = join(content, '2026', '10', '2026-10-02', 'nathan-beausoleil--sde.md');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `---\n${post({ date: '2026-10-02', slug: 'sde' })}\n---\n\nBody.\n`);
    const fresh = join(content, '2026', '10', '2026-10-09', 'nathan-beausoleil--in-window.md');
    mkdirSync(dirname(fresh), { recursive: true });
    writeFileSync(fresh, `---\n${post({ date: '2026-10-09', slug: 'in-window' })}\n---\n\nBody.\n`);
    const out = join(root, 'dist');
    const r = spawnSync('node', [
      BUILD, '--content', content, '--out', out, '--site-url', 'https://example.test', '--newsroom-today', '2026-10-09',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, SOURCE_DATE_EPOCH: String(Date.parse('2026-10-02T12:00:00Z') / 1000) },
    });
    assert.equal(r.status, 0, r.stderr);
    // The window is judged against 2026-10-09, so a post dated 2026-10-02 fell out
    // on 2026-10-04. Had the commit time driven it, today would read 2026-10-02,
    // the post would be listed, and there would be no expiry line at all.
    assert.match(r.stdout, /newsroom day 2026-10-09/);
    assert.match(r.stdout, /expired 2026-10-04 \(default-window\)/);
    assert.equal(JSON.parse(readFileSync(join(out, 'build-info.json'), 'utf8')).listing.newsroomToday, '2026-10-09');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--listing-days changes the window without touching anything else', () => {
  const one = buildFixture(TWO_DAYS, { today: '2026-10-04', listingDays: 1 });
  try {
    assert.equal((one.feed.match(/<item>/g) || []).length, 2, 'one day lists only that day');
    assert.equal(one.info.listing.windowDays, 1);
  } finally {
    rmSync(one.root, { recursive: true, force: true });
  }
  const refused = buildFixture(TWO_DAYS, { today: '2026-10-04', listingDays: 0 });
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /--listing-days must be a whole number of at least 1/);
});

test('a nonsense --newsroom-today is refused', () => {
  const r = buildFixture(TWO_DAYS, { today: 'not-a-day' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--newsroom-today must be a plain YYYY-MM-DD day/);
});

// ------------------------------------------------------- the real archive

test('the committed archive stays inside the window on any day it is built', () => {
  // Sanity, not a pin: whatever day this runs, the build reports a listing, and
  // every post still has a page. A change to this rule must never be able to
  // leave the archive unrendered.
  const out = mkdtempSync(join(tmpdir(), "belmont-archive-"));
  try {
    spawnSync('node', [BUILD, '--content', 'content', '--out', out, '--site-url', 'https://example.test'], {
      cwd: REPO, encoding: 'utf8',
    });
    const info = JSON.parse(readFileSync(join(out, 'build-info.json'), 'utf8'));
    assert.match(info.listing.newsroomToday, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(info.listing.listed + info.listing.expired, info.posts, 'every post is either listed or expired, and none is lost');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// ------------------------------------------------------ the archive notice
//
// Ageing a post out of the listing is a recency rule. On 2026-10-05 that was the
// whole mechanism, and the consequence was that a post's own page was byte-
// identical whether it was this morning's edition or three days old. The only
// temporal signal in the markup was the byline's <time datetime>, which reads as
// a publication date and nothing more. A reader who followed a three-day-old link
// or arrived from a search result got "free and open 24 hours today" with nothing
// on the page to date it.
//
// The notice is the fix for that, and the tests below are the standard it has to
// hold to, decided on BEL-139: dated, above the headline, retracting the
// time-sensitive claims rather than merely noting the age, machine-readable, and
// present in the served HTML rather than added by CSS.

test('a post outside the window carries the archive notice above its headline', () => {
  const r = buildFixture(TWO_DAYS, { today: '2026-10-04' });
  try {
    const page = r.pageFor({ date: '2026-10-01', slug: 'three-days-ago' });
    const notice = /<aside class="expired-notice"[\s\S]*?<\/aside>/.exec(page);
    assert.ok(notice, 'the expired post has a notice at all');
    // Above the H1, not below the byline and not in the footer. A reader who
    // skims the headline has to meet the notice before the headline, which is the
    // only position that satisfies "must not reach the action copy without it".
    assert.ok(page.indexOf('<aside class="expired-notice"') < page.indexOf('<h1>'),
      'the notice is rendered before the H1');
    assert.ok(page.indexOf('</aside>') < page.indexOf('<h1>'),
      'the whole notice, not just its opening tag, precedes the headline');
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('a post inside the window carries no notice', () => {
  // The other half of the rule, and the one a sloppy fix breaks: a banner on
  // today's edition would train every reader to skip it, which retires the
  // affordance for exactly the posts that need it.
  const r = buildFixture(TWO_DAYS, { today: '2026-10-04' });
  try {
    const page = r.pageFor({ date: '2026-10-04', slug: 'today-morning' });
    assert.doesNotMatch(page, /expired-notice/);
    assert.doesNotMatch(page, /not current advice/);
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('the notice is dated with the publication day and the day it left the window', () => {
  const r = buildFixture(TWO_DAYS, { today: '2026-10-04' });
  try {
    // 2026-10-01 falls out at 00:00 on 2026-10-03: listed on its own day and the
    // next, out from the third. Both dates are real <time datetime> elements, so
    // a screen reader announces them as dates rather than as digits.
    const page = r.pageFor({ date: '2026-10-01', slug: 'three-days-ago' });
    const notice = /<aside class="expired-notice"[\s\S]*?<\/aside>/.exec(page)[0];
    assert.match(notice, /<time datetime="2026-10-01">2026-10-01<\/time>/, 'names the publication date');
    assert.match(notice, /<time datetime="2026-10-03">2026-10-03<\/time>/, 'names the day it left the window');
    assert.match(notice, /role="note"/, 'it is a note, so assistive tech announces it');
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('the notice retracts the time-sensitive claims instead of only noting the age', () => {
  // "This is an archived article" was rejected on BEL-139 for a specific reason:
  // it does not retract "you can still go tonight", and the wall-that-heals post
  // says exactly that about an event that had already closed. Ageing a post is
  // not the same statement as retracting the claims in it, and only the second
  // one is true here.
  const r = buildFixture(TWO_DAYS, { today: '2026-10-04' });
  try {
    const notice = /<aside class="expired-notice"[\s\S]*?<\/aside>/.exec(
      r.pageFor({ date: '2026-10-01', slug: 'three-days-ago' }),
    )[0];
    assert.match(notice, /accurate as of publication and is not current advice/);
    // And it names the claim types, so a reader knows which sentences to stop
    // believing instead of having to guess whether the whole article is void.
    assert.match(notice, /dates, times and hours/);
    assert.match(notice, /forecast validity/);
    assert.match(notice, /event status/);
    assert.match(notice, /anything that instructs you to act/);
    // It has to be a retraction, not a suggestion. A reader told the instruction
    // is "withdrawn" cannot read it as advice.
    assert.match(notice, /that instruction is withdrawn/);
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('the notice links to the current front page', () => {
  // A reader who lands on a three-day-old link needs one route to something
  // live. Without it the notice retracts the page and offers no next step.
  const r = buildFixture(TWO_DAYS, { today: '2026-10-04' });
  try {
    const notice = /<aside class="expired-notice"[\s\S]*?<\/aside>/.exec(
      r.pageFor({ date: '2026-10-01', slug: 'three-days-ago' }),
    )[0];
    assert.match(notice, /<a href="\/">/);
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('the notice is in the served HTML, so it survives a plain-text copy', () => {
  // Plain text is how much of this traffic arrives: a reader pasting the page
  // into a note, a reader on a reader-mode service, a reader whose browser
  // strips styling. A notice rendered through a ::before pseudo-element is in the
  // CSS and nowhere else, so it survives none of that, and it would also have
  // failed Grace's audit, which counted markup and found nothing.
  const r = buildFixture(TWO_DAYS, { today: '2026-10-04' });
  try {
    const page = r.pageFor({ date: '2026-10-01', slug: 'three-days-ago' });
    const css = readFileSync(join(REPO, 'static', 'styles.css'), 'utf8');
    const cssRule = /\.expired-notice[^{]*\{[^}]*\}/.exec(css);
    assert.ok(cssRule, 'the notice is styled at all');
    assert.doesNotMatch(cssRule[0], /::before|::after|content\s*:/,
      'no pseudo-element may carry the notice text');
    assert.doesNotMatch(cssRule[0], /display\s*:\s*none|visibility\s*:\s*hidden/,
      'nothing may hide the notice');
    // The retraction itself, in the bytes the server returns.
    assert.match(page, /not current advice/);
    assert.match(page, /expired-notice/);
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('the notice leaves the post a full, readable, 200 page at its own URL', () => {
  // The ruling is that an expired post keeps its body. If the notice ever grew
  // into a stub, or the page into a redirect, this fails. Belmont County readers
  // cite these URLs and a 410 would assert a story we published never existed.
  const r = buildFixture(TWO_DAYS, { today: '2026-10-04' });
  try {
    const page = r.pageFor({ date: '2026-10-01', slug: 'three-days-ago' });
    assert.match(page, /<h2>The roundup<\/h2>/, 'the body is still rendered');
    assert.match(page, /Rain tonight\./, 'the body is not truncated');
    assert.match(page, /Gridpoint forecast PBZ\/50,48/, 'the sources are still on the page');
    assert.match(r.sitemap, /<loc>https:\/\/example\.test\/2026-10-01\/three-days-ago\/<\/loc>/,
      'an expired post stays in the sitemap');
    assert.deepEqual(r.info.listing.expiredUrls.sort(), [
      '/2026-10-01/three-days-ago/',
      '/2026-10-02/two-days-ago/',
    ], 'build-info.json still discloses them');
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('the template never rewrites the body copy', () => {
  // The half of BEL-139 that is explicitly not authorised. A renderer that bent
  // tense would publish sentences no reporter or editor ever read, and the way
  // that ships is silently: the page looks fine and the archive is rewritten.
  // "Rain tonight." is the fixture body. It has to reach the reader verbatim.
  const r = buildFixture(TWO_DAYS, { today: '2026-10-04' });
  try {
    const page = r.pageFor({ date: '2026-10-01', slug: 'three-days-ago' });
    const body = /<div class="post-body">([\s\S]*?)<\/div>/.exec(page)[1];
    assert.match(body, /Rain tonight\./);
    assert.doesNotMatch(body, /Rain ran\.|Rain was\.|Rain that night\./);
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test('the notice keys off the window, not off the front page', () => {
  // When the window comes up empty the listing falls back to the newest posts,
  // so a post can be on the front page and out of the window at the same time.
  // The notice is about the post's own currency, so it follows the window. If
  // this ever keyed off the front page instead, the fallback would silently
  // strip the notice off the two most expired posts on the site, which are the
  // two a reader is least able to place in time.
  const r = buildFixture(TWO_DAYS, { today: '2026-11-20' });
  try {
    assert.equal(r.info.listing.fallback, true, 'the fallback is what this test is about');
    const page = r.pageFor({ date: '2026-10-01', slug: 'three-days-ago' });
    assert.match(page, /expired-notice/, 'an out-of-window post is noticed even when it is on the front page');
    assert.match(r.home, /three-days-ago|class="card"/, 'and it is still shown, because the fallback is unchanged');
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});
