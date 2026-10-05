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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { calendarDay, addDays, NEWSROOM_TZ } from '../scripts/dates.mjs';
import { DEFAULT_LISTING_DAYS, listingExpiry, expiryError, expiredError, declaredExpired, declaredExpiryField, isCalendarDay, publicationDay } from '../scripts/expiry.mjs';

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

// ------------------------------------------- declared expiry (BEL-161)
//
// The window above is a question about the calendar. `expired` is a question
// about the story, and the Wall That Heals exhibit is the case that needs both:
// published 2026-10-03, shut Sunday 2026-10-04 at 14:00, and on Monday the 5th it
// was inside its own two-day window, on the front page, in the feed, telling a
// reader it "closes tonight". No window rule can catch that, because by the
// window's own definition the post was current.

test('a declared expired day is not in force until that day arrives', () => {
  const fm = { date: '2026-10-03', expired: '2026-10-04' };
  // Before the day: nothing changes at all. This is the whole reason a day is
  // accepted rather than only `true` — the flag has to be writable on publication
  // day, because the moment a story goes stale nobody is watching.
  assert.deepEqual(declaredExpired(fm, { today: '2026-10-03' }), { expired: false, declaredDay: '2026-10-04', from: 'front-matter' });
  assert.deepEqual(declaredExpired(fm, { today: '2026-10-04' }), { expired: true, declaredDay: '2026-10-04', from: 'front-matter' });
  assert.deepEqual(declaredExpired(fm, { today: '2026-10-05' }), { expired: true, declaredDay: '2026-10-04', from: 'front-matter' });
});

test('expired true is in force at once, and names no day it does not have', () => {
  const fm = { date: '2026-10-03', expired: true };
  assert.deepEqual(declaredExpired(fm, { today: '2026-10-03' }), { expired: true, declaredDay: null, from: 'front-matter' });
  assert.deepEqual(fm.expired, true);
});

test('an absent, empty or false expired field makes no claim and is not an error', () => {
  for (const fm of [{ date: '2026-10-03' }, { date: '2026-10-03', expired: '' }, { date: '2026-10-03', expired: false }]) {
    assert.equal(declaredExpiryField(fm), null, JSON.stringify(fm));
    assert.equal(expiredError(fm, 'p.md'), null, JSON.stringify(fm));
    assert.equal(listingExpiry(fm, { today: '2026-10-03' }).declaredExpired, false);
  }
});

test('a misspelled expired is refused, because an ignored flag is worse than none', () => {
  // A flag that is silently dropped leaves the page reading as live and the source
  // reading as expired, and nobody finds out until a reader is told an exhibit
  // closes tonight three days after it shut.
  for (const bad of ['yesterday', '2026-13-45', '2026-10-04T14:00:00-04:00', 'true-ish', '1']) {
    const err = expiredError({ date: '2026-10-03', expired: bad }, 'p.md');
    assert.match(err || '', /expired must be true or a real calendar day/, `accepted ${JSON.stringify(bad)}`);
  }
});

