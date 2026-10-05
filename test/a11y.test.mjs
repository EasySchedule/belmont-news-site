// The two keyboard affordances the site was missing, read back out of the built
// HTML. Run with: node --test
//
// Both defects were found by a read-only audit of the published site on
// 2026-10-05: no page had a skip link and no page had a single `id` attribute,
// so there was no target to point at either; and all 18 `target="_blank"`
// links announced nothing, which on one story meant seven silent context
// switches in a row.
//
// The test that matters most here is the one that checks the skip link against
// the page it is on. Adding the link without the `id` looks like the fix landed
// and leaves the keyboard user exactly where they were, because the browser has
// nothing to jump to. Asserting that the link exists is not enough; the pair has
// to be asserted together.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(REPO, 'build.mjs');
const STYLES = join(REPO, 'static', 'styles.css');

const FRONT = [
  'title: "The wall came down, and the fight over it did not"',
  'dek: "One sentence under the headline."',
  'date: 2026-10-03',
  'edition: evening',
  'byline: Danica Hoyt',
  'category: news',
  'slug: wall-that-heals-st-clairsville',
].join('\n');

const SOURCES = [
  'sources:',
  '  - type: document',
  '    title: "Gridpoint forecast PBZ/50,48"',
  '    organization: "National Weather Service, forecast office Pittsburgh PA"',
  '    retrieved: 2026-10-03',
  '    url: "https://api.weather.gov/gridpoints/PBZ/50,48/forecast"',
  '  - type: human',
  '    title: "Jackee Pugh"',
  '    organization: "Executive Director, Belmont County Tourism Council"',
  '    retrieved: 2026-10-03',
  '    url: "https://example.test/pugh"',
].join('\n');

// An external link in the body is the other place this build emits
// target="_blank", so the fixture needs one or the markdown path goes untested.
const BODY = [
  '## What happens next',
  '',
  'Read the [engineer\'s report](https://example.test/report) for the full detail.',
  'Then read the [corrections log](/corrections/), which stays on this site.',
].join('\n');

const LOG = `# Belmont News corrections — October 2026

Standing rule: a correction is appended and never deleted.

## 2026-10-03 — wall-that-heals-st-clairsville

Correction (2026-10-03): The engineer's report was linked as [the report](https://example.test/report), not the draft.
Published in: the 20:00 edition of Saturday 2026-10-03.
Corrected by: Rosalind Kimbrough.
`;

// Built once for the whole file. Every page type comes out of the same run:
// the front page, the post, the corrections index, the monthly log and the 404.
function buildSite() {
  const root = mkdtempSync(join(tmpdir(), 'belmont-a11y-'));
  const post = join(root, 'content', '2026', '10', '2026-10-03', 'danica-hoyt--wall-that-heals-st-clairsville.md');
  mkdirSync(dirname(post), { recursive: true });
  writeFileSync(post, ['---', FRONT, SOURCES, '---', '', BODY, ''].join('\n'));
  mkdirSync(join(root, 'corrections'), { recursive: true });
  writeFileSync(join(root, 'corrections', '2026-10.md'), LOG);
  try {
    execFileSync('node', [BUILD, '--content', join(root, 'content'), '--corrections', join(root, 'corrections'), '--out', join(root, 'dist'), '--site-url', 'https://example.test'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(`fixture build failed: ${e.stderr || e.message}`);
  }
  return root;
}

let site = null;
function pages() {
  if (site) return site;
  const root = buildSite();
  const dist = join(root, 'dist');
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.html')) {
        found.push({
          page: relative(dist, p).split(sep).join('/'),
          html: readFileSync(p, 'utf8'),
        });
      }
    }
  };
  walk(dist);
  site = found;
  return site;
}

function anchors(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    attrs: m[1],
    text: m[2],
    href: (/\shref="([^"]*)"/.exec(m[1]) || [, ''])[1],
    newTab: /target="_blank"/.test(m[1]),
  }));
}

