#!/usr/bin/env node
// publish-now.mjs - ask pages.yml to run, and then prove that it did.
//
//   GITHUB_TOKEN=... PUBLISH_REPO=owner/name node scripts/publish-now.mjs
//   WORKFLOW=pages.yml REF=main ATTEMPTS=3 WAIT=45 node scripts/publish-now.mjs
//
// Exit codes, matching check-blogs-ahead.mjs so the two probes read alike:
//
//   0  a run of the publish workflow was dispatched AND a run of it now exists.
//   1  no run of the publish workflow could be got to exist. This is a failure.
//   2  the request could not be carried out. Also a failure, not "nothing to do".
//
// Why the second half is here at all, because a dispatch that only asks is the
// defect BEL-335 is about. The Actions API answers the dispatch endpoint with 204
// and a body that says nothing: 204 means "accepted for processing", not "will
// run". Nothing in the response names a run, so `gh workflow run` exiting 0 was
// the only evidence the probe had, and the only evidence its summary printed.
//
// That is the whole gap. Between "the store moved" and "a reader sees the new
// edition" sit two facts nobody asserted: that a request left, and that a deploy
// began. This script asserts both or it fails. A probe that decides to publish and
// cannot show a deploy is red and says so, which is what makes the red run an
// alarm instead of a footnote.
//
// Two things this deliberately does not do.
//
// It does not ask git anything. The defect that emptied thirteen runs was `gh`
// resolving the target repository from the git remote of a working directory that
// had no checkout, so the call died on "fatal: not a git repository" before it
// ever reached the API. Every target here is an explicit owner/name in an explicit
// URL, so no working directory, no remote and no git binary can affect the result.
//
// It does not hold a stored credential. The token is the repository's own
// GITHUB_TOKEN, scoped to this repository by the platform. There is no secret to
// rotate, store or leak, and this runs in the one job that was never supposed to
// need one.
//
// Why retrying is safe. pages.yml declares concurrency group "pages" with
// cancel-in-progress, so a second dispatch of the same workflow cannot produce a
// second live site: it cancels the first build and takes its place. A retry is
// therefore bounded and idempotent, and it only happens when there is no evidence
// any run was created. The cost of a redundant dispatch is one cancelled build.
// The cost of not retrying is the silent non-publish this file exists to end.

import { setTimeout as sleep } from 'node:timers/promises';

const REPO = process.env.PUBLISH_REPO || '';
const WORKFLOW = process.env.WORKFLOW || 'pages.yml';
const REF = process.env.REF || 'main';
const ATTEMPTS = positiveInt(process.env.ATTEMPTS, 3, 'ATTEMPTS');
const WAIT = positiveInt(process.env.WAIT, 45, 'WAIT');
const POLL = positiveInt(process.env.POLL, 5, 'POLL');
const TOKEN = process.env.GITHUB_TOKEN || '';

// Actions sets GITHUB_API_URL; the default is the public API, and the tests point
// it at a stand-in. Deriving the base from the environment rather than a flag is
// what keeps the test honest: it exercises the same variable the runner sets.
const API = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');

// GitHub stamps run times at second granularity and the Actions API is not
// strongly consistent, so a run created by *this* probe can report a created_at
// marginally before the request that asked for it. Sixty seconds of slop absorbs
// that without letting the run from the previous probe answer for this one: a
// retry legitimately accepts the earlier attempt's run as its own, and a
// half-hour-old run still cannot.
const SLOP_MS = 60_000;

function positiveInt(raw, fallback, name) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    process.stderr.write(`publish-now: ${name} must be a positive integer, got ${JSON.stringify(raw)}\n`);
    process.exit(2);
  }
  return n;
}

// Human output goes to stderr, and stdout carries the run URL and nothing else.
// The workflow captures stdout into a job output, so a progress line on stdout
// would arrive inside that value. check-blogs-ahead.mjs can put prose on stdout
// because nothing parses it; this file is parsed.
function note(msg) {
  process.stderr.write(`publish-now: ${msg}\n`);
}

function bail(msg, detail) {
  process.stderr.write(`publish-now: ${msg}\n`);
  if (detail) process.stderr.write(`publish-now:   ${String(detail).split('\n')[0]}\n`);
  process.exit(2);
}

// owner/name, and nothing else. A malformed value has to stop the script here:
// an empty repository would otherwise post to /repos//actions/workflows/... and
// produce a URL-shaped 404 that reads like a permissions problem.
if (!/^[\w.-]+\/[\w.-]+$/.test(REPO)) {
  bail(`PUBLISH_REPO must be owner/name, got ${JSON.stringify(REPO)}`, 'set PUBLISH_REPO, or GITHUB_REPOSITORY in the workflow');
}
if (!TOKEN) {
  bail('no GITHUB_TOKEN in the environment', 'actions: write on this repository is what supplies it');
}

