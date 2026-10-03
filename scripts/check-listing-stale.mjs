#!/usr/bin/env node
// check-listing-stale.mjs - is the published front page showing yesterday's news?
//
//   node scripts/check-listing-stale.mjs
//   SITE_URL=https://easyschedule.github.io/belmont-news-site node scripts/check-listing-stale.mjs
//
// Exit codes, matching check-blogs-ahead.mjs so one workflow can read both:
//
//   0  the live listing was built for the current newsroom day. Do nothing.
//   1  the live listing is built for an earlier day. Publish.
//   2  the check could not be carried out. This is NOT "nothing to do".
//
// Why this script exists at all, because it looks like duplication.
//
// The front page is a rolling listing now: a post stops being "Latest" when the
// newsroom day moves on, whether or not anybody writes anything. Before the
// listing window, the rendered site was a pure function of the markdown, so one
// publish per store change was the whole trigger story. It is not any more. A
// site published on Monday and left alone would keep Monday's front page on
// Tuesday morning, and the reader arriving for the 06:00 edition would find
// yesterday's stories.
//
// The existing drift check cannot notice this, and the reason is worth being
// precise about: it compares the markdown commit against the commit the live
// site says it rendered. On a quiet newsroom day those two are equal, it exits
// 0, and no deploy happens. Meanwhile the listing is a day out of date. Silence
// again, which is the failure that check-blogs-ahead.mjs was written to refuse.
//
// So the trigger has to read the day, not the commit. build.mjs stamps the
// newsroom day it judged the window against into build-info.json as
// listing.newsroomToday, this reads that field back, and compares it with the
// day in America/New_York now. It is the same lookup, not an inference, and
// therefore the same answer in every timezone and on every runner.
//
// It is deliberately NOT derived from SOURCE_DATE_EPOCH. That value is the
// commit being deployed, so a scheduled rebuild dispatched with no new commit
// would judge the window against the day of the last commit, and the front page
// would freeze on whatever day that commit landed. The clock is read here, the
// same way the clock is read inside the build.
//
// Both reads are anonymous. The deployed site is public, so this needs no token
// and no secret, which is what lets it run on a schedule in a repository that
// holds no credentials at all.

import { calendarDay, isRealDay, NEWSROOM_TZ } from './dates.mjs';

const SITE_URL = (process.env.SITE_URL || 'https://easyschedule.github.io/belmont-news-site').replace(/\/$/, '');
const TIME_ZONE = process.env.TZ_FOR_DATES || NEWSROOM_TZ;

// GitHub's CDN holds a deployed build-info.json for up to ten minutes
// (cache-control: max-age=600). Without a cache-busting parameter this compares
// today's newsroom day against a build-info.json that may predate the deploy it
// is trying to judge, and asks for a publish on every run for a site that is
// already current. A publish every fifteen minutes is the opposite of the point.
const cacheBust = Date.now();

function fail(msg, detail) {
  process.stderr.write(`check-listing-stale: ${msg}\n`);
  if (detail) process.stderr.write(`check-listing-stale:   ${String(detail).split('\n')[0]}\n`);
  process.exit(2);
}

// The newsroom day the live site says it built its listing for.
async function publishedDay() {
  const url = `${SITE_URL}/build-info.json?cb=${cacheBust}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  } catch (e) {
    return fail(`could not reach ${url}`, e.message);
  }
  if (!res.ok) return fail(`${url} returned HTTP ${res.status}`);
  let info;
  try {
    info = await res.json();
  } catch (e) {
    return fail(`${url} is not JSON`, e.message);
  }
  // A build predating the listing field reports nothing. That is unknown, not
  // equal: treating it as current would make the first deployment of this
  // mechanism the one deployment whose front page never rolls.
  //
  // isRealDay, not a shape test, and the difference is not pedantry. `2026-13-45`
  // matches the shape and is not a date. A shape-only check would accept it and
  // then compare it as text, where it sorts after every real day, so the answer
  // would be "not stale" and this script would report green every fifteen minutes
  // while the front page never rolled.
  const day = info?.listing?.newsroomToday;
  if (!isRealDay(day)) {
    return fail(`${SITE_URL} does not report a real listing.newsroomToday`, `newsroomToday=${JSON.stringify(day)}`);
  }
  return day;
}

// The newsroom day now. Read from the wall clock in the newsroom's own zone, so
// "today" here means the day the desk is working on.
const today = calendarDay(Date.now(), TIME_ZONE);
const published = await publishedDay();

if (published === today) {
  process.stdout.write(`check-listing-stale: listing is current for ${published}\n`);
  process.exit(0);
}

// Only ever forwards. A listing built for a day ahead of the clock is not stale
// and rebuilding would be churn; it is a clock skew, or a runner in the wrong
// zone, and it says so on stderr so a human can look.
if (published > today) {
  process.stderr.write(`check-listing-stale: live listing is dated ${published}, ahead of the newsroom day ${today}\n`);
  process.stderr.write(`check-listing-stale: this is a clock or time zone problem, not a stale listing. Not publishing.\n`);
  process.exit(0);
}

process.stdout.write(`check-listing-stale: listing is stale. built=${published} today=${today}\n`);
process.stdout.write(`${today}\n`);
process.exit(1);
