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
npm run sync           # copy markdown from a sibling belmont-news/blogs checkout
npm run serve          # serve dist/ on :8080
npm test               # renderer tests
npm run dev            # build:local then serve
npm run sync -- --from-github EasySchedule/belmont-news-blogs@main
```

`npm run sync` is what makes this repository self-contained. `content/` is a copy
of `belmont-news/blogs/content`; the blogs repository is the source of truth. CI
syncs from GitHub before building so a blog commit publishes without anyone
touching this repository.

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
than publishing an empty site.

## Tests

```
npm test               # node --test, no dependencies
```

The renderer tests build fixtures and read the HTML that comes out, so a field
that stops reaching the page is a failing test and not a silent blank.

## Layout

| Path | What it is |
| --- | --- |
| `build.mjs` | The renderer. Markdown subset, page shells, RSS, sitemap, 404. |
| `content/` | Synced copy of the markdown store. Not edited here. |
| `static/styles.css` | The only stylesheet. Print-first, dark-mode aware, no webfont. |
| `scripts/sync-content.mjs` | Copies or clones the blogs repository into `content/`. |
| `scripts/serve.mjs` | Local static server for checking. Not for production. |
| `netlify.toml` | Netlify free-tier build config and security headers. |
| `.github/workflows/pages.yml` | GitHub Pages publish on every push to `main`. |

## URLs

- Site: `/`
- A post: `/<YYYY-MM-DD>/<slug>/`
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

Push to `main`. GitHub Pages publishes. Netlify deploys the same `dist` from the
same command, so the two hosts render identical HTML. A failing gate stops both,
because the gate runs before the upload step.
