// The renderer, tested. Run with: node --test
//
// The one case that matters most: a source the reader cannot see is a failed
// publish. The parser here once read only the `- ` marker lines of a `sources:`
// block, dropped every continuation line, and published a page that printed
// "Document ." once per source. That passed the length check, so only these
// tests caught it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync, existsSync } from 'node:fs';
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

// Where the builder put a post's page: `date`/`slug` out of the front matter,
// exactly as build.mjs reads them (`url: `${data.date}/${data.slug}/``).
//
// This used to split the filename on `--` and take the second half. That threw
// on the short form `content/<Y>/<M>/<day>/<author-slug>.md`, which the filing
// rule in the blogs repository allows whenever a writer files one post that day
// ("It is optional: use the short form when a writer files one post that day"),
// and `index.mjs --check` accepts it. There was no `--` to split, so
// `split('--')[1]` was undefined and this line raised
// `TypeError: Cannot read properties of undefined (reading 'replace')`. Because
// the renderer tests run inside pages.yml, on the publish path, that took the
// deploy down with it: a legal filing red the build at 15:25:06Z on the BEL-37
// publish and no page reached readers.
//
// The filename is not the address of a post and never was. build.mjs reads the
// whole front matter and writes to date/slug, so a post filed under the short
// form, or under any other name, still lands where the front matter says. Ask
// the front matter the same way and the two forms stop being different.
function builtPath(file) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, 'utf8'));
  assert.ok(front, `${file} has no front matter block`);
  const scalar = (key) => {
    const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(front[1]);
    assert.ok(m, `${file} has no ${key} in its front matter`);
    const v = m[1].trim();
    const q = /^"(.*)"$/.exec(v) || /^'(.*)'$/.exec(v);
    return q ? q[1] : v;
  };
  return `${scalar('date')}/${scalar('slug')}`;
}

