#!/usr/bin/env node
// check-blogs-ahead.mjs - is the published site behind the markdown store?
//
//   node scripts/check-blogs-ahead.mjs
//   BLOGS_REPO=EasySchedule/belmont-news-blogs node scripts/check-blogs-ahead.mjs
//   SITE_URL=https://easyschedule.github.io/belmont-news-site node scripts/check-blogs-ahead.mjs
//
// Exit codes, and they are the whole contract:
//
//   0  the site is current, or already behind by nothing publishable. Do nothing.
//   1  the site is behind the store. Publish.
//   2  the check could not be carried out. This is NOT "nothing to do".
//
// That last code is the point of the script. The failure this whole mechanism
// exists to fix is a blogs merge that publishes nothing and reports nothing: a
// correct merge, a green gate, and a reader still on a 404. A checker that
// treats "I could not tell" as "no change" reintroduces that exact silence one
// layer up, where it is harder to see. So an unanswerable question exits 2 and
// goes red. It is better to publish a site that was already current than to
// leave a stale one live because the probe was flaky.
//
// How the comparison works. The site publishes the commit of the markdown store
// it rendered, stamped into build-info.json by build.mjs, so the question is a
// lookup rather than an inference: read the deployed build-info.json, read the
// store's current main, compare the two commits.
//
// Both reads are anonymous. The store is public and the deployed site is
// public, so this needs no token and no secret, which is what lets it run on a
// schedule in a repository that holds no credentials at all.

import { execFileSync } from 'node:child_process';

const BLOGS_REPO = process.env.BLOGS_REPO || 'EasySchedule/belmont-news-blogs';
const BLOGS_REF = process.env.BLOGS_REF || 'main';
const SITE_URL = (process.env.SITE_URL || 'https://easyschedule.github.io/belmont-news-site').replace(/\/$/, '');

// GitHub's CDN holds a deployed build-info.json for up to ten minutes
// (cache-control: max-age=600). Without a cache-busting parameter this script
// compares the store's main against a build-info.json that may predate the
// deploy it is trying to judge, and reports drift for a site that is already
// current. That produces a publish every run, which is the opposite of the
// point.
const cacheBust = Date.now();

function fail(msg, detail) {
  process.stderr.write(`check-blogs-ahead: ${msg}\n`);
  if (detail) process.stderr.write(`check-blogs-ahead:   ${String(detail).split('\n')[0]}\n`);
  process.exit(2);
}

// The store's current head. `git ls-remote` rather than the REST API on
// purpose: it needs no token, so it cannot be rate-limited into a false "I
// could not tell" during exactly the busy period when the desk is merging.
function storeHead() {
  let out;
  try {
    out = execFileSync('git', ['ls-remote', `https://github.com/${BLOGS_REPO}.git`, `refs/heads/${BLOGS_REF}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return fail(`could not read ${BLOGS_REPO}@${BLOGS_REF}`, e.stderr);
  }
  const sha = out.trim().split(/\s+/)[0];
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) return fail(`${BLOGS_REPO}@${BLOGS_REF} returned no usable head`, out);
  return sha;
}

// The commit the live site says it rendered.
async function publishedHead() {
  const url = `${SITE_URL}/build-info.json?cb=${cacheBust}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  } catch (e) {
    return fail(`could not reach ${url}`, e.message);
  }
  if (!res.ok) return fail(`${url} returned HTTP ${res.status}`);
  let info;
  try {
    info = await res.json();
  } catch (e) {
    return fail(`${url} is not JSON`, e.message);
  }
  // A build predating the contentHead field reports nothing. That is unknown,
  // not equal: treating it as current would leave the first deployment of this
  // mechanism as the one deployment that never publishes.
  if (!/^[0-9a-f]{40}$/.test(info?.contentHead || '')) {
    return fail(`${SITE_URL} does not report a contentHead yet`, `contentHead=${JSON.stringify(info?.contentHead)}`);
  }
  return info.contentHead;
}

const ahead = await storeHead();
const published = await publishedHead();

if (ahead === published) {
  process.stdout.write(`check-blogs-ahead: site is current at ${ahead.slice(0, 12)}\n`);
  process.exit(0);
}

process.stdout.write(`check-blogs-ahead: site is behind. store=${ahead.slice(0, 12)} published=${published.slice(0, 12)}\n`);
process.stdout.write(`${ahead}\n`);
process.exit(1);
