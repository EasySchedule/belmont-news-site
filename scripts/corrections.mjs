#!/usr/bin/env node
// corrections.mjs - read the newsroom corrections log.
//
// The corrections log lives in the blogs repository at corrections/YYYY-MM.md,
// outside content/, because a correction is not an article and is not gated as
// one. The site copies that directory verbatim (see sync-content.mjs) and
// renders it here. This module only parses; build.mjs renders.
//
// The entry format is fixed by the newsroom and by BEL-39, so the parser is
// strict about the three labelled fields and lenient about prose:
//
//   # <log title>
//
//   <standing rule, one paragraph>
//
//   ## <post date> — <post slug>
//
//   Correction (<YYYY-MM-DD>): <what was wrong> / <what is right>.
//   Published in: <edition and date>.
//   Corrected by: <full name>.
//
// A line that does not open a labelled field continues the field above it, so a
// long correction may wrap without losing text.
//
// This module parses the log and reconciles it against the posts in the build;
// build.mjs renders and refuses. See reconcileCorrections() for the rule that
// joins a logged correction to the front matter on the post it names.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

// Filename is the log key: YYYY-MM.md, so the URL is /corrections/YYYY-MM/.
const MONTH_FILE = /^(\d{4})-(\d{2})\.md$/;

const ENTRY_HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s+[—-]\s+(\S.*?)\s*$/;
const CORRECTION_LINE = /^Correction\s*\((\d{4}-\d{2}-\d{2})\)\s*:\s*(.*)$/;
const PUBLISHED_LINE = /^Published in\s*:\s*(.*)$/;
const CORRECTED_BY_LINE = /^Corrected by\s*:\s*(.*)$/;

// Parse one corrections file into { month, title, standingRule, entries }.
// Entries keep the order the file has them in: the log is append-only, so file
// order is the newsroom's own chronological record and this parser does not
// re-sort it.
export function parseCorrectionsFile(text, month) {
  const log = { month, title: '', standingRule: '', entries: [] };
  let current = null;
  let field = null;

  const set = (k, v) => {
    if (!current) return;
    current[k] = current[k] ? `${current[k]} ${v}` : v;
  };

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();

    if (!line) { field = null; continue; }

    // A new entry opens on the post date and slug.
    const entry = ENTRY_HEADING.exec(line);
    if (entry) {
      current = { postDate: entry[1], slug: entry[2], correctionDate: '', correction: '', publishedIn: '', correctedBy: '' };
      log.entries.push(current);
      field = null;
      continue;
    }

    if (!current) {
      // Everything before the first entry is the log's own preamble.
      if (line.startsWith('# ')) log.title = line.slice(2).trim();
      else if (line.startsWith('## ')) continue; // a section we do not model
      else if (log.standingRule) log.standingRule += ` ${line}`;
      else log.standingRule = line;
      continue;
    }

    const corr = CORRECTION_LINE.exec(line);
    if (corr) {
      current.correctionDate = corr[1];
      current.correction = corr[2];
      field = 'correction';
      continue;
    }

    const published = PUBLISHED_LINE.exec(line);
    if (published) {
      current.publishedIn = published[1];
      field = 'publishedIn';
      continue;
    }

    const by = CORRECTED_BY_LINE.exec(line);
    if (by) {
      current.correctedBy = by[1];
      field = 'correctedBy';
      continue;
    }

    // Wrapped prose. Only continue a field that already holds something, so an
    // unrecognised stray line is never silently grafted onto a correction.
    if (field) set(field, line);
  }

  // A log that names no correction is still a log. Drop only entries that
  // carry no correction text at all, which means the file is malformed there.
  log.entries = log.entries.filter((e) => e.correction);
  return log;
}