test('every post in the committed content snapshot names its sources', () => {
  const out = mkdtempSync(join(tmpdir(), 'belmont-real-'));
  // The archive is staged into a temp directory and built from the copy. One
  // committed file is refused by the body gate added for BEL-161, because its body
  // is a Paperclip document API response rather than the article, and it cannot
  // render at all. This test is about sources, so it renders the rest and reports
  // what it had to leave out rather than quietly covering less than it used to.
  const staged = mkdtempSync(join(tmpdir(), 'belmont-real-content-'));
  try {
    const stagedContent = join(staged, 'content');
    cpSync(join(REPO, 'content'), stagedContent, { recursive: true });

    const markdown = [];
    (function walk(dir) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.md')) markdown.push(p);
      }
    })(stagedContent);
    assert.ok(markdown.length > 0, 'the committed snapshot has no posts in it');
    const committed = markdown.length;

    // build.mjs stops at the first refusal, so each pass names one file. The name it
    // prints is relative to its own working directory, which is not the staged
    // directory, so keep only the part under content/ and join it back.
    const blocked = [];
    for (let pass = 0; pass < 20; pass++) {
      const gate = spawnSync('node', [BUILD, '--content', stagedContent, '--check'], { cwd: REPO, encoding: 'utf8' });
      if (gate.status === 0) break;
      const m = /build\.mjs: ([^:]+\.md):/.exec(gate.stderr || '');
      if (!m) throw new Error(`the body gate failed without naming a file:\n${gate.stderr}`);
      const parts = m[1].split(/[/\\]/).slice(-4);
      if (parts.length !== 4) throw new Error(`cannot resolve ${m[1]} against the staged archive`);
      const file = parts.join('/');
      if (blocked.includes(file)) throw new Error(`the body gate named ${file} twice without advancing`);
      blocked.push(file);
      rmSync(join(stagedContent, ...parts));
    }
    assert.deepEqual(
      blocked, [],
      `the committed archive cannot be published. ${blocked.length} file(s) are refused by the body gate:\n`
      + blocked.map((f) => `  ${f}`).join('\n')
      + '\nReplace the body of each with the markdown, not the document record.',
    );

    const buildable = (function walk(dir) {
      const found = [];
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) found.push(...walk(p));
        else if (e.name.endsWith('.md')) found.push(p);
      }
      return found;
    })(stagedContent);

    const stdout = execFileSync('node', [BUILD, '--content', stagedContent, '--out', out, '--site-url', 'https://example.test'], {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(stdout, new RegExp(`built ${buildable.length} post\\(s\\)`));
    assert.equal(buildable.length, committed, 'no post is dropped from this test without saying so');
    for (const file of buildable) {
      // The same derivation every other test uses: build.mjs writes to
      // date/slug out of the front matter, so ask the front matter.
      const p = builtPath(file);
      const html = readFileSync(join(out, ...p.split('/'), 'index.html'), 'utf8');
      const s = sourcesSection(html);
      assert.notEqual(s, '', `${p} rendered no sources section at all`);
      assert.doesNotMatch(s, /<\/span>\s*\./, `${p} rendered a source with no name`);
      const items = s.match(/<li>/g) || [];
      assert.ok(items.length >= 3, `${p} rendered ${items.length} source(s)`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(staged, { recursive: true, force: true });
  }
});

test('both filing-rule filename forms publish the page the front matter names', () => {
  // README.md and CONTRIBUTING.md allow both
  // `content/<Y>/<M>/<day>/<author-slug>--<slug>.md` and the short
  // `content/<Y>/<M>/<day>/<author-slug>.md` ("It is optional: use the short
  // form when a writer files one post that day"), and `index.mjs --check` takes
  // the short form. Every post in the archive happens to carry a `--`, so
  // nothing covered the short form: a legal filing red the deploy because the
  // snapshot test above split the filename on a separator the short form does
  // not have. Build both here, so the next reporter who uses the short form
  // gets a page instead of a dead publish.
  const root = mkdtempSync(join(tmpdir(), 'belmont-bothforms-'));
  try {
    const day = join(root, 'content', '2026', '10', '2026-10-02');
    mkdirSync(day, { recursive: true });
    // Three sources, the same floor the snapshot test holds the archive to, so
    // this checks a short-form post publishes a complete page and not only a
    // directory.
    const sources = `${SOURCES}
  - type: document
    title: "Belmont County EMA, overnight rainfall totals"
    organization: "Belmont County Emergency Management Agency"
    retrieved: 2026-10-02
    url: "https://belmontcountyoh.gov/ema/rainfall"`;
    const posts = [
      { file: 'nathan-beausoleil--the-long-form-still-publishes.md', slug: 'the-long-form-still-publishes' },
      { file: 'priya-raghunathan.md', slug: 'the-short-form-publishes-too' },
    ];
    for (const { file, slug } of posts) {
      const front = FRONT.replace(/^slug: .*$/m, `slug: ${slug}`);
      writeFileSync(join(day, file), `---\n${front}\n${sources}\n---\n\n## The post\n\nRain tonight, then a dry weekend.\n`);
    }

    const stdout = execFileSync('node', [BUILD, '--content', join(root, 'content'), '--out', join(root, 'dist'), '--site-url', 'https://example.test'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.match(stdout, /built 2 post\(s\)/);

    for (const { file, slug } of posts) {
      // Go through the same derivation the snapshot test uses, so this covers
      // the line that threw rather than only the builder.
      assert.equal(builtPath(join(day, file)), `2026-10-02/${slug}`);
      const s = sourcesSection(readFileSync(join(root, 'dist', '2026-10-02', slug, 'index.html'), 'utf8'));
      assert.notEqual(s, '', `${slug} rendered no sources section at all`);
      assert.doesNotMatch(s, /<\/span>\s*\./, `${slug} rendered a source with no name`);
      assert.ok((s.match(/<li>/g) || []).length >= 3, `${slug} rendered fewer than three sources`);
    }

    // The filename is not the address of a post. A short-form post publishes
    // where its front matter says, not where it happens to sit on disk.
    assert.ok(!existsSync(join(root, 'dist', '2026-10-02', 'priya-raghunathan')), 'the filename leaked into the URL');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------- a wrapped paragraph stays a paragraph

// render() reads back dist/<slug>/, and the build writes the slug out of the
// front matter, so a fixture has to carry the same slug in both places.
function bodyAt(slug, body) {
  return render(FRONT.replace('slug: belmont-county-three-day-weather-roundup', `slug: ${slug}`) + `\n${SOURCES}`, slug, body);
}

// A body line that begins with a digit and a period is not a list. The Wall
// That Heals story wraps to
//
//   The presenting sponsor is American Legion St. Clairsville Post
//   159. The host committee lists its sponsors in tiers.
//
// and "159." matched the ordered-marker regex, so the renderer cut the
// sentence at "Post", stripped the number, and published the rest of the
// paragraph as a one-item <ol> followed by an orphan <p>. Both halves are
// asserted here, because either one alone would have passed.

test('a wrapped paragraph that begins with a number is not a list', () => {
  const body = [
    'The national partner on the Belmont County stop is the Vietnam Veterans',
    'Memorial Fund. The presenting sponsor is American Legion St. Clairsville Post',
    '159. The host committee lists its sponsors in tiers. The Freedom Sponsors are',
    'Belmont County, Ohio, Belmont County Fair and Rotary of St. Clairsville.',
    '',
  ].join('\n');
  const r = bodyAt('wall-that-heals-st-clairsville', body);
  assert.equal(r.code, 0, r.stderr);

  // 1. the sentence is whole, and agrees with the source note on the same page
  assert.match(
    r.html,
    /<p>The national partner on the Belmont County stop is the Vietnam Veterans Memorial Fund\. The presenting sponsor is American Legion St\. Clairsville Post 159\./,
    'the sponsor number was cut out of the sentence',
  );
  // 2. the whole paragraph is one <p>, and no list was invented around it
  assert.doesNotMatch(r.html, /<ol>/, 'a wrapped paragraph opened an ordered list');
  const paras = r.html.match(/<p>The national partner[\s\S]*?<\/p>/g) || [];
  assert.equal(paras.length, 1, 'the paragraph was split into more than one block');
  assert.match(paras[0], /Belmont County Fair and Rotary of St\. Clairsville\./);
});

// The complement of the rule above: at the top of a block, a list that starts
// at a number other than 1 is still a list. Without this the fix could pass by
// simply refusing to recognise an ordered list at all.
test('an ordered list that starts above 1 still opens a list', () => {
  const body = ['## Two runners-up', '', '3. Third place.', '4. Fourth place.', ''].join('\n');
  const r = bodyAt('runners-up', body);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.html, /<ol><li>Third place\.<\/li><li>Fourth place\.<\/li><\/ol>/);
});

// The blank line matters here. With one, the paragraph is already flushed by the
// time "1." arrives and the assertion is satisfied by the para.length === 0
// branch, so the case proves nothing about interrupting. Without one, the only
// thing that can make this an <ol> is the start-at-1 rule itself.
test('an ordered list starting at 1 still interrupts a paragraph', () => {
  const body = [
    'A lead paragraph that runs on',
    'across two lines.',
    '1. First item.',
    '2. Second item.',
    '',
  ].join('\n');
  const r = bodyAt('interrupting-list', body);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.html, /<ol><li>First item\.<\/li><li>Second item\.<\/li><\/ol>/);
  assert.match(r.html, /<p>A lead paragraph that runs on across two lines\.<\/p>/);
});

// CommonMark lets an unordered list interrupt a paragraph as long as its first
// item is not empty. The start-at-1 rule above belongs to ordered lists only.
// When the two were conflated, this body rendered as one paragraph with the
// bullets typed inline, and nothing in the store did it yet to catch it.
test('an unordered list interrupts a paragraph with no blank line before it', () => {
  const body = [
    'The tier list reads as follows, and the tiers are',
    '- Freedom Sponsors, which include Belmont County',
    '- Tribute Sponsors, which include UPMC',
    '',
  ].join('\n');
  const r = bodyAt('tier-list', body);
  assert.equal(r.code, 0, r.stderr);
  assert.match(
    r.html,
    /<ul><li>Freedom Sponsors, which include Belmont County<\/li><li>Tribute Sponsors, which include UPMC<\/li><\/ul>/,
    'the bullets stopped being bullets',
  );
  assert.match(r.html, /<p>The tier list reads as follows, and the tiers are<\/p>/);
  assert.doesNotMatch(r.html, /tiers are - /, 'a bullet was typed inline into the paragraph');
});

// An ordered marker indented under an open paragraph is the same rule with
// leading whitespace. The marker pattern accepts ^\s*, so the interrupt test has
// to as well, or an indented "1." becomes paragraph text while a flush one does
// not.
test('an indented 1. still interrupts a paragraph', () => {
  const body = [
    'The host committee lists its sponsors in tiers',
    '  1. Freedom Sponsors',
    '  2. Tribute Sponsors',
    '',
  ].join('\n');
  const r = bodyAt('indented-interrupting-list', body);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.html, /<ol><li>Freedom Sponsors<\/li><li>Tribute Sponsors<\/li><\/ol>/);
  assert.match(r.html, /<p>The host committee lists its sponsors in tiers<\/p>/);
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
        // The index and the month page are written by this same build, so the
        // index is read here rather than by a second build with the same fixture.
        indexHtml: readFileSync(join(root, 'dist', 'corrections', 'index.html'), 'utf8'),
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

// -------------------------------------------------- data tables
//
// The defect: on 2026-10-05 every <th> on the site was a bare <th>. A
// screen-reader user got six unlabelled numbers per weather row with no way to
// recover which was the high and which the low, and neither table carried a
// <caption>. WCAG 1.3.1.

const TABLE_BODY = [
  '## Three-day table',
  '',
  'Point of record: St. Clairsville, Ohio.',
  '',
  '| Date | High | Low | Sky condition |',
  '| --- | --- | --- | --- |',
  '| Sat Oct 3, 2026 | 69 °F | 53 °F | Sunny |',
  '| Sun Oct 4, 2026 | 73 °F | 50 °F | Partly sunny |',
  '',
].join('\n');

test('every header cell names its column', () => {
  const r = render(FRONT + `\n${SOURCES}`, 'belmont-county-three-day-weather-roundup', TABLE_BODY);
  assert.equal(r.code, 0, r.stderr);
  const cells = [...r.html.matchAll(/<th\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(cells.length, 4, 'all four header cells render');
  for (const cell of cells) {
    assert.match(cell, /scope="col"/, `header cell carries its column scope: ${cell}`);
  }
  // The one header row is the whole association. An id/headers pair per cell
  // would be the same information spelled out once per column.
  assert.doesNotMatch(r.html, /headers=/, 'no id/headers pairing is invented for a single header row');
});

test('a table an author captioned renders that caption, and it is visible', () => {
  const body = TABLE_BODY.replace(
    '| Date |',
    'Table: Belmont County three-day forecast, Saturday October 3 through Monday October 5, 2026. Source: National Weather Service gridpoint forecast PBZ/50,48, retrieved 2026-10-02.\n\n| Date |',
  );
  const r = render(FRONT + `\n${SOURCES}`, 'belmont-county-three-day-weather-roundup', body);
  assert.equal(r.code, 0, r.stderr);
  const caption = /<caption>([\s\S]*?)<\/caption>/.exec(r.html);
  assert.ok(caption, 'the table is captioned');
  assert.match(caption[1], /National Weather Service gridpoint forecast PBZ\/50,48/, 'the caption says where the numbers came from');
  assert.doesNotMatch(caption[0], /class="visually-hidden"/, 'an author-written caption is on the page, not hidden from it');
});

test('a caption survives a blank line between it and the table', () => {
  const body = TABLE_BODY.replace(
    '| Date |',
    'Table: The forecast, from the National Weather Service.\n\n| Date |',
  );
  const r = render(FRONT + `\n${SOURCES}`, 'belmont-county-three-day-weather-roundup', body);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.html, /<caption>The forecast, from the National Weather Service\.<\/caption>/);
  assert.doesNotMatch(r.html, /<p>Table: /, 'the caption line does not also print as a paragraph');
});

test('a table with no caption written still gets one, carried for a screen reader', () => {
  // This is the half that scales. No post has to opt in, so a queued story
  // carrying a table cannot reintroduce the defect.
  const r = render(FRONT + `\n${SOURCES}`, 'belmont-county-three-day-weather-roundup', TABLE_BODY);
  assert.equal(r.code, 0, r.stderr);
  const caption = /<caption[^>]*>([\s\S]*?)<\/caption>/.exec(r.html);
  assert.ok(caption, 'an unwritten caption does not mean no caption');
  assert.match(caption[0], /class="visually-hidden"/, 'a derived caption is not printed twice on the page');
  assert.equal(caption[1].trim(), 'Three-day table', 'it is taken from the heading above the table');
});

test('a derived caption carries the heading words but no link a keyboard user can land on', () => {
  // The heading is already on the page, so its link is reachable there. A second
  // copy inside off-screen text is a tab stop with no visible focus target.
  const body = [
    '## See the [forecast notice](/sources/) before you read on',
    '',
    '| Date | High |',
    '| --- | --- |',
    '| Sat Oct 3, 2026 | 69 °F |',
    '',
  ].join('\n');
  const r = render(FRONT + `\n${SOURCES}`, 'belmont-county-three-day-weather-roundup', body);
  assert.equal(r.code, 0, r.stderr);
  const caption = /<caption[^>]*>([\s\S]*?)<\/caption>/.exec(r.html);
  assert.ok(caption, 'the table is captioned');
  assert.equal(caption[1].trim(), 'See the forecast notice before you read on', 'the readable words survive');
  assert.doesNotMatch(caption[1], /<a\b/, 'the off-screen caption carries no interactive markup');
  // The heading itself keeps its link. Only the hidden copy drops it.
  assert.match(r.html, /<a href="\/sources\/">forecast notice<\/a>/, 'the printed heading is untouched');
});

test('a Table: line that is not above a table stays ordinary prose', () => {
  const body = `${TABLE_BODY}\n## Later\n\nTable: this one names no table at all.\n`;
  const r = render(FRONT + `\n${SOURCES}`, 'belmont-county-three-day-weather-roundup', body);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.html, /<p>Table: this one names no table at all\.<\/p>/);
  assert.equal([...r.html.matchAll(/<caption/g)].length, 1, 'the one table on the page is still captioned');
});

// -------------------------------------------------- corrections: anchors

const headTexts = (html) => [...html.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());

test('every correction carries an id, so one correction can be linked to', () => {
  const r = renderCorrections(`# Log

${correctionEntryFixture('2026-10-02', '2026-10-03', 'the high was wrong')}
${correctionEntryFixture('2026-10-03', '2026-10-04', 'the address was wrong')}`);
  assert.equal(r.code, 0, r.stderr);
  const ids = [...r.html.matchAll(/<article class="correction" id="([^"]+)">/g)].map((m) => m[1]);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2, 'ids are unique');
  for (const id of ids) {
    assert.match(r.html, new RegExp(`href="#${id}"`), `the permalink points at ${id}`);
  }
});

test('two corrections to one post on one day do not collide on an id', () => {
  // Both entries share post date, correction date and slug, which is the only
  // combination the id can collide on.
  const r = renderCorrections(`# Log

${correctionEntryFixture('2026-10-02', '2026-10-03', 'the first claim was wrong')}
${correctionEntryFixture('2026-10-02', '2026-10-03', 'the second claim was wrong')}`);
  assert.equal(r.code, 0, r.stderr);
  const ids = [...r.html.matchAll(/<article class="correction" id="([^"]+)">/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, 2, 'the second entry steps past the first id');
});

test('two corrections on one post on different dates do not collide on an id', () => {
  // The date of the correction is part of the id, so a post corrected twice in
  // one month does not give both entries the same anchor.
  const r = renderCorrections(`# Log

${correctionEntryFixture('2026-10-02', '2026-10-03', 'the high was wrong')}
${correctionEntryFixture('2026-10-02', '2026-10-05', 'the low was wrong')}`);
  assert.equal(r.code, 0, r.stderr);
  const ids = [...r.html.matchAll(/<article class="correction" id="([^"]+)">/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, 2, 'each correction date gets its own anchor');
});

test('a heading list of corrections tells them apart', () => {
  // The defect in its original form: six h2s, three of them the same string.
  // The desk's own separator is "what was wrong / what is right", so the half
  // before it is the claim that identifies the entry.
  const r = renderCorrections(`# Log

${correctionEntryFixture('2026-10-02', '2026-10-03', 'the high was wrong / the right figure was 70')}
${correctionEntryFixture('2026-10-03', '2026-10-04', 'the address was wrong / it is 45420 Roscoe Road')}`);
  assert.equal(r.code, 0, r.stderr);
  const heads = headTexts(r.html);
  assert.equal(heads.length, 2);
  assert.equal(new Set(heads).size, 2, 'no two corrections share a heading');
  assert.match(heads[0], /the high was wrong/, 'the heading carries the claim being corrected');
  assert.doesNotMatch(heads[0], /the right figure was 70/, 'the heading stops at the separator');
  // The heading identifies the entry. It does not replace it.
  assert.match(correctionTexts(r.html)[0], /the high was wrong \/ the right figure was 70/, 'the full text still prints in full underneath');
});

test('two corrections whose claims start the same way still get different headings', () => {
  // The fixture case the uniqueness assertion above misses: same post, same
  // correction date, claims that begin with the same words.
  const r = renderCorrections(`# Log

${correctionEntryFixture('2026-10-02', '2026-10-03', 'the high was wrong / the right figure was 70')}
${correctionEntryFixture('2026-10-02', '2026-10-03', 'the high was wrong / the right figure was 71')}`);
  assert.equal(r.code, 0, r.stderr);
  const heads = headTexts(r.html);
  assert.equal(new Set(heads).size, 2, 'a repeated claim lead is numbered rather than left identical');
});

test('each correction permalink has an accessible name of its own', () => {
  // Every link on the page used to be announced as "Permalink to this
  // correction", so a screen reader's link list was the same words six times.
  const r = renderCorrections(`# Log

${correctionEntryFixture('2026-10-02', '2026-10-03', 'the high was wrong')}
${correctionEntryFixture('2026-10-03', '2026-10-04', 'the address was wrong')}`);
  assert.equal(r.code, 0, r.stderr);
  const names = [...r.html.matchAll(/<a class="permalink" href="#[^"]+" aria-label="([^"]+)">/g)].map((m) => m[1]);
  assert.equal(names.length, 2);
  assert.equal(new Set(names).size, 2, 'the names are distinct');
  assert.match(names[0], /2026-10-03/, 'a name says which correction it points at');
});

test('the corrections index counts corrections without claiming attribution', () => {
  // `.byline` is the only class in the stylesheet that means who wrote a thing,
  // and the corrections log is the one page whose subject is attribution.
  const r = renderCorrections(`# Log

${correctionEntryFixture('2026-10-02', '2026-10-03', 'the high was wrong')}
${correctionEntryFixture('2026-10-03', '2026-10-04', 'the address was wrong')}`);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.indexHtml, /<p class="card-note">2 corrections on record<\/p>/);
  assert.doesNotMatch(r.indexHtml, /class="byline"/, 'a count is not rendered as an attribution');
});
