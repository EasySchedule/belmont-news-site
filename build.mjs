#!/usr/bin/env node
// build.mjs - render the Belmont News site from belmont-news/blogs content.
//
//   node build.mjs --content content --out dist --base-url /
//   node build.mjs --check        # validate only, write nothing
//
// Zero dependencies on purpose. The build runs on Netlify's free tier, on a
// GitHub Pages runner, and on a laptop, with the same result and nothing to
// audit between the markdown and the page.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEWSROOM_TZ, publicationInstant, buildEpochMs, calendarDay } from './scripts/dates.mjs';
import { readCorrections, correctionsIndexUrl, correctionsMonthUrl } from './scripts/corrections.mjs';
import { DEFAULT_LISTING_DAYS, publicationDay, expiryError, expiredError, partition } from './scripts/expiry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- CLI

const USAGE = `build.mjs - render the Belmont News site

Usage: node build.mjs [options]

  --content <dir>   markdown content directory  (default content)
  --corrections <dir>  corrections log directory (default corrections)
  --out <dir>       output directory            (default dist)
  --base-url <url>  site base URL path or origin (default /)
  --site-url <url>  canonical origin for feeds  (default http://localhost:8080)
  --title <text>    site title                 (default Belmont News)
  --build-epoch <unix-seconds>  when this build shipped (default SOURCE_DATE_EPOCH,
                                else the wall clock). Caps every feed timestamp,
                                so no item is ever dated in the future.
  --newsroom-today <YYYY-MM-DD>  the newsroom day the listing window is judged
                                against (default: the America/New_York date now).
                                Pins the rolling listing for a reproducible build.
  --listing-days <n>  newsroom days a post stays on the front page and in
                      feed.xml, counting its own day (default ${DEFAULT_LISTING_DAYS}).
  --check           validate only, write nothing
  --help            this text

Front matter the build reads beyond the required keys:

  expires: 2026-10-30   replaces the listing window for this post alone.
  expired: 2026-10-04   the story stopped being TRUE on this day, independently of
  expired: true         the window. Before the day it is not in force, so a post can
                        be marked on the morning it publishes. Either form removes
                        the post from the listing and the feed, and puts a dated
                        notice on its own page. The page is never withdrawn.

Environment:
  PUBLIC_POSTHOG_KEY   PostHog project key. When unset, no analytics snippet is
                      emitted at all. The build never fails on a missing key and
                      never hard-codes one.
  SOURCE_DATE_EPOCH    Same meaning as --build-epoch. CI sets it from the commit
                      being deployed so a build is reproducible from Git. It does
                      NOT drive the listing window: it is the commit's time, not
                      the build's, and using it would freeze the listing on the
                      day of the last commit rather than rolling it. See
                      --newsroom-today.
  TZ_FOR_DATES         Time zone for publication instants (default
                      ${NEWSROOM_TZ}). Named, never a numeric offset.
`;

function parseArgs(argv) {
  const o = { content: 'content', corrections: 'corrections', out: 'dist', baseUrl: '/', siteUrl: 'http://localhost:8080', title: 'Belmont News', buildEpoch: null, newsroomToday: null, listingDays: DEFAULT_LISTING_DAYS, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) {
        process.stderr.write(`build.mjs: ${a} needs a value\n`);
        process.exit(2);
      }
      return argv[++i];
    };
    if (a === '--content') o.content = val();
    else if (a === '--corrections') o.corrections = val();
    else if (a === '--out') o.out = val();
    else if (a === '--base-url') o.baseUrl = val();
    else if (a === '--site-url') o.siteUrl = val().replace(/\/$/, '');
    else if (a === '--title') o.title = val();
    else if (a === '--build-epoch') o.buildEpoch = val();
    else if (a === '--newsroom-today') o.newsroomToday = val();
    else if (a === '--listing-days') o.listingDays = Number(val());
    else if (a === '--check') o.check = true;
    else if (a === '--help') { process.stdout.write(USAGE); process.exit(0); }
    else {
      process.stderr.write(`build.mjs: unknown argument ${a}\n`);
      process.exit(2);
    }
  }
  return o;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.newsroomToday !== null && !/^\d{4}-\d{2}-\d{2}$/.test(opts.newsroomToday.trim())) {
  fail(`--newsroom-today must be a plain YYYY-MM-DD day, got ${JSON.stringify(opts.newsroomToday)}`);
}
if (!Number.isInteger(opts.listingDays) || opts.listingDays < 1) {
  fail(`--listing-days must be a whole number of at least 1, got ${JSON.stringify(opts.listingDays)}`);
}

// ------------------------------------------------------------- escaping

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// A link that opens a new tab has to say so. A screen-reader user cannot see
// that the context is about to change, and on the Wall That Heals story the
// Sources block is seven of these in a row.
//
// Two marks, doing two different jobs.
//
// The sentence goes in a visually hidden span, because that is text in the
// document and it reaches assistive technology reliably. It is appended, never
// prepended, so the visible text still leads the accessible name and voice
// control on "click source" keeps working (WCAG 2.5.3).
//
// The arrow goes in an `aria-hidden` span rather than a CSS `content` value.
// It looked equivalent and is not: Chrome with NVDA reads CSS generated
// content aloud, so an arrow drawn by `content` joins the link's accessible
// name and the screen-reader user is told "north east arrow" once per source.
// `aria-hidden` on a real element is the one form that is excluded from the
// accessibility tree in every combination. The visible text is not the arrow,
// so hiding the arrow hides nothing a reader needs.
//
// Declared here rather than beside the Sources block that uses it most:
// correction prose renders through inline() above, at module top level, and a
// const declared further down would be in its temporal dead zone there.
const NEW_TAB_HINT = '<span class="visually-hidden"> (opens in a new tab)</span>';
const NEW_TAB_MARK = '<span class="ext-mark" aria-hidden="true">\u2197</span>';

// ------------------------------------------------------------- markdown

