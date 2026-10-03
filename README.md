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
npm test               # the feed-clock, corrections-log, and listing-window rules
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

Entry prose is rendered as inline markdown by the same renderer a post body uses,
so a correction that quotes the post it corrects quotes it as the reader sees it.
That matters most for backticked constructs: a correction citing a status like
`in_progress`, a document slug, or an API field name renders those as `<code>`,
exactly as the quoted post does, rather than printing the backticks as
characters. A code span holding markup comes out as text inside `<code>`, because
the renderer escapes before it transforms. The log stays append-only either way:
rendering never edits, drops or reorders a published entry.

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

## The rolling listing

The front page is a rolling listing. A post stops being "Latest" when the newsroom
day moves on, whether or not anybody writes anything. Before this, a post dated
2026-09-01 was still on the front page and still in `feed.xml` in October, so
"Latest" meant "everything the archive has ever held".

Three surfaces read the post set. Two of them apply the window and one does not,
deliberately:

| Surface | Expired post |
| --- | --- |
| `/` front page | Drops off the listing. |
| `/feed.xml` | Drops out of the item list. |
| `/sitemap.xml` | **Stays.** Every post is listed, listed or not. |
| `/<date>/<slug>/` | **Stays**, at HTTP 200, with its sources and its corrections. |

### What this is not

**Not a withdrawal.** Ageing a listing is not retracting a story. Yesterday's
three-day weather roundup is still the correct answer to "what was the forecast
yesterday?", and the archive is the record. Nothing a reader can reach disappears,
and nothing a search engine was promised is taken back.

**Not a retraction of the feed.** RSS 2.0 has no way to withdraw an item, and this
feed's `guid` is the permalink, which does not change. A reader's feed reader has
already fetched any item that drops out of the feed and will keep it. Dropping the
item takes nothing away from anyone who already has it, and the page at that
permalink still resolves.

**Not a correction.** Expiring a listing hides a post from the front page. It does
not make any claim in the post's copy true, and it is not a way to remove
something that should not have been published. The desk gate item ruled on BEL-87
owns that, and this rule neither performs nor substitutes for it. Nothing here
touches `index.mjs`'s gates in `belmont-news/blogs`, whose date window stays
forward-only with no backward half, for the reason documented there.

### The window

A post dated D is listed for newsroom days D and D+1, and falls out at 00:00 on
D+2. Two newsroom days is chosen so this rule changes nothing visible on the day
it ships: every post in the archive on 2026-10-03 is inside a two-day window, so
the first deploy strips nothing and the rule only becomes load-bearing once the
archive is older than the window. A one-day window would have emptied the front
page of last night's edition before the 06:00 reader arrived.

Change it with `--listing-days <n>`, per build. The newsroom day is read in
`America/New_York`, not UTC: an instant at 03:00Z is still the previous evening in
Belmont County, and a rule that used the UTC date would roll the listing over
before the newsroom day ended.

### Per-post override

The optional `expires` front matter field replaces the default window for one
post:

```yaml
expires: 2026-10-30
```

It is a plain calendar day in `America/New_York`. A time of day is **refused**,
not truncated: the newsroom changes offset on 2026-11-01, and a rule that picked
one would be right for half the year. An `expires` before the post's own date is
refused too. Both are refused in this build and in `belmont-news/blogs`, so a bad
value fails at the pull request that introduced it as well as at deploy time.
The field is declared in that repository's `schema.json`, which is what stops
`additionalProperties: false` from rejecting a post that uses it.

### The listing rolls on its own

A listing that ages out on a calendar boundary needs a build on that boundary. The
store-drift check cannot provide one: it compares the markdown commit against the
commit the live site says it rendered, and on a quiet newsroom day those are equal,
so it exits 0 and nothing publishes — while the front page sits there showing
yesterday's edition to everyone who came for the 06:00 one.

So `scripts/check-listing-stale.mjs` reads `listing.newsroomToday` out of the live
`build-info.json` and compares it with the day in `America/New_York` now, and
`publish-on-blogs-update.yml` runs it on the same fifteen-minute schedule. It is a
lookup rather than an inference, and it needs no token: the site is public. Like
the drift check it uses the exit-code contract `0` current, `1` publish, `2` could
not tell, and `2` is a red run rather than a quiet no-op.

```
node scripts/check-listing-stale.mjs    # 0 current, 1 stale, 2 could not tell
```

