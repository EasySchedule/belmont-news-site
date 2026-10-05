#!/usr/bin/env node
// check-hosts.mjs - does every host in the deploy record serve what we say it serves?
//
//   node scripts/check-hosts.mjs
//   HOSTS_FILE=hosts.json node scripts/check-hosts.mjs
//
// Exit codes, matching check-listing-stale.mjs so one workflow can read all three:
//
//   0  every host served its expected content. Do nothing.
//   1  a host answered and served the wrong thing. This is the interesting failure.
//   2  the check could not be carried out. This is NOT "nothing to do".
//
// Why this script exists, because the bug it fixes sounds too simple to need one.
//
// On 2026-10-05 the deploy record listed belmont-county-news-b68j.bolt.host as a
// host, and asserted it was available. It is dead: HTTP 200, 8478 bytes, and a
// body that is Bolt's "Website Not Found" page. The record was wrong in the worst
// possible way, because it was wrong in a way that reads as correct. Anything that
// asks "did the host answer?" gets told yes. `curl -o /dev/null -w '%{http_code}'`
// is the whole reason the record drifted.
//
// So the assertion here is never the status code. It is the content:
//
//   * a news host must serve JSON /build-info.json with a 40-hex contentHead. That
//     is what build.mjs writes, so it is a marker of our build rather than of any
//     host's generic success page.
//   * an app host must serve HTML carrying its own <title>. belmont-news.bolt.host
//     answers 200 with 795 bytes and "Belmont County News WebApp"; the dead
//     sibling answers 200 with 8478 bytes and "Website Not Found". Same status,
//     opposite meaning, and the marker separates them on the first byte.
//   * a host the record knows is dead is asserted DEAD, so it cannot drift back
//     into the healthy column by answering 200.
//
// Exit 1 and exit 2 are deliberately different numbers and the difference is the
// point. A host answering 200 with the wrong body is a fact about that host: it is
// dead, hijacked, or serving somebody else's site, and no amount of retrying
// changes it. A host that could not be reached, or a build-info.json that would not
// parse, is a fact about this run. Collapsing the two into one code is what lets a
// network blip get recorded as "the site is fine" and a real outage get retried
// until it looks like flakiness.
//
// Every failure line names the host and the marker, so the log says which thing
// broke rather than which check ran.
//
// All reads are anonymous. The store is public and every host here is public, so
// this needs no token and no secret, which is what lets it run in a repository
// that holds no credentials at all.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOSTS_FILE = process.env.HOSTS_FILE || join(HERE, '..', 'hosts.json');

// GitHub's CDN holds a deployed build-info.json for up to ten minutes
// (cache-control: max-age=600). Without a cache-busting parameter a redeploy can
// be judged against the file it replaced and reported stale while it is current.
const cacheBust = Date.now();

function loadHosts() {
  let doc;
  try {
    doc = JSON.parse(readFileSync(HOSTS_FILE, 'utf8'));
  } catch (e) {
    process.stderr.write(`check-hosts: could not read ${HOSTS_FILE}\n`);
    process.stderr.write(`check-hosts:   ${e.message}\n`);
    process.exit(2);
  }
  const hosts = doc?.hosts;
  if (!Array.isArray(hosts) || hosts.length === 0) {
    process.stderr.write(`check-hosts: ${HOSTS_FILE} lists no hosts. A record with no hosts checks nothing.\n`);
    process.exit(2);
  }
  return { store: doc.store, storeRef: doc.storeRef || 'main', hosts };
}