// --------------------------------------------------------- the log against the copy
//
// A correction is logged in corrections/YYYY-MM.md AND reflected on the post it
// names, in that post's `corrections:` front matter. Until this function existed
// nothing joined the two: readCorrections() parsed the log, correctionsBlock()
// rendered whatever front matter a post happened to carry, and no code path
// asked whether they agreed.
//
// The result was a correction that was logged, counted valid, published at
// /corrections/, and linked from the reader's own page -- to a post that showed
// the reader nothing. On 2026-10-05, at belmont-news-site eb7cc0c, five entries
// named morning-briefing-2026-10-03 and that page rendered zero Corrections
// sections. `npm run check` printed "11 post(s) valid, 1 corrections log(s)
// valid, 7 correction(s)" and passed clean. That is BEL-313.
//
// The two directions are not symmetric, and only one of them is a failure:
//
//   log -> post   A logged correction with no front-matter entry of the same
//                 date on the post it names is a FAILURE. The reader has been
//                 told the story was corrected; the story does not say so.
//
//   post -> log   Not checked here, and deliberately. A `corrections:` entry
//                 with no log entry is the desk correcting itself silently,
//                 which is a different defect (BEL-323's ruling covers the
//                 reverse order and this gate is not the place for it).
//
//   post missing  A correction that outlives the post it names is a WARNING,
//                 never a failure. build.mjs already drops the link to a post
//                 that is not in the build, on purpose, because a dead link in a
//                 corrections log is worse than plain text. A correction has to
//                 be able to outlive its post, so requiring the post to exist
//                 would make an honest record impossible to keep. The warning is
//                 here so the case is visible without blocking a publish.
//
// What "matching" means is the DATE and nothing else. The log entry and the
// front-matter entry are written by the same desk about the same correction, but
// the log carries the full editorial record and the front matter carries the
// reader-facing summary, and they are not required to be the same sentence.
// Demanding identical prose would make this a second copy of the content and the
// first thing to break the next time a correction is reworded -- reintroducing
// the class of defect this gate exists to catch, one level down. Date equality is
// the smallest thing that cannot be satisfied by accident and still means the
// reader is told.
export function reconcileCorrections({ logs, posts }) {
  const byUrl = new Map();
  for (const p of posts || []) byUrl.set(p.url, p);

  const unreconciled = [];
  const unknownPost = [];
  let checked = 0;
  let reconciled = 0;

  for (const log of logs || []) {
    for (const e of log.entries) {
      checked += 1;
      const url = `${e.postDate}/${e.slug}/`;
      const post = byUrl.get(url);
      const where = {
        month: log.month,
        file: `corrections/${log.month}.md`,
        postDate: e.postDate,
        slug: e.slug,
        url,
        correctionDate: e.correctionDate,
      };

      if (!post) {
        unknownPost.push(where);
        continue;
      }

      // The front-matter parser gives `corrections:` as a list of objects, one
      // per entry. Read the dates out and compare them, so a correction whose
      // prose was reworded on the post still counts as reflected.
      const postDates = Array.isArray(post.fm && post.fm.corrections)
        ? post.fm.corrections
          .map((c) => (c && typeof c === 'object' && !Array.isArray(c) ? String(c.date ?? '').trim() : ''))
          .filter(Boolean)
        : [];

      if (postDates.includes(e.correctionDate)) {
        reconciled += 1;
      } else {
        unreconciled.push({ ...where, postDates });
      }
    }
  }

  return { checked, reconciled, unreconciled, unknownPost };
}

// Read every corrections log in `dir`, newest month first. A missing directory
// is not an error: a fresh clone has not synced yet, and a newsroom that has
// logged no correction yet must still publish a working site.
export function readCorrections(dir) {
  const logs = [];
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return { dir, logs, present: false };
  }
  const present = names.some((n) => MONTH_FILE.test(n));
  for (const name of names.sort()) {
    const month = MONTH_FILE.exec(name);
    if (!month) continue;
    const file = join(dir, name);
    if (!statSync(file).isFile()) continue;
    logs.push(parseCorrectionsFile(readFileSync(file, 'utf8'), `${month[1]}-${month[2]}`));
  }
  logs.sort((a, b) => b.month.localeCompare(a.month));
  return { dir, logs, present: present && logs.length > 0 };
}

// The stable URL of a log. /corrections/ is the index and never moves, whatever
// months exist; /corrections/YYYY-MM/ is one month.
export const correctionsIndexUrl = 'corrections/';
export const correctionsMonthUrl = (month) => `corrections/${month}/`;
export const logName = (file) => basename(file);