// A small, predictable subset: headings, paragraphs, blockquotes, fenced code,
// unordered and ordered lists, pipe tables, horizontal rules, and inline
// strong/em/code/links. Anything it does not know renders as text, which is the
// safe failure for a news site: a reader sees the sentence, not a broken page.
function inline(src) {
  let s = esc(src);
  // inline code first so its contents escape nothing else
  //
  // The placeholder is wrapped in NUL, not a bare index. A bare index is
  // indistinguishable from a number the author wrote, and restoring it by
  // matching digits therefore matched every number in the article and printed
  // codes[<number>] for each one. That is how every figure on the site came
  // out as the word "undefined". Nothing esc() emits can contain NUL, so the
  // two can never collide.
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const safe = /^(https?:\/\/|\/|#|mailto:)/.test(href) ? href : '#';
    // An external link is the one case here that opens a new tab, so it is the
    // one case that has to announce it. Same marker as the Sources block.
    if (/^https?:\/\//.test(safe)) {
      return `<a class="ext" href="${safe}" rel="noopener noreferrer" target="_blank">${text}${NEW_TAB_HINT}${NEW_TAB_MARK}</a>`;
    }
    return `<a href="${safe}">${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

// Whether a pipe table starts at `at`: a header row, then a separator row of
// dashes, colons and pipes. One predicate, so the caption line above a table and
// the table itself cannot disagree about what a table is.
function tableStartsAt(lines, at) {
  if (at < 0 || at + 1 >= lines.length) return false;
  return /\|/.test(lines[at]) && /^\s*\|?[\s:-]*-[\s:|-]*$/.test(lines[at + 1]);
}

// Text of a heading or caption with its Markdown link markup removed, leaving the
// words a reader reads.
//
// Only for the caption the renderer writes itself, and only because that caption
// is off-screen. `inline()` turns `[x](/y)` into a real link, and a focusable
// link inside a `visually-hidden` caption is a keyboard user tabbing to something
// with no visible focus target and no way to know where they are. The heading it
// borrows the words from is already printed on the page, so keeping its links buys
// nothing and costs that.
function plainText(src) {
  return String(src || '').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1').trim();
}

// ------------------------------------------------- the caption for a table
//
// A caption the author wrote, on the line above the table, is the caption a reader
// sees. A table whose author wrote none still gets one, taken from the nearest
// heading above it and kept out of the visual layout: that heading is already on
// the page, so printing it twice in a row is noise. Hidden is not absent — the
// caption stays in the accessibility tree, which is the part that was missing.
//
// The fallback is what makes this hold for the next story. Nothing in a post has
// to opt in for its table to be navigable, so a queued story carrying a table
// cannot reintroduce the defect this fixes.
const TABLE_CAPTION_FALLBACK = 'Data table';

function captionTag(written, nearestHeading) {
  if (written) return `<caption>${inline(written)}</caption>`;
  const text = plainText(nearestHeading) || TABLE_CAPTION_FALLBACK;
  return `<caption class="visually-hidden">${esc(text)}</caption>`;
}

function markdown(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  // The nearest heading above the table that still needs a caption. Reset per
  // call, so a blockquote's own headings are the ones its own tables fall back to.
  let lastHeading = '';
  // Set by a `Table:` line, spent by the table it is written above.
  let pendingCaption = null;

  const flushParagraph = (buf) => {
    if (buf.length) out.push(`<p>${inline(buf.join(' '))}</p>`);
    buf.length = 0;
  };
  const para = [];

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (/^```/.test(line)) {
      flushParagraph(para);
      const lang = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushParagraph(para);
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      lastHeading = h[2].trim();
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flushParagraph(para);
      out.push('<hr>');
      i++;
      continue;
    }

    // blockquote
    if (/^\s*>/.test(line)) {
      flushParagraph(para);
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${markdown(q.join('\n'))}</blockquote>`);
      continue;
    }

    // A caption written above a table: `Table: <text>` on a line of its own.
    //
    // It is consumed here rather than in the table branch so a blank line may sit
    // between the caption and the table, which is how the rest of this subset
    // separates blocks and how anyone writes a caption in an editor. It is only
    // consumed when a table really is the next block, so a `Table:` line that is
    // not above a table stays ordinary prose.
    const captionLine = /^Table:\s+(\S.*)$/.exec(line);
    if (captionLine) {
      let next = i + 1;
      while (next < lines.length && !lines[next].trim()) next++;
      if (tableStartsAt(lines, next)) {
        flushParagraph(para);
        pendingCaption = captionLine[1].trim();
        i++;
        continue;
      }
    }

    // table
    if (tableStartsAt(lines, i)) {
      flushParagraph(para);
      const caption = pendingCaption;
      pendingCaption = null;
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (/:-$/.test(c) ? 'right' : /^:-$|^:-/.test(c) ? 'center' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(splitRow(lines[i++]));
      // Every header cell names its column. `scope="col"` on the one header row
      // is what lets a screen reader say "69 °F, High" instead of "69 °F", and on
      // a table with a single header row it is the whole association: an
      // id/headers pair per cell would be the same information spelled out once
      // per column, and this renderer has exactly one table shape.
      const th = head.map((c, k) => `<th scope="col"${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</th>`).join('');
      const body = rows
        .map((r) => `<tr>${r.map((c, k) => `<td${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<div class="table-wrap"><table>${captionTag(caption, lastHeading)}<thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`);
      continue;
    }

    // lists
    //
    // A line inside an open paragraph does not get to open a list just because
    // it begins with a digit and a period. That is how a wrapped paragraph
    // lost its tail: the body of the Wall That Heals story wraps
    //
    //   The presenting sponsor is American Legion St. Clairsville Post
    //   159. The host committee lists its sponsors in tiers. ...
    //
    // and "159." matched this regex. The renderer then treated the rest of the
    // paragraph as a one-item ordered list, cut the marker out of the sentence
    // so the sponsor read "Post" with no number, and left the remaining tiers
    // in an orphan paragraph. One wrapped line, three visible defects, and the
    // sentence silently disagreed with the Sources block on the same page.
    //
    // CommonMark already draws this line, and the rule is the whole fix: a list
    // may interrupt a paragraph only if it is unordered, or if it is ordered
    // and starts at 1. So while a paragraph is open, an ordered marker is only
    // honoured when it reads "1.". Outside a paragraph, at the top of a block,
    // nothing changes: "3." still opens a list there.
    //
    // The start-at-1 restriction is an ordered-list rule and applies only to
    // ordered markers. An unordered marker interrupts a paragraph whenever its
    // first item is not empty, which is what CommonMark requires and what a
    // writer who leaves off the blank line expects:
    //
    //   The tier list reads as follows, and the tiers are
    //   - Freedom Sponsors, which include Belmont County
    //
    // Gating "1." on the marker test below, rather than on the marker type,
    // inlined those bullets into the sentence above them. So decide whether the
    // line is ordered first, then apply the rule to that answer.
    const orderedMarker = /^\s*\d+\./.test(line);
    const interruptible = para.length === 0 || !orderedMarker || /^\s*1\.\s+/.test(line);
    if (/^\s*([-*+]|\d+\.)\s+/.test(line) && interruptible) {
      flushParagraph(para);
      const ordered = orderedMarker;
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
        // continuation lines
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          items[items.length - 1] += ` ${lines[i++].trim()}`;
        }
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }

    if (!line.trim()) { flushParagraph(para); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flushParagraph(para);
  return out.join('\n');
}

// --------------------------------------------------------- front matter

const PAIR = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/;

// The blogs repo writes two list shapes, and this parser has to read both. A list
// of scalars:
//
//   tags:
//     - weather
//
// and a list of mappings, where the first field rides on the `- ` marker and the
// rest are indented continuation lines:
//
//   sources:
//     - type: document
//       title: "..."
//       retrieved: 2026-10-02
//
// A `- ` marker always opens a new item, and the continuation lines after it
// fill that item. Reading only the marker lines, as this did, turned every
// source into the literal string "type: document" and dropped title,
// organization, retrieved and url, so every published post printed "Document ."
// once per source instead of naming anything.
function parseFrontMatter(text, file) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) fail(`${file} has no front matter block`);
  const data = {};
  let listKey = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (/^\s/.test(raw)) {
      if (!listKey || !Array.isArray(data[listKey])) continue;
      const item = raw.trim();
      if (item === '-') { data[listKey].push({}); continue; }
      if (item.startsWith('- ')) { data[listKey].push(newListItem(item.slice(2))); continue; }
      pushInline(data, listKey, item);
      continue;
    }
    const km = PAIR.exec(raw);
    if (!km) fail(`${file} has an unparseable front matter line: ${raw.trim()}`);
    const value = km[2].trim();
    if (value === '') {
      data[km[1]] = [];
      listKey = km[1];
      continue;
    }
    listKey = null;
    data[km[1]] = scalar(value);
  }
  return { data, body: m[2] ?? '' };
}

function newListItem(text) {
  const kv = PAIR.exec(text);
  if (!kv) return scalar(text);
  return { [kv[1]]: scalar(kv[2].trim()) };
}

function pushInline(data, listKey, text) {
  const arr = data[listKey];
  const kv = PAIR.exec(text);
  if (!kv) { arr.push(scalar(text)); return; }
  const last = arr[arr.length - 1];
  if (last !== null && typeof last === 'object' && !Array.isArray(last)) {
    last[kv[1]] = scalar(kv[2].trim());
    return;
  }
  arr.push({ [kv[1]]: scalar(kv[2].trim()) });
}

