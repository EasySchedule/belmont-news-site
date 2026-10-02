// Test the two rules that this build exists to enforce, and the parser that
// reads the corrections log.
//
//   node --test test/
//
// Zero dependencies, like the build. `npm test` runs this on every pull request.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { zonedInstant, publicationInstant, isInstant, NEWSROOM_TZ } from '../scripts/dates.mjs';
import { parseCorrectionsFile, readCorrections } from '../scripts/corrections.mjs';

const utc = (ms) => new Date(ms).toISOString();

test('zonedInstant resolves the America/New_York wall clock with no hardcoded offset', () => {
  // October is EDT, -04:00. 06:00 local is 10:00 UTC.
  assert.equal(utc(zonedInstant('2026-10-03', 6, 0)), '2026-10-03T10:00:00.000Z');
  // The newsroom moves to EST, -05:00, on 2026-11-01. 06:00 local is 11:00 UTC.
  // A build that wrote -04:00 into the source would be one hour out from here
  // on, for the rest of the year.
  assert.equal(utc(zonedInstant('2026-11-01', 6, 0)), '2026-11-01T11:00:00.000Z');
  assert.equal(utc(zonedInstant('2026-12-15', 20, 0)), '2026-12-16T01:00:00.000Z');
});

test('zonedInstant survives both DST boundaries, not just the fall one', () => {
  // Spring forward, 2026-03-08: 06:00 local is 10:00 UTC, the day before the
  // change 06:00 local is 11:00 UTC.
  assert.equal(utc(zonedInstant('2026-03-07', 6, 0)), '2026-03-07T11:00:00.000Z');
  assert.equal(utc(zonedInstant('2026-03-08', 6, 0)), '2026-03-08T10:00:00.000Z');
  // Midnight on the change day is still EDT, because the change is at 02:00.
  assert.equal(utc(zonedInstant('2026-11-01', 0, 0)), '2026-11-01T04:00:00.000Z');
});

test('zonedInstant is a real inverse of the zone, not an approximation', () => {
  const inZone = (t) => {
    const p = {};
    for (const part of new Intl.DateTimeFormat('en-US', {
      timeZone: NEWSROOM_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    }).formatToParts(new Date(t))) if (part.type !== 'literal') p[part.type] = part.value;
    return `${p.year}-${p.month}-${p.day} ${p.hour}:00`;
  };
  for (const day of ['2026-01-15', '2026-03-08', '2026-07-04', '2026-11-01', '2027-02-28']) {
    for (const hour of [0, 6, 12, 20, 23]) {
      assert.equal(inZone(zonedInstant(day, hour, 0)), `${day} ${String(hour).padStart(2, '0')}:00`,
        `${day} ${hour}:00 does not round-trip`);
    }
  }
});

test('isInstant only accepts a full ISO 8601 instant that carries its own offset', () => {
  assert.ok(isInstant('2026-10-03T06:00:00-04:00'));
  assert.ok(isInstant('2026-10-03T06:00:00-05:00'));
  assert.ok(isInstant('2026-10-03T10:00:00Z'));
  assert.ok(!isInstant('2026-10-03'), 'a bare calendar date is not an instant');
  assert.ok(!isInstant('2026-10-03T06:00:00'), 'a local time with no offset is ambiguous');
  assert.ok(!isInstant('2026-10-03 06:00:00-04:00'), 'not ISO 8601');
});

test('no post is ever dated in the future, whatever the calendar date says', () => {
  // The 06:00 edition of 2026-10-03 was filed and shipped on the evening of
  // 2026-10-02. Its own 06:00 instant is more than six hours ahead of the build.
  const shipped = Date.parse('2026-10-02T23:35:06Z');
  const tomorrowMorning = { date: '2026-10-03', edition: 'column' };
  const tomorrowEvening = { date: '2026-10-03', edition: 'evening' };

  assert.ok(publicationInstant(tomorrowMorning, shipped) <= shipped);
  assert.ok(publicationInstant(tomorrowEvening, shipped) <= shipped);
  assert.equal(publicationInstant(tomorrowMorning, shipped), shipped);
  assert.equal(publicationInstant(tomorrowEvening, shipped), shipped);

  // Tonight's 20:00 edition, built after 20:00 local, keeps its real instant:
  // 2026-10-02T20:00-04:00 is 2026-10-03T00:00Z. The feed still orders it
  // below the morning edition that shipped first.
  const afterEight = Date.parse('2026-10-03T01:00:00Z');
  const tonight = { date: '2026-10-02', edition: 'evening' };
  assert.equal(utc(publicationInstant(tonight, afterEight)), '2026-10-03T00:00:00.000Z');
  assert.ok(publicationInstant(tonight, afterEight) <= afterEight);
});

