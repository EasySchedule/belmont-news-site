#!/usr/bin/env node
// dates.mjs - publication instants for the RSS feed, with no hardcoded offset.
//
// The newsroom runs on America/New_York and switches between EDT (-04:00) and
// EST (-05:00) on 2026-11-01. Writing an offset into the build hard-codes the
// wrong instant for half the year, so the offset is read from the IANA time
// zone database at build time instead. That is a build-time Intl lookup on the
// runner's own tzdata, not a dependency.
//
// Zero dependencies, like the rest of the build.

export const NEWSROOM_TZ = 'America/New_York';

// Edition clock times, from the publishing calendar: 06:00 and 20:00 local.
export const EDITION_CLOCK = { morning: [6, 0], evening: [20, 0] };

// A column post declares edition: column, which carries no clock time of its
// own. Day start is the honest floor for it: the earliest instant the
// publication day can have begun.
const DEFAULT_CLOCK = [0, 0];

// Offset of `timeZone` at instant `t`, in milliseconds east of UTC.
//
// Trick: format the instant in the target zone, read the wall clock back as if
// it were UTC, and the gap is the offset. No tz database is parsed here.
export function zoneOffsetMs(t, timeZone = NEWSROOM_TZ) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(t))) if (part.type !== 'literal') p[part.type] = part.value;
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  // Seconds are dropped from `t` so the comparison ignores the sub-second part
  // that the formatter does not carry.
  return wall - Math.floor(t / 1000) * 1000;
}

// The calendar day an instant falls on, in a named zone, as YYYY-MM-DD.
//
// Not the UTC date. The newsroom runs America/New_York, so an instant at
// 2026-10-04T03:00Z is still 2026-10-03 here, and a rule that asked for "the
// UTC date" would roll the listing over an hour or two before the newsroom
// day actually turns over.
export function calendarDay(instantMs, timeZone = NEWSROOM_TZ) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(instantMs))) if (part.type !== 'literal') p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

// True when a string is a calendar day that exists.
//
// The shape test alone is not enough. `2026-13-45` matches /^\d{4}-\d{2}-\d{2}$/
// perfectly well, and anything that only checks the shape will go on to compare it
// as text: `2026-13-45` sorts after any real day, so a rule asked "is this listing
// stale?" about it answers no, and the failure is silent. Round-tripping through
// Date.UTC is what turns the shape into a date.
export function isRealDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10));
  const d = new Date(t);
  return Number.isFinite(t)
    && d.getUTCFullYear() === +v.slice(0, 4)
    && d.getUTCMonth() === +v.slice(5, 7) - 1
    && d.getUTCDate() === +v.slice(8, 10);
}

// Add whole days to a calendar day. UTC arithmetic, deliberately: a calendar
// day has no offset and no DST, and borrowing the newsroom zone here would
// make the result depend on which side of a transition the day fell.
export function addDays(day, n) {
  const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

// A wall-clock time on a calendar day, in a named zone, as a UTC instant.
//
//   zonedInstant('2026-10-03', 6, 0)  -> 2026-10-03T10:00:00Z   (EDT)
//   zonedInstant('2026-11-01', 6, 0)  -> 2026-11-01T11:00:00Z   (EST)
//
// Two steps, because a single step lands on the wrong side of a DST boundary:
// guess the offset from the naive instant, then re-read the offset at the
// guessed instant and correct once if it moved. On 2026-11-01 the first guess
// lands inside the fallback hour and the second pass moves it out.
export function zonedInstant(day, hour = 0, minute = 0, timeZone = NEWSROOM_TZ) {
  const naive = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), hour, minute, 0);
  const first = zoneOffsetMs(naive, timeZone);
  const guess = naive - first;
  const second = zoneOffsetMs(guess, timeZone);
  return second === first ? guess : naive - second;
}

// True when a front matter `date` is a full ISO 8601 instant carrying its own
// offset, for example 2026-10-03T06:00:00-04:00. The site-architecture blueprint
// specifies that shape, so a post that carries one is used exactly as written
// and this module never guesses on its behalf.
export function isInstant(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/.test(date.trim());
}

// The publication instant of a post, in milliseconds since the epoch.
//
// Precedence, most trustworthy first:
//   1. a full ISO 8601 instant in `date`, used verbatim.
//   2. the edition clock (06:00 morning, 20:00 evening) on the publication day,
//      resolved in America/New_York so the DST change is handled by tzdata.
//   3. day start, for a column post whose edition carries no clock time.
//
// The result is never later than `buildEpochMs`. An edition is filed before its
// publication day arrives, so a post dated tomorrow would otherwise be stamped
// in the future, and a reader's feed reader would hide it as unreadable. The
// floor is when this build shipped, which is also the honest answer to "when
// did this reach the reader".
export function publicationInstant(fm, buildEpochMs, timeZone = NEWSROOM_TZ) {
  if (isInstant(fm.date)) return Math.min(Date.parse(fm.date.trim()), buildEpochMs);
  const day = String(fm.date || '').slice(0, 10);
  const [hour, minute] = EDITION_CLOCK[fm.edition] || DEFAULT_CLOCK;
  return Math.min(zonedInstant(day, hour, minute, timeZone), buildEpochMs);
}

// The instant this build shipped, for clamping and for the feed's lastBuildDate.
// SOURCE_DATE_EPOCH is the reproducible-builds convention: when CI sets it from
// the commit being deployed, two builds of the same commit emit the same bytes.
export function buildEpochMs(explicit) {
  const raw = explicit ?? process.env.SOURCE_DATE_EPOCH;
  if (raw != null && /^\d+$/.test(String(raw).trim())) return Number(String(raw).trim()) * 1000;
  return Date.now();
}