function scalar(v) {
  if (v === '[]') return [];
  const q = /^"(.*)"$/.exec(v) || /^'(.*)'$/.exec(v);
  if (q) return q[1];
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

function fail(msg) {
  process.stderr.write(`build.mjs: ${msg}\n`);
  process.exit(1);
}

// -------------------------------------------------- the body's shape
//
// The gate above checks the front matter: title, date, byline, slug, sources.
// It never looked at the body, and that is how a page shipped that rendered the
// Paperclip document API response instead of the story — 9,711 bytes, a valid
// h1, a valid byline, and the article trapped inside as an escaped string.
// Grace's audit is the argument: the gate catches a bad byline and says nothing
// about a bad body, which is a hole in the same gate.
//
// What this catches, and only this: a body that is a serialized data document
// rather than prose. Concretely, a body that is one JSON object or array and
// nothing else.
//
// The narrowness is deliberate, and it goes to `{` and `[` only rather than to
// every JSON value. A story that opens with a brace, one that opens with a bracket,
// and one that quotes JSON inside a fenced code block are all ordinary journalism,
// and none can trip this: the test is that the ENTIRE body parses as one value, so
// there is no prose left over to be a story. A bare scalar is not refused either,
// because `"a pull quote"` is a normal paragraph opening and a gate that refuses
// pull quotes gets deleted. The publisher of the offending page passed the check on
// its front matter because the front matter was fine — the file is valid YAML
// followed by an API response where markdown should be.
//
// This is a loud failure by design, not a warning. A warning on this shape would
// be reported by nobody and would ship the same page again on the next commit.
function bodyShapeError(body, file) {
  const text = String(body ?? '').trim();
  if (!text) return `${file}: the body is empty. A post with no body does not publish.`;
  if (text[0] !== '{' && text[0] !== '[') return null;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // It starts like JSON and is not JSON. That is a story that opens with a
    // brace, which is allowed, so it is not this gate's business.
    return null;
  }

  // The whole body was one JSON value, so there is no article in it to render.
  const shape = Array.isArray(parsed) ? 'a JSON array' : 'a JSON object';
  const isDocumentResponse = !Array.isArray(parsed)
    && typeof parsed.body === 'string'
    && ('id' in parsed || 'issueId' in parsed || 'companyId' in parsed || 'key' in parsed);

  if (isDocumentResponse) {
    const inner = parsed.body.trim();
    return `${file}: the body is a Paperclip document API response, not the article. `
      + `The post renders as ${shape} and the story is trapped inside it as an escaped string, under the "body" key. `
      + 'The front matter is valid, which is why the page looked like a working post. '
      + 'Write the markdown that is the value of "body" here, and nothing else: no "id", no "companyId", no braces. '
      + `This is where the response was written whole; nothing in this build read the wrong field, because nothing here selects one. `
      + (inner ? `The text is still recoverable from the source file (${inner.length} characters between the "body" quotes).` : '');
  }

  const opener = Array.isArray(parsed) ? 'a bracket' : 'a brace';
  return `${file}: the body is one JSON ${Array.isArray(parsed) ? 'array' : 'object'} with no prose in it, `
    + 'so it is a data document rather than a story. '
    + 'A post body has to be the markdown a reader reads. If this was meant to be prose that opens with '
    + `${opener}, it has to be prose the whole way through, not valid JSON.`;
}

// ------------------------------------------------------------ discovery

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

const contentDir = resolve(opts.content);
let files;
try {
  files = walk(contentDir);
} catch {
  fail(`cannot read content directory ${contentDir}. Run "npm run sync" first, or point --content at belmont-news/blogs/content.`);
}
if (!files.length) fail(`no markdown found under ${contentDir}. An empty site does not publish.`);

const posts = files.map((f) => {
  const rel = f.replace(`${process.cwd()}/`, '');
  const { data, body } = parseFrontMatter(readFileSync(f, 'utf8'), rel);
  const missing = ['title', 'date', 'byline', 'slug', 'sources'].filter((k) => !(k in data));
  if (missing.length) fail(`${rel}: missing required front matter ${missing.join(', ')}`);
  if (!Array.isArray(data.sources) || !data.sources.length) {
    fail(`${rel}: has no sources. An unsourced post does not publish.`);
  }
  // A source the reader cannot name is not a source. This check is what makes a
  // future parser regression loud: the parser once turned every entry into the
  // string "type: document", which passed the length test above and published a
  // page of "Document ." with no name, no body and no retrieval date.
  data.sources.forEach((s, i) => {
    const named = s && typeof s === 'object' && !Array.isArray(s) && String(s.title || '').trim();
    if (!named) fail(`${rel}: sources[${i}] has no title. A source the reader cannot name does not publish.`);
  });
  // A malformed or already-elapsed `expires` stops the build here rather than
  // being ignored downstream. Ignoring it is how a post ends up listed forever,
  // which is the exact defect this rule was added to remove.
  const badExpiry = expiryError(data, rel);
  if (badExpiry) fail(badExpiry);
  // Same for `expired`, which the desk sets when a story stops being true before
  // its window runs out. Held to the same standard on purpose: a misspelled flag
  // that is ignored downstream is a stale story still being served as current.
  const badExpired = expiredError(data, rel);
  if (badExpired) fail(badExpired);
  // The body is checked last, so a post that fails on shape is reported against
  // front matter that is otherwise sound. Order is diagnostic only: the build
  // stops at the first failure either way.
  const badBody = bodyShapeError(body, rel);
  if (badBody) fail(badBody);
  return { file: rel, fm: data, body: body.trim(), url: `${data.date}/${data.slug}/` };
});

posts.sort((a, b) => (b.fm.date || '').localeCompare(a.fm.date || '') || (a.fm.slug).localeCompare(b.fm.slug));

// ------------------------------------------------------- listing expiry
//
// Three surfaces read the post set and each applies its own rule:
//
//   homePage()  the rolling root listing. Expired posts drop off it.
//   feedItems   feed.xml. Expired items drop out of it.
//   sitemap()   every post, expired or not. See the note on that function.
//
// The post's OWN page is written for every post regardless, and every post is
// rendered and copied whether or not it is listed. Expiry is a recency rule for
// a listing. It is not a withdrawal, it is not a correction, and it does not
// make any post's copy true: the desk gate item ruled on BEL-87 owns that and
// this does not substitute for it.
//
// The newsroom day is read from the wall clock, deliberately, and never from
// SOURCE_DATE_EPOCH. CI sets SOURCE_DATE_EPOCH from the commit being deployed, so
// a scheduled rebuild dispatched with no new commit would judge the window
// against the day of the last commit and the front page would stop rolling
// entirely. --newsroom-today pins it so a build can be reproduced and audited.
const NEWSROOM_TODAY = (opts.newsroomToday || calendarDay(Date.now(), NEWSROOM_TZ)).trim();

const { listed: listedPosts } = partition(posts, {
  today: NEWSROOM_TODAY,
  days: opts.listingDays,
});

// A front page with nothing on it is not a quiet outcome, it is the worst one.
// It happens when the archive has a gap wider than the window, for instance if
// nothing is filed over a holiday weekend. The listing falls back to the newest
// posts so the page a reader lands on still shows news, and the build says so
// loudly on stderr and in build-info.json. It does not fail the deploy: stopping
// publication because a listing would be empty is a worse outcome than showing a
// slightly older story, and the gate already refuses to publish a site with no
// posts at all.
//
// The fallback may overrule the window and it may not overrule the desk.
//
// Overruling the window is the whole point: the post is old, and an old post that
// may still be true is a better front page than a blank one, provided the page says
// so. Every fallback card carries a dated flag and the page carries a notice, so the
// reader is told rather than left to work out that the navigation link reading
// "Latest" is a fallback.
//
// Overruling a declared `expired` would be the exact defect this work exists to
// remove, in a new place. `expired:` is not a recency judgement; it is the desk
// saying the story stopped being true on a named day. Resurrecting it onto the front
// page — under "Latest", above the fold, in the feed — because it is merely recent
// is how "the wall stands free and open 24 hours today and tomorrow" gets published
// by the mechanism that was built to stop it. So a post that has declared itself
// expired is never a fallback candidate, and if that leaves the fallback empty the
// front page says it is empty.
const listingWindowEmpty = listedPosts.length === 0;
const fallbackCandidates = posts.filter((p) => p.listing?.declaredExpired !== true);
const fallbackPosts = listingWindowEmpty ? fallbackCandidates.slice(0, opts.listingDays) : [];
const listing = listingWindowEmpty ? fallbackPosts : listedPosts;
// The one case the fallback does not paper over: posts exist, and every one of them
// has declared itself no longer current. Then there is nothing honest to put on the
// front page and it says so, rather than reaching for a post the desk has said is
// false. The archive still publishes in full; only the "Latest" page is empty, and
// it is empty loudly.
const listingEmpty = posts.length > 0 && listing.length === 0;

