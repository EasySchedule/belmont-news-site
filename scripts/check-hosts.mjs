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
// Being behind the store is not the same as being stale, and conflating them is how
// this check would have reproduced the disease it exists to cure. A merge to the
// store does not publish; the `*/15` cron does, and GitHub queues it. For the first
// few minutes after a merge the publish path is *supposed* to be behind, and a
// check that exits 1 for that window goes red on every merge. A check that is red
// most of the time is a check nobody reads, and BEL-199 exists because somebody
// believed a host nobody had checked. So a mismatch is only a failure once the
// store commit is older than the publish window (PUBLISH_WINDOW_MINUTES, default
// 30: the 15-minute cron plus room for a queued run). Inside that window the host
// is reported BEHIND and exits 0, with both commits and the age in the line. Drift
// that outlives the window is exit 1, which is the real finding.
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

// How long a store commit may sit unpublished before the publish path counts as
// stale rather than merely behind. The cron asks for a run every 15 minutes and
// GitHub queues those, so 30 is the cron plus one missed slot. Overridable so a
// test can move the boundary, and so this is a policy value in one place rather
// than a constant somebody has to find.
const PUBLISH_WINDOW_MINUTES = Number(process.env.PUBLISH_WINDOW_MINUTES || 30);

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

// How old the store's head commit is, in minutes. Needed to tell "behind, and a
// publish is still legitimately in flight" from "behind, and the publish window has
// closed" -- the difference between a red line and a routine one.
//
// The commits Atom feed rather than the REST API, for the same reason the head uses
// git ls-remote: no token, so no rate limit that could turn into a false "I could
// not tell" during a busy merge window. It is also a single small document.
async function storeHeadAgeMinutes(store, ref, sha) {
  if (process.env.STORE_HEAD_AGE_MINUTES !== undefined && process.env.STORE_HEAD_AGE_MINUTES !== '') {
    const n = Number(process.env.STORE_HEAD_AGE_MINUTES);
    return Number.isFinite(n) ? n : null;
  }
  // An explicitly empty override means "no clock", which is unknown, not zero.
  // Number('') is 0, and 0 is the youngest possible commit, so reading it as an age
  // would make an unreadable clock look like a fresh merge and pass the host.
  if (process.env.STORE_HEAD_AGE_MINUTES === '') return null;
  let body;
  try {
    const res = await fetch(`https://github.com/${store}/commits/${ref}.atom`, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) return null;
    body = await res.text();
  } catch {
    return null;
  }
  // Match the entry for the head we actually compared against, rather than trusting
  // the feed's first entry. If the feed moved between the two reads the ages
  // disagree, and using the wrong commit's age would judge this host against a
  // window it never had.
  for (const m of body.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = m[1];
    const id = entry.match(/Grit::Commit\/([0-9a-f]{40})/);
    if (!id || id[1] !== sha) continue;
    const updated = entry.match(/<updated>([^<]+)<\/updated>/);
    if (!updated) return null;
    const at = Date.parse(updated[1]);
    if (!Number.isFinite(at)) return null;
    return Math.max(0, (Date.now() - at) / 60000);
  }
  return null;
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' }, redirect: 'follow' });
  const body = await res.text();
  return { status: res.status, ok: res.ok, body, url: res.url || url };
}

