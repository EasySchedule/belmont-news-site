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
import { readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
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

function buildInfo(head) {
  return JSON.stringify({ generated: '2026-10-05T16:05:54.326Z', siteTitle: 'Belmont News', contentHead: head });
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
    res.writeHead(route.status ?? 200, { 'content-type': route.type ?? 'text/plain' }).end(route.body ?? '');
  });
  return once(server.listen(0, '127.0.0.1'), 'listening').then(() => server);
}

function withHost(base, host, rest = {}) {
  return { id: host.id ?? 'test-host', role: host.role ?? 'publish-path', url: base, ...rest };
}

// Run the check against a hosts.json written into a temp file, so the test never
// depends on the shipped record's contents beyond what it asserts about.
async function check(hosts, env = {}) {
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'bel222-'));
  const file = join(dir, 'hosts.json');
  writeFileSync(file, JSON.stringify(hosts));
  try {
    return await run([CHECK], {
      ...process.env,
      HOSTS_FILE: file,
      EXPECT_CONTENT_HEAD: 'a'.repeat(40),
      ...env,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------- the 200 that serves nothing of ours

test('a host answering 200 with Bolt\'s "Website Not Found" page exits 1, not 0', async () => {
  // The measured BEL-222 case: belmont-county-news-b68j.bolt.host, HTTP 200, 8478
  // bytes, nothing of ours. Exit 0 here is the bug.
  const server = await serve({ '/': { status: 200, body: WEBSITE_NOT_FOUND, type: 'text/html' } });
  try {
    const r = await check({
      store: 'x/y', storeRef: 'main',
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'belt-dead' }, { expect: 'html', markers: ['<title>Belmont County News WebApp</title>'], forbidden: ['Website Not Found'] })],
    });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /WRONG belt-dead/);
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
      store: 'x/y', storeRef: 'main',
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'pages' }, { expect: 'build-info', requireCurrentStore: true })],
    });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /WRONG pages/);
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
      store: 'x/y', storeRef: 'main',
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
  const server = await serve({
    '/build-info.json': { status: 200, body: buildInfo('b'.repeat(40)), type: 'application/json' },
  });
  try {
    const r = await check({
      store: 'x/y', storeRef: 'main',
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'netlify' }, { expect: 'build-info', requireCurrentStore: true })],
    });
    assert.equal(r.code, 1);
    assert.match(r.stdout, /rendered store commit bbbbbbbb/);
    assert.match(r.stdout, /aaaaaaaa is current/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('an unreachable host exits 2, which is not 1 and not 0', async () => {
  // The distinction the whole script is built on. Collapsing these two codes is how
  // a network blip gets recorded as "the site is fine".
  const server = await serve({ '/build-info.json': { status: 200, body: buildInfo('a'.repeat(40)), type: 'application/json' } });
  const port = server.address().port;
  server.closeAllConnections();
  server.close();
  const r = await check({
    store: 'x/y', storeRef: 'main',
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
      store: 'x/y', storeRef: 'main',
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
  const server = await serve({
    '/build-info.json': { status: 200, body: buildInfo('b'.repeat(40)), type: 'application/json' },
  });
  try {
    const r = await check({
      store: 'x/y', storeRef: 'main',
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'pages' }, { expect: 'build-info', requireCurrentStore: true })],
    }, { EXPECT_CONTENT_HEAD: '' });
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
  const server = await serve({
    '/build-info.json': { status: 200, body: buildInfo('a'.repeat(40)), type: 'application/json' },
    '/': { status: 200, body: OUR_APP, type: 'text/html' },
  });
  try {
    const r = await check({
      store: 'x/y', storeRef: 'main',
      hosts: [
        withHost(`http://127.0.0.1:${server.address().port}`, { id: 'pages', role: 'publish-path' }, { expect: 'build-info', requireCurrentStore: true }),
        withHost(`http://127.0.0.1:${server.address().port}`, { id: 'app', role: 'app' }, { expect: 'html', markers: ['<title>Belmont County News WebApp</title>'], forbidden: ['Website Not Found'] }),
      ],
    });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /2\/2 hosts served/);
    assert.match(r.stdout, /OK    pages/);
    assert.match(r.stdout, /OK    app/);
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
    '/build-info.json': { status: 200, body: buildInfo('c'.repeat(40)), type: 'application/json' },
  });
  try {
    const r = await check({
      store: 'x/y', storeRef: 'main',
      hosts: [withHost(`http://127.0.0.1:${server.address().port}`, { id: 'netlify' }, { expect: 'build-info', requireCurrentStore: false })],
    });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /store commit cccccccc/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('a retired host still serving nothing of ours exits 0 and says so', async () => {
  const server = await serve({ '/': { status: 200, body: WEBSITE_NOT_FOUND, type: 'text/html' } });
  try {
    const r = await check({
      store: 'x/y', storeRef: 'main',
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
      store: 'x/y', storeRef: 'main',
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
      store: 'x/y', storeRef: 'main',
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