// Everything that reports on the listing has to report one partition of the
// archive: a post is on the front page or it is not, and the two counts add up
// to the number of posts there are.
//
// That stops being true the moment the fallback runs if the report reuses
// partition()'s `expired` list. The fallback shows the newest posts, and the
// newest posts are by definition the ones furthest out of window, so they are
// already in `expired` while also being the ones on the page. Every post on the
// front page was therefore reported as expired, and listed + expired came to
// more than the number of posts, which is the invariant the archive check in
// test/expiry.test.mjs holds the build to. It only bites on a quiet newsroom
// day, which is exactly when the archive check runs and the build is needed.
//
// So "listed" means on the page from here on, and the reported expiry is the
// complement of the page. This is reporting only: the rendered pages, the feed
// and the sitemap already used `listing` and are untouched, and
// check-listing-stale.mjs reads newsroomToday alone.
const listingUrls = new Set(listing.map((p) => p.url));
const expiredForListing = posts.filter((p) => !listingUrls.has(p.url));

// ------------------------------------------------------------ corrections

// The corrections log is editorial record, not posts. It is read from its own
// directory and rendered at /corrections/, which always exists so the URL is
// stable from the first deploy onwards.
const NEWSROOM = process.env.TZ_FOR_DATES || NEWSROOM_TZ;
const SHIPPED_AT = buildEpochMs(opts.buildEpoch);
const corrections = readCorrections(resolve(opts.corrections));
const postUrls = new Set(posts.map((p) => p.url));

// A correction names the post it corrects. Link it only when that post is in
// this build; a correction can outlive the post it refers to, and a dead link
// in a corrections log is worse than plain text.
//
// The date and slug print with the newsroom's own em dash, so the identifying
// line on the page is character-for-character the `## <date> — <slug>` heading
// in corrections/2026-10.md and a reader can match the two without editing.
function correctionPostRef(e) {
  const url = `${e.postDate}/${e.slug}/`;
  const label = `<time datetime="${esc(e.postDate)}">${esc(e.postDate)}</time> — ${esc(e.slug)}`;
  return postUrls.has(url) ? `<a href="${esc(key(url))}">${label}</a>` : label;
}

// Correction prose goes through inline(), not esc(). A correction quotes the post
// it corrects, and it routinely quotes the words a reader can see on that post:
// a status like `in_progress`, a document slug, an API field name. Rendering it
// with esc() alone printed those backticks as characters, so on 2026-10-03 the
// published log showed the reader 18 literal backticks where 9 code spans should
// have been, while the post it quoted rendered the identical span correctly. The
// two paths diverging is the whole defect, so the entry now uses the same
// renderer the post does rather than a second, narrower one.
//
// inline() escapes before it transforms, so this stays as safe as esc() was, and
// a code span holding markup comes out as text inside <code> rather than as
// markup. The log stays append-only either way: nothing here edits a published
// entry, it renders the bytes the desk already wrote.

// --- one correction, three ways of naming it ------------------------------
//
// The heading a reader navigates by, the id they can link to, and the ordinal
// that keeps two corrections on one post apart are all the same problem: on
// 2026-10-05 the month page rendered six <article class="correction"> whose h2s
// were 3x "Correction (2026-10-02)" and 3x "Correction (2026-10-03)", with no id
// on any of them. A heading list of six identical entries tells a screen-reader
// user nothing, and with no id there was no way to send anyone to one correction
// instead of to the month.
//
// The id is derived from the entry, not from its position, so appending a
// correction never renumbers the ones above it: the ordinal is only added after
// the first entry for a given post on a given correction date. A reader who
// bookmarked the first correction to a post keeps that bookmark when the second
// lands three days later.
//
// All three fields are in the id, not two. A post corrected twice in one month on
// two different dates would otherwise give both entries the same base id, and the
// second link in that post's own Corrections block would open the first entry —
// the exact "reader follows the link and lands on the wrong correction" failure
// the anchor exists to remove.
const correctionSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function correctionId(e) {
  return `correction-${e.postDate}-${e.correctionDate}-${correctionSlug(e.slug)}`;
}

// Pair every entry of a log with the id it publishes under, and with a heading
// that names the claim it corrects.
//
// Two guards, because the month page is the one surface where two entries
// collide in the reader's eye. `used` is belt and braces: two different slugs can
// slugify to the same string (`a_b` and `a-b` both become `a-b`), and a duplicate
// id on one page points two anchors at the first match. `seenLeads` is the one
// that matters for the audit: two corrections on the same post, same date, whose
// claims start with the same words would otherwise render the same heading again,
// which is the defect in its original form. The second one is numbered rather
// than left to look identical.
const CORRECTION_LEAD_MAX = 140;

// What a reader needs to tell two corrections apart, taken from the entry itself:
// the desk's own "what was wrong / what is right" separator means the text before
// the first ` / ` is the claim being corrected, which is the half that identifies
// it. Long claims are cut at a word boundary. Nothing here restates the
// correction: the full text is still printed in full directly below the heading.
function correctionLead(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  const claim = flat.split(' / ')[0].trim() || flat;
  if (claim.length <= CORRECTION_LEAD_MAX) return claim;
  const cut = claim.slice(0, CORRECTION_LEAD_MAX);
  const at = cut.lastIndexOf(' ');
  return `${(at > 40 ? cut.slice(0, at) : cut).replace(/[\s,;:—-]+$/, '')}…`;
}

function correctionsWithIds(log) {
  const used = new Set();
  const seenLeads = new Set();
  return log.entries.map((e) => {
    let id = correctionId(e);
    for (let n = 2; used.has(id); n += 1) id = `${correctionId(e)}-${n}`;
    used.add(id);
    let lead = correctionLead(e.correction);
    if (seenLeads.has(lead)) {
      let n = 2;
      while (seenLeads.has(`${lead} (${n})`)) n += 1;
      lead = `${lead} (${n})`;
    }
    seenLeads.add(lead);
    return { entry: e, id, lead };
  });
}

function correctionEntry(e, id, lead) {
  const when = `<span class="correction-when">Correction (<time datetime="${esc(e.correctionDate)}">${esc(e.correctionDate)}</time>)</span>`;
  // The permalink's accessible name carries the date and the claim. Every entry
  // on the month page used to be announced as "Permalink to this correction", so
  // the link list a screen reader can pull up was six rows of the same words.
  const name = `Permalink to the ${esc(e.correctionDate)} correction: ${esc(lead)}`;
  return `  <article class="correction" id="${esc(id)}">
    <p class="kicker">${correctionPostRef(e)}</p>
    <h2>
      ${when}
      <span class="correction-lead">${inline(lead)}</span><a class="permalink" href="#${esc(id)}" aria-label="${name}">#</a>
    </h2>
    <p class="correction-text">${inline(e.correction)}</p>
    ${e.publishedIn ? `<p class="correction-meta">Published in: ${esc(e.publishedIn)}</p>` : ''}
    ${e.correctedBy ? `<p class="correction-meta">Corrected by: ${esc(e.correctedBy)}</p>` : ''}
  </article>`;
}

function correctionsIndexPage() {
  const listing = corrections.logs.map((log) => `
  <article class="card corrections-card">
    <h2><a href="${esc(key(correctionsMonthUrl(log.month)))}">${esc(log.title || `Corrections, ${log.month}`)}</a></h2>
    <p class="card-note">${log.entries.length} correction${log.entries.length === 1 ? '' : 's'} on record</p>
  </article>`).join('\n');

  const body = `
<h1 class="page-title">Corrections</h1>
<p class="lede">Every correction Belmont News has published, on one page. A correction is
appended and never deleted, and a correction that is itself wrong stays and gets its own
correction underneath it.</p>
${corrections.logs.length ? `<section class="feed">
${listing}
</section>` : '<p class="empty">No correction has been logged yet. If a number here is ever wrong, the correction is published the same day and listed on this page.</p>'}`;
  return shell({
    title: 'Corrections — Belmont News',
    description: 'Every correction Belmont News has published.',
    body,
    canonical: abs(correctionsIndexUrl),
  });
}

