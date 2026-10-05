// Test the publish dispatch: the last step between a detected drift and a deploy.
//
//   node --test test/
//
// test/publish-drift.test.mjs covers the first half of that sentence. This file
// covers the second. They are separate defects and the split is the point: a
// drift check that says "publish" and a dispatch that publishes are two different
// claims, and between 2026-10-03 and 2026-10-05 the first was green on thirteen
// consecutive runs while the second did nothing at all. Nothing in the repository
// tested the second claim, so a workflow could decide to publish correctly and
// still never publish, and every test still passed.
//
// The headline test is the first one below: a detected drift, dispatched and
// confirmed, is a deploy that exists. That sentence is the whole requirement, and
// nothing else in the codebase asserts it.
//
// These drive the real script against a stand-in Actions API on localhost. The
// script talks to GITHUB_API_URL, which is the variable the runner already sets,
// so the path under test is the path that ships. No token, no network, no git.
//
// Zero dependencies, like the build, the checks and the script itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SCRIPT = join(ROOT, 'scripts', 'publish-now.mjs');
const PROBE_WORKFLOW = join(ROOT, '.github', 'workflows', 'publish-on-blogs-update.yml');
const PUBLISH_WORKFLOW = join(ROOT, '.github', 'workflows', 'pages.yml');

const REPO = 'EasySchedule/belmont-news-site';
const TOKEN = 'not-a-real-token';

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

// A stand-in for the two Actions endpoints publish-now.mjs uses.
//
//   onDispatch  called with (attemptNumber, body) when the dispatch endpoint is
//               hit. Return {status, message} to refuse, or {} to accept.
//   onRuns      called with the query on the runs listing. Return {status, runs}.
//
// Both default to a clean accept and an empty listing, which is the world in
// which a dispatch is accepted and nothing comes of it.
let dispatches = 0;

function actionsApi({ onDispatch, onRuns } = {}) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const reply = (status, payload) => {
      // Every response closes its connection, for the reason given in
      // publish-drift.test.mjs: a pooled keep-alive socket outlives
      // server.close() and the test file hangs instead of exiting.
      res.setHeader('connection', 'close');
      if (payload === undefined) res.writeHead(status).end();
      else res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
    };

    if (req.method === 'POST' && url.pathname.endsWith('/dispatches')) {
      dispatches += 1;
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let parsed = {};
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          /* a malformed body is the caller's problem, not the stand-in's */
        }
        const outcome = onDispatch?.(dispatches, parsed) ?? {};
        reply(outcome.status ?? 204, outcome.message ? { message: outcome.message } : undefined);
      });
      return;
    }

    if (req.method === 'GET' && url.pathname.endsWith('/runs')) {
      const outcome = onRuns?.(url.searchParams) ?? {};
      reply(outcome.status ?? 200, { total_count: outcome.runs?.length ?? 0, workflow_runs: outcome.runs ?? [] });
      return;
    }

    reply(404, { message: 'Not Found' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Run the real script against the stand-in. Timings are compressed to the floor
// the script allows so the suite stays quick; the logic under test does not read
// a clock for anything but the confirmation window.
async function publish({ api, env = {}, token = TOKEN, repo = REPO }) {
  return run('node', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      GITHUB_API_URL: api,
      GITHUB_TOKEN: token,
      PUBLISH_REPO: repo,
      WORKFLOW: 'pages.yml',
      REF: 'main',
      ATTEMPTS: '2',
      WAIT: '2',
      POLL: '1',
      ...env,
    },
  });
}

function workflowRun(number, over = {}) {
  return {
    id: 1000 + number,
    run_number: number,
    event: 'workflow_dispatch',
    status: 'queued',
    head_branch: 'main',
    created_at: new Date().toISOString(),
    html_url: `https://github.com/${REPO}/actions/runs/${1000 + number}`,
    ...over,
  };
}

