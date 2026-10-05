// The host-content check, tested: the check that stops a dead host being recorded
// as healthy because it answered 200.
//
//   node --test test/
//
// This is the narrowest fix in the repository and the one with the most ways to be
// quietly wrong. The failure it exists to prevent is a green report about a host
// serving nothing of ours. So the cases that matter most are the ones where the
// host answers 200 with the wrong bytes: every one of them must exit non-zero, and
// none of them may be mistaken for "could not tell".
//
// Zero dependencies, like the check itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, '..', 'scripts', 'check-hosts.mjs');
const HOSTS = join(HERE, '..', 'hosts.json');

// The body Bolt serves at a host that is not there: HTTP 200, and not one of our
// markers in it. Reproduced from the measurement in BEL-222 rather than invented,
// because the shape is the whole point.
const WEBSITE_NOT_FOUND = `<!doctype html><html><head><title>Website Not Found - Bolt</title>
<meta name="description" content="Bolt website not found"></head><body><div id="root"></div>
<p>Website Not Found</p></body></html>`;

const OUR_APP = `<!doctype html><html lang="en"><head><meta charset="UTF-8" />
<title>Belmont County News WebApp</title></head><body><div id="root"></div></body></html>`;

function buildInfo(head, over = {}) {
  return JSON.stringify({ generated: '2026-10-05T16:05:54.326Z', siteTitle: 'Belmont News', contentHead: head, ...over });
}