function correctionsMonthPage(log) {
  const body = `
<h1 class="page-title">${esc(log.title || `Corrections, ${log.month}`)}</h1>
${log.standingRule ? `<p class="lede">${esc(log.standingRule)}</p>` : ''}
<section class="corrections-log">
${correctionsWithIds(log).map(({ entry, id, lead }) => correctionEntry(entry, id, lead)).join('\n')}
</section>
<p class="back"><a href="${esc(key(correctionsIndexUrl))}">← All corrections</a></p>`;
  return shell({
    title: `${log.title || `Corrections, ${log.month}`} — Belmont News`,
    description: `Corrections published by Belmont News in ${log.month}.`,
    body,
    canonical: abs(correctionsMonthUrl(log.month)),
  });
}

// --------------------------------------------------------------- output

const base = opts.baseUrl.endsWith('/') ? opts.baseUrl : `${opts.baseUrl}/`;
const key = (p) => (base === '/' ? `/${p}` : `${base}${p}`);
const abs = (p) => `${opts.siteUrl}${key(p)}`;

const posthogKey = process.env.PUBLIC_POSTHOG_KEY || '';
const posthogHost = process.env.PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

function analytics() {
  if (!posthogKey) {
    return `<!-- PostHog: PUBLIC_POSTHOG_KEY is not set, so no analytics script is emitted. -->`;
  }
  return `<script>
  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,o){var e=o.split(".");2==e.length&&(t=t[e[0]],o=e[1]),t[o]=function(){t.push([o].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.apiHost+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;void 0!==a?u=e+a="":u=t,e.__SV=1)}(document);
  posthog.init(${JSON.stringify(posthogKey)},{api_host:${JSON.stringify(posthogHost)}});
</script>`;
}

// The one template every page goes through: the front page, each post, the
// corrections index, each monthly corrections log, and the 404.
//
// The skip link and the target it points at are added here together, on
// purpose. A skip link with no `id` to land on is inert: it looks like the
// defect is fixed, the browser jumps nowhere, and the keyboard user is still
// five tab stops from the article. `<main id="main" tabindex="-1">` is the
// other half. The `tabindex="-1"` is what makes it a real focus move rather
// than a scroll, which is the difference between the link working and doing
// nothing in WebKit. It is not in the tab order, so it adds no sixth stop.
function shell({ title, description, body, canonical, self }) {
  return `<!doctype html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description || '')}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="alternate" type="application/rss+xml" title="Belmont News" href="${esc(key('feed.xml'))}">
<link rel="stylesheet" href="${esc(key('styles.css'))}">
${analytics()}
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>
<header class="masthead">
  <a class="brand" href="${esc(key(''))}">Belmont News</a>
  <p class="tagline">Independent local news for Belmont County, Ohio</p>
  <nav>
    <a href="${esc(key(''))}">Latest</a>
    <a href="${esc(key(correctionsIndexUrl))}">Corrections</a>
    <a href="${esc(key('feed.xml'))}">RSS</a>
    <a href="https://api.weather.gov/zones/forecast/OHZ059">NWS OHZ059</a>
  </nav>
</header>
<main id="main" tabindex="-1">
${body}
</main>
<footer class="site-footer">
  <p>Belmont News. Belmont County, Ohio. Newsroom time zone America/New_York.</p>
  <p>Every claim carries a named on-record source or an on-record document. Corrections are published, never silently applied. <a href="${esc(key(correctionsIndexUrl))}">Read the corrections log</a>.</p>
  <p>Weather source of record: National Weather Service, gridpoint forecast <code>PBZ/50,48</code>, forecast zone <code>OHZ059</code>.</p>
</footer>
</body>
</html>
`;
}

const EDITION_LABEL = { morning: 'Morning edition', evening: 'Evening edition', column: 'Column' };

function sourcesBlock(sources) {
  if (!Array.isArray(sources) || !sources.length) return '';
  const rows = sources.map((s) => {
    const label = s.type === 'human' ? 'On the record' : 'Document';
    const org = s.organization ? ` — ${s.organization}` : '';
    const date = s.retrieved ? `, retrieved ${s.retrieved}` : '';
    const link = s.url ? ` <a class="ext" href="${esc(s.url)}" rel="noopener noreferrer" target="_blank">source${NEW_TAB_HINT}${NEW_TAB_MARK}</a>` : '';
    return `    <li><span class="src-type">${label}</span> ${esc(s.title || '')}${esc(org)}${esc(date)}.${link}</li>`;
  }).join('\n');
  return `<section class="sources">
  <h2>Sources</h2>
  <ul>
${rows}
  </ul>
</section>`;
}

// Each correction in a post's own Corrections block links to its entry in the
// log, not only to the month index. The entry carries an id and a heading, so the
// reader lands on the one correction instead of hunting for it among every other
// entry in the month.
//
// The id is not recomputed here. It is read out of the log this build actually
// rendered, keyed on the post, the correction date and the claim, and the first
// unused match is taken. Recomputing it was the earlier attempt and it had two
// ways to be wrong: it trusted the month page existing rather than the entry
// existing, and it counted ordinals from the post's own list rather than from the
// log's. Either way a reader who followed the link landed on a correction that
// was not theirs — on a page built for the opposite purpose.
//
// No matching entry, no link. The month index stays below either way.
const correctionEntryIndex = (() => {
  const index = new Map();
  for (const log of corrections.logs) {
    for (const { entry, id, lead } of correctionsWithIds(log)) {
      const k = `${entry.postDate}|${entry.slug}|${entry.correctionDate}`;
      if (!index.has(k)) index.set(k, []);
      index.get(k).push({ id, lead, used: false });
    }
  }
  return index;
})();

function correctionLogHref(post, c, usedEntries) {
  const bucket = correctionEntryIndex.get(`${post.fm.date}|${post.fm.slug}|${c.date}`);
  if (!bucket) return null;
  const lead = correctionLead(c.correction);
  const hit = bucket.find((b) => !b.used && b.lead === lead) || bucket.find((b) => !b.used);
  if (!hit) return null;
  hit.used = true;
  usedEntries.push(hit);
  const month = String(c.date || '').slice(0, 7);
  return `${key(correctionsMonthUrl(month))}#${hit.id}`;
}

function correctionsBlock(post, list) {
  if (!Array.isArray(list) || !list.length) return '';
  const usedEntries = [];
  const items = list.map((c) => {
    const href = correctionLogHref(post, c, usedEntries);
    const link = href
      ? ` <a class="correction-log-link" href="${esc(href)}">Open this entry in the corrections log</a>`
      : '';
    return `    <li><strong>Correction (${esc(c.date)}):</strong> ${esc(c.correction)}${link}</li>`;
  }).join('\n');
  return `<section class="corrections">
  <h2>Corrections</h2>
  <ul>
${items}
  </ul>
  <p><a href="${esc(key(correctionsIndexUrl))}">Full corrections log</a></p>
</section>`;
}

// ---------------------------------------------------------- the age notice
//
// Three reader-facing surfaces serve a post that is not current, and before this
// none of them said so:
//
//   the post's own page      reached by link, bookmark, search, or a shared link
//   the front page card      reached by our own navigation, labelled "Latest"
//   feed.xml                 reached by a feed reader that already fetched it
//
// Only the first was reachable, and it was the loudest failure: a reader who
// followed a link to "The Wall That Heals closes Sunday at the Belmont County
// Fairgrounds" on Monday the 5th was told the wall "stands free and open 24
// hours today and tomorrow" and that a reader "can still go tonight". The exhibit
// shut Sunday the 4th at 14:00. The page was not withdrawn, and it should not be
// — the archive is the record — but it also made a claim about the present that
// was false, and a valid h1 and a valid byline made it look like a working post.
//
// So this is one notice, stated three times, in three lengths.
//
// The wording is doing a specific job, and it is not "label the page". A reader
// needs four things, and a banner that supplies one of them is a third silent
// success:
//
//   1. WHICH DAY this stopped being current. A date, not "this is old".
//   2. WHAT KIND it is, because the two are different facts and a reader acts on
//      them differently. Out of window is a statement about the calendar: the
//      story may still be perfectly true. Declared expired is a statement about
//      the story: it is no longer true.
//   3. WHAT TO DO INSTEAD. Check the source named at the foot of the page. Every
//      post in this archive carries named sources, so the instruction is always
//      actionable.
//   4. THAT THIS PAGE PROMISES NOTHING GOING FORWARD. The weather roundup in the
//      archive already works this way and it is the pattern to copy: "an empty
//      alert response is a statement about the moment of retrieval, not a
//      standing guarantee." The notice makes the same move for dates and hours,
//      so it cannot go stale in the way the story it sits above already did.
//
// Nothing here decides whether a post is stale. It reports a decision the build
// has already made — the window in scripts/expiry.mjs, and the desk's own
// `expired:` when it is set — and tells the reader. Changing the copy of a story
// is the desk's call, not this build's.

