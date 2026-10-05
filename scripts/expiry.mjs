// expiry.mjs - when a post stops being *listed* on the rolling front page and in
// feed.xml.
//
//   import { listingExpiry } from './scripts/expiry.mjs';
//   const l = listingExpiry(fm, { today: '2026-10-05' });
//   l.listed   // true or false
//   l.expires  // '2026-10-05', the newsroom day it falls out
//
// What this is, precisely: a recency rule for two surfaces, the root listing and
// the RSS feed. Before it, a post dated 2026-09-01 was still on the front page
// and still in feed.xml in October, so "Latest" meant "everything, ever".
//
// What this is NOT, and the difference is the whole point:
//
//   - It is not a withdrawal. An expired post keeps its own page, keeps its
//     HTTP 200, keeps its sources, and keeps its entry in sitemap.xml. Ageing
//     a listing is not retracting a story.
//   - It is not a correctness check. Expiring a listing hides a post; it does
//     not make the post's copy true. The desk gate item ruled on BEL-87 owns
//     that, and this rule neither performs nor substitutes for it.
//   - It is not a change to the build gate. `index.mjs` in the markdown store
//     keeps its forward-only date window exactly as it is, with no backward
//     half, for the reason documented there.
//
// The window. A post dated D is listed for newsroom days D and D+1 and falls
// out at 00:00 on D+2. Two days is chosen so that the listing a reader sees is
// unchanged by this rule on the day it ships: every post in the archive on
// 2026-10-03 is inside a two-day window, so the first deploy strips nothing,
// and the rule only becomes load-bearing once the archive is older than the
// window. A one-day window would have emptied the front page of last night's
// edition by the time the 06:00 reader arrived.
//
// Zero dependencies, like everything else in this build.
//
// One more rule lives here, and it is a different kind of rule from the window
// above. BEL-161:
//
//   A post can stop being TRUE long before it stops being RECENT.
//
// The window above answers "is this post inside the last two news days?", which
// is a question about the calendar. It cannot answer "is this story still
// current?", which is a question about the story. The Wall That Heals exhibit
// closed Sunday 4 October at 14:00, so on Monday the 5th that post was inside
// its own two-day window, still on the front page, still in the feed, and
// telling a reader it "closes tonight". The window could not have caught it: by
// the rule's own definition the post was three days old and therefore current.
// Grace's audit found the same false tense on two more posts.
//
// So a post may now say so itself, in front matter, with `expired`:
//
//   expired: 2026-10-04     the story stopped being true on that newsroom day
//   expired: true           the story stopped being true, no single day to name
//
// A day rather than a bare true is preferred, because "this exhibit closed at
// 14:00 on the 4th" is something a reader can be told and "this is old" is not.
// Before that day the post behaves exactly as it does now, so a story can be
// marked in advance on the morning it publishes and go stale on its own.
//
// This is a second reason for a post to leave the listing and the feed, and the
// only reason the post's OWN page changes: an expired post gets a visible notice
// saying its text is the record as published and no longer current. The page is
// never withdrawn. The archive is the record, and a reader who followed a link
// has to be told the difference between what the story said and what is true.

import { addDays, isRealDay } from './dates.mjs';

// How many newsroom days a post is listed for, counting its own day as the
// first. Exported so build-info.json can report the number a build actually
// used and so a later ruling can change it in one place.
export const DEFAULT_LISTING_DAYS = 2;

// A plain calendar day, and nothing else. An instant is deliberately rejected
// rather than truncated: `expires: 2026-10-05T06:00:00-04:00` is a shape this
// module would have to guess an answer for, and guessing at a publication
// deadline is how a rule like this ends up silently wrong for half a year.
//
// The day also has to exist. `2026-13-45` has the right shape and is not a date,
// and a rule that accepted it would compare it as text, where it sorts after
// every real day and so never ages out.
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDay(v) {
  return typeof v === 'string' && DAY.test(v.trim()) && isRealDay(v.trim());
}

// The post's own newsroom day.
//
// The first ten characters of `date`, which is also the day directory in the
// post's URL. Deriving the listing day from the same characters the URL uses is
// deliberate: two notions of "the day" would eventually disagree, and the page
// would drop off the front page on a different day than its own address says.
export function publicationDay(fm) {
  return String(fm?.date ?? '').trim().slice(0, 10);
}

// ---------------------------------------------------- declared expiry
//
// `expired` is read the same tolerant way as `expires`, and it is optional in
// the same way: absent, empty, or `false` all mean "this post makes no claim
// about its own currency", which is every post that has not been through the
// question yet.
//
// `true` is accepted as well as a day, because a desk that knows a story has
// gone stale should be able to say so without inventing a day it does not have.
export function declaredExpiryField(fm) {
  const raw = fm?.expired;
  if (raw === undefined || raw === null || String(raw).trim() === '' || raw === false) return null;
  return String(raw).trim();
}

