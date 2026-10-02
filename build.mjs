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
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- CLI

const USAGE = `build.mjs - render the Belmont News site

Usage: node build.mjs [options]

  --content <dir>   markdown content directory  (default content)
  --out <dir>       output directory            (default dist)
  --base-url <url>  site base URL path or origin (default /)
  --site-url <url>  canonical origin for feeds  (default http://localhost:8080)
  --title <text>    site title                 (default Belmont News)
  --check           validate only, write nothing
  --help            this text

Environment:
  PUBLIC_POSTHOG_KEY   PostHog project key. When unset, no analytics snippet is
                      emitted at all. The build never fails on a missing key and
                      never hard-codes one.
`;

function parseArgs(argv) {
  const o = { content: 'content', out: 'dist', baseUrl: '/', siteUrl: 'http://localhost:8080', title: 'Belmont News', check: false };
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
    else if (a === '--out') o.out = val();
    else if (a === '--base-url') o.baseUrl = val();
    else if (a === '--site-url') o.siteUrl = val().replace(/\/$/, '');
    else if (a === '--title') o.title = val();
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
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `${codes.length - 1}`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
    const safe = /^(https?:\/\/|\/|#|mailto:)/.test(href) ? href : '#';
    const ext = /^https?:\/\//.test(safe) ? ' rel="noopener noreferrer" target="_blank"' : '';
    return `<a href="${safe}"${ext}>${text}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(\d+)/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return s;
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
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
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

function parseFrontMatter(text, file) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) fail(`${file} has no front matter block`);
  const data = {};
  let key = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim()) continue;
    if (/^\s/.test(raw)) {
      const item = raw.trim();
      if (!key) continue;
      if (!Array.isArray(data[key])) data[key] = [];
      if (item.startsWith('- ')) data[key].push(scalar(item.slice(2)));
      continue;
    }
    const km = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(raw);
    if (!km) fail(`${file} has an unparseable front matter line: ${raw.trim()}`);
    key = km[1];
    data[key] = km[2].trim() === '' ? [] : scalar(km[2].trim());
  }
  return { data, body: m[2] ?? '' };
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
  return { file: rel, fm: data, body: body.trim(), url: `${data.date}/${data.slug}/` };
});

posts.sort((a, b) => (b.fm.date || '').localeCompare(a.fm.date || '') || (a.fm.slug).localeCompare(b.fm.slug));

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
    <a href="${esc(key('feed.xml'))}">RSS</a>
    <a href="https://api.weather.gov/zones/forecast/OHZ059">NWS OHZ059</a>
  </nav>
</header>
<main>
${body}
</main>
<footer class="site-footer">
  <p>Belmont News. Belmont County, Ohio. Newsroom time zone America/New_York.</p>
  <p>Every claim carries a named on-record source or an on-record document. Corrections are published, never silently applied.</p>
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

function homePage() {
  const cards = posts.map((p) => `
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

function feed() {
  const items = posts.map((p) => `  <item>
    <title>${esc(p.fm.title)}</title>
    <link>${esc(abs(p.url))}</link>
    <guid isPermaLink="true">${esc(abs(p.url))}</guid>
    <pubDate>${new Date(`${p.fm.date}T12:00:00-04:00`).toUTCString()}</pubDate>
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
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`;
}

function sitemap() {
  const urls = ['', ...posts.map((p) => p.url)].map((u) => `  <url>
    <loc>${esc(abs(u))}</loc>
    ${u ? `<lastmod>${esc(posts.find((p) => p.url === u).fm.date)}</lastmod>` : ''}
  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

if (opts.check) {
  process.stdout.write(`build.mjs: ${posts.length} post(s) valid, nothing written (--check)\n`);
  for (const p of posts) process.stdout.write(`build.mjs:   ${p.url}  ${p.fm.byline}  ${p.fm.title.slice(0, 60)}\n`);
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
writeFileSync(join(outDir, '404.html'), shell({
  title: 'Not found — Belmont News',
  body: '<h1 class="page-title">Not found</h1><p class="lede">That page is not here. <a href="/">Go to the front page</a>.</p>',
  canonical: abs('404.html'),
}));
writeFileSync(join(outDir, 'build-info.json'), `${JSON.stringify({
  generated: new Date().toISOString(),
  siteTitle: opts.title,
  siteUrl: opts.siteUrl,
  posthogEnabled: Boolean(posthogKey),
  posts: posts.length,
  contentFiles: files.length,
}, null, 2)}\n`);
copyFileSync(join(HERE, 'static', 'styles.css'), join(outDir, 'styles.css'));
try {
  copyFileSync(join(HERE, 'static', 'robots.txt'), join(outDir, 'robots.txt'));
} catch { /* optional */ }

process.stdout.write(`build.mjs: built ${posts.length} post(s) into ${opts.out}\n`);
for (const p of posts) process.stdout.write(`build.mjs:   ${key(p.url)}  ${p.fm.byline}  ${p.fm.title.slice(0, 60)}\n`);
process.stdout.write(`build.mjs: analytics ${posthogKey ? 'enabled' : 'disabled (PUBLIC_POSTHOG_KEY unset)'}\n`);