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