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
// Exit 1 covers "served a commit that is not the one expected", which includes the
// case where the served commit is an ancestor of the expected one. That is the whole
// point and it is worth being blunt about: a page built from an older commit looks
// identical to a correct page over HTTP, reports a fresh cache hit, and stamps a
// plausible `generated` time. See the currentness section below.
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
// The currentness assertion, which is the part that had to be got right.
//
// build-info.json carries the store commit the page was actually rendered from, in
// `contentHead`. That is the one value which differs between a correct deployment
// and a wrong one, so it is what this compares. Everything else about the response
// is evidence about the plumbing, not about the deployment:
//
//   * The status code. 200 is what a dead Bolt host answers.
//   * `generated` and `contentSyncedAt`. Two builds on 2026-10-05 were stamped
//     17:08:15 and 17:40:46 and neither timestamp was wrong on its own. The head
//     was what disagreed with the repository, so a timestamp check passes a page
//     serving the wrong edition.
//   * `x-cache: HIT`, `age: 9`, and a low `age` are the same story again. The edge
//     reported a fresh cache hit while serving an older generation than it had
//     served twenty minutes before. A cache header is a statement about the CDN,
//     not about what the repository says.
//
// So a mismatch is a failure. Not a warning, and not a failure once the store
// commit is old enough to look unambiguous. On 2026-10-05 the store head was
// 29adf631 and six minutes old when the publish path served 2d09294f, which is an
// ancestor of it. "Behind, but only for a minute" is a rule that reads that
// situation as fine, and this check is the thing that was asked for precisely
// because a plausible-sounding rule read a wrong deployment as a passing one.
//
// Ancestry is resolved against the store's real history rather than guessed from a
// clock, so the line says which kind of wrong it is:
//
//   STALE      the served head is an ancestor of the expected one. The page was
//              built from an older commit. This is the case above, and it is the
//              one that reads as healthy over HTTP.
//   DIVERGED   the served head is in the store but is not an ancestor of the
//              expected one. Either the store was rewritten, or the page was built
//              from something that never landed on the branch. Also wrong, and not
//              the same thing.
//   OFF-HISTORY the served head is not a commit in the store at all. Somebody is
//              serving a build of something else under our URL.
//   UNKNOWN    the store's history could not be read, so the mismatch cannot be
//              classified. Exit 2. Never a pass: an unclassified mismatch is still a
//              mismatch, and the class of bug that produced BEL-199 is a check
//              reporting a host it did not understand as fine.
//
// All reads are anonymous. The store is public and every host here is public, so
// this needs no token and no secret, which is what lets it run in a repository
// that holds no credentials at all. `git` is invoked with credential helpers
// disabled and terminal prompts off, so it cannot acquire a token even if the
// machine running it has one configured.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOSTS_FILE = process.env.HOSTS_FILE || join(HERE, '..', 'hosts.json');

// GitHub's CDN holds a deployed build-info.json for up to ten minutes
// (cache-control: max-age=600). Without a cache-busting parameter a redeploy can
// be judged against the file it replaced and reported stale while it is current.
// Note what this does and does not buy: it makes the fetch reach the origin more
// often, and the assertions below do not care, because they read the commit out of
// the body rather than trusting the response to be the newest one. Cache-busting
// narrows a window; comparing the head closes it.
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

// The store's git URL. `hosts.json` names it as `owner/repo` because that is what a
// record should hold, but a full URL is accepted too. That is not decoration: it is
// what lets this be tested against a real commit graph on a machine with no network
// and no credential, rather than against a mock of the graph.
function storeUrl(store) {
  const s = String(store ?? '');
  return /^(https?|file|git|ssh):/.test(s) ? s.replace(/\.git$/, '') : `https://github.com/${s}.git`;
}

// git invoked so that it cannot acquire a credential and cannot block on a prompt.
// This check is specified to need no secret, so it is specified not to be able to
// use one: -c credential.helper= drops any helper the machine has configured, and
// GIT_TERMINAL_PROMPT=0 turns "no access" into an error instead of a hang.
function git(args, opts = {}) {
  return execFileSync('git', ['-c', 'credential.helper=', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', GIT_CONFIG_NOSYSTEM: '0' },
    ...opts,
  });
}

// The store's current head, for the hosts that must be rendering the current
// edition. `git ls-remote` rather than the REST API on purpose: it needs no
// token, so it cannot be rate-limited into a false "could not tell" during
// exactly the busy period when the desk is merging.
function storeHead(url, ref) {
  // An explicit override is a test seam, and "none" is a real answer rather than a
  // missing one: it says the expected head is unknown, which is a different state
  // from not looking. Callers must distinguish the two, so they can.
  const override = process.env.EXPECT_CONTENT_HEAD;
  if (override === 'none' || override === '') return null;
  if (override) return override;
  let out;
  try {
    out = git(['ls-remote', url, `refs/heads/${ref}`]);
  } catch {
    process.stderr.write(`check-hosts:   could not read ${ref}\n`);
    return null;
  }
  const sha = out.trim().split(/\s+/)[0];
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
    process.stderr.write(`check-hosts:   ${ref} returned no usable head\n`);
    return null;
  }
  return sha;
}