// ok      the host served what it must serve.
// wrong   it answered, and the answer is not ours. Exit 1.
// unknown we could not tell. Exit 2.
// behind  it served ours, and is a commit behind. Exit 0 while the store commit is
//         younger than the publish window, exit 1 once it is older.
// requireCurrent is passed separately from expectedHead on purpose. "This host must
// be current and I could not read the store" is a different fact from "no
// comparison was wanted here", and the caller needs to tell them apart to report
// one as unknown and the other as a pass.
async function checkBuildInfo(host, expectedHead, requireCurrent, storeAgeMinutes) {
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
    const got = info.contentHead.slice(0, 8);
    const want = expectedHead.slice(0, 8);
    const where = `(marker: build-info.json contentHead == store main; rendered ${got}, store ${want})`;
    // A mismatch whose store commit is younger than the publish window is a publish
    // in flight, not a stale host. Exiting 1 here would make this check fail on
    // every merge and train the newsroom to ignore it.
    //
    // An age we could not read is NOT treated as "within the window". Guessing young
    // would turn an unreadable clock into a silent pass, which is the one thing this
    // script must never do. Unknown age goes to exit 2 and says so.
    if (storeAgeMinutes === null || storeAgeMinutes === undefined) {
      return { ok: false, wrong: false, say: `${host.url} rendered store commit ${got} but ${want} is current, and the age of ${want} could not be read, so whether this is drift or a publish still in flight is unknown. ${where}` };
    }
    if (storeAgeMinutes <= PUBLISH_WINDOW_MINUTES) {
      const mins = Math.floor(storeAgeMinutes);
      return { ok: true, wrong: false, behind: true, say: `${host.url} is BEHIND, not stale: rendered ${got}, store ${want} is ${mins} min old, inside the ${PUBLISH_WINDOW_MINUTES} min publish window. The cron has not run yet. ${where}` };
    }
    const mins = Math.floor(storeAgeMinutes);
    return { ok: false, wrong: true, say: `${host.url} rendered store commit ${got} but ${want} is current and has been for ${mins} min, past the ${PUBLISH_WINDOW_MINUTES} min publish window. This is stale. ${where}` };
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

// Only read when a comparison is actually going to be made. Fetching a clock for a
// check that will not use it is a way to have a second thing fail.
const storeAge = needsHead && expectedHead ? await storeHeadAgeMinutes(store, storeRef, expectedHead) : null;

if (needsHead && expectedHead && storeAge === null) {
  process.stderr.write(`check-hosts: could not read the age of ${store}@${storeRef}. Any host that is behind will report UNKNOWN rather than guessing that a publish is still in flight.\n`);
}

let wrong = 0;
let unknown = 0;
let passed = 0;
let behind = 0;

for (const host of hosts) {
  if (typeof host.id !== 'string' || typeof host.url !== 'string') {
    process.stderr.write(`check-hosts: a host entry has no id or url. The record must name what it checks.\n`);
    unknown += 1;
    continue;
  }
  let result;
  if (host.expect === 'build-info') result = await checkBuildInfo(host, host.requireCurrentStore ? expectedHead : null, Boolean(host.requireCurrentStore), storeAge);
  else if (host.expect === 'html') result = await checkHtml(host);
  else if (host.expect === 'absent') result = await checkAbsent(host);
  else {
    process.stderr.write(`check-hosts: ${host.id} has expect=${JSON.stringify(host.expect)}, which this check does not know. An unknown expectation is not a pass.\n`);
    result = { ok: false, wrong: false, say: 'unknown expectation' };
  }
  wrong += result.wrong ? 1 : 0;
  unknown += !result.ok && !result.wrong ? 1 : 0;
  passed += result.ok && !result.behind ? 1 : 0;
  behind += result.behind ? 1 : 0;

  const label = `${host.id} [${host.role ?? 'unspecified'}] ${host.url}`;
  if (result.ok) {
    // The verdict column is padded to the width of BEHIND, so a run that mixes a pass
    // with a host waiting on its publish still lines up and the eye can find the one
    // that is not OK at a glance.
    const verdict = (result.behind ? 'BEHIND' : 'OK').padEnd(7);
    process.stdout.write(`check-hosts: ${verdict}${label}\n`);
    process.stdout.write(`check-hosts:        ${result.say}\n`);
  } else {
    const stream = result.wrong ? process.stdout : process.stderr;
    stream.write(`check-hosts: ${result.wrong ? 'WRONG' : 'UNKNOWN'} ${label}\n`);
    stream.write(`check-hosts:        ${result.say}\n`);
  }
}

process.stdout.write(`check-hosts: ${passed}/${hosts.length} hosts served what the record says they serve${behind ? `, ${behind} behind but inside the publish window` : ''}\n`);

if (wrong) {
  process.stdout.write(`check-hosts: ${wrong} host(s) answered and served the wrong content. The status code was never the test.\n`);
  process.exit(1);
}
if (unknown) {
  process.stderr.write(`check-hosts: ${unknown} host(s) could not be judged. This is NOT "nothing to do".\n`);
  process.exit(2);
}
process.exit(0);