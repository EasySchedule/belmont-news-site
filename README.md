# belmont-news/site

Renders the markdown store in `belmont-news/blogs` into the Belmont News website.

No framework, no bundler, no runtime dependencies. `npm install` is not required;
the build is one Node script, so the same HTML comes out of Netlify, a GitHub
Pages runner, and a laptop.

## Commands

```
npm run build          # render content/ into dist/, canonical URLs for GitHub Pages
npm run build:local    # same, canonical URLs for http://localhost:8080
npm run check          # validate only, write nothing
npm test               # the feed-clock and corrections-log rules
npm run sync           # copy markdown from a sibling belmont-news/blogs checkout
npm run serve          # serve dist/ on :8080
npm test               # renderer tests
npm run dev            # build:local then serve
npm run sync -- --from-github EasySchedule/belmont-news-blogs@main
```

`npm run sync` is what makes this repository self-contained. `content/` is a copy
of `belmont-news/blogs/content` and `corrections/` is a copy of
`belmont-news/blogs/corrections`; the blogs repository is the source of truth. CI
syncs from GitHub before building so a blog commit publishes without anyone
touching this repository.

## What the sync copies

Two trees, from `belmont-news/blogs`:

| Source in the blogs repo | Lands here | What it is | Gated? |
| --- | --- | --- | --- |
| `content/**/*.md` | `content/` | Posts. | Yes, by `build.mjs`. |
| `corrections/*.md` | `corrections/` | The corrections log, one file per month. | No. |

A corrections log is not an article. It has no front matter, it is not a post,
and it must not be able to fail the sourcing gate, so it is synced and rendered
on a separate path. `corrections/2026-10.md` is the only file name the site
reads: `YYYY-MM.md`, because the month is the URL.

`scripts/sync-content.mjs` writes what it read to `.content-synced.json`,
including `sourceHead` (the blogs commit), `markdownFiles`,
`correctionsFiles` and `correctionsFilesList`. That file is the answer to "which
blogs commit is this site built from, and did the corrections log come with it".

CI does this automatically. `pages.yml` runs
`node scripts/sync-content.mjs --from-github EasySchedule/belmont-news-blogs@main`
before the build, so both trees arrive on every deploy. `npm run sync` with no
arguments finds a sibling `../blogs` checkout; `--from <dir>` takes either the
blogs repository root or its `content/` directory.

A missing `corrections/` directory is not an error. A newsroom that has logged
no correction yet still publishes a working site.

## The corrections log

| URL | What it is |
| --- | --- |
| `/corrections/` | Every log, newest month first. Always built. |
| `/corrections/<YYYY-MM>/` | One month, entry by entry, in the order the log was written. |

`/corrections/` is built on every deploy whether or not a log exists, so the
URL a reader bookmarks never 404s. Both URLs are in the masthead nav, in the
footer, and in `sitemap.xml`. A per-post `corrections:` front matter array still
renders under the post body, and now links to the full log.

The entry format is the newsroom's, and `scripts/corrections.mjs` parses it
strictly:

```
## <post date> — <post slug>

Correction (<YYYY-MM-DD>): <what was wrong> / <what is right>.
Published in: <edition and date>.
Corrected by: <full name>.
```

Nothing is dropped and nothing is split. The ` / ` between what was wrong and
what is right stays inside the sentence, because splitting on it would mangle
any correction that contains a slash. A wrapped line continues the field above
it. Entries keep the order the file has them in, because the log is append-only
and file order is the newsroom's own record.

A correction is linked to its post only when that post is in the same build. A
correction can outlive the post it refers to, and a dead link in a corrections
log is worse than plain text.

`/build-info.json` names the file, its URL and its entry count, so the live site
can be checked without reading a build log:

```json
"correctionsFiles": 1,
"corrections": [
  { "file": "corrections/2026-10.md", "month": "2026-10",
    "url": "/corrections/2026-10/", "entries": 3,
    "title": "Belmont News corrections — October 2026" }
]
```

## Feed timestamps