test('the feed cannot regress below the build even when the clock is skewed', () => {
  const futureDay = { date: '2030-01-01', edition: 'morning' };
  assert.equal(publicationInstant(futureDay, 1000), 1000);
});

test('an offset-bearing date is used verbatim, capped at the build', () => {
  // Once the instant is in the past, the build epoch does not touch it.
  assert.equal(
    utc(publicationInstant({ date: '2026-10-01T06:00:00-04:00', edition: 'morning' }, Date.parse('2026-10-02T23:35:06Z'))),
    '2026-10-01T10:00:00.000Z',
  );
  // A post stamped ahead of the build is still capped.
  assert.equal(
    publicationInstant({ date: '2026-10-03T06:00:00-04:00', edition: 'morning' }, Date.parse('2026-10-02T23:35:06Z')),
    Date.parse('2026-10-02T23:35:06Z'),
  );
});

test('the corrections log parses the newsroom format, in the order it was written', () => {
  const log = parseCorrectionsFile(`# Belmont News corrections — October 2026

Standing rule: a correction is appended and never deleted.

## 2026-10-03 — morning-briefing-2026-10-03

Correction (2026-10-02): The headline said NONE / The lead call is The Wall That Heals.
Published in: the 06:00 edition of Saturday 2026-10-03.
Corrected by: Rosalind Kimbrough.

## 2026-10-03 — morning-briefing-2026-10-03

Correction (2026-10-02): Second correction, appended below the first.
Published in: the 06:00 edition of Saturday 2026-10-03.
Corrected by: Rosalind Kimbrough.
`, '2026-10');

  assert.equal(log.month, '2026-10');
  assert.equal(log.title, 'Belmont News corrections — October 2026');
  assert.equal(log.standingRule, 'Standing rule: a correction is appended and never deleted.');
  assert.equal(log.entries.length, 2);
  assert.deepEqual(log.entries[0], {
    postDate: '2026-10-03',
    slug: 'morning-briefing-2026-10-03',
    correctionDate: '2026-10-02',
    correction: 'The headline said NONE / The lead call is The Wall That Heals.',
    publishedIn: 'the 06:00 edition of Saturday 2026-10-03.',
    correctedBy: 'Rosalind Kimbrough.',
  });
});

test('a wrapped correction keeps every word', () => {
  const log = parseCorrectionsFile(`# Log

## 2026-10-03 — some-slug

Correction (2026-10-02): first line of the correction
that wrapped onto a second line
and a third.
Published in: an edition.
Corrected by: A Person.
`, '2026-10');
  assert.equal(
    log.entries[0].correction,
    'first line of the correction that wrapped onto a second line and a third.',
  );
});

test('a log with no corrections is a log, not a build failure', () => {
  const log = parseCorrectionsFile('# Log\n\nNothing yet.\n', '2026-10');
  assert.equal(log.entries.length, 0);
  assert.equal(log.title, 'Log');
});

test('an entry with no correction text is dropped rather than rendered blank', () => {
  const log = parseCorrectionsFile(`# Log

## 2026-10-03 — a

Correction (2026-10-02): real.

## 2026-10-04 — b

Published in: an edition.
Corrected by: A Person.
`, '2026-10');
  assert.equal(log.entries.length, 1);
  assert.equal(log.entries[0].slug, 'a');
});

test('readCorrections reads YYYY-MM.md, newest month first, and tolerates a missing directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'corrections-'));
  writeFileSync(join(dir, '2026-09.md'), '# September\n\n## 2026-09-30 — a\n\nCorrection (2026-09-30): b.\n');
  writeFileSync(join(dir, '2026-10.md'), '# October\n\n## 2026-10-03 — a\n\nCorrection (2026-10-02): b.\n');
  writeFileSync(join(dir, 'README.md'), 'not a log\n');
  writeFileSync(join(dir, 'notes.txt'), 'not a log\n');

  const found = readCorrections(dir);
  assert.equal(found.present, true);
  assert.deepEqual(found.logs.map((l) => l.month), ['2026-10', '2026-09']);

  // A clone that has not synced yet must still build.
  const missing = readCorrections(join(dir, 'does-not-exist'));
  assert.equal(missing.present, false);
  assert.deepEqual(missing.logs, []);

  // A directory that synced but held no log yet is the same case as no
  // directory, and neither is an error.
  const bare = mkdtempSync(join(tmpdir(), 'corrections-empty-'));
  assert.equal(readCorrections(bare).present, false);
});