// isoSecondsAgo beats subtracting from now() inside the handler: the script
// compares created_at strings, and a fractional-second "now" would sort after a
// truncated timestamp in a way that has nothing to do with the code under test.
function isoSecondsAgo(seconds) {
  return new Date(Date.now() - seconds * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
}

// --- the requirement -------------------------------------------------------

test('a dispatch that produces a run exits 0 and reports the deploy it caused', async () => {
  dispatches = 0;
  // The Actions API is not strongly consistent: it routinely answers the runs
  // listing before it has the run the dispatch just created. Answering empty a
  // couple of times first is what a real 204-then-moment-later looks like, and a
  // script that gave up on it would report a deploy that was about to happen as
  // one that did not.
  let listings = 0;
  const api = await actionsApi({
    onRuns: () => (++listings < 2 ? { runs: [] } : { runs: [workflowRun(41)] }),
  });
  try {
    const r = await publish({ api: `http://127.0.0.1:${api.address().port}` });
    assert.equal(r.code, 0);
    assert.equal(dispatches, 1, 'a confirmed dispatch must not be sent again');
    assert.match(r.stderr, /pages\.yml run #41 is queued/);
    // stdout is the run URL and nothing else, because the workflow captures it
    // into a job output. A progress line here would end up inside that value.
    assert.equal(r.stdout, `https://github.com/${REPO}/actions/runs/1041\n`);
  } finally {
    api.closeAllConnections();
    api.close();
  }
});

// --- the thirteen failures, in the shape they really took -----------------

test('a dispatch the API refuses on every attempt exits 1 and prints the refusal', async () => {
  dispatches = 0;
  // "HTTP 403 Resource not accessible by integration" against "HTTP 404 Not
  // Found" is the difference between a permission problem and a wrong
  // repository name, and the newsroom should not have to guess which one it has.
  // The API's own message has to survive into the log.
  const api = await actionsApi({ onDispatch: () => ({ status: 403, message: 'Resource not accessible by integration' }) });
  try {
    const r = await publish({ api: `http://127.0.0.1:${api.address().port}` });
    assert.equal(r.code, 1, 'a refused dispatch must never read as success');
    assert.match(r.stderr, /Resource not accessible by integration/);
    assert.match(r.stderr, /The site is NOT published/);
    assert.equal(dispatches, 2, 'it retries once, then gives up rather than looping');
  } finally {
    api.closeAllConnections();
    api.close();
  }
});

test('a dispatch accepted with no run behind it is retried, and the retry is what counts', async () => {
  dispatches = 0;
  // 204 and silence. The request succeeded, nothing deployed, and the first
  // probe could not tell the difference. This is the whole defect: if the
  // response to "accepted" were also the response to "published", the run would
  // be green over a site nobody had republished.
  const api = await actionsApi({
    onDispatch: (attempt) => (attempt === 1 ? {} : {}),
    onRuns: (_q) => (dispatches > 1 ? { runs: [workflowRun(42)] } : { runs: [] }),
  });
  try {
    const r = await publish({ api: `http://127.0.0.1:${api.address().port}` });
    assert.equal(r.code, 0);
    assert.equal(dispatches, 2, 'accepted-then-silent must be retried, not believed');
    assert.match(r.stderr, /no pages\.yml run appeared within 2s/);
    assert.equal(r.stdout.trim().split('\n').pop(), `https://github.com/${REPO}/actions/runs/1042`);
  } finally {
    api.closeAllConnections();
    api.close();
  }
});

test('a dispatch that is accepted and never produces a run exits 1', async () => {
  dispatches = 0;
  const api = await actionsApi();
  try {
    const r = await publish({ api: `http://127.0.0.1:${api.address().port}` });
    assert.equal(r.code, 1);
    assert.equal(dispatches, 2);
    assert.match(r.stderr, /The site is NOT published/);
    assert.match(r.stderr, /a detected drift with no deploy is this failure/i);
  } finally {
    api.closeAllConnections();
    api.close();
  }
});

// --- a confirmation that could confirm the wrong thing ---------------------

test('a run from before this probe is not accepted as its own dispatch', async () => {
  dispatches = 0;
  // pages.yml runs on every push to main, so the runs listing for this workflow
  // is normally full of deploys this probe did not ask for. Confirming against
  // one of those turns the check into a green light that is always on: the probe
  // would report a deploy for a request it never made, and the drift it detected
  // would still be sitting there unpublished.
  const api = await actionsApi({ onRuns: () => ({ runs: [workflowRun(7, { created_at: isoSecondsAgo(3600) })] }) });
  try {
    const r = await publish({ api: `http://127.0.0.1:${api.address().port}` });
    assert.equal(r.code, 1, 'an hour-old run must not pass as a fresh dispatch');
    assert.match(r.stderr, /The site is NOT published/);
  } finally {
    api.closeAllConnections();
    api.close();
  }
});

test('a push-triggered build is not the dispatch this probe made', async () => {
  dispatches = 0;
  // Same workflow, right now, not from us. A push to main already builds and
  // deploys the store, so this particular case is close to harmless; the reason
  // to exclude it is that the moment pages.yml grows a second trigger the same
  // code would claim credit for someone else's deploy.
  const api = await actionsApi({
    onRuns: () => ({ runs: [workflowRun(8, { event: 'push', created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') })] }),
  });
  try {
    const r = await publish({ api: `http://127.0.0.1:${api.address().port}` });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /The site is NOT published/);
  } finally {
    api.closeAllConnections();
    api.close();
  }
});

// --- the step's own shell --------------------------------------------------

// The dispatch step captures the run URL out of a command substitution, which is
// the one place a failed publish could still be laundered into a green step.
// `url="$(false)"` under `set -e` fails; `url=$(false || true)` does not; and
// adding `|| true` to a line like this is exactly the kind of edit nobody notices
// afterwards. So the step's own script is extracted from the workflow and run
// here, against a stand-in `node`, rather than trusted.
function runBlockOf(file, stepName) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const at = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  assert.notEqual(at, -1, `${stepName} step not found in ${file}`);
  const start = lines.slice(at).findIndex((l) => /^\s*run: \|\s*$/.test(l));
  assert.notEqual(start + 1, 0, `${stepName} has no run: | block`);
  const indent = lines.slice(at)[start].match(/^\s*/)[0].length + 2;
  const body = [];
  for (const line of lines.slice(at + start + 1)) {
    if (line.trim() !== '' && line.match(/^\s*/)[0].length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join('\n');
}

async function runDispatchStep(nodeExit, nodeStdout) {
  const dir = mkdtempSync(join(tmpdir(), 'bel-335-'));
  const out = join(dir, 'gh_output');
  writeFileSync(out, '');
  // A `node` that answers with whatever this case needs. The step runs no other
  // external command, so replacing node is enough to drive it.
  const stub = join(dir, 'node');
  writeFileSync(stub, `#!/bin/sh\n[ -n "${nodeStdout ?? ''}" ] && printf '%s\\n' '${nodeStdout}'\nexit ${nodeExit}\n`);
  chmodSync(stub, 0o755);
  try {
    const script = runBlockOf(PROBE_WORKFLOW, 'Dispatch the publish');
    const r = await run('bash', ['-e', '-c', script], {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        HOME: process.env.HOME,
        GITHUB_OUTPUT: out,
        DRIFT: 'true',
        LISTING: 'true',
      },
    });
    return { ...r, output: readFileSync(out, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a confirmed dispatch puts the deploy url in the job output', async () => {
  const url = 'https://github.com/EasySchedule/belmont-news-site/actions/runs/1041';
  const r = await runDispatchStep(0, url);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /drift=true listing=true/);
  assert.equal(r.output.trim(), `url=${url}`);
});

test('a failed dispatch fails the step and writes no url', async () => {
  // The laundering case. If this step can end green with publish-now.mjs exiting
  // non-zero, the whole confirmation is decoration: the run goes green, the
  // summary reads "Nothing to publish" or "Dispatched" from a result that never
  // happened, and the newsroom is exactly where it was on 2026-10-04. The capture
  // must not absorb the failure.
  const r = await runDispatchStep(1, '');
  assert.notEqual(r.code, 0, 'a command substitution must not swallow a non-zero exit');
  assert.equal(r.output, '', 'no url may be written when the dispatch failed');
});

// --- refusing to guess ----------------------------------------------------

test('no token exits 2 without asking the API anything', async () => {
  dispatches = 0;
  // Sending an unauthenticated request to find out it is unauthenticated turns a
  // local configuration mistake into a rate-limited 401 against the real API,
  // from a scheduled run, on the path that is supposed to publish.
  const api = await actionsApi();
  try {
    const r = await publish({ api: `http://127.0.0.1:${api.address().port}`, token: '' });
    assert.equal(r.code, 2);
    assert.equal(dispatches, 0);
    assert.match(r.stderr, /no GITHUB_TOKEN/);
  } finally {
    api.closeAllConnections();
    api.close();
  }
});

test('a repository that is not owner/name exits 2 before any URL is built', async () => {
  dispatches = 0;
  // An empty repository produces /repos//actions/workflows/pages.yml/dispatches,
  // which answers 404 and reads like a permissions problem.
  const api = await actionsApi();
  try {
    for (const bad of ['', 'belmont-news-site', 'EasySchedule/']) {
      const r = await publish({ api: `http://127.0.0.1:${api.address().port}`, repo: bad });
      assert.equal(r.code, 2, `PUBLISH_REPO=${JSON.stringify(bad)} must not reach the API`);
      assert.match(r.stderr, /owner\/name/);
    }
    assert.equal(dispatches, 0);
  } finally {
    api.closeAllConnections();
    api.close();
  }
});

// --- the wiring, asserted in the file that ships ---------------------------
//
// Text assertions, and they are weaker than the tests above on purpose. They
// cannot prove the workflow calls the script; they can only prove the workflow
// has not gone back to the shape that lost thirteen runs. That is still worth
// having, because the thirteen runs were red on a schedule nobody was watching,
// and a red pull request is the only place anyone was going to look.

// Comment lines are dropped before any of these look at the file. Both workflows
// are mostly comment, and this repository's comments quote the commands they are
// warning against, so an assertion over the raw text trips on its own warnings.
function code(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

test('the probe dispatches through publish-now.mjs, and not through a bare gh call', () => {
  const src = code(PROBE_WORKFLOW);
  assert.match(src, /node scripts\/publish-now\.mjs/);

  // The exact regress. `gh workflow run` with no --repo resolves the target from
  // the git remote of the working directory, and the dispatch job used to run no
  // checkout, so it died on "fatal: not a git repository" before reaching the
  // API. Every such call has to name its repository, and the workflow has no use
  // for gh here at all.
  for (const line of src.split('\n').filter((l) => l.includes('gh workflow run'))) {
    assert.match(line, /--repo/, `gh workflow run must name its repository: ${line.trim()}`);
  }
});

test('the probe hands the script the token and an explicit repository', () => {
  const src = code(PROBE_WORKFLOW);
  assert.match(src, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(src, /PUBLISH_REPO: \$\{\{ github\.repository \}\}/);
  // actions: write is what permits the dispatch and the listing that confirms it.
  assert.match(src, /actions: write/);
});

test('the report cannot claim a publish it did not observe', () => {
  const src = code(PROBE_WORKFLOW);
  // The report has to depend on the dispatch job, or it cannot know its outcome.
  assert.match(src, /report:\n\s+name: Report\n\s+needs: \[drift, listing, dispatch\]/);
  // And it has to branch on the job's result, not on the probes' publish intent.
  // The old summary read `publish == 'true'` and printed "Dispatched pages.yml."
  // from that, which is why thirteen runs reported a deploy that never happened.
  assert.match(src, /needs\.dispatch\.result/);
  assert.ok(
    !/needs\.drift\.outputs\.publish[^\n]*\|\|[^\n]*needs\.listing\.outputs\.publish[^\n]*\n\s*then\s*\n\s*echo "Dispatched/.test(src),
    'the summary must not report a dispatch from the probes intention alone'
  );
  // A decided publish that did not happen is named as a failure, in words a
  // reader of the run page cannot misread.
  assert.match(src, /The publish was decided and did not happen/);
});

test('pages.yml still answers a dispatch', () => {
  // The dispatch endpoint 404s on a workflow with no workflow_dispatch trigger,
  // and the script cannot tell that apart from a permission failure, so the
  // trigger is part of the publish path and is asserted here.
  const src = code(PUBLISH_WORKFLOW);
  assert.match(src, /on:\n(?:.*\n)*?\s+workflow_dispatch:\n/);
  // And the retry in publish-now.mjs is only idempotent because of this. If a
  // duplicate deploy could reach a reader, the retry would be trading one
  // defect for a worse one.
  assert.match(src, /concurrency:\n\s+group: pages\n\s+cancel-in-progress: true/);
});