// Why this post is not current, or null when it is.
//
// The build already knows both answers before a page is written. It states them
// here so the notice, the card flag, the feed and build-info.json cannot disagree
// about the same post.
function staleness(p) {
  const reason = p.listing?.reason || null;
  const declaredDay = p.listing?.declaredDay || null;
  const declared = p.listing?.declaredExpired === true;
  if (declared) {
    return { kind: 'expired', declaredDay, since: declaredDay || null };
  }
  if (reason) {
    return { kind: 'out-of-window', declaredDay: null, since: p.listing.expires || null };
  }
  return null;
}

// The long form, on the post's own page. Rendered above the body and below the
// byline: low enough that the headline still leads, high enough that it is the
// first thing read before the first present-tense sentence.
function ageNotice(p) {
  const s = staleness(p);
  if (!s) return '';
  const published = publicationDay(p.fm);

  if (s.kind === 'expired') {
    const head = s.since
      ? `This story stopped being current on <time datetime="${esc(s.since)}">${esc(s.since)}</time>.`
      : 'This story is no longer current.';
    const because = s.since
      ? `Published <time datetime="${esc(published)}">${esc(published)}</time>, and its subject ended on
         <time datetime="${esc(s.since)}">${esc(s.since)}</time>. Every hour, place and date below
         describes that day and not this one.`
      : `Published <time datetime="${esc(published)}">${esc(published)}</time> and marked no longer
         current by the newsroom. The newsroom has not given a single day for it, so treat
         everything below as the state of things on the publication date.`;
    return `<aside class="age-notice" role="note" aria-label="This story is no longer current">
  <p class="age-notice-head">${head}</p>
  <p>${because}</p>
  <p>The text is left exactly as published, because it is the record of what Belmont News
  said. Nothing on this page is a standing claim about today. If you are deciding something on
  the strength of it, ${sourcesPrompt(p)}</p>
</aside>`;
  }

  return `<aside class="age-notice" role="note" aria-label="This story is in the archive">
  <p class="age-notice-head">This is the archive, not the news.</p>
  <p>Published <time datetime="${esc(published)}">${esc(published)}</time>. The front page carries
  only the last ${esc(opts.listingDays)} news days, so this story has aged out of it. It may still be
  accurate; it is simply no longer what the newsroom is reporting.</p>
  <p>Every date, time and place below is what was true on
  <time datetime="${esc(published)}">${esc(published)}</time>, written down that day, and it is not
  updated afterwards. Nothing on this page is a standing claim about today. If you are deciding
  something on the strength of it, ${sourcesPrompt(p)}</p>
</aside>`;
}

// "the source named at the foot of this page", phrased as a link when the post has
// named sources to link to. Every post in the archive has to, or the build stops,
// so this is never a dead end — but it degrades to plain text rather than
// producing a link to nowhere if the shape ever changes.
function sourcesPrompt(p) {
  const n = Array.isArray(p.fm.sources) ? p.fm.sources.length : 0;
  if (!n) return 'check the source this story names before you act on it.';
  const one = n === 1;
  return `check ${one ? 'the source named' : 'the sources named'} at the foot of this page before you act on it.`;
}

// The short form, on a front-page card. One line, dated, linking to the long form
// on the post's own page.
//
// This exists because of the fallback path, and that is the whole reason it is
// here. When no post falls inside the listing window the build fills the front
// page with the newest posts so it is not blank — a decision that was already made
// and is still correct — and those posts are, by construction, all out of window.
// They were therefore the least signalled posts on the site: not in the listing by
// the window's own rule, yet on the front page under a navigation link reading
// "Latest". The instance a reader hits first was the least marked one.
function ageFlag(p) {
  const s = staleness(p);
  if (!s) return '';
  const label = s.kind === 'expired'
    ? (s.since ? `No longer current since ${s.since}` : 'No longer current')
    : `From the archive, published ${publicationDay(p.fm)}`;
  return ` <span class="age-flag">${esc(label)}</span>`;
}

// The front page's own notice, when the fallback is running.
//
// Every card below is flagged, so this is not strictly needed. It is here because
// the fallback changes the meaning of the page as a whole, not of any one card: the
// heading says "Latest" and on this day nothing here is latest. Saying that once,
// at the top, is what stops the page from reading as current news with footnotes.
function listingNotice() {
  if (!listingWindowEmpty) return '';
  if (listingEmpty) {
    return `<aside class="age-notice age-notice-listing" role="note" aria-label="No story is current">
  <p class="age-notice-head">Nothing on this page is current.</p>
  <p>Every story in the archive has been marked no longer current by the newsroom, so
  there is nothing to show under <strong>Latest</strong>. The archive itself is unchanged
  and every story is still where it was, with its publication date and its sources.</p>
</aside>`;
  }
  return `<aside class="age-notice age-notice-listing" role="note" aria-label="Nothing has been filed inside the listing window">
  <p class="age-notice-head">Nothing has been filed inside the listing window for
  <time datetime="${esc(NEWSROOM_TODAY)}">${esc(NEWSROOM_TODAY)}</time>.</p>
  <p>The front page carries the last ${esc(opts.listingDays)} news days, counting a post's own day.
  No post falls inside that window today, so this page is showing the
  ${esc(fallbackPosts.length)} newest ${fallbackPosts.length === 1 ? 'story' : 'stories'} in the archive
  instead. Each one is dated below.</p>
  <p>These are not the current news, and this site does not present them as such anywhere else.
  Each story's own page carries its publication date and the sources it rests on.</p>
</aside>`;
}

function postPage(p) {
  const fm = p.fm;
  const body = `
<article class="post">
  <p class="kicker">${esc(EDITION_LABEL[fm.edition] || fm.edition || 'News')}${fm.column ? ` · ${esc(fm.column)}` : ''}</p>
  <h1>${esc(fm.title)}</h1>
  ${fm.dek ? `<p class="dek">${esc(fm.dek)}</p>` : ''}
  <p class="byline">By <strong>${esc(fm.byline)}</strong> · <time datetime="${esc(fm.date)}">${esc(fm.date)}</time></p>
  ${ageNotice(p)}
  <div class="post-body">
${markdown(p.body)}
  </div>
  ${correctionsBlock(p, fm.corrections)}
  ${sourcesBlock(fm.sources)}
</article>
<p class="back"><a href="${esc(key(''))}">← All posts</a></p>`;
  return shell({
    title: `${fm.title} — Belmont News`,
    description: fm.dek,
    body,
    canonical: abs(p.url),
  });
}

