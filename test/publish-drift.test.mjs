// Test the publish-drift check: the thing that decides whether a blogs merge
// publishes the site.
//
//   node --test test/
//
// This is the check standing between the newsroom and the failure this exists
// to fix, so the cases that matter most are the ones where it must refuse to
// answer. A checker that reports "no change" when it could not read the store,
// or when the live site will not say what it rendered, is the original bug with
// a green run attached to it.
//
// Zero dependencies, like the build and the check itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, '..', 'scripts', 'check-blogs-ahead.mjs');
const BUILD = join(HERE, '..', 'build.mjs');

const HEAD_A = 'a'.repeat(40);
const HEAD_B = 'b'.repeat(40);

// execFile, not execFileSync: the stand-in site runs in this same process, and
// a synchronous child would block the event loop that has to answer it. The
// check would wait on a server that could never be scheduled, and the test
// would hang rather than fail.
function run(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// A store whose `git ls-remote` always answers with this head, so the check can
// be driven without touching the network or a real repository.
function fakeStoreOnPath(head, binDir) {
  const git = join(binDir, 'git');
  execFileSync('sh', ['-c', `cat > "${git}" <<'EOF'
#!/bin/sh
if [ "$1" = "ls-remote" ]; then
  echo "${head}	refs/heads/main"
  exit 0
fi
exit 1
EOF
chmod +x "${git}"`]);
  return binDir;
}

// A stand-in for the deployed site. `buildInfo` is served verbatim; anything
// else 404s, which is what a host that is not there looks like.
//
// Every response closes its connection. Node's fetch pools keep-alive sockets,
// and a pooled socket outlives server.close(), so the test file would hang
// after the last assertion instead of exiting.
function serveBuildInfo(buildInfo, { status = 200 } = {}) {
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

async function runCheck({ storeHead, buildInfo, status }) {
  const binDir = join(HERE, '..', '.test-bin-tmp');
  execFileSync('mkdir', ['-p', binDir]);
  fakeStoreOnPath(storeHead, binDir);
  const server = await serveBuildInfo(buildInfo, { status });
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    return await run('node', [CHECK], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, SITE_URL: url, BLOGS_REPO: 'EasySchedule/belmont-news-blogs' },
    });
  } finally {
    server.closeAllConnections();
    server.close();
    execFileSync('rm', ['-rf', binDir]);
  }
}

test('a site already rendering the store head reports no drift, and exits 0', async () => {
  const r = await runCheck({ storeHead: HEAD_A, buildInfo: { contentHead: HEAD_A } });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /site is current/);
});

test('a site behind the store exits 1 and prints the store head to publish', async () => {
  const r = await runCheck({ storeHead: HEAD_B, buildInfo: { contentHead: HEAD_A } });
  assert.equal(r.code, 1);
  assert.match(r.stdout, /site is behind/);
  // The last line is the head, so a workflow can read it without parsing prose.
  assert.equal(r.stdout.trim().split('\n').pop(), HEAD_B);
});

test('a live site that will not say what it rendered exits 2, not 0', async () => {
  // This is the silent-failure case. The site is up but carries no contentHead,
  // so the check cannot prove the site is current. Exiting 0 here would leave
  // the first deployment of this mechanism as the one that never publishes.
  const r = await runCheck({ storeHead: HEAD_B, buildInfo: { posts: 5 } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /does not report a contentHead/);
});

test('a live site that is not there exits 2, not 0', async () => {
  const r = await runCheck({ storeHead: HEAD_B, buildInfo: {}, status: 404 });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /HTTP 404/);
});

test('the store head must be a real commit, or the check exits 2', async () => {
  const r = await runCheck({ storeHead: 'not-a-sha', buildInfo: { contentHead: HEAD_A } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /no usable head/);
});

test('build-info.json reports the markdown commit the build rendered', () => {
  // The check is only as good as this field, so the field is asserted against
  // the build itself rather than against a hand-written object. build.mjs reads
  // the manifest sync-content.mjs writes; without the stamp there is nothing to
  // compare and the check above can only ever exit 2.
  const src = readFileSync(BUILD, 'utf8');
  assert.match(src, /contentHead: synced\.head/);
  assert.match(src, /contentSource: synced\.source/);
});