// Comments are stripped before any rule is asserted on. A comment that explains
// why `outline: none` is not used here would otherwise read as a use of it, and
// the stylesheet is full of exactly that kind of note.
function cssRules() {
  return readFileSync(STYLES, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

// ------------------------------------------------- the skip link and its target

test('every page carries a skip link', () => {
  const all = pages();
  assert.ok(all.length >= 5, `fixture built only ${all.length} page(s)`);
  for (const { page, html } of all) {
    const skip = anchors(html).find((a) => /class="skip-link"/.test(a.attrs));
    assert.ok(skip, `${page} has no skip link`);
    assert.equal(skip.href, '#main', `${page} skip link points at ${skip.href}`);
    assert.match(skip.text, /Skip to main content/i, `${page} skip link has no readable text`);
  }
});

test('the skip link is the first focusable thing on the page', () => {
  // Order is the whole point of a bypass link. A skip link parked after the nav
  // is the same five stops with extra markup.
  for (const { page, html } of pages()) {
    const focusable = anchors(html);
    assert.ok(focusable.length, `${page} has no links at all`);
    assert.match(focusable[0].attrs, /class="skip-link"/,
      `${page} first tab stop is "${focusable[0].text.trim()}", not the skip link`);
  }
});

test('the skip link points at an id that exists on that same page', () => {
  // The pairing, asserted together. A skip link with no target is the defect
  // this whole issue was filed for: it renders, it looks fixed, and it moves
  // the reader nowhere.
  for (const { page, html } of pages()) {
    const skip = anchors(html).find((a) => /class="skip-link"/.test(a.attrs));
    assert.ok(skip, `${page} has no skip link`);
    const target = skip.href.replace(/^#/, '');
    assert.ok(target, `${page} skip link has no fragment`);
    assert.match(html, new RegExp(`id="${target}"`),
      `${page} skip link points at #${target} and no such id is on the page`);
  }
});

test('the skip target is main, and it is focusable without joining the tab order', () => {
  // tabindex="-1" is what turns the jump into a real focus move rather than a
  // scroll. Without it the link still does something in Gecko and nothing in
  // WebKit. It must never be "0", which would add a sixth stop and defeat the
  // bypass it exists to provide.
  for (const { page, html } of pages()) {
    const main = /<main\b([^>]*)>/.exec(html);
    assert.ok(main, `${page} has no <main>`);
    assert.match(main[1], /id="main"/, `${page} <main> carries no id`);
    assert.match(main[1], /tabindex="-1"/, `${page} <main> is not focusable`);
    assert.doesNotMatch(main[1], /tabindex="0"/, `${page} <main> would add a tab stop`);
  }
});

test('nothing anywhere puts an element back into the tab order by hand', () => {
  // A positive tabindex reorders the whole page against reading order. The
  // site never needed one and the skip link made that easy to break.
  for (const { page, html } of pages()) {
    assert.doesNotMatch(html, /tabindex="[1-9]/, `${page} has a positive tabindex`);
  }
});

// ------------------------------------------------- links that open a new tab

test('every link that opens a new tab announces it', () => {
  let checked = 0;
  for (const { page, html } of pages()) {
    for (const a of anchors(html)) {
      if (!a.newTab) continue;
      checked++;
      assert.match(a.text, /opens in a new tab/i,
        `${page} opens a new tab with no announcement: "${a.text.replace(/<[^>]+>/g, '').trim()}"`);
      assert.match(a.attrs, /class="[^"]*\bext\b/,
        `${page} new-tab link has no .ext marker for readers who cannot hear the announcement`);
    }
  }
  assert.ok(checked >= 4, `fixture rendered only ${checked} new-tab link(s); the assertions proved little`);
});

test('a source link is never the bare word source', () => {
  // The audit's exact finding: all 18 links read "source" with nothing else.
  // The announcement is visually hidden, so the visible text stays short, but
  // it must no longer be the only text in the element.
  for (const { page, html } of pages()) {
    const sources = /<section class="sources">[\s\S]*?<\/section>/.exec(html);
    if (!sources) continue;
    for (const a of anchors(sources[0])) {
      assert.notEqual(a.text.trim(), 'source', `${page} still renders a bare "source" link`);
    }
  }
});

test('a new-tab link keeps its visible text at the front of the accessible name', () => {
  // WCAG 2.5.3. The announcement is appended, never prepended, so a voice
  // control user who says "click source" still hits the right link.
  for (const { page, html } of pages()) {
    for (const a of anchors(html)) {
      if (!a.newTab) continue;
      const visible = a.text.replace(/<span class="visually-hidden">[\s\S]*?<\/span>/g, '').trim();
      assert.ok(visible, `${page} new-tab link has no visible text of its own`);
      assert.equal(a.text.trim().startsWith(visible), true,
        `${page} new-tab link announces itself before its own text: "${a.text.trim()}"`);
    }
  }
});

test('a link that stays on this site is not marked as opening a new tab', () => {
  // The marker is not decoration. /corrections/ in the fixture body is internal
  // and must not claim otherwise.
  const post = pages().find((p) => p.page.includes('wall-that-heals-st-clairsville'));
  assert.ok(post, 'fixture did not render the post page');
  const internal = anchors(post.html).find((a) => a.href === '/corrections/');
  assert.ok(internal, 'fixture did not render the internal corrections link');
  assert.equal(internal.newTab, false, 'an internal link opened a new tab');
  assert.doesNotMatch(internal.text, /opens in a new tab/i, 'an internal link claimed a new tab');
});

test('the announcement survives the corrections path, where inline() runs early', () => {
  // Correction prose renders through inline() at module top level, before the
  // const that holds the announcement is initialised. A fixture whose log
  // quotes no link cannot see that, and the page throws a ReferenceError
  // instead of rendering.
  const month = pages().find((p) => p.page === 'corrections/2026-10/index.html');
  assert.ok(month, 'fixture did not render the corrections month page');
  const quoted = anchors(month.html).find((a) => a.href === 'https://example.test/report');
  assert.ok(quoted, 'the link quoted in the correction did not render');
  assert.equal(quoted.newTab, true, 'the link quoted in a correction stopped opening a new tab');
  assert.match(quoted.text, /opens in a new tab/i, 'the link quoted in a correction lost its announcement');
});

// ------------------------------------------------------- what must not regress

test('no author rule removes the focus ring', () => {
  // The audit confirmed the user-agent ring survives everywhere, which is the
  // reason focus visibility passes today. This keeps the first `outline: none`
  // out of the file, whichever rule it arrives in.
  const css = cssRules();
  assert.doesNotMatch(css, /outline\s*:\s*(none|0)\b/i, 'styles.css removes the focus ring');
});

test('the skip link is hidden by positioning, not by anything that un-tabs it', () => {
  // display:none, visibility:hidden and a huge negative offset all keep a
  // keyboard user from reaching the link, which is the bug the class exists to
  // fix. The rule has to move it with transform.
  const css = cssRules();
  const rule = /\.skip-link\s*\{[^}]*\}/.exec(css);
  assert.ok(rule, 'styles.css has no .skip-link rule at all');
  assert.doesNotMatch(rule[0], /display\s*:\s*none/i, '.skip-link is display:none, so it cannot be tabbed to');
  assert.doesNotMatch(rule[0], /visibility\s*:\s*hidden/i, '.skip-link is visibility:hidden, so it cannot be tabbed to');
  assert.match(rule[0], /transform\s*:\s*translateY/, '.skip-link does not move itself out of view with transform');
  assert.match(css, /\.skip-link:focus\s*\{[^}]*translateY\(\s*0\s*\)/, '.skip-link does not come back on focus');
});

test('the visually-hidden helper does not hide from assistive technology too', () => {
  // It has to be clipped, not display:none or visibility:hidden, or the words
  // "opens in a new tab" are in the markup and in nobody's ears.
  const css = cssRules();
  const rule = /\.visually-hidden\s*\{[^}]*\}/.exec(css);
  assert.ok(rule, 'styles.css has no .visually-hidden rule at all');
  assert.doesNotMatch(rule[0], /display\s*:\s*none/i);
  assert.doesNotMatch(rule[0], /visibility\s*:\s*hidden/i);
  assert.match(rule[0], /clip/, '.visually-hidden does not clip');
  assert.match(rule[0], /overflow\s*:\s*hidden/, '.visually-hidden does not clip its overflow');
});