function run(args, env) {
  return new Promise((resolve) => {
    execFile('node', args, { encoding: 'utf8', env }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// A stand-in for any host. Each route answers whatever the test tells it to, which
// is how one process can be a live news site, a dead Bolt host, and a 404 at once.
// Routes may carry their own headers, because the 2026-10-05 regression was reported
// through the cache headers while the body was wrong.
//
// Every response closes its connection. Node's fetch pools keep-alive sockets and a
// pooled socket outlives server.close(), so the test file would hang after the last
// assertion instead of exiting.
function serve(routes) {
  const server = createServer((req, res) => {
    res.setHeader('connection', 'close');
    const path = req.url.split('?')[0];
    const route = routes[path] ?? routes['*'] ?? { status: 404, body: 'not found' };
    if (route.drop) {
      req.socket.destroy();
      return;
    }
    res.writeHead(route.status ?? 200, { 'content-type': route.type ?? 'text/plain', ...(route.headers ?? {}) }).end(route.body ?? '');
  });
  return once(server.listen(0, '127.0.0.1'), 'listening').then(() => server);
}

function withHost(base, host, rest = {}) {
  return { id: host.id ?? 'test-host', role: host.role ?? 'publish-path', url: base, ...rest };
}

// Run the check against a hosts.json written into a temp file, so the test never
// depends on the shipped record's contents beyond what it asserts about.
//
// The store defaults to the real repository built above and the expected head to its
// `main`. Both are overridable per test, and overriding either is itself a case
// worth having: the marker tests below override the head and need no store, while
// the ancestry tests override the served head and need a real graph to judge it
// against.
async function check(hosts, env = {}) {
  const s = store();
  const dir = mkdtempSync(join(tmpdir(), 'bel222-'));
  const file = join(dir, 'hosts.json');
  writeFileSync(file, JSON.stringify({
    store: s.url, storeRef: 'main', ...hosts,
  }));
  try {
    return await run([CHECK], {
      ...process.env,
      HOSTS_FILE: file,
      EXPECT_CONTENT_HEAD: s.newest,
      // Old enough that a reader of the output cannot mistake a line for routine.
      // It changes no verdict; see the test that proves it changes no verdict.
      STORE_HEAD_AGE_MINUTES: '600',
      ...env,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A real markdown-store repository, three commits deep, on `main`.
//
// The ancestry assertion is the deliverable, so it is tested against a real commit
// graph rather than a stub that returns whatever the test wants. `file://` is enough
// for that and it keeps the test hermetic: no network, no token, and nothing to be
// rate-limited by. The commits are empty, because a sha is a sha.
function storeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'bel222-store-'));
  const repo = join(dir, 'store');
  const g = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.email=bel@example.invalid', '-c', 'user.name=BEL', ...args], { encoding: 'utf8' });
  execFileSync('git', ['init', '--quiet', '-b', 'main', repo], { encoding: 'utf8' });
  const commit = (msg) => {
    g('commit', '--quiet', '--allow-empty', '-m', msg);
    return g('rev-parse', 'HEAD').trim();
  };
  const oldest = commit('first');
  const middle = commit('second');
  const newest = commit('third');
  // A commit that exists but is not on main, so "in the store, not an ancestor" is a
  // state the tests can actually reach rather than a state that is described.
  g('checkout', '--quiet', '-b', 'side', oldest);
  const sideOnly = commit('only ever on a side branch');
  g('checkout', '--quiet', 'main');
  return {
    oldest, middle, newest, sideOnly,
    url: `file://${repo}`,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// One store for the whole file, built once. `check()` defaults EXPECT_CONTENT_HEAD to
// this store's `main` head, which is what most tests want: a real expected head, so
// the ancestry path runs for real instead of being short-circuited by an override.
let STORE = null;
function store() {
  if (!STORE) {
    STORE = storeRepo();
    process.on('exit', () => STORE.cleanup());
  }
  return STORE;
}

// ------------------------------------------- the 200 that serves nothing of ours

test('a host answering 200 with Bolt\'s "Website Not Found" page exits 1, not 0', async () => {
  // The measured BEL-222 case: belmont-county-news-b68j.bolt.host, HTTP 200, 8478
  // bytes, nothing of ours. Exit 0 here is the bug.
  const server = await serve({ '/': { status: 200, body: WEBSITE_NOT_FOUND, type: 'text/html' } });
  try {
    const r = await check({
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'belt-dead' }, { expect: 'html', markers: ['<title>Belmont County News WebApp</title>'], forbidden: ['Website Not Found'] })],
    });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /WRONG {3}belt-dead/);
    // The failure has to name the marker, or the log says which check ran rather
    // than which thing broke.
    assert.match(r.stdout, /Belmont County News WebApp/);
    assert.match(r.stdout, /Website Not Found/);
    assert.match(r.stdout, /status code was never the test/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('a host answering 200 with a 200 HTML body where build-info.json is expected exits 1', async () => {
  // The same defect on a news host. /build-info.json returning a page rather than
  // JSON is this host answering, wrongly, and must not read as unreachable.
  const server = await serve({
    '/build-info.json': { status: 200, body: WEBSITE_NOT_FOUND, type: 'text/html' },
    '/': { status: 200, body: WEBSITE_NOT_FOUND, type: 'text/html' },
  });
  try {
    const r = await check({
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'pages' }, { expect: 'build-info', requireCurrentStore: true })],
    });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /WRONG {3}pages/);
    assert.match(r.stdout, /Website Not Found/);
    assert.match(r.stdout, /40-hex contentHead/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('a news host whose contentHead is HTML instead of a sha exits 1', async () => {
  // A JSON body with the wrong shape is still a wrong answer. Treating it as
  // "unknown" would let a real outage be retried as if it were a network blip.
  const server = await serve({
    '/build-info.json': { status: 200, body: JSON.stringify({ siteTitle: 'Belmont News', contentHead: '<title>Website Not Found</title>' }), type: 'application/json' },
  });
  try {
    const r = await check({
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'pages' }, { expect: 'build-info', requireCurrentStore: true })],
    });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /no 40-hex contentHead/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

// ------------------------------------------------ the two codes must stay apart

test('a stale news host exits 1 and names both commits', async () => {
  const s = store();
  const server = await serve({
    '/build-info.json': { status: 200, body: buildInfo(s.middle), type: 'application/json' },
  });
  try {
    const r = await check({
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'netlify' }, { expect: 'build-info', requireCurrentStore: true })],
    });
    assert.equal(r.code, 1);
    assert.match(r.stdout, new RegExp(`served head ${s.middle}`));
    assert.match(r.stdout, new RegExp(`Store main is ${s.newest.slice(0, 8)}`));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

// ------------------------------- the served head, and what it cannot survive

test('a host serving an ancestor of the expected head exits 1 and says STALE', async () => {
  // The case the board asked for by name, and the one a status-code check cannot
  // see. On 2026-10-05 the store head was 29adf631 and the publish path served
  // 2d09294f, which is an ancestor of it: an older edition, answering 200, with a
  // fresh cache hit and a plausible timestamp. 'oldest' is two commits behind main
  // here, so the ancestry is real rather than described.
  const s = store();
  const server = await serve({
    '/build-info.json': {
      status: 200,
      body: buildInfo(s.oldest, { generated: '2026-10-05T17:08:15.000Z' }),
      type: 'application/json',
      // The headers the regression was reported through, present to prove they
      // change nothing: a cache hit with a low age is not evidence about the commit.
      headers: { 'x-cache': 'HIT', age: '9', 'cache-control': 'max-age=600' },
    },
  });
  try {
    const r = await check({
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'github-pages', role: 'publish-path' }, { expect: 'build-info', requireCurrentStore: true })],
    });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /STALE {3}github-pages/);
    assert.match(r.stdout, /is an ancestor of store main/);
    assert.match(r.stdout, /serving a stale edition/);
    // The head it actually served, in full, so the sequence is reconstructible from
    // the log rather than by hand.
    assert.match(r.stdout, new RegExp(`served head ${s.oldest}`));
    assert.match(r.stdout, /stamped 2026-10-05T17:08:15\.000Z/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('the age of the store head does not soften a mismatch, however young it is', async () => {
  // The regression read as routine because the store head was six minutes old. A
  // young head that still exits 0 means the rule which hid the real failure is
  // back, in a place nobody would look for it. One minute old, and it is still a
  // failure.
  const s = store();
  const server = await serve({
    '/build-info.json': { status: 200, body: buildInfo(s.oldest), type: 'application/json' },
  });
  try {
    const r = await check({
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'github-pages', role: 'publish-path' }, { expect: 'build-info', requireCurrentStore: true })],
    }, { STORE_HEAD_AGE_MINUTES: '1' });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /STALE {3}github-pages/);
    assert.match(r.stdout, /that head is 1 min old/);
    assert.match(r.stdout, /is an ancestor of store main/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('the timestamp is reported but is never the assertion', async () => {
  // Two builds on 2026-10-05 were stamped 17:08:15 and 17:40:46 and neither
  // timestamp was wrong on its own; the head was what disagreed with the
  // repository. So a wrong head with an ordinary-looking timestamp has to fail, and
  // the timestamp has to be in the line anyway.
  const s = store();
  const server = await serve({
    '/build-info.json': { status: 200, body: buildInfo(s.oldest, { generated: '2026-10-05T17:40:46.670Z' }), type: 'application/json' },
  });
  try {
    const r = await check({
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'github-pages', role: 'publish-path' }, { expect: 'build-info', requireCurrentStore: true })],
    });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /stamped 2026-10-05T17:40:46\.670Z/);
    assert.match(r.stdout, /is an ancestor of store main/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('a host serving a commit that is not on the branch exits 1 and says so', async () => {
  // In the store, but not on main. A different failure from "older", and a check
  // that only asked "is it behind?" would file it as the routine thing.
  const s = store();
  const server = await serve({
    '/build-info.json': { status: 200, body: buildInfo(s.sideOnly), type: 'application/json' },
  });
  try {
    const r = await check({
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'github-pages', role: 'publish-path' }, { expect: 'build-info', requireCurrentStore: true })],
    });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /is in the store but is not an ancestor/);
    assert.match(r.stdout, /was not built from this branch's history at all/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('a head that is not a commit in the store at all exits 1 and says so', async () => {
  // Somebody serving a build of something else under our URL. Distinct from both
  // above, and the most alarming of the three, so it gets its own wording rather
  // than being lumped in with "stale".
  const server = await serve({
    '/build-info.json': { status: 200, body: buildInfo('d'.repeat(40)), type: 'application/json' },
  });
  try {
    const r = await check({
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'github-pages', role: 'publish-path' }, { expect: 'build-info', requireCurrentStore: true })],
    });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /is not a commit in main at all/);
    assert.match(r.stdout, /serving a build of something else under this URL/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('a mismatch the store history cannot classify is exit 2, and never a pass', async () => {
  // The dangerous direction. A store that cannot be read leaves a mismatch
  // unclassified, and calling an unclassified mismatch fine is the exact conversion
  // of unknown into known-good this whole check is against.
  const s = store();
  const server = await serve({
    '/build-info.json': { status: 200, body: buildInfo(s.oldest), type: 'application/json' },
  });
  try {
    const r = await check({
      store: 'file:///nonexistent-store-for-this-test',
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'github-pages', role: 'publish-path' }, { expect: 'build-info', requireCurrentStore: true })],
    });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /UNKNOWN github-pages/);
    assert.match(r.stderr, /could not be determined/);
    assert.match(r.stderr, /unclassified/);
    // The mismatch is restated in full, so the exit code is not the only evidence.
    assert.match(r.stderr, new RegExp(`served head ${s.oldest}`));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('nothing but the commit is allowed to decide the verdict', async () => {
  // The three things that were available and all said "fine" on the night. Pinned on
  // the source so none of them can quietly become the assertion again: the only
  // exit-0 path for a build-info host is a contentHead equal to the store head.
  const src = readFileSync(CHECK, 'utf8');
  assert.match(src, /if \(!res\.ok\)/, 'a status code may still name a refusal');
  assert.match(src, /contentHead/, 'the build-info marker is still contentHead');
  assert.match(src, /status code was never the test/);
  // No exemption keyed on age. The publish window that read as exit 0 is gone, and
  // its name must not come back.
  assert.doesNotMatch(src, /PUBLISH_WINDOW_MINUTES/);
  assert.doesNotMatch(src, /publish window/);
  // Cache headers are not read at all.
  // Cache headers are not read at all: no header is consulted anywhere in the check.
  assert.doesNotMatch(src, /\.headers\.get\(/);
  assert.doesNotMatch(src, /res\.headers/);
});

test('the record names the store and the branch the expected head comes from', () => {
  // "Compare against the commit you believe is deployed" needs that commit to come
  // from somewhere written down rather than from a status code. Pinned so the record
  // cannot lose the ref and fall back to guessing.
  const doc = JSON.parse(readFileSync(HOSTS, 'utf8'));
  assert.equal(doc.store, 'EasySchedule/belmont-news-blogs');
  assert.equal(doc.storeRef, 'main');
});

test('an unreachable host exits 2, which is not 1 and not 0', async () => {
  // The distinction the whole script is built on. Collapsing these two codes is how
  // a network blip gets recorded as "the site is fine".
  const server = await serve({ '/build-info.json': { status: 200, body: buildInfo(store().newest), type: 'application/json' } });
  const port = server.address().port;
  server.closeAllConnections();
  server.close();
  const r = await check({
    hosts: [withHost(`http://127.0.0.1:${port}`, { id: 'pages' }, { expect: 'build-info', requireCurrentStore: true })],
  });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /UNKNOWN pages/);
  assert.match(r.stderr, /NOT "nothing to do"/);
  assert.doesNotMatch(r.stdout, /status code was never the test/);
});

test('a dropped connection exits 2 rather than reading as a wrong host', async () => {
  const server = await serve({ '/build-info.json': { drop: true } });
  try {
    const r = await check({
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'pages' }, { expect: 'build-info', requireCurrentStore: true })],
    });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /UNKNOWN pages/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('an unreadable store head is reported as unknown, never as current', async () => {
  // The store cannot be read at all, so there is no expected head to compare with.
  // The marker was present, so a checker that only looked for markers would go green
  // here while the edition behind it could be any age.
  const server = await serve({
    '/build-info.json': { status: 200, body: buildInfo(store().middle), type: 'application/json' },
  });
  try {
    const r = await check({
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'pages' }, { expect: 'build-info', requireCurrentStore: true })],
    }, { EXPECT_CONTENT_HEAD: 'none' });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /currentness is UNKNOWN/);
    assert.match(r.stderr, /This is not a pass/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

// ------------------------------------------------------------------- the passes

test('a host serving our content exits 0', async () => {
  const s = store();
  const server = await serve({
    '/build-info.json': { status: 200, body: buildInfo(s.newest), type: 'application/json' },
    '/': { status: 200, body: OUR_APP, type: 'text/html' },
  });
  try {
    const r = await check({
      hosts: [
        withHost(`http://127.0.0.1:${server.address().port}`, { id: 'pages', role: 'publish-path' }, { expect: 'build-info', requireCurrentStore: true }),
        withHost(`http://127.0.0.1:${server.address().port}`, { id: 'app', role: 'app' }, { expect: 'html', markers: ['<title>Belmont County News WebApp</title>'], forbidden: ['Website Not Found'] }),
      ],
    });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /2\/2 hosts served/);
    assert.match(r.stdout, /OK {6}pages/);
    assert.match(r.stdout, /OK {6}app/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('a host without requireCurrentStore is not failed for being behind', async () => {
  // Netlify is a second copy, not the publish path. Its staleness is reported, and
  // it is not what this check is for, so it must not turn the whole run red until
  // BEL-199 decides what happens to that site.
  const server = await serve({
    '/build-info.json': { status: 200, body: buildInfo(store().oldest), type: 'application/json' },
  });
  try {
    const r = await check({
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'netlify' }, { expect: 'build-info', requireCurrentStore: false })],
    });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /store commit [0-9a-f]{8}/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('a retired host still serving nothing of ours exits 0 and says so', async () => {
  const server = await serve({ '/': { status: 200, body: WEBSITE_NOT_FOUND, type: 'text/html' } });
  try {
    const r = await check({
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'bolt-county-dead', role: 'retired' }, { expect: 'absent', markers: ['<title>Belmont County News WebApp</title>'] })],
    });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /still not serving our site/);
    assert.match(r.stdout, /Website Not Found/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('a retired host that starts serving our site exits 1', async () => {
  // The point of asserting a dead host dead: it cannot drift back into the healthy
  // column unnoticed, and a restored host is a fact somebody has to look at.
  const server = await serve({ '/': { status: 200, body: OUR_APP, type: 'text/html' } });
  try {
    const r = await check({
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'bolt-county-dead', role: 'retired' }, { expect: 'absent', markers: ['<title>Belmont County News WebApp</title>'] })],
    });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /recorded as retired but is now serving/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('a 404 on the app host exits 1 and names the marker it wanted', async () => {
  const server = await serve({ '*': { status: 404, body: 'not found' } });
  try {
    const r = await check({
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'app' }, { expect: 'html', markers: ['<title>Belmont County News WebApp</title>'] })],
    });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /answered HTTP 404/);
    assert.match(r.stdout, /marker: HTML containing/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

// ------------------------------------------------------- the record itself

test('the shipped record names the four hosts BEL-199 measured, with their roles', () => {
  // The record decays. Pinning the ids here means a host cannot be quietly dropped
  // from hosts.json while the README table keeps listing it.
  const doc = JSON.parse(readFileSync(HOSTS, 'utf8'));
  assert.deepEqual(doc.hosts.map((h) => h.id).sort(), ['bolt-app', 'bolt-county-dead', 'github-pages', 'netlify']);
  const byId = Object.fromEntries(doc.hosts.map((h) => [h.id, h]));
  assert.equal(byId['github-pages'].expect, 'build-info');
  assert.equal(byId['github-pages'].requireCurrentStore, true);
  assert.equal(byId['netlify'].requireCurrentStore, false);
  assert.equal(byId['bolt-app'].expect, 'html');
  assert.deepEqual(byId['bolt-app'].forbidden, ['Website Not Found']);
  assert.equal(byId['bolt-county-dead'].expect, 'absent');
});

test('the shipped record asserts content on every host, and never a status code', () => {
  // The bug, restated as a test on the data. A host entry that only records a URL
  // and a role is a host entry whose only possible assertion is "it answered".
  const doc = JSON.parse(readFileSync(HOSTS, 'utf8'));
  for (const host of doc.hosts) {
    assert.ok(['build-info', 'html', 'absent'].includes(host.expect), `${host.id} needs a content expectation`);
    if (host.expect === 'html' || host.expect === 'absent') {
      assert.ok(Array.isArray(host.markers) && host.markers.length > 0, `${host.id} must name the marker it asserts`);
    }
  }
  // No entry may carry a status code as its assertion. If somebody adds
  // "expectedStatus: 200" this fails and they have to explain themselves.
  const src = readFileSync(HOSTS, 'utf8');
  assert.doesNotMatch(src, /expectedStatus|expectStatus|statusCode/);
});

test('the check reads no status code as a pass, only to name a refusal', () => {
  // Same pinning trick as the contentHead test in publish-drift.test.mjs. res.ok is
  // fine for detecting a definite refusal; it must never be the reason a host
  // passes, so the only exit-0 path is a matched marker.
  const src = readFileSync(CHECK, 'utf8');
  assert.match(src, /if \(!res\.ok\)/);
  assert.match(src, /contentHead/, 'the build-info marker is still contentHead');
  assert.match(src, /status code was never the test/);
});