`/feed.xml` is the reader-facing contract, so its timestamps are held to two rules.

**1. No item is ever dated in the future.** The newsroom files tomorrow's 06:00
edition the evening before. A stamp read off the calendar date alone therefore
lands up to a day ahead of the reader, and feed readers treat a future item as
unreadable. Every `pubDate` is capped at the instant this build shipped, which
is also the honest answer to "when did this reach the reader". `build-info.json`
marks the items that were capped, in `feed[].clampedToBuildEpoch`.

**2. No offset is written down.** `-04:00` is correct until 2026-11-01 and wrong
for the rest of the year when the newsroom moves to EST. `scripts/dates.mjs`
resolves the instant against the `America/New_York` time zone database on the
build machine instead, so the EST change is a tzdata update and not a code
change. Override the zone with `TZ_FOR_DATES`; it takes a zone name, never a
numeric offset.

The instant is decided in this order:

| # | Source | Used when |
| --- | --- | --- |
| 1 | `date` as a full ISO 8601 instant with its own offset, e.g. `2026-10-03T06:00:00-04:00` | The post carries one. Used verbatim, then capped at the build. |
| 2 | The edition clock on the publication day in `America/New_York`: 06:00 for `edition: morning`, 20:00 for `edition: evening` | The usual case today. |
| 3 | Day start, 00:00 local | `edition: column`, which names no clock time of its own. |

Rule 1 is what the `site-architecture` blueprint specifies for `date`, so a post
that adopts it is stamped exactly as written with no change here. Rules 2 and 3
are the floor for the bare `YYYY-MM-DD` that the blogs schema uses today.

The feed is sorted newest first by publication instant, so a post published in
its own edition slot ranks above one that shipped later on the same day.

`lastBuildDate` uses the same clock, which makes the feed reproducible from Git:
CI sets `SOURCE_DATE_EPOCH` from the commit being deployed
(`git log -1 --format=%ct`) and two builds of the same commit emit the same
bytes. `npm run build` locally falls back to the wall clock, and
`--build-epoch <unix-seconds>` sets it explicitly.

## The gate

`build.mjs` refuses to publish a post without sources, and names the file. An
empty source list fails the same way here as it does in `belmont-news/blogs`.
There is no flag to skip it.

It also refuses a source with no title. A source the reader cannot name is not a
source, and this is the check that would have caught the parser defect behind
BEL-45: the front matter parser read only the `- ` marker lines of a `sources:`
block and dropped every continuation line, so each source became the string
`"type: document"` and every published post printed `Document .` in place of its
sources. The length check passed the whole time. That is fixed, and
`npm test` now reads the rendered HTML so it cannot come back.

If the content directory is missing the build fails with the sync command rather
than publishing an empty site. A missing corrections directory does not fail:
that path has no gate and no required content.

## Tests

```
npm test               # node --test, no dependencies
```

The renderer tests build fixtures and read the HTML that comes out, so a field
that stops reaching the page is a failing test and not a silent blank.

`test/build.test.mjs` holds the two rules this build exists to enforce: a
publication instant resolves against the newsroom time zone across both DST
boundaries, and no `pubDate` is ever later than the build. It also pins the
corrections-log parser to the newsroom's format.

## Layout