// The rolling root listing. It renders `listing`, not `posts`: a post that has
// aged out is no longer "Latest", so it is no longer a card here. Its own page
// still exists, and it is still in sitemap.xml, so nothing a reader can reach
// disappears and nothing a search engine was promised is withdrawn.
//
// One exception to "a post that has aged out is not a card here", and it is the
// fallback below: when nothing falls inside the window, the newest posts are shown
// anyway so the page is not blank. Every card is then dated and flagged, and the
// page carries a notice saying the whole listing is archive. The fallback is the
// right answer to an empty front page and the wrong answer to a front page that
// claims to be current news, so it gets both.
//
// The heading says "Latest" either way. When the window came up empty and the
// fallback filled the page, the build warns on stderr and records
// `listing.fallback` in build-info.json, and the notice above the cards comes
// from listingNotice(). The warning and the record are how the build says so out
// loud; they are in addition to the notice, not instead of it.
function homePage() {
  const cards = listing.map((p) => `
  <article class="card">
    <p class="kicker">${esc(EDITION_LABEL[p.fm.edition] || p.fm.edition || 'News')}${p.fm.column ? ` · ${esc(p.fm.column)}` : ''} · <time datetime="${esc(p.fm.date)}">${esc(p.fm.date)}</time>${ageFlag(p)}</p>
    <h2><a href="${esc(key(p.url))}">${esc(p.fm.title)}</a></h2>
    ${p.fm.dek ? `<p class="dek">${esc(p.fm.dek)}</p>` : ''}
    <p class="byline">By ${esc(p.fm.byline)}</p>
  </article>`).join('\n');

  const body = `
<h1 class="page-title">Belmont News</h1>
<p class="lede">Independent local news for Belmont County, Ohio. Morning edition at 06:00, evening edition at 20:00, America/New_York.</p>
${listingNotice()}
${listing.length ? `<section class="feed">
${cards}
</section>` : '<p class="empty">No story is current. The archive is below the fold of the search engines and every story still resolves at its own address.</p>'}`;
  return shell({ title: 'Belmont News — Belmont County, Ohio', description: 'Independent local news for Belmont County, Ohio.', body, canonical: abs('') });
}

// -------------------------------------------------------------- feed

// Each post gets one publication instant, decided in scripts/dates.mjs and
// printed in build-info.json so a reader or a reporter can audit it.
//
// The rule that matters: an item is never dated after this build shipped. The
// newsroom files tomorrow's 06:00 edition the evening before, so a stamp taken
// from the calendar date alone lands up to a day in the future, and a feed
// reader treats a future item as unreadable. Clamping to the build instant is
// also the honest answer to "when did this reach the reader".
//
// The rule that also matters: the offset is never written down. -04:00 is right
// until 2026-11-01 and wrong forever after. The instant is resolved against the
// America/New_York tz database at build time, so the EST change is a tzdata
// update and not a code change.
// The feed carries the listed posts only. Two things are true about dropping an
// item and both belong in the same comment, because the second is the one that
// gets over-claimed:
//
//   1. The feed stops advertising it. A reader arriving by feed sees the last two
//      news days, not everything the archive has ever held.
//   2. This is not a retraction and cannot be. RSS 2.0 has no way to withdraw an
//      item, and this feed's `guid` is the permalink, which does not change. A
//      reader's reader has already fetched any item it drops here and will keep
//      it. Dropping the item from the forward-looking feed takes nothing away
//      from anyone who already has it.
//
// The page itself is untouched, so the permalink in every already-delivered guid
// still resolves.
const feedItems = listing
  .map((p) => ({ post: p, publishedAt: publicationInstant(p.fm, SHIPPED_AT, NEWSROOM) }))
  .sort((a, b) => b.publishedAt - a.publishedAt
    || (b.post.fm.date || '').localeCompare(a.post.fm.date || '')
    || a.post.fm.slug.localeCompare(b.post.fm.slug));

