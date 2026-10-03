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
  const listed = today < expires;
  return { listed, expires, from: override ? 'front-matter' : 'default-window' };
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
