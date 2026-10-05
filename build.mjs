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
import { DEFAULT_LISTING_DAYS, listingExpiry, expiryError, partition } from './scripts/expiry.mjs';

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
    const ext = /^https?:\/\//.test(safe) ? ' rel="noopener noreferrer" target="_blank"' : '';
    return `<a href="${safe}"${ext}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

function markdown(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;

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

    // table
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:-]*-[\s:|-]*$/.test(lines[i + 1])) {
      flushParagraph(para);
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (/:-$/.test(c) ? 'right' : /^:-$|^:-/.test(c) ? 'center' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(splitRow(lines[i++]));
      const th = head.map((c, k) => `<th${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</th>`).join('');
      const body = rows
        .map((r) => `<tr>${r.map((c, k) => `<td${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`);
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
    const interruptible = para.length === 0 || /^1\.\s+/.test(line);
    if (/^\s*([-*+]|\d+\.)\s+/.test(line) && interruptible) {
      flushParagraph(para);
      const ordered = /^\s*\d+\./.test(line);
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
const listingWindowEmpty = listedPosts.length === 0;
const fallbackPosts = listingWindowEmpty ? posts.slice(0, opts.listingDays) : [];
const listing = listingWindowEmpty ? fallbackPosts : listedPosts;

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

function correctionEntry(e) {
  return `  <article class="correction">
    <p class="kicker">${correctionPostRef(e)}</p>
    <h2>Correction (<time datetime="${esc(e.correctionDate)}">${esc(e.correctionDate)}</time>)</h2>
    <p class="correction-text">${inline(e.correction)}</p>
    ${e.publishedIn ? `<p class="correction-meta">Published in: ${esc(e.publishedIn)}</p>` : ''}
    ${e.correctedBy ? `<p class="correction-meta">Corrected by: ${esc(e.correctedBy)}</p>` : ''}
  </article>`;
}

function correctionsIndexPage() {
  const listing = corrections.logs.map((log) => `
  <article class="card corrections-card">
    <h2><a href="${esc(key(correctionsMonthUrl(log.month)))}">${esc(log.title || `Corrections, ${log.month}`)}</a></h2>
    <p class="byline">${log.entries.length} correction${log.entries.length === 1 ? '' : 's'} on record</p>
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
${log.entries.map(correctionEntry).join('\n')}
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
<main>
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
    const link = s.url ? ` <a href="${esc(s.url)}" rel="noopener noreferrer" target="_blank">source</a>` : '';
    return `    <li><span class="src-type">${label}</span> ${esc(s.title || '')}${esc(org)}${esc(date)}.${link}</li>`;
  }).join('\n');
  return `<section class="sources">
  <h2>Sources</h2>
  <ul>
${rows}
  </ul>
</section>`;
}

function correctionsBlock(corrections) {
  if (!Array.isArray(corrections) || !corrections.length) return '';
  const items = corrections.map((c) => `    <li><strong>Correction (${esc(c.date)}):</strong> ${esc(c.correction)}</li>`).join('\n');
  return `<section class="corrections">
  <h2>Corrections</h2>
  <ul>
${items}
  </ul>
  <p><a href="${esc(key(correctionsIndexUrl))}">Full corrections log</a></p>
</section>`;
}

function postPage(p) {
  const fm = p.fm;
  const body = `
<article class="post">
  <p class="kicker">${esc(EDITION_LABEL[fm.edition] || fm.edition || 'News')}${fm.column ? ` · ${esc(fm.column)}` : ''}</p>
  <h1>${esc(fm.title)}</h1>
  ${fm.dek ? `<p class="dek">${esc(fm.dek)}</p>` : ''}
  <p class="byline">By <strong>${esc(fm.byline)}</strong> · <time datetime="${esc(fm.date)}">${esc(fm.date)}</time></p>
  <div class="post-body">
${markdown(p.body)}
  </div>
  ${correctionsBlock(fm.corrections)}
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
// The heading says "Latest" either way. When the window came up empty and the
// fallback filled the page, the build warns on stderr and records
// `listing.fallback` in build-info.json rather than putting a caveat on the front
// page of a newspaper.
function homePage() {
  const cards = listing.map((p) => `
  <article class="card">
    <p class="kicker">${esc(EDITION_LABEL[p.fm.edition] || p.fm.edition || 'News')}${p.fm.column ? ` · ${esc(p.fm.column)}` : ''} · <time datetime="${esc(p.fm.date)}">${esc(p.fm.date)}</time></p>
    <h2><a href="${esc(key(p.url))}">${esc(p.fm.title)}</a></h2>
    ${p.fm.dek ? `<p class="dek">${esc(p.fm.dek)}</p>` : ''}
    <p class="byline">By ${esc(p.fm.byline)}</p>
  </article>`).join('\n');

  const body = `
<h1 class="page-title">Belmont News</h1>
<p class="lede">Independent local news for Belmont County, Ohio. Morning edition at 06:00, evening edition at 20:00, America/New_York.</p>
<section class="feed">
${cards}
</section>`;
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
    <category>${esc(p.fm.category || 'news')}</category>
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
function sitemap() {
  const urls = [
    { loc: abs(''), lastmod: '' },
    ...posts.map((p) => ({ loc: abs(p.url), lastmod: p.fm.date })),
    { loc: abs(correctionsIndexUrl), lastmod: corrections.logs[0]?.month || '' },
    ...corrections.logs.map((log) => ({ loc: abs(correctionsMonthUrl(log.month)), lastmod: log.entries[0]?.correctionDate || log.month })),
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
    const mark = listingUrls.has(p.url) ? 'listed  ' : `expired ${p.listing.expires}`;
    process.stdout.write(`build.mjs:   ${mark}  ${p.url}  ${p.fm.byline}  ${p.fm.title.slice(0, 60)}\n`);
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
    // Every post stays rendered and stays in the sitemap whatever it says here.
    // This block records the listing decision and nothing else.
    expiredUrls: expiredForListing.map((p) => `/${p.url}`),
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
for (const p of expiredForListing) process.stdout.write(`build.mjs:   expired ${p.listing.expires} (${p.listing.from})  ${key(p.url)}\n`);
if (listingWindowEmpty) {
  process.stderr.write(
    `build.mjs: WARNING no post is inside the ${opts.listingDays}-day listing window for newsroom day ${NEWSROOM_TODAY}.\n`
    + `build.mjs: WARNING the front page is showing the ${fallbackPosts.length} newest post(s) as a fallback.\n`
    + 'build.mjs: WARNING every post page and every sitemap entry is unaffected. The archive is the record.\n',
  );
}
process.stdout.write(`build.mjs: corrections ${corrections.logs.length ? `${corrections.logs.length} log(s), ${corrections.logs.reduce((n, l) => n + l.entries.length, 0)} entry(ies) at ${key(correctionsIndexUrl)}` : `none found under ${relative(process.cwd(), corrections.dir)}`}\n`);
process.stdout.write(`build.mjs: feed clock ${new Date(SHIPPED_AT).toUTCString()} ${NEWSROOM}, no item dated later\n`);
process.stdout.write(`build.mjs: analytics ${posthogKey ? 'enabled' : 'disabled (PUBLIC_POSTHOG_KEY unset)'}\n`);