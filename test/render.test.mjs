// The renderer, tested. Run with: node --test
//
// The one case that matters most: a source the reader cannot see is a failed
// publish. The parser here once read only the `- ` marker lines of a `sources:`
// block, dropped every continuation line, and published a page that printed
// "Document ." once per source. That passed the length check, so only these
// tests caught it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(REPO, 'build.mjs');

const FRONT = [
  'title: "A headline for the test fixture"',
  'dek: "One sentence under the headline."',
  'date: 2026-10-02',
  'edition: evening',
  'byline: Nathan Beausoleil',
  'category: weather',
  'slug: belmont-county-three-day-weather-roundup',
].join('\n');

const SOURCES = [
  'sources:',
  '  - type: document',
  '    title: "Gridpoint forecast PBZ/50,48"',
  '    organization: "National Weather Service, forecast office Pittsburgh PA"',
  '    retrieved: 2026-10-02',
  '    url: "https://api.weather.gov/gridpoints/PBZ/50,48/forecast"',
  '  - type: human',
  '    title: "Jackee Pugh"',
  '    organization: "Executive Director, Belmont County Tourism Council"',
  '    retrieved: 2026-10-02',
].join('\n');

function render(frontMatter, slug = 'belmont-county-three-day-weather-roundup', body = '## The roundup\n\nRain tonight, then a dry weekend.\n') {
  const root = mkdtempSync(join(tmpdir(), 'belmont-site-'));
  try {
    const file = join(root, 'content', '2026', '10', '2026-10-02', `nathan-beausoleil--${slug}.md`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `---\n${frontMatter}\n---\n\n${body}`);
    try {
      const stdout = execFileSync('node', [BUILD, '--content', join(root, 'content'), '--out', join(root, 'dist'), '--site-url', 'https://example.test'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, stdout, stderr: '', html: readFileSync(join(root, 'dist', '2026-10-02', slug, 'index.html'), 'utf8') };
    } catch (e) {
      return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '', html: '' };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function sourcesSection(html) {
  const m = /<section class="sources">[\s\S]*?<\/section>/.exec(html);
  return m ? m[0] : '';
}

// -------------------------------------------------- the reader sees sources

test('every source is named on the page, with body, retrieval date and link', () => {
  const r = render(`${FRONT}\n${SOURCES}`);
  assert.equal(r.code, 0, r.stderr);
  const s = sourcesSection(r.html);
  assert.match(s, /Gridpoint forecast PBZ\/50,48/);
  assert.match(s, /National Weather Service, forecast office Pittsburgh PA/);
  assert.match(s, /retrieved 2026-10-02/);
  assert.match(s, /href="https:\/\/api\.weather\.gov\/gridpoints\/PBZ\/50,48\/forecast"/);
  assert.doesNotMatch(s, /Document\s*<\/span>\s*\./, 'a source must never render as a bare label');
});

test('a named human renders as on the record', () => {
  const r = render(`${FRONT}\n${SOURCES}`);
  const s = sourcesSection(r.html);
  assert.match(s, /On the record<\/span> Jackee Pugh/);
  assert.match(s, /Executive Director, Belmont County Tourism Council/);
});

test('each list item is its own source, not the first one repeated', () => {
  const four = [
    'sources:',
    '  - type: document',
    '    title: "First"',
    '    retrieved: 2026-10-02',
    '  - type: document',
    '    title: "Second"',
    '    retrieved: 2026-10-02',
    '  - type: human',
    '    title: "Third"',
    '    retrieved: 2026-10-02',
    '  - type: human',
    '    title: "Fourth"',
    '    retrieved: 2026-10-02',
  ].join('\n');
  const r = render(`${FRONT}\n${four}`);
  assert.equal(r.code, 0, r.stderr);
  const s = sourcesSection(r.html);
  for (const t of ['First', 'Second', 'Third', 'Fourth']) assert.match(s, new RegExp(t));
  assert.equal((s.match(/<li>/g) || []).length, 4);
});

// --------------------------------------------------- the reader sees numbers
//
// These fail on main. The renderer parked inline-code spans as bare numeric
// indexes and restored them by replacing every digit run in the document, so
// every figure in every article printed as the word "undefined". A reader got
// "the undefined -hour public access" and "BEL- undefined ." Nothing in the
// suite asserted on a numeral reaching the page, which is how it shipped.

const NUMBERS_BODY = [
  '## The roundup',
  '',
  'It carries the 58,281 names. The grounds are open 24 hours today and the',
  'closing ceremony starts at 1:45 p.m. on 2026-10-04. The street number is',
  '45420, and the exhibit closes at 2 p.m.',
  '',
  "The committee's published schedule sets the times, and Route 40 carries the",
  'detour. Build it with `npm run build` before you push.',
].join('\n');

test('numbers in the body reach the page as written', () => {
  const r = render(`${FRONT}\n${SOURCES}`, undefined, NUMBERS_BODY);
  assert.equal(r.code, 0, r.stderr);
  for (const n of ['58,281', '24 hours', '1:45 p.m.', '2026-10-04', '45420', '2 p.m.', 'Route 40']) {
    assert.match(r.html, new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${n} must reach the reader`);
  }
});

test('no figure anywhere on the page degrades to the word undefined', () => {
  const r = render(`${FRONT}\n${SOURCES}`, undefined, NUMBERS_BODY);
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.html, /undefined/, 'no numeral may render as undefined');
  assert.match(r.html, /committee&#39;s published schedule sets the times/);
});

test('inline code still renders as code, and keeps its contents verbatim', () => {
  const r = render(`${FRONT}\n${SOURCES}`, undefined, NUMBERS_BODY);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.html, /<code>npm run build<\/code>/);
  assert.doesNotMatch(r.html, /<code>undefined<\/code>/);
});

test('inline code around digits is not confused with a bare number', () => {
  const body = ['## The roundup', '', 'Seven `2` and `12` and a bare 42 in the same line.', ''].join('\n');
  const r = render(`${FRONT}\n${SOURCES}`, undefined, body);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.html, /Seven <code>2<\/code> and <code>12<\/code> and a bare 42/);
});

// ------------------------------------------------------ and never a blank one

test('a source with no title stops the build instead of printing a blank', () => {
  const r = render(`${FRONT}\nsources:\n  - see attached`);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /sources\[0\] has no title/);
});

test('a sources key with nothing under it stops the build', () => {
  const r = render(`${FRONT}\nsources:`);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /has no sources/);
});

test('a post with no sources key at all stops the build', () => {
  const r = render(FRONT);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /missing required front matter sources/);
});

// ------------------------------------------------------- the rest of the front matter

test('a list of scalars still parses as scalars', () => {
  const r = render(`${FRONT}\ntags:\n  - weather\n  - fair\n${SOURCES}`);
  assert.equal(r.code, 0, r.stderr);
  assert.doesNotMatch(r.html, /type: weather/);
});

test('a corrections block parses', () => {
  const corrections = 'corrections:\n  - date: 2026-10-04\n    correction: "Temperature was high, not low."';
  const r = render(`${FRONT}\n${corrections}\n${SOURCES}`);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.html, /Temperature was high, not low\./);
});

test('a post missing its byline stops the build', () => {
  const noByline = FRONT.split('\n').filter((l) => !l.startsWith('byline:')).join('\n');
  const r = render(`${noByline}\n${SOURCES}`);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /missing required front matter byline/);
});

// ------------------------------------------------------------ the real archive

test('every post in the committed content snapshot names its sources', () => {
  const out = mkdtempSync(join(tmpdir(), 'belmont-real-'));
  try {
    // Walk the committed snapshot instead of naming today's posts. A hardcoded
    // list and a hardcoded count both rot on the next publish, and this test now
    // runs on the publish path too: a fifth post would have failed the deploy
    // over a stale number rather than over anything a reader would see.
    const markdown = [];
    (function walk(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.md')) markdown.push(p);
      }
    })(join(REPO, 'content'));
    assert.ok(markdown.length > 0, 'the committed snapshot has no posts in it');

    const stdout = execFileSync('node', [BUILD, '--content', 'content', '--out', out, '--site-url', 'https://example.test'], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(stdout, new RegExp(`built ${markdown.length} post\\(s\\)`));
    for (const file of markdown) {
      // content/YYYY/MM/YYYY-MM-DD/author--slug.md renders to YYYY-MM-DD/slug.
      const parts = file.split(sep);
      const p = `${parts[parts.length - 2]}/${parts[parts.length - 1].split('--')[1].replace(/\.md$/, '')}`;
      const html = readFileSync(join(out, ...p.split('/'), 'index.html'), 'utf8');
      const s = sourcesSection(html);
      assert.notEqual(s, '', `${p} rendered no sources section at all`);
      assert.doesNotMatch(s, /<\/span>\s*\./, `${p} rendered a source with no name`);
      const items = s.match(/<li>/g) || [];
      assert.ok(items.length >= 3, `${p} rendered ${items.length} source(s)`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// ------------------------------------------------------- the reader sees a correction

// Build a corrections log in a temp tree and read back the month page the reader
// gets. build.mjs takes --corrections as its own directory, so this exercises
// the real corrections path end to end rather than a reimplementation of it.
function renderCorrections(log) {
  const root = mkdtempSync(join(tmpdir(), 'belmont-corrections-'));
  try {
    mkdirSync(join(root, 'corrections'), { recursive: true });
    // The build refuses an empty site, so one post stands in. The corrections
    // path does not read it; it is here so the build has something to publish
    // alongside the log.
    const post = join(root, 'content', '2026', '10', '2026-10-02', 'nathan-beausoleil--belmont-county-three-day-weather-roundup.md');
    mkdirSync(dirname(post), { recursive: true });
    writeFileSync(post, ['---', FRONT, SOURCES, '---', '', '## The roundup', '', 'Rain tonight.', ''].join('\n'));
    writeFileSync(join(root, 'corrections', '2026-10.md'), log);
    try {
      const stdout = execFileSync('node', [BUILD, '--content', join(root, 'content'), '--corrections', join(root, 'corrections'), '--out', join(root, 'dist'), '--site-url', 'https://example.test'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return {
        code: 0,
        stdout,
        stderr: '',
        html: readFileSync(join(root, 'dist', 'corrections', '2026-10', 'index.html'), 'utf8'),
        // The sitemap is written by this same build and carries the lastmod the
        // tests below are about, so it is read here rather than by a second
        // build with the same fixture.
        sitemap: readFileSync(join(root, 'dist', 'sitemap.xml'), 'utf8'),
      };
    } catch (e) {
      return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '', html: '' };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function correctionTexts(html) {
  return [...html.matchAll(/<p class="correction-text">([\s\S]*?)<\/p>/g)].map((m) => m[1]);
}

// The defect this guards: a correction quotes the post it corrects, so it quotes
// backticked constructs, and the log rendered them with esc() while the post
// rendered the same construct as <code>. A reader met 18 literal backticks on
// /corrections/2026-10/ where 9 code spans belonged.
test('a correction renders inline code as code, not as literal backticks', () => {
  const r = renderCorrections(`# Belmont News corrections — October 2026

Standing rule: a correction is appended and never deleted.

## 2026-10-03 — morning-briefing-2026-10-03

Correction (2026-10-02): BEL-24 "is still \`in_progress\` and carries no \`lead-story-recommendation\` document".
Published in: the 06:00 edition of Saturday 2026-10-03.
Corrected by: Rosalind Kimbrough.
`);
  assert.equal(r.code, 0, r.stderr);
  const [text] = correctionTexts(r.html);
  assert.match(text, /<code>in_progress<\/code>/);
  assert.match(text, /<code>lead-story-recommendation<\/code>/);
  assert.doesNotMatch(text, /`/, 'a code span must not reach the reader as backtick characters');
});

// The wording of a published correction is the editorial record. Rendering must
// not restate it: every character outside the backticks has to survive verbatim,
// so a fix for legibility cannot quietly become an edit to what the desk said.
test('rendering a correction changes its backticks and nothing else', () => {
  const quoted = 'Sections 3 and 4 print \`probabilityOfPrecipitation.value\` of 33 percent "Chance Rain Showers" / For that period the grid returns 17 percent.';
  const r = renderCorrections(`# Belmont News corrections — October 2026

Standing rule: a correction is appended and never deleted.

## 2026-10-03 — morning-briefing-2026-10-03

Correction (2026-10-02): ${quoted}
Published in: the 06:00 edition of Saturday 2026-10-03.
Corrected by: Rosalind Kimbrough.
`);
  assert.equal(r.code, 0, r.stderr);
  const [text] = correctionTexts(r.html);
  const visible = text.replace(/<code>([\s\S]*?)<\/code>/g, '$1')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  assert.equal(visible, quoted.replace(/`([^`]+)`/g, '$1'));
});

// inline() escapes before it transforms, so routing correction prose through it
// cannot have weakened the escaping esc() gave. A code span holding markup is
// the case that would show it: it must read as text, not become a tag.
test('a code span in a correction holding markup stays text', () => {
  const r = renderCorrections(`# Belmont News corrections — October 2026

Standing rule: a correction is appended and never deleted.

## 2026-10-03 — morning-briefing-2026-10-03

Correction (2026-10-02): the field \`<b>value</b>\` was printed raw.
Published in: the 06:00 edition of Saturday 2026-10-03.
Corrected by: Rosalind Kimbrough.
`);
  assert.equal(r.code, 0, r.stderr);
  const [text] = correctionTexts(r.html);
  assert.match(text, /<code>&lt;b&gt;value&lt;\/b&gt;<\/code>/);
  assert.doesNotMatch(text, /<code><b>/);
});

// Rendering must not become an edit. The log is append-only, and a build that
// dropped or reordered a published entry would be as much a deletion as editing
// one in place, so the count and the order are asserted here.
test('rendering keeps every entry, in the order the log has them', () => {
  const entry = (date, what) => `## 2026-10-03 — morning-briefing-2026-10-03

Correction (${date}): ${what}
Published in: the 06:00 edition of Saturday 2026-10-03.
Corrected by: Rosalind Kimbrough.
`;
  const r = renderCorrections(`# Belmont News corrections — October 2026

Standing rule: a correction is appended and never deleted.

${entry('2026-10-02', 'first, printed \`NONE\`')}${entry('2026-10-02', 'second, printed 33 percent')}${entry('2026-10-03', 'third, printed \`in_progress\`')}
`);
  assert.equal(r.code, 0, r.stderr);
  const texts = correctionTexts(r.html);
  assert.equal(texts.length, 3, 'a published entry went missing from the log');
  assert.match(texts[0], /first, printed <code>NONE<\/code>/);
  assert.match(texts[1], /second, printed 33 percent/);
  assert.match(texts[2], /third, printed <code>in_progress<\/code>/);
});

// ---------------------------------------------- what the sitemap tells a crawler
//
// The defect BEL-137 found. `lastmod` for /corrections/2026-10/ read
// log.entries[0], and the log is append-only, so that is its OLDEST entry. Three
// corrections appended on 2026-10-03 sat on a page the sitemap still dated
// 2026-10-02, and the two they superseded are the entries a reader most needs to
// reach. Not a cosmetic date.

const correctionEntryFixture = (postDate, correctionDate, what) => `## ${postDate} — morning-briefing-${postDate}

Correction (${correctionDate}): ${what}
Published in: the 06:00 edition of Saturday ${postDate}.
Corrected by: Rosalind Kimbrough.
`;

const lastmodFor = (sitemap, url) => {
  const m = new RegExp(`<loc>https://example\\.test/${url}</loc>\\s*<lastmod>([^<]+)</lastmod>`).exec(sitemap);
  return m ? m[1] : null;
};

test("a corrections page's lastmod is the newest correction on it, not the oldest", () => {
  const r = renderCorrections(`# Belmont News corrections — October 2026

Standing rule: a correction is appended and never deleted.

${correctionEntryFixture('2026-10-03', '2026-10-02', 'the first correction')}
${correctionEntryFixture('2026-10-03', '2026-10-02', 'the second correction')}
${correctionEntryFixture('2026-10-03', '2026-10-03', 'the third, superseding the first two')}`);
  assert.equal(r.code, 0, r.stderr);
  // The page really does carry the later correction, so a stale lastmod cannot be
  // explained away by there being nothing newer to report.
  assert.match(r.html, /Correction \(<time datetime="2026-10-03"/);
  assert.equal(lastmodFor(r.sitemap, 'corrections/2026-10/'), '2026-10-03');
});

test('appending a newer correction moves lastmod forward with it', () => {
  // On a log whose newest entry happens to be its first, the old code looked
  // right. Growing that same log by one entry is what has to move the date, and
  // this is the assertion that fails on main.
  const one = renderCorrections(`# Log

Standing rule: a correction is appended and never deleted.

${correctionEntryFixture('2026-10-02', '2026-10-02', 'the only one so far')}`);
  const two = renderCorrections(`# Log

Standing rule: a correction is appended and never deleted.

${correctionEntryFixture('2026-10-02', '2026-10-02', 'the only one so far')}
${correctionEntryFixture('2026-10-03', '2026-10-03', 'appended a day later')}`);
  assert.equal(one.code, 0, one.stderr);
  assert.equal(two.code, 0, two.stderr);
  assert.equal(lastmodFor(one.sitemap, 'corrections/2026-10/'), '2026-10-02');
  assert.equal(lastmodFor(two.sitemap, 'corrections/2026-10/'), '2026-10-03', 'an appended correction must move the date a crawler reads');
});

test('no lastmod anywhere in the sitemap is a partial date', () => {
  // `2026-10` is legal in the sitemap protocol and rejected or coerced by a
  // number of parsers. It is what /corrections/ carried. A partial date in this
  // document means the old fallback came back into use.
  const r = renderCorrections(`# Log

Standing rule: a correction is appended and never deleted.

${correctionEntryFixture('2026-10-03', '2026-10-02', 'one correction')}`);
  assert.equal(r.code, 0, r.stderr);
  const found = [...r.sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
  assert.ok(found.length, 'the fixture must produce at least one lastmod or this proves nothing');
  for (const d of found) assert.match(d, /^\d{4}-\d{2}-\d{2}$/, `lastmod ${d} is not a full date`);
});

test('the corrections index carries the newest date on any month page beneath it', () => {
  const r = renderCorrections(`# Log

Standing rule: a correction is appended and never deleted.

${correctionEntryFixture('2026-10-03', '2026-10-02', 'one correction')}
${correctionEntryFixture('2026-10-03', '2026-10-04', 'a later correction')}`);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(lastmodFor(r.sitemap, 'corrections/'), '2026-10-04');
});

test('a log with no corrections omits lastmod rather than inventing one', () => {
  // A log that names no correction has no modification date to report. lastmod is
  // optional in the protocol, so the element is dropped rather than filled in
  // with the month, which is how the partial date got there.
  const r = renderCorrections('# Log\n\nNothing has been corrected yet.\n');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.sitemap, /<loc>https:\/\/example\.test\/corrections\/2026-10\/<\/loc>/, 'the month page is still published');
  assert.equal(lastmodFor(r.sitemap, 'corrections/2026-10/'), null, 'no correction means no date to claim');
});

test("a post's own sitemap entry still carries its publish date", () => {
  // The fix touches the two corrections URLs only. Post entries are correct as
  // they stand and the expiry rule deliberately keeps expired posts in here, so
  // this pins both facts while the corrections dates are being recomputed.
  const r = renderCorrections(`# Log

Standing rule: a correction is appended and never deleted.

${correctionEntryFixture('2026-10-02', '2026-10-03', 'one correction')}`);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(lastmodFor(r.sitemap, '2026-10-02/belmont-county-three-day-weather-roundup/'), '2026-10-02');
});