function feed() {
  const items = feedItems.map(({ post: p, publishedAt }) => `  <item>
    <title>${esc(p.fm.title)}</title>
    <link>${esc(abs(p.url))}</link>
    <guid isPermaLink="true">${esc(abs(p.url))}</guid>
    <pubDate>${new Date(publishedAt).toUTCString()}</pubDate>
    <author>${esc(p.fm.byline)}</author>
    <category>${esc(p.fm.category || 'news')}</category>${staleness(p) ? '\n    <category>archive</category>' : ''}
    <description>${esc(p.fm.dek || '')}</description>
  </item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Belmont News</title>
  <link>${esc(opts.siteUrl)}/</link>
  <atom:link href="${esc(abs('feed.xml'))}" rel="self" type="application/rss+xml" />
  <description>Independent local news for Belmont County, Ohio.</description>
  <language>en-us</language>
  <lastBuildDate>${new Date(SHIPPED_AT).toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`;
}

// The sitemap lists every post, listed or not. It is the one surface of the four
// that the expiry rule deliberately does not touch, and the reasoning is worth
// keeping next to the code:
//
// A `sitemap.xml` entry is a standing claim to a search engine that this URL is
// current and worth indexing. Ageing a front-page listing is not a statement
// about the page, so withdrawing the sitemap entry would be a different act than
// the one this rule performs. Yesterday's three-day weather roundup is still the
// correct answer to "what was the forecast yesterday?", and deindexing it would
// destroy that answer for no reader benefit.
//
// There is also a hard fact underneath the judgment. GitHub Pages is the live
// host, and it cannot emit HTTP 410: it serves 301 and 302 and nothing else. So
// a build that withdrew expired pages could not honour the withdrawal on the
// host the site actually runs on, and promising a 410 the host cannot keep is
// the same lie as the 404 this is avoiding, with a more respectable status code.
//
// If the desk later rules that expired pages are withdrawn rather than aged out,
// that is a new issue and it needs a mechanism decided there: this host's
// redirect story, and whether a withdrawn URL is served a 404 body or moved.
// The latest date a corrections page actually prints, for `lastmod`.
//
// This was `log.entries[0]`, and the log is append-only, so entries[0] is the
// OLDEST entry rather than the newest. On 2026-10-03 three corrections were
// appended under the three that were already there and the value stayed pinned
// to 2026-10-02, so a crawler reading the sitemap was told the corrections page
// had not changed since the day before the two superseding corrections landed on
// it. A corrections log a search engine cannot be told to re-read is not doing
// its job, and the entries it was hiding are the ones explicitly marked
// superseded. BEL-137.
//
// Both dates count because both are printed on the page: it changes when a
// correction is appended, and when an entry names a later-dated post. ISO dates
// compare correctly as strings, so the max is the max.
//
// '' means say nothing. `lastmod` is optional in the sitemap protocol, and an
// invented date is worse than an absent one: the old fallback was the month,
// `2026-10`, a partial date many parsers reject or coerce. A log with no
// corrections has no modification date to report, so the element is omitted
// rather than guessed at.
function lastPrintedDate(dates) {
  return dates.reduce((newest, d) => (d && d > newest ? d : newest), '');
}

function logLastmod(log) {
  return lastPrintedDate(log.entries.flatMap((e) => [e.correctionDate, e.postDate]));
}

function sitemap() {
  const urls = [
    { loc: abs(''), lastmod: '' },
    ...posts.map((p) => ({ loc: abs(p.url), lastmod: p.fm.date })),
    // The index is as current as the newest entry on any month page beneath it,
    // so it takes the newest date across every log rather than the newest log's
    // month.
    { loc: abs(correctionsIndexUrl), lastmod: lastPrintedDate(corrections.logs.map(logLastmod)) },
    ...corrections.logs.map((log) => ({ loc: abs(correctionsMonthUrl(log.month)), lastmod: logLastmod(log) })),
  ].map((u) => `  <url>
    <loc>${esc(u.loc)}</loc>
    ${u.lastmod ? `<lastmod>${esc(u.lastmod)}</lastmod>` : ''}
  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

if (opts.check) {
  process.stdout.write(`build.mjs: ${posts.length} post(s) valid, nothing written (--check)\n`);
  process.stdout.write(`build.mjs: newsroom today ${NEWSROOM_TODAY}, listing window ${opts.listingDays} day(s), ${listing.length} listed, ${expiredForListing.length} expired\n`);
  for (const p of posts) {
    const mark = listingUrls.has(p.url)
      ? (staleness(p) ? `listed* ${p.listing.reason || 'fallback'}` : 'listed  ')
      : `expired ${p.listing.reason || p.listing.expires}`;
    process.stdout.write(`build.mjs:   ${mark}  ${p.url}  ${p.fm.byline}  ${p.fm.title.slice(0, 60)}\n`);
  }
  if (listing.some((p) => staleness(p))) {
    process.stdout.write(`build.mjs:   listed* is on the page as a fallback and carries a dated notice; it is not current news\n`);
  }
  if (corrections.logs.length) {
    process.stdout.write(`build.mjs: ${corrections.logs.length} corrections log(s) valid\n`);
    for (const log of corrections.logs) {
      process.stdout.write(`build.mjs:   ${correctionsMonthUrl(log.month)}  ${log.entries.length} correction(s)\n`);
    }
  } else {
    process.stdout.write(`build.mjs: no corrections log found under ${corrections.dir} (the page still builds)\n`);
  }
  process.exit(0);
}

const outDir = resolve(opts.out);
mkdirSync(outDir, { recursive: true });
for (const p of posts) {
  const dir = join(outDir, p.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), postPage(p));
}
writeFileSync(join(outDir, 'index.html'), homePage());
writeFileSync(join(outDir, 'feed.xml'), feed());
writeFileSync(join(outDir, 'sitemap.xml'), sitemap());
mkdirSync(join(outDir, correctionsIndexUrl), { recursive: true });
writeFileSync(join(outDir, correctionsIndexUrl, 'index.html'), correctionsIndexPage());
for (const log of corrections.logs) {
  mkdirSync(join(outDir, correctionsMonthUrl(log.month)), { recursive: true });
  writeFileSync(join(outDir, correctionsMonthUrl(log.month), 'index.html'), correctionsMonthPage(log));
}
writeFileSync(join(outDir, '404.html'), shell({
  title: 'Not found — Belmont News',
  body: '<h1 class="page-title">Not found</h1><p class="lede">That page is not here. <a href="/">Go to the front page</a>.</p>',
  canonical: abs('404.html'),
}));

// The commit of the markdown store this build rendered, read from the manifest
// sync-content.mjs writes. It is the one field that answers "is the live site
// current?", which is the question a blogs merge leaves open: the store is the
// source of truth and this repository is not, so a merge lands here without
// touching Git history anywhere an operator would look.
//
// The manifest is rewritten by every sync and never committed back, so this is
// the value for the content in this build and not a stale snapshot of it. A
// build from a plain directory with no manifest beside it reports null, which
// reads as "unknown" rather than as a claim that it is current.
const synced = (() => {
  try {
    const m = JSON.parse(readFileSync(join(HERE, '.content-synced.json'), 'utf8'));
    return { source: m.source ?? null, head: m.sourceHead ?? null, syncedAt: m.syncedAt ?? null };
  } catch {
    return { source: null, head: null, syncedAt: null };
  }
})();

// The build report carries the corrections file by name, the exact feed
// timestamps it emitted, and the markdown commit it rendered, so a reporter
// checking the live site can see what this build read and what it published
// without reading a build log.
writeFileSync(join(outDir, 'build-info.json'), `${JSON.stringify({
  generated: new Date().toISOString(),
  buildEpoch: SHIPPED_AT,
  timezone: NEWSROOM,
  siteTitle: opts.title,
  siteUrl: opts.siteUrl,
  posthogEnabled: Boolean(posthogKey),
  contentSource: synced.source,
  contentHead: synced.head,
  contentSyncedAt: synced.syncedAt,
  posts: posts.length,
  contentFiles: files.length,
  // The listing window this build judged against. `newsroomToday` is what the
  // scheduled staleness check in scripts/check-listing-stale.mjs reads: it is
  // the field that lets the front page roll on a day when nothing was committed.
  // Without it the listing would only ever move when someone happened to push.
  listing: {
    newsroomToday: NEWSROOM_TODAY,
    windowDays: opts.listingDays,
    listed: listing.length,
    expired: expiredForListing.length,
    fallback: listingWindowEmpty,
    // True when the fallback had nothing honest left to show: every post has
    // declared itself no longer current. The front page is empty and says so.
    empty: listingEmpty,
    // Every post stays rendered and stays in the sitemap whatever it says here.
    // This block records the listing decision and nothing else.
    expiredUrls: expiredForListing.map((p) => `/${p.url}`),
    // Why each post is on or off the page, per post. `reason` is the field the
    // audits asked for and the one `--check` prints: a post can leave the listing
    // for two different reasons, and until they are told apart "expired" reads as
    // one thing.
    //
    //   out-of-window        aged out of the calendar window. May still be true.
    //   window-override      aged out by its own `expires:` front matter.
    //   declared-expired     aged out because the desk said the story is no longer
    //                        current, which the window would not have caught.
    //   fallback             off the window but ON the page, because nothing
    //                        filed fell inside it. This is the case that had no
    //                        marker at all, on the page a reader lands on first.
    posts: posts.map((p) => {
      const s = staleness(p);
      return {
        url: `/${p.url}`,
        date: p.fm.date,
        listed: listingUrls.has(p.url),
        expires: p.listing.expires,
        reason: p.listing.reason,
        declaredExpired: p.listing.declaredExpired,
        declaredDay: p.listing.declaredDay,
        fallbackListed: listingUrls.has(p.url) && Boolean(s),
        notice: s ? s.kind : null,
      };
    }),
  },
  correctionsDir: relative(HERE, corrections.dir),
  correctionsFiles: corrections.logs.length,
  corrections: corrections.logs.map((log) => ({
    file: `corrections/${log.month}.md`,
    month: log.month,
    url: `/${correctionsMonthUrl(log.month)}`,
    entries: log.entries.length,
    title: log.title,
  })),
  feed: feedItems.map(({ post: p, publishedAt }) => ({
    url: `/${p.url}`,
    date: p.fm.date,
    edition: p.fm.edition || null,
    pubDate: new Date(publishedAt).toUTCString(),
    clampedToBuildEpoch: publishedAt === SHIPPED_AT,
  })),
}, null, 2)}\n`);
copyFileSync(join(HERE, 'static', 'styles.css'), join(outDir, 'styles.css'));
try {
  copyFileSync(join(HERE, 'static', 'robots.txt'), join(outDir, 'robots.txt'));
} catch { /* optional */ }

process.stdout.write(`build.mjs: built ${posts.length} post(s) into ${opts.out}\n`);
for (const p of posts) process.stdout.write(`build.mjs:   ${key(p.url)}  ${p.fm.byline}  ${p.fm.title.slice(0, 60)}\n`);
process.stdout.write(`build.mjs: listing ${listing.length} listed, ${expiredForListing.length} expired, newsroom day ${NEWSROOM_TODAY}, window ${opts.listingDays} day(s)\n`);
for (const p of expiredForListing) process.stdout.write(`build.mjs:   expired ${p.listing.reason} ${p.listing.expires}  ${key(p.url)}\n`);
for (const p of listing.filter((q) => staleness(q))) process.stdout.write(`build.mjs:   listed as fallback, carries a dated notice  ${key(p.url)}\n`);
if (listingWindowEmpty) {
  process.stderr.write(
    `build.mjs: WARNING no post is inside the ${opts.listingDays}-day listing window for newsroom day ${NEWSROOM_TODAY}.\n`
    + (listing.length
      ? `build.mjs: WARNING the front page is showing the ${fallbackPosts.length} newest post(s) as a fallback, each flagged as archive.\n`
      : 'build.mjs: WARNING every post has declared itself no longer current, so the front page has nothing to show. The archive still publishes.\n')
    + 'build.mjs: WARNING every post page and every sitemap entry is unaffected. The archive is the record.\n',
  );
}
process.stdout.write(`build.mjs: corrections ${corrections.logs.length ? `${corrections.logs.length} log(s), ${corrections.logs.reduce((n, l) => n + l.entries.length, 0)} entry(ies) at ${key(correctionsIndexUrl)}` : `none found under ${relative(process.cwd(), corrections.dir)}`}\n`);
process.stdout.write(`build.mjs: feed clock ${new Date(SHIPPED_AT).toUTCString()} ${NEWSROOM}, no item dated later\n`);
process.stdout.write(`build.mjs: analytics ${posthogKey ? 'enabled' : 'disabled (PUBLIC_POSTHOG_KEY unset)'}\n`);