const headers = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'belmont-news-publish-now',
  authorization: `Bearer ${TOKEN}`,
};

// The API's own words, kept verbatim. "HTTP 403 Resource not accessible by
// integration" and "HTTP 404 Not Found" are the difference between a permission
// problem, a wrong repository name and a workflow that does not exist, and a
// newsroom should not have to guess which one it has.
async function describe(res) {
  let body = '';
  try {
    body = await res.text();
  } catch {
    return `HTTP ${res.status}`;
  }
  try {
    const parsed = JSON.parse(body);
    if (parsed?.message) return `HTTP ${res.status} ${parsed.message}`;
  } catch {
    // Not JSON. Fall through to the raw body below.
  }
  return `HTTP ${res.status} ${body.slice(0, 200)}`.trim();
}

const dispatchUrl = `${API}/repos/${REPO}/actions/workflows/${encodeURIComponent(WORKFLOW)}/dispatches`;
const runsUrl =
  `${API}/repos/${REPO}/actions/workflows/${encodeURIComponent(WORKFLOW)}/runs` +
  `?event=workflow_dispatch&branch=${encodeURIComponent(REF)}&per_page=20`;

// Every attempt's outcome, kept so a failure can say what it actually saw
// instead of a single stale exit code. This is the evidence the newsroom was
// missing for two days.
const tried = [];

// Ask the workflow to run. Returns the instant we asked, which is the only moment
// we can trust as the start of the window we then poll.
async function dispatch() {
  // Stamped before the request, not after. The API is fast enough to create and
  // return a run inside the round trip, and a window that opens after the fact
  // would miss exactly the dispatch we just made.
  const since = Date.now();
  const res = await fetch(dispatchUrl, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ ref: REF }),
  });
  if (!res.ok) return { ok: false, detail: await describe(res) };
  return { ok: true, since };
}

// Look for a run created by this probe. Only workflow_dispatch runs count, and
// only ones newer than the window: a push-triggered build of the same workflow
// is a deploy that was already happening and says nothing about this dispatch,
// and a run from before the probe answers for a request it never received.
async function findRun(since) {
  const floor = new Date(since - SLOP_MS).toISOString();
  const res = await fetch(runsUrl, { headers });
  if (!res.ok) return { error: await describe(res) };
  let body;
  try {
    body = await res.json();
  } catch (e) {
    return { error: `runs listing is not JSON (${e.message})` };
  }
  const runs = Array.isArray(body?.workflow_runs) ? body.workflow_runs : [];
  const mine = runs
    .filter((r) => r?.event === 'workflow_dispatch')
    .filter((r) => typeof r?.created_at === 'string' && r.created_at >= floor)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return { run: mine[0] ?? null };
}

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  note(`dispatching ${WORKFLOW} at ${REF} in ${REPO} (attempt ${attempt} of ${ATTEMPTS})`);

  let asked;
  try {
    asked = await dispatch();
  } catch (e) {
    asked = { ok: false, detail: `request failed: ${e.message}` };
  }

  if (!asked.ok) {
    note(`the API refused the dispatch: ${asked.detail}`);
    tried.push(`attempt ${attempt}: dispatch refused, ${asked.detail}`);
    if (attempt < ATTEMPTS) await sleep(POLL * 1000);
    continue;
  }

  // The endpoint answered 204. That is an acknowledgement, not a deploy, so the
  // only question left is whether a run turned up.
  const deadline = Date.now() + WAIT * 1000;
  let lastError = null;
  while (Date.now() < deadline) {
    let seen;
    try {
      seen = await findRun(asked.since);
    } catch (e) {
      seen = { error: `request failed: ${e.message}` };
    }
    if (seen.error) {
      lastError = seen.error;
    } else if (seen.run) {
      const n = seen.run.run_number ?? '?';
      note(`${WORKFLOW} run #${n} is ${seen.run.status}`);
      // The only thing on stdout, and the last line, so a workflow can read the
      // deploy's own URL without parsing prose.
      process.stdout.write(`${seen.run.html_url}\n`);
      process.exit(0);
    }
    await sleep(POLL * 1000);
  }

  // Accepted and then nothing. This is the silent non-publish, caught.
  note(`the dispatch was accepted but no ${WORKFLOW} run appeared within ${WAIT}s`);
  tried.push(
    `attempt ${attempt}: accepted, then no run appeared within ${WAIT}s` +
      (lastError ? ` (last listing error: ${lastError})` : '')
  );
  if (attempt < ATTEMPTS) await sleep(POLL * 1000);
}

process.stderr.write(`publish-now: gave up after ${ATTEMPTS} attempt(s). The site is NOT published.\n`);
for (const line of tried) process.stderr.write(`publish-now:   ${line}\n`);
process.stderr.write(
  'publish-now: a detected drift with no deploy is this failure. The store is ahead of the live site.\n'
);
process.exit(1);