// Where the served head sits in the store's real history, relative to the head we
// expected. Answers the question a mismatch raises -- is this page an older edition,
// or something else entirely -- with git rather than with a timestamp.
//
// The history is fetched, blobs filtered out, into a temporary directory that is
// removed afterwards. Anonymous, because the store is public: the same reason the
// head uses ls-remote, and the same reason this does not use the REST API, whose
// unauthenticated rate limit would turn a busy merge window into a false "could not
// tell" on the very run that matters most.
//
// Returns one of:
//   'ancestor'     served is an ancestor of expected. The page is an older edition.
//   'diverged'     served is in the store but not an ancestor of expected.
//   'off-history'  served is not a commit in the store.
//   'unknown'      the history could not be read, or could not be classified.
function classifyServedHead(url, ref, served, expected) {
  if (!/^[0-9a-f]{40}$/.test(served ?? '') || !/^[0-9a-f]{40}$/.test(expected ?? '')) return 'unknown';
  const dir = mkdtempSync(join(tmpdir(), 'check-hosts-store-'));
  try {
    git(['init', '--quiet', '--bare', dir]);
    // --filter=blob:none asks for commits and trees only. A commit graph is all the
    // ancestry question needs, and this keeps a fast check fast. Servers that do not
    // support it warn and serve the objects anyway, which is fine.
    git(['-C', dir, 'fetch', '--quiet', '--no-tags', '--filter=blob:none', url, `+refs/heads/${ref}:refs/heads/${ref}`]);
    // `merge-base --is-ancestor` exits non-zero both for "no" and for "I have never
    // heard of that commit", so the two are separated here first. Collapsing them
    // would report a page built from a foreign commit as merely an old edition.
    let known = true;
    try {
      git(['-C', dir, 'cat-file', '-e', `${served}^{commit}`]);
    } catch {
      known = false;
    }
    if (!known) return 'off-history';
    try {
      git(['-C', dir, 'merge-base', '--is-ancestor', served, expected]);
      return 'ancestor';
    } catch {
      return 'diverged';
    }
  } catch {
    return 'unknown';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// How old the store's expected head is, in minutes. Read for the failure line only.
//
// This is context, never a verdict. It exists so the person reading a red line can
// tell the two causes apart at a glance: a merge from four minutes ago, where the
// */15 cron has simply not run yet, and a store that has been ahead since Tuesday.
// Both are exit 1. Neither is softened by being young, because "young" is exactly
// what the 2026-10-05 regression looked like -- store head 29adf631, six minutes old,
// served head 2d09294f, and every available heuristic read it as routine.
//
// The commits Atom feed rather than the REST API, for the same reason the head uses
// git ls-remote: no token, so no rate limit that could turn into a false "I could
// not tell" during a busy merge window. It is also a single small document.
async function storeHeadAgeMinutes(url, ref, sha) {
  // An explicitly empty override means "no clock", which is unknown rather than
  // zero. Number('') is 0, and 0 is the youngest possible commit.
  if (process.env.STORE_HEAD_AGE_MINUTES !== undefined) {
    if (process.env.STORE_HEAD_AGE_MINUTES === '') return null;
    const n = Number(process.env.STORE_HEAD_AGE_MINUTES);
    return Number.isFinite(n) ? n : null;
  }
  // Only github.com serves the Atom feed. A test store on file:// has no feed, and
  // asking for one would be a second thing to fail in a run that is already about
  // git.
  if (!/^https:\/\/github\.com\//.test(url)) return null;
  let body;
  try {
    const res = await fetch(`${url.replace(/\.git$/, '')}/commits/${ref}.atom`, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) return null;
    body = await res.text();
  } catch {
    return null;
  }
  // Match the entry for the head we actually compared against, rather than trusting
  // the feed's first entry. If the feed moved between the two reads the ages
  // disagree, and the wrong commit's age would describe a commit we did not judge.
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

// ok       the host served what it must serve.
// wrong    it answered, and the answer is not ours. Exit 1.
// unknown  we could not tell. Exit 2.
// kind     the word on the verdict line when the failure has a name of its own, so
//          a log can be read for "which kind of wrong" without parsing prose.
//
// requireCurrent is passed separately from expectedHead on purpose. "This host must
// be current and I could not read the store" is a different fact from "no
// comparison was wanted here", and the caller needs to tell them apart to report
// one as unknown and the other as a pass.
async function checkBuildInfo(host, expectedHead, requireCurrent, storeAgeMinutes, storeUrlForHistory) {
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
  // Every build-info verdict carries the head it actually served, in full, and the
  // timestamp it claims for itself. Both, because on 2026-10-05 the timestamps were
  // not what lied -- two builds stamped 17:08:15 and 17:40:46 were each internally
  // consistent -- and the head was. A check that reports only a boolean leaves the
  // sequence to be reconstructed by hand, which is the thing that was done by hand
  // that evening and should not have to be done again.
  const served = `served head ${info.contentHead}`;
  const stamped = info.generated ? `stamped ${info.generated}` : 'stamped with no generated time';

  // A host that must be current, compared against nothing, is unknown. Reporting
  // it as a pass is exactly the silence this script exists to refuse: the marker
  // was present, so a checker that only looked for markers would go green while the
  // edition behind it could be any age.
  if (requireCurrent && !expectedHead) {
    return { ok: false, wrong: false, say: `${host.url} served a well-formed build-info.json (${served}, ${stamped}) but currentness could not be judged, because the store head is unknown` };
  }
  if (expectedHead && info.contentHead !== expectedHead) {
    const want = expectedHead.slice(0, 8);
    const where = `(marker: build-info.json contentHead == store main; ${served}, store ${want})`;
    // The age of the store head, read for the line and for nothing else. It answers
    // "is this a merge from four minutes ago the cron has not seen yet, or has the
    // store been ahead since Tuesday?" and it does not get a vote on the verdict.
    // The reason is dated: the store head was six minutes old and the host was
    // serving an ancestor, and every age-based rule available read that as routine.
    const age = storeAgeMinutes === null || storeAgeMinutes === undefined
      ? 'the age of that head could not be read'
      : `that head is ${Math.floor(storeAgeMinutes)} min old`;
    // Ancestry is what makes this line worth reading. A boolean cannot tell a page
    // built from last week's edition apart from one built from a commit that was
    // never on the branch, and the two call for opposite responses.
    const relation = storeUrlForHistory ? classifyServedHead(storeUrlForHistory, host.storeRef, info.contentHead, expectedHead) : 'unknown';
    if (relation === 'unknown') {
      // Unclassified is not a pass. Exit 2, and the mismatch itself is restated in
      // full, so nobody has to take the exit code on trust.
      return {
        ok: false,
        wrong: false,
        say: `${host.url} ${served} but store main is ${want}, and where ${info.contentHead} sits in the store's history could not be determined, so this mismatch is unclassified. Store main is ${want} and ${age}. ${where}. This is not a pass.`,
      };
    }
    const said = {
      ancestor: `is an ancestor of store main ${want}, so this page was built from an older commit of the store and is serving a stale edition`,
      diverged: `is in the store but is not an ancestor of store main ${want}, so this page was not built from this branch's history at all`,
      'off-history': `is not a commit in ${host.storeRef} at all, so something is serving a build of something else under this URL`,
    }[relation];
    return {
      ok: false,
      wrong: true,
      kind: relation === 'ancestor' ? 'STALE' : 'WRONG',
      say: `${host.url} ${served}, ${stamped}. It ${said}. Store main is ${want} and ${age}. ${where}`,
    };
  }
  const shown = expectedHead ? `current (store main ${expectedHead.slice(0, 8)})` : info.contentHead.slice(0, 8);
  return { ok: true, wrong: false, say: `served our build-info.json, store commit ${shown}, ${served}, ${stamped}` };
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
const storeGitUrl = storeUrl(store);

// One store lookup for every host that needs it, and only if one needs it.
const needsHead = hosts.some((h) => h.expect === 'build-info' && h.requireCurrentStore);
const expectedHead = needsHead ? storeHead(storeGitUrl, storeRef) : null;

if (needsHead && !expectedHead) {
  process.stderr.write(`check-hosts: cannot compare against ${store}@${storeRef}, so currentness is UNKNOWN for the hosts that require it. This is not a pass.\n`);
}

// Only read when a comparison is actually going to be made. Fetching a clock for a
// check that will not use it is a way to have a second thing fail.
const storeAge = needsHead && expectedHead ? await storeHeadAgeMinutes(storeGitUrl, storeRef, expectedHead) : null;

if (needsHead && expectedHead && storeAge === null) {
  process.stderr.write(`check-hosts: could not read the age of ${store}@${storeRef}. It appears in the failure lines as context; it is not what decides the verdict.\n`);
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
  // storeRef travels on the host so a failure line can name the branch it judged
  // against without this loop having to thread it through separately.
  const judged = { ...host, storeRef };
  if (host.expect === 'build-info') result = await checkBuildInfo(judged, host.requireCurrentStore ? expectedHead : null, Boolean(host.requireCurrentStore), storeAge, storeGitUrl);
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
  // The verdict column is padded to the widest verdict so a mixed run lines up and
  // the eye finds the one that is not OK without reading the detail lines.
  const verdict = (result.ok ? 'OK' : (result.wrong ? (result.kind ?? 'WRONG') : 'UNKNOWN')).padEnd(8);
  const stream = result.ok || result.wrong ? process.stdout : process.stderr;
  stream.write(`check-hosts: ${verdict}${label}\n`);
  stream.write(`check-hosts:        ${result.say}\n`);
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