**`SOURCE_DATE_EPOCH` deliberately does not drive the window.** CI sets it from the
commit being deployed, so a scheduled rebuild dispatched with no new commit would
judge the window against the day of the last commit and the front page would freeze.
The listing reads the clock, the same way the clock is read inside the build.

### When the window comes up empty

The window can come up empty when the archive has a gap wider than it, for
instance if nothing is filed over a holiday weekend. The front page is the worst
place to publish a blank, so the listing falls back to the newest posts, the build
warns on stderr, and `build-info.json` records `listing.fallback: true`. It does not
fail the deploy: refusing to publish because a listing would be empty is worse than
showing a slightly older story, and the gate already refuses to publish a site with
no posts at all. Every post page and every sitemap entry is unaffected either way.

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

`test/expiry.test.mjs` covers the listing window end to end, with the newsroom day
pinned so it does not depend on the day the suite runs. The assertions that matter
most are the ones protecting a reader: an expired post must still have its page, its
sources and its sitemap entry, and `sitemap.xml` must come out byte-identical on a
day when the listing differs. One test pins the window to the wall clock rather
than `SOURCE_DATE_EPOCH`, because the regression there is silent — the build
succeeds and the front page simply stops rolling.

`test/listing-stale.test.mjs` covers the check that keeps the listing moving,
including the cases where it must exit 2 rather than report that there is nothing
to do. A check that answered 0 when it could not read the site would freeze the
front page and still report green every fifteen minutes.

## Layout

| Path | What it is |
| --- | --- |
| `build.mjs` | The renderer. Markdown subset, page shells, RSS, sitemap, 404. |
| `scripts/dates.mjs` | Publication instants for the feed. Zone-aware, no hardcoded offset. |
| `scripts/expiry.mjs` | The listing window: which posts are still "Latest", and the `expires` override. |
| `scripts/corrections.mjs` | Reads `corrections/YYYY-MM.md` into entries. |
| `content/` | Synced copy of the markdown store. Not edited here. |
| `corrections/` | Synced copy of the corrections log. Not edited here. |
| `static/styles.css` | The only stylesheet. Print-first, dark-mode aware, no webfont. |
| `scripts/sync-content.mjs` | Copies or clones the blogs repository into `content/` and `corrections/`. |
| `scripts/check-blogs-ahead.mjs` | Answers "is the published site behind the markdown store?" and exits 0/1/2. |
| `scripts/check-listing-stale.mjs` | Answers "was the front page built for an earlier newsroom day?" and exits 0/1/2. |
| `scripts/serve.mjs` | Local static server for checking. Not for production. |
| `test/build.test.mjs` | The DST and no-future-`pubDate` rules, and the log parser. |
| `test/render.test.mjs` | Builds fixtures and reads the HTML that comes out. |
| `test/expiry.test.mjs` | The listing window, and the four surfaces it does and does not touch. |
| `test/publish-drift.test.mjs` | The drift check, including the cases where it must refuse to answer. |
| `test/listing-stale.test.mjs` | The listing-staleness check, and its refusal cases. |
| `netlify.toml` | Netlify free-tier build config and security headers. |
| `.github/workflows/pages.yml` | GitHub Pages publish. The only thing that builds or deploys. |
| `.github/workflows/publish-on-blogs-update.yml` | Scheduled checks. Dispatches `pages.yml` when the store moves or the listing day turns over. |
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

### The listing rolls without a commit

The front page is a rolling listing, so it also needs a publish on days when
nobody commits anything. `publish-on-blogs-update.yml` runs two checks on its
fifteen-minute schedule, because the site can be behind for two unrelated reasons:

1. `check-blogs-ahead.mjs` — the markdown store moved. Compares the store's `main`
   against the `contentHead` the live site reports.
2. `check-listing-stale.mjs` — the newsroom day moved. Compares
   `listing.newsroomToday` the live site reports against the day in
   `America/New_York` now.

Either one dispatches `pages.yml`, through a single dispatch job, so a morning
that is both behind on content and a day old in the listing still spends one
deploy. `pages.yml` remains the only thing in this repository that builds or
deploys.

Without the second check the failure is quiet and easy to miss: on a day when
nothing was filed, the store head matches the published head, the drift check
exits 0, and the front page keeps serving yesterday's edition to every reader who
came for the 06:00 one. Nothing is red anywhere.

```
node scripts/check-blogs-ahead.mjs      # 0 current, 1 behind, 2 could not tell
node scripts/check-listing-stale.mjs    # 0 current, 1 stale, 2 could not tell
```

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

