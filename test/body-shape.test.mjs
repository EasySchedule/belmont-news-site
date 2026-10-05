// The body's shape, tested. Run with: node --test
//
// On 2026-10-02 a live page rendered the Paperclip document API response instead of
// the story: HTTP 200, 9,711 bytes, a valid h1, a valid byline, and the article
// trapped inside as an escaped string under a "body" key. Nothing signalled failure,
// and the gate that stops an unsourced or badly-bylined post said nothing about it,
// because it only ever read the front matter.
//
// The diagnosis is worth having in the test file, because it is not the one the
// issue guessed. Nothing in the build reads a wrong field. `parseFrontMatter`
// returns everything after the closing `---` as the body and `postPage` renders it.
// There is no field selection anywhere in the pipeline, so there was no field to get
// wrong: the file itself contained the whole API response where markdown belonged.
//
// So the guard is on the input, and its job is to make that shape impossible to
// publish again. Which means the tests below are mostly about what it must NOT
// refuse. A gate that stops legitimate stories is a gate that gets deleted, and then
// the next JSON blob ships.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(REPO, 'build.mjs');

const FRONT = [
  'title: "A headline long enough to pass the schema"',
  'dek: "One sentence under the headline."',
  'date: 2026-10-02',
  'edition: evening',
  'byline: Margaret Vance',
  'category: weather',
  'slug: morning-briefing-2026-10-02-evening',
  'sources:',
  '  - type: document',
  '    title: "Gridpoint forecast PBZ/50,48"',
  '    organization: "National Weather Service, forecast office Pittsburgh PA"',
  '    retrieved: 2026-10-02',
].join('\n');

function buildWithBody(body, front = FRONT) {
  const root = mkdtempSync(join(tmpdir(), 'belmont-shape-'));
  try {
    const file = join(root, 'content', '2026', '10', '2026-10-02', 'margaret-vance--morning-briefing-2026-10-02-evening.md');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `---\n${front}\n---\n\n${body}\n`);
    const r = spawnSync('node', [BUILD, '--content', join(root, 'content'), '--out', join(root, 'dist'), '--site-url', 'https://example.test', '--newsroom-today', '2026-10-02'], {
      cwd: root,
      encoding: 'utf8',
    });
    let html = '';
    try { html = readFileSync(join(root, 'dist', '2026-10-02', 'morning-briefing-2026-10-02-evening', 'index.html'), 'utf8'); } catch { /* not written */ }
    return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', html };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// The shape as it actually shipped: a whole document record, keys and all.
const DOCUMENT_RESPONSE = JSON.stringify({
  id: '022ea0dc-0996-4b21-8b25-21c2fe34e21f',
  companyId: 'e932f2d1-8b59-4754-a733-7e1f5428778c',
  issueId: '1e4c01a0-61c5-40eb-b1ad-bd8cdad57b49',
  key: 'morning-briefing-2026-10-02-evening',
  title: 'Morning Briefing - Evening Edition 2026-10-02 20:00 EDT',
  format: 'markdown',
  body: '# Morning Briefing\n\nRain before eight, then a dry weekend.\n\n## Tonight\n\nShowers.',
  latestRevisionId: '9f0c1f52-2a44-4d2e-9a10-3c9d4b7a51ee',
  latestRevisionNumber: 3,
  createdByAgentId: '75f6db11-63b4-4374-b2d6-cbaeebf1eb02',
  lockedByAgentId: null,
  sourceTrust: null,
});

// ---------------------------------------------------- what must be refused

test('a body that is a document API response fails the build and names the recovery', () => {
  const r = buildWithBody(DOCUMENT_RESPONSE);
  assert.equal(r.code, 1, 'this must stop the deploy, not warn on the way past');
  assert.match(r.stderr, /body is a Paperclip document API response/);
  // The instruction has to be actionable on its own, because the person reading it
  // is a reporter at 20:00, not the person who wrote the pipeline.
  assert.match(r.stderr, /Write the markdown that is the value of "body" here/);
  assert.match(r.stderr, /nothing here selects one/, 'the diagnosis, not a guess about it');
  assert.match(r.stderr, /still recoverable/, 'and the text is not lost');
  assert.equal(r.html, '', 'nothing may be written to dist when the body is this shape');
});

test('the refusal names the file, so a build with many posts points at one line', () => {
  const r = buildWithBody(DOCUMENT_RESPONSE);
  assert.match(r.stderr, /margaret-vance--morning-briefing-2026-10-02-evening\.md/);
});

test('a body that is a JSON object or array fails the build', () => {
  // Not a document record — any single JSON object or array. If the whole body is a
  // data value there is no article in it, whatever the keys happen to be.
  for (const body of ['{"a":1}', '[{"a":1}]', '[]', '{}', '[\n  {"a":1},\n  {"b":2}\n]']) {
    const r = buildWithBody(body);
    assert.equal(r.code, 1, `accepted a data document as a story: ${body}`);
  }
});

test('a bare JSON scalar is not refused, because a paragraph can start with one', () => {
  // `"a pull quote"` and `2026 is the year` are both ordinary prose openings. The
  // guard is deliberately restricted to `{` and `[`, which is the shape a serialized
  // document actually takes. Widening it to every JSON scalar would refuse a pull
  // quote, and a gate that refuses pull quotes gets deleted.
  for (const body of ['"A pull quote opening the story."', '42', 'true', 'null']) {
    const r = buildWithBody(body);
    assert.equal(r.code, 0, `refused prose that happens to start like JSON: ${body} (${r.stderr})`);
  }
});

test('an empty body fails the build', () => {
  const r = buildWithBody('   ');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /body is empty/);
});