| Path | What it is |
| --- | --- |
| `build.mjs` | The renderer. Markdown subset, page shells, RSS, sitemap, 404. |
| `scripts/dates.mjs` | Publication instants for the feed. Zone-aware, no hardcoded offset. |
| `scripts/corrections.mjs` | Reads `corrections/YYYY-MM.md` into entries. |
| `content/` | Synced copy of the markdown store. Not edited here. |
| `corrections/` | Synced copy of the corrections log. Not edited here. |
| `static/styles.css` | The only stylesheet. Print-first, dark-mode aware, no webfont. |
| `scripts/sync-content.mjs` | Copies or clones the blogs repository into `content/` and `corrections/`. |
| `scripts/check-blogs-ahead.mjs` | Answers "is the published site behind the markdown store?" and exits 0/1/2. |
| `scripts/serve.mjs` | Local static server for checking. Not for production. |
| `test/build.test.mjs` | The DST and no-future-`pubDate` rules, and the log parser. |
| `test/render.test.mjs` | Builds fixtures and reads the HTML that comes out. |
| `test/publish-drift.test.mjs` | The drift check, including the cases where it must refuse to answer. |
| `netlify.toml` | Netlify free-tier build config and security headers. |
| `.github/workflows/pages.yml` | GitHub Pages publish. The only thing that builds or deploys. |
| `.github/workflows/publish-on-blogs-update.yml` | Scheduled drift check. Dispatches `pages.yml` when the store moves. |
| `.github/workflows/gate.yml` | The same check on every pull request. |

## URLs

- Site: `/`
- A post: `/<YYYY-MM-DD>/<slug>/`
- Corrections log: `/corrections/`, and `/corrections/<YYYY-MM>/` for a month
- RSS 2.0: `/feed.xml` (also at `/rss` by redirect)
- Sitemap: `/sitemap.xml`

## Analytics

PostHog is opt-in and off by default. Set `PUBLIC_POSTHOG_KEY` in the host's
environment and the snippet is emitted. Leave it unset and no analytics script
appears in the HTML at all — the build never fails on a missing key and never
hard-codes one. `PUBLIC_POSTHOG_HOST` overrides the host, default
`https://us.i.posthog.com`.

Check `/build-info.json` on the deployed site to see whether analytics is on.

## Publishing

**The live host is GitHub Pages**, at
<https://easyschedule.github.io/belmont-news-site>. That is the URL the
newsroom verifies. Netlify is configured in `netlify.toml` and builds the same
`dist/` from the same command, but it is not deployed and its host returns 404,
so nothing in the publish path depends on it. See "Hosting" below.

Push to `main` and `pages.yml` publishes. That workflow is the only thing in
this repository that builds or deploys; every other route into publishing ends
by dispatching it.

### A blogs merge publishes the site

The markdown store is a different repository, so a merge to
`belmont-news-blogs` `main` does not push this one and does not fire `pages.yml`
on its own. That gap is closed by `publish-on-blogs-update.yml`, which runs
every 15 minutes:

1. `build.mjs` stamps the store commit it rendered into `/build-info.json`, so
   the published site can say what it is built from.
2. The workflow compares that against the store's current `main`.
3. If they differ, it dispatches `pages.yml`, which rebuilds and redeploys. If
   they match, it does nothing and no deploy is spent.

So a correct merge to the store publishes within about fifteen minutes without
anyone remembering to. Check it at any time:

```
curl -s https://easyschedule.github.io/belmont-news-site/build-info.json | grep contentHead
git ls-remote https://github.com/EasySchedule/belmont-news-blogs.git refs/heads/main
```

Those two agree when the site is current.

The same check runs by hand, which is what to use when a merge has just landed
and the wait is too long:

```
node scripts/check-blogs-ahead.mjs        # 0 current, 1 behind, 2 could not tell
gh workflow run pages.yml --ref main
```

Exit code 2 means the question could not be answered: the store was unreachable,
or the live site was not serving, or the live site predates the `contentHead`
field. That is a failure and the scheduled run goes red on it. It is never
read as "nothing to do", because a silent no-op is the failure this whole
mechanism exists to prevent.

### Hosting

Two hosts are configured and only one is live.

| Host | State | URL |
|---|---|---|
| GitHub Pages | **Live. The verified publish path.** | `https://easyschedule.github.io/belmont-news-site` |
| Netlify | Configured in `netlify.toml`, not deployed, returns 404 | `https://belmont-news.netlify.app` |

Both run `npm run build` and publish `dist/`, so they render identical HTML.
Until Netlify is deployed and its URL is verified, GitHub Pages is production
and `pages.yml` is the publish path. Do not describe a Netlify deploy as done.

A failing gate stops both, because the gate runs before the upload step.