test('an expired before the post date is refused as a typo', () => {
  const err = expiredError({ date: '2026-10-03', expired: '2026-10-02' }, 'p.md');
  assert.match(err || '', /expired 2026-10-02 is before the post's own date 2026-10-03/);
});

test('a declared expired removes the post from the listing for a stated reason', () => {
  const fm = { date: '2026-10-05', expired: '2026-10-05' };
  const l = listingExpiry(fm, { today: '2026-10-05' });
  assert.equal(l.listed, false, 'inside its own window and still not listed');
  assert.equal(l.declaredExpired, true);
  assert.equal(l.declaredDay, '2026-10-05');
  assert.equal(l.reason, 'declared-expired', 'the reason is the desk, not the calendar');
});

test('declared-expired outranks out-of-window when a post is both', () => {
  // The window would have caught it anyway. The declaration is the fact that the
  // window did not need, so it is the one worth reporting.
  const l = listingExpiry({ date: '2026-10-02', expired: '2026-10-03' }, { today: '2026-10-05' });
  assert.equal(l.listed, false);
  assert.equal(l.reason, 'declared-expired');
});

test('a post with a bad expired fails the build rather than being served as current', () => {
  const r = buildFixture(
    [{ date: '2026-10-02', slug: 'broken-expired', extra: 'expired: last tuesday' }],
    { today: '2026-10-02' },
  );
  assert.equal(r.code, 1);
  assert.match(r.stderr, /expired must be true or a real calendar day/);
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
    //
    // The line states the reason, not the source. `out-of-window` is the window's
    // own verdict; `window-override` means the post's own `expires:` did it;
    // `declared-expired` means the desk said the story stopped being true.
    assert.match(r.stdout, /newsroom day 2026-10-09/);
    assert.match(r.stdout, /expired out-of-window 2026-10-04/);
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
  //
  // One committed file does not survive the body gate added for BEL-161, because
  // its body is a Paperclip document API response rather than the article. That is
  // the gate working, not a failure of this rule, so the invariant below is proved
  // over the rest of the archive and the blocked file is named on every run.
  //
  // The last assertion is the real one. It is red until that file is repaired, and
  // that is deliberate: a suite that quietly dropped a broken post from its own
  // coverage would be the third silent success on this issue.
  const out = mkdtempSync(join(tmpdir(), 'belmont-archive-'));
  const staged = mkdtempSync(join(tmpdir(), 'belmont-archive-content-'));
  try {
    // The archive is copied out and built from the copy. This test is not allowed
    // to move a file in the repository to get a green run — a test that edits its
    // own fixtures is a test that can delete the evidence.
    const stagedContent = join(staged, 'content');
    cpSync(join(REPO, 'content'), stagedContent, { recursive: true });

    // The corrections gate is pointed at an empty log, deliberately. This loop
    // peels files off the STAGED tree until the gate is clean, and the only
    // answer it knows how to give a refusal is to delete the post. That is the
    // right answer to a bad body and the worst possible answer to an unreconciled
    // correction, which is fixed by adding front matter to the post rather than by
    // removing the post. Pointing `--corrections` at an empty directory makes that
    // structurally impossible. The committed log is gated against the committed
    // posts by test/correction-reconciliation.test.mjs, which reads both.
    const stagedCorrections = join(staged, 'corrections');
    mkdirSync(stagedCorrections, { recursive: true });

    // Each pass validates the STAGED copy, so the loop converges: the file it refuses
    // is the file it has just removed. Validating the repository instead would name
    // the same file twenty times and never finish.
    const gate = () => spawnSync('node', [BUILD, '--content', stagedContent, '--corrections', stagedCorrections, '--check'], { cwd: REPO, encoding: 'utf8' });
    const blocked = [];
    // build.mjs stops at the first refusal, so each pass names one file. Loop until
    // the archive clears the gate, with a bound so a gate that starts refusing
    // everything fails instead of hanging the suite.
    for (let pass = 0; pass < 20; pass++) {
      const r = gate();
      if (r.status === 0) break;
      const m = /build\.mjs: ([^:]+\.md):/.exec(r.stderr || '');
      if (!m) throw new Error(`the body gate failed without naming a file:\n${r.stderr}`);
      const rel = m[1].replace(/^.*?content\//, 'content/');
      if (blocked.includes(rel)) throw new Error(`the body gate named ${rel} twice without advancing:\n${r.stderr}`);
      blocked.push(rel);
      rmSync(join(stagedContent, rel.replace(/^content\//, '')));
    }

    const r = spawnSync('node', [BUILD, '--content', stagedContent, '--out', out, '--site-url', 'https://example.test'], {
      cwd: REPO, encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    const info = JSON.parse(readFileSync(join(out, 'build-info.json'), 'utf8'));
    assert.match(info.listing.newsroomToday, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(info.listing.listed + info.listing.expired, info.posts, 'every post is either listed or expired, and none is lost');

    assert.deepEqual(
      blocked, [],
      `the committed archive cannot be published. ${blocked.length} file(s) are refused by the body gate:\n`
      + blocked.map((f) => `  ${f}`).join('\n')
      + '\nReplace the body of each with the markdown, not the document record. The text is still '
      + 'inside the file, under the "body" key.',
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(staged, { recursive: true, force: true });
  }
});
