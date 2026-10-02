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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
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

function render(frontMatter, slug = 'belmont-county-three-day-weather-roundup') {
  const root = mkdtempSync(join(tmpdir(), 'belmont-site-'));
  try {
    const file = join(root, 'content', '2026', '10', '2026-10-02', `nathan-beausoleil--${slug}.md`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `---\n${frontMatter}\n---\n\n## The roundup\n\nRain tonight, then a dry weekend.\n`);
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
    const stdout = execFileSync('node', [BUILD, '--content', 'content', '--out', out, '--site-url', 'https://example.test'], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(stdout, /built 4 post\(s\)/);
    const pages = [
      '2026-10-02/belmont-county-three-day-weather-roundup',
      '2026-10-02/morning-briefing-2026-10-02-evening',
      '2026-10-03/morning-briefing-2026-10-03',
      '2026-10-03/wall-that-heals-last-chance-lead-recommendation',
    ];
    for (const p of pages) {
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