// The store's current head, for the hosts that must be rendering the current
// edition. `git ls-remote` rather than the REST API on purpose: it needs no
// token, so it cannot be rate-limited into a false "could not tell" during
// exactly the busy period when the desk is merging.
function storeHead(store, ref) {
  if (process.env.EXPECT_CONTENT_HEAD) return process.env.EXPECT_CONTENT_HEAD;
  let out;
  try {
    out = execFileSync('git', ['ls-remote', `https://github.com/${store}.git`, `refs/heads/${ref}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    process.stderr.write(`check-hosts:   could not read ${store}@${ref}\n`);
    return null;
  }
  const sha = out.trim().split(/\s+/)[0];
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
    process.stderr.write(`check-hosts:   ${store}@${ref} returned no usable head\n`);
    return null;
  }
  return sha;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' }, redirect: 'follow' });
  const body = await res.text();
  return { status: res.status, ok: res.ok, body, url: res.url || url };
}

// ok      the host served what it must serve.
// wrong   it answered, and the answer is not ours. Exit 1.
// unknown we could not tell. Exit 2.
// requireCurrent is passed separately from expectedHead on purpose. "This host must
// be current and I could not read the store" is a different fact from "no
// comparison was wanted here", and the caller needs to tell them apart to report
// one as unknown and the other as a pass.
async function checkBuildInfo(host, expectedHead, requireCurrent) {
  const url = `${host.url}/build-info.json?cb=${cacheBust}`;
  let res;
  try {
    res = await fetchText(url);
  } catch (e) {
    return { ok: false, wrong: false, say: `could not reach ${url}: ${e.message}` };
  }
  // A non-2xx here is not the failure this script is about, but it is still not a
  // pass. Reported as wrong rather than unknown because the host answered with a
  // definite refusal.
  if (!res.ok) {
    return { ok: false, wrong: true, say: `${host.url} answered HTTP ${res.status} for /build-info.json (marker: a 200 build-info.json with a 40-hex contentHead)` };
  }
  let info;
  try {
    info = JSON.parse(res.body);
  } catch (e) {
    // The 200-with-HTML case, and the reason this file exists. Bolt serves its
    // "Website Not Found" page at 200; a build-info.json request that returns a
    // page instead of JSON is that same host answering, wrongly.
    const kind = /Website Not Found/i.test(res.body) ? 'Bolt\'s "Website Not Found" page' : 'a non-JSON body';
    return { ok: false, wrong: true, say: `${host.url} /build-info.json returned HTTP 200 but the body is ${kind} (marker: JSON with a 40-hex contentHead)` };
  }
  // 40 hex and nothing else. A truncated or HTML-wrapped value must not read as
  // a commit, for the same reason check-listing-stale.mjs uses isRealDay rather
  // than a shape test: "looks like a sha" is not "is a sha".
  if (!/^[0-9a-f]{40}$/.test(info?.contentHead ?? '')) {
    return { ok: false, wrong: true, say: `${host.url} /build-info.json has no 40-hex contentHead (marker: a 40-hex contentHead; got ${JSON.stringify(info?.contentHead)})` };
  }
  // A host that must be current, compared against nothing, is unknown. Reporting
  // it as a pass is exactly the silence this script exists to refuse: the marker
  // was present, so a checker that only looked for markers would go green while the
  // edition behind it could be any age.
  if (requireCurrent && !expectedHead) {
    return { ok: false, wrong: false, say: `${host.url} served a well-formed build-info.json (commit ${info.contentHead.slice(0, 8)}) but currentness could not be judged, because the store head is unknown` };
  }
  if (expectedHead && info.contentHead !== expectedHead) {
    return { ok: false, wrong: true, say: `${host.url} rendered store commit ${info.contentHead.slice(0, 8)} but ${expectedHead.slice(0, 8)} is current (marker: build-info.json contentHead == store main)` };
  }
  const shown = expectedHead ? 'current' : `${info.contentHead.slice(0, 8)}`;
  return { ok: true, wrong: false, say: `served our build-info.json, store commit ${shown}` };
}

async function checkHtml(host) {
  let res;
  try {
    res = await fetchText(`${host.url}/?cb=${cacheBust}`);
  } catch (e) {
    return { ok: false, wrong: false, say: `could not reach ${host.url}/: ${e.message}` };
  }
  if (!res.ok) {
    return { ok: false, wrong: true, say: `${host.url} answered HTTP ${res.status} (marker: HTML containing ${host.markers?.[0] ?? 'the app title'})` };
  }
  const missing = (host.markers ?? []).filter((m) => !res.body.includes(m));
  if (missing.length) {
    // The dead Bolt host lands here: 200, 8478 bytes, and not one of our markers
    // in it. Named explicitly so the log says which host is lying.
    const tell = /Website Not Found/i.test(res.body) ? ' (body is Bolt\'s "Website Not Found" page)' : '';
    return { ok: false, wrong: true, say: `${host.url} answered HTTP 200, ${res.body.length} bytes, but is missing ${missing.map((m) => JSON.stringify(m)).join(', ')}${tell}` };
  }
  const forbidden = (host.forbidden ?? []).find((m) => res.body.includes(m));
  if (forbidden) {
    return { ok: false, wrong: true, say: `${host.url} served our markers but also ${JSON.stringify(forbidden)}, which is not allowed on this host` };
  }
  return { ok: true, wrong: false, say: `served our app HTML (${res.body.length} bytes)` };
}

async function checkAbsent(host) {
  let res;
  try {
    res = await fetchText(`${host.url}/?cb=${cacheBust}`);
  } catch (e) {
    // Unreachable is an acceptable state for a host asserted dead. It is still
    // reported, because "dead" and "we cannot tell" are different facts.
    return { ok: true, wrong: false, say: `unreachable, which is consistent with a retired host (${e.message})` };
  }
  const present = (host.markers ?? []).filter((m) => res.body.includes(m));
  if (present.length) {
    return { ok: false, wrong: true, say: `${host.url} was recorded as retired but is now serving ${present.map((m) => JSON.stringify(m)).join(', ')}. It is back: re-verify and either restore it as a host or find out who owns it.` };
  }
  const tell = res.body.length && /Website Not Found/i.test(res.body) ? 'serving Bolt\'s "Website Not Found" page, as measured' : `answering ${res.status} with ${res.body.length} bytes of nothing we serve`;
  return { ok: true, wrong: false, say: `still not serving our site, ${tell}` };
}

const { store, storeRef, hosts } = loadHosts();

// One store lookup for every host that needs it, and only if one needs it.
const needsHead = hosts.some((h) => h.expect === 'build-info' && h.requireCurrentStore);
const expectedHead = needsHead ? storeHead(store, storeRef) : null;

if (needsHead && !expectedHead) {
  process.stderr.write(`check-hosts: cannot compare against ${store}@${storeRef}, so currentness is UNKNOWN for the hosts that require it. This is not a pass.\n`);
}

let wrong = 0;
let unknown = 0;
let passed = 0;

for (const host of hosts) {
  if (typeof host.id !== 'string' || typeof host.url !== 'string') {
    process.stderr.write(`check-hosts: a host entry has no id or url. The record must name what it checks.\n`);
    unknown += 1;
    continue;
  }
  let result;
  if (host.expect === 'build-info') result = await checkBuildInfo(host, host.requireCurrentStore ? expectedHead : null, Boolean(host.requireCurrentStore));
  else if (host.expect === 'html') result = await checkHtml(host);
  else if (host.expect === 'absent') result = await checkAbsent(host);
  else {
    process.stderr.write(`check-hosts: ${host.id} has expect=${JSON.stringify(host.expect)}, which this check does not know. An unknown expectation is not a pass.\n`);
    result = { ok: false, wrong: false, say: 'unknown expectation' };
  }
  wrong += result.wrong ? 1 : 0;
  unknown += !result.ok && !result.wrong ? 1 : 0;
  passed += result.ok ? 1 : 0;

  const label = `${host.id} [${host.role ?? 'unspecified'}] ${host.url}`;
  if (result.ok) {
    process.stdout.write(`check-hosts: OK    ${label}\n`);
    process.stdout.write(`check-hosts:        ${result.say}\n`);
  } else {
    const stream = result.wrong ? process.stdout : process.stderr;
    stream.write(`check-hosts: ${result.wrong ? 'WRONG' : 'UNKNOWN'} ${label}\n`);
    stream.write(`check-hosts:        ${result.say}\n`);
  }
}

process.stdout.write(`check-hosts: ${passed}/${hosts.length} hosts served what the record says they serve\n`);

if (wrong) {
  process.stdout.write(`check-hosts: ${wrong} host(s) answered and served the wrong content. The status code was never the test.\n`);
  process.exit(1);
}
if (unknown) {
  process.stderr.write(`check-hosts: ${unknown} host(s) could not be judged. This is NOT "nothing to do".\n`);
  process.exit(2);
}
process.exit(0);