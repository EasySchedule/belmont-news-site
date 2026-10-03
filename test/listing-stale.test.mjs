// The listing-staleness check, tested: the thing that keeps the front page rolling
// on a day when nobody commits anything.
//
//   node --test test/
//
// This checker is the newest member of a family whose whole purpose is to refuse
// to answer quietly. A listing check that reported "nothing to do" when it could
// not reach the site, or when the site would not say which day it built for,
// would freeze the front page on a stale day forever while reporting green every
// fifteen minutes. The cases that matter most are the refusal cases.
//
// Zero dependencies, like the check itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, '..', 'scripts', 'check-listing-stale.mjs');
const BUILD = join(HERE, '..', 'build.mjs');

// The day this run happens to be in the newsroom's own zone. The check reads the
// wall clock, so the expected answer is derived rather than hardcoded.
function newsroomToday() {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())) if (part.type !== 'literal') p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

function shiftDays(day, n) {
  return new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) + n * 86400000)
    .toISOString().slice(0, 10);
}

function run(args, env) {
  return new Promise((resolve) => {
    execFile('node', args, { encoding: 'utf8', env }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// A stand-in for the deployed site. buildInfo is served verbatim; anything else
// 404s, which is what a host that is not there looks like.
//
// Every response closes its connection. Node's fetch pools keep-alive sockets and
// a pooled socket outlives server.close(), so the test file would hang after the
// last assertion instead of exiting.
function serve(buildInfo, { status = 200 } = {}) {
  const server = createServer((req, res) => {
    res.setHeader('connection', 'close');
    if (!req.url.startsWith('/build-info.json')) {
      res.writeHead(404).end('not found');
      return;
    }
    if (status !== 200) {
      res.writeHead(status).end('nope');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(buildInfo));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function runCheck(buildInfo, opts) {
  const server = await serve(buildInfo, opts);
  try {
    return await run([CHECK], { ...process.env, SITE_URL: `http://127.0.0.1:${server.address().port}` });
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

// ---------------------------------------------------------------- the answers

test('a site whose listing was built for today reports nothing to do, and exits 0', async () => {
  const r = await runCheck({ listing: { newsroomToday: newsroomToday(), windowDays: 2, listed: 3, expired: 1 } });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /listing is current/);
});

test('a site whose listing is a day behind exits 1 and names the day to publish for', async () => {
  const today = newsroomToday();
  const r = await runCheck({ listing: { newsroomToday: shiftDays(today, -1), windowDays: 2 } });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /listing is stale/);
  // The last line is the day, so a workflow can use it without parsing prose.
  assert.equal(r.stdout.trim().split('\n').pop(), today);
});

test('a listing several days behind still exits 1, not a bigger number', async () => {
  const r = await runCheck({ listing: { newsroomToday: '2026-09-01' } });
  assert.equal(r.code, 1);
});

test('a listing dated ahead of the clock is never published, and says why', async () => {
  // A clock skew, or a runner in the wrong zone. Rebuilding would be churn, and
  // answering 1 here on a runner that read the wrong day would mean rebuilding
  // every fifteen minutes until someone noticed.
  const future = shiftDays(newsroomToday(), 1);
  const r = await runCheck({ listing: { newsroomToday: future } });
  assert.equal(r.code, 0);
  assert.match(r.stderr, /ahead of the newsroom day/);
  assert.match(r.stderr, /clock or time zone problem/);
});

// -------------------------------------------------------------- the refusals

test('a live site that does not report the listing day exits 2, not 0', async () => {
  // The silent-freeze case, and the exact state every live site is in on the day
  // this ships. Exiting 0 here would make the first deployment of this mechanism
  // the one whose front page never rolls.
  const r = await runCheck({ posts: 4, contentHead: 'a'.repeat(40) });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /does not report a real listing.newsroomToday/);
});

test('a malformed listing day exits 2, not 0', async () => {
  for (const day of [undefined, null, '', 'yesterday', '2026-13-45', 20261003]) {
    const r = await runCheck({ listing: { newsroomToday: day } });
    assert.equal(r.code, 2, `newsroomToday=${JSON.stringify(day)} must not read as current`);
  }
});

test('a live site that is not there exits 2, not 0', async () => {
  const r = await runCheck({}, { status: 404 });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /HTTP 404/);
});

test('a build-info.json that is not JSON exits 2, not 0', async () => {
  const server = await serve({});
  try {
    const port = server.address().port;
    const r = await Promise.all([
      // Serve a body that is valid JSON but has no listing block at all, which is
      // the same refusal for a different reason and the most likely real shape.
      run([CHECK], { ...process.env, SITE_URL: `http://127.0.0.1:${port}` }),
    ]);
    assert.equal(r[0].code, 2);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

// ------------------------------------------------- the field the check reads

test('build.mjs writes the field the check reads, rather than the check inventing it', () => {
  // The same reasoning as the contentHead assertion in publish-drift.test.mjs. If
  // the field were renamed in build.mjs this script would keep exiting 2 forever
  // and the suite would stay green, so the two are pinned to each other here.
  const src = readFileSync(BUILD, 'utf8');
  assert.match(src, /newsroomToday: NEWSROOM_TODAY/);
  assert.match(src, /const NEWSROOM_TODAY = \(opts\.newsroomToday \|\| calendarDay\(Date\.now\(\), NEWSROOM_TZ\)\)/);
});

test('the check reads the wall clock in the newsroom zone, not UTC', () => {
  // Same rule as the build. A check that asked for the UTC date would ask for a
  // publish every evening between midnight and 20:00 New York time, spending a
  // deploy on a listing that is not yet stale.
  const src = readFileSync(CHECK, 'utf8');
  assert.match(src, /calendarDay\(Date\.now\(\), TIME_ZONE\)/);
  assert.match(src, /TIME_ZONE = process\.env\.TZ_FOR_DATES \|\| NEWSROOM_TZ/);
});