// ------------------------------------------------- what must NOT be refused

test('a story that opens with a brace is still a story', () => {
  // It starts like JSON and is not JSON, so there is prose in it and this gate has
  // no business. Refusing this would train the desk to work around the gate.
  const r = buildWithBody('{The county fair board met Tuesday} and set the premium at $12.');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.html, /county fair board met Tuesday/);
});

test('a story that opens with a bracket is still a story', () => {
  const r = buildWithBody('[Photo: the wall at the fairgrounds, taken 2026-10-02.] The exhibit closes Sunday.');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.html, /exhibit closes Sunday/);
});

test('a fenced code block holding JSON does not trip the gate', () => {
  // A weather post that quotes the endpoint response is a legitimate story. The
  // test is that the ENTIRE body parses as one JSON value; prose around a fence
  // means it cannot.
  const r = buildWithBody([
    'The alert endpoint returned this at 22:30Z:',
    '',
    '```json',
    '{"features": []}',
    '```',
    '',
    'Zero alerts, which is a statement about the moment of retrieval.',
  ].join('\n'));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.html, /Zero alerts/);
  assert.match(r.html, /features/);
});

test('prose that merely mentions JSON publishes normally', () => {
  const r = buildWithBody('The response was `{"features":[]}` and the zone was quiet.');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.html, /the zone was quiet/);
});

test('an ordinary post still builds and still renders its markdown', () => {
  const r = buildWithBody('## Evening\n\nShowers before eight, then a dry weekend.');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.html, /<h2>Evening<\/h2>/);
  assert.doesNotMatch(r.html, /&quot;/, 'no escaped JSON anywhere in the page');
});

// -------------------------------------------------- what the guard buys

test('no governance field can reach a published page through this shape', () => {
  // `sourceTrust` and `lockedByAgentId` are document-governance fields with no
  // business being public under any rendering rule, and the served page carried all
  // of them HTML-escaped in its own source. A `.body`-only fix would have left every
  // one of them in the bytes. The guard refuses the file instead, so there is
  // nothing to redact because there is nothing to render.
  const r = buildWithBody(DOCUMENT_RESPONSE);
  assert.equal(r.code, 1);
  assert.equal(r.html, '', 'no page is written at all');
  // And the rendered form of the same post, once repaired, carries no envelope keys.
  const ok = buildWithBody('# Morning Briefing\n\nRain before eight.');
  assert.equal(ok.code, 0, ok.stderr);
  const unescaped = ok.html.replace(/&quot;/g, '"');
  for (const key of ['companyId', 'issueId', 'latestRevisionId', 'latestRevisionNumber', 'createdByAgentId', 'lockedByAgentId', 'sourceTrust']) {
    assert.ok(!unescaped.includes(`"${key}"`), `${key} leaked into the page`);
  }
});