// Validate the optional `expired` override. Returns an error string, or null.
//
// Held to the same standard as `expires` on purpose. A flag that is silently
// ignored when misspelled is worse than no flag at all, because the post reads
// as live on the page and as expired in the source, and nobody notices until a
// reader is told an exhibit closes tonight three days after it shut. So:
// anything that is neither `true` nor a real calendar day stops the build.
export function expiredError(fm, file) {
  const value = declaredExpiryField(fm);
  if (value === null) return null;
  if (value === 'true') return null;
  if (!isCalendarDay(value)) {
    return `${file}: expired must be true or a real calendar day as YYYY-MM-DD, got ${JSON.stringify(fm.expired)}. `
      + 'Use a day when the story has a known expiry, and true when it does not. '
      + 'A misspelled flag is ignored downstream, which is how a stale story keeps being served as current.';
  }
  const day = publicationDay(fm);
  if (!isRealDay(day)) {
    return `${file}: date must begin with a real YYYY-MM-DD day for expired to be checked against`;
  }
  if (value < day) {
    return `${file}: expired ${value} is before the post's own date ${day}. `
      + 'A story cannot have expired before it was filed; that is a typo, and honouring it would drop a new post off the front page on its first day.';
  }
  return null;
}

// Has the post declared itself expired, as of this newsroom day?
//
//   expired        true once the day has arrived, false before it
//   declaredDay    the day named, or null for a bare `expired: true`
//   from           'front-matter' when declared, so build-info and --check can
//                  report a post leaving the listing for a stated reason rather
//                  than for the default window
//
// Before the named day this returns false and the post is live. That is the
// point of allowing a day instead of only `true`: the flag has to be writable on
// publication day, because the moment a story goes stale nobody is watching.
export function declaredExpired(fm, { today } = {}) {
  const value = declaredExpiryField(fm);
  if (value === null) return { expired: false, declaredDay: null, from: null };
  if (value === 'true') return { expired: true, declaredDay: null, from: 'front-matter' };
  const day = value;
  // An unvalidated field must not decide anything. expiryError/expiredError have
  // already stopped the build by the time a real build reaches here; this keeps
  // the function total for the tests and for --check on a bad file.
  if (!isCalendarDay(day)) return { expired: false, declaredDay: null, from: 'front-matter' };
  return { expired: String(today) >= day, declaredDay: day, from: 'front-matter' };
}

// Validate the optional `expires` override. Returns an error string, or null.
//
// A malformed or already-elapsed expiry is refused rather than ignored. Silently
// ignoring it is how a post ends up listed forever, which is the defect this
// module exists to remove, and a build that stops is a far cheaper outcome than
// a front page that quietly never rolls.
export function expiryError(fm, file) {
  const raw = fm?.expires;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const value = String(raw).trim();
  if (!isCalendarDay(value)) {
    return `${file}: expires must be a real calendar day as YYYY-MM-DD, got ${JSON.stringify(raw)}. `
      + 'A time of day is not accepted here because this rule cannot choose one for you.';
  }
  const day = publicationDay(fm);
  if (!isRealDay(day)) return `${file}: date must begin with a real YYYY-MM-DD day for expires to be checked against`;
  if (value < day) {
    return `${file}: expires ${value} is before the post's own date ${day}. `
      + 'A post that is expired on the day it is filed is a typo; set a later day or drop the field.';
  }
  return null;
}

// The expiry decision for one post.
//
//   today    a newsroom calendar day, YYYY-MM-DD. Required: this is a pure
//            function of its inputs, so a build can be pinned and audited.
//   days     the listing window in newsroom days, default DEFAULT_LISTING_DAYS.
export function listingExpiry(fm, { today, days = DEFAULT_LISTING_DAYS } = {}) {
  const override = fm?.expires != null && String(fm.expires).trim() !== ''
    ? String(fm.expires).trim()
    : null;
  const expires = override || addDays(publicationDay(fm), days);
  // On its expiry day the post is already out. A boundary of "after" would keep
  // it listed for one extra full day and make the window days+1 long by accident.
  const withinWindow = today < expires;
  // Two independent reasons to leave the listing, and they are not the same
  // reason. The window is about the calendar: this post is not news any more.
  // A declared `expired` is about the story: this post is no longer TRUE, and
  // the window would still consider it current. Either one is enough.
  const declared = declaredExpired(fm, { today });
  return {
    listed: withinWindow && !declared.expired,
    expires,
    from: override ? 'front-matter' : 'default-window',
    // `reason` is the single field a reader of build-info.json or --check needs:
    // why is this post not on the front page. Stated once here so the three
    // surfaces that report on the listing cannot drift apart.
    //
    // A post can be out of window AND have declared itself expired, and when both
    // are true `declared-expired` is the answer worth printing. The window would
    // have caught it anyway; the declaration is the fact that the window did not
    // need. Reporting `out-of-window` there would understate what the desk knows.
    reason: declared.expired
      ? 'declared-expired'
      : (!withinWindow ? (override ? 'window-override' : 'out-of-window') : null),
    declaredExpired: declared.expired,
    declaredDay: declared.declaredDay,
  };
}

// Split a post set into the posts that are listed and the posts that are not,
// newest first, preserving the caller's order inside each group.
export function partition(posts, opts) {
  const listed = [];
  const expired = [];
  for (const p of posts) {
    const l = listingExpiry(p.fm, opts);
    p.listing = l;
    (l.listed ? listed : expired).push(p);
  }
  return { listed, expired };
}
