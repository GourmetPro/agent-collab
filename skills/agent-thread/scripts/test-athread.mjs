#!/usr/bin/env node
// Self-contained test for athread.mjs. Run: node test-athread.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const AT = path.join(here, 'athread.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'athread-test-'));
const env = { ...process.env, ATHREAD_DIR: TMP };

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('node', [AT, ...args], { env });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
    p.on('error', reject);
  });
}
const meta = (t) => JSON.parse(fs.readFileSync(path.join(TMP, t, 'meta.json'), 'utf8'));
const indices = (t) => fs.readdirSync(path.join(TMP, t)).filter((f) => /^\d{4}\./.test(f)).sort().map((f) => f.slice(0, 4));

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} - ${name}`);
  if (!cond) failures++;
};

// --- core turn-taking flow ---
const T = 'flow';
await run(['init', '--thread', T, '--participants', 'author,reviewer']);
check('init: turn starts at author', meta(T).turn === 'author');
check('init: status open', meta(T).status === 'open');

await run(['post', '--thread', T, '--as', 'author', '--body', 'please review X']);
check('post: turn flips to reviewer', meta(T).turn === 'reviewer');

await run(['post', '--thread', T, '--as', 'reviewer', '--body', '1. issue a']);
check('post: turn flips back to author', meta(T).turn === 'author');

await run(['post', '--thread', T, '--as', 'author', '--body', 'fixed a']);
await run(['resolve', '--thread', T, '--as', 'reviewer', '--body', 'clean']);
check('resolve: status resolved', meta(T).status === 'resolved');
check('flow: four sequential messages', indices(T).join(',') === '0001,0002,0003,0004');

const afterResolve = await run(['post', '--thread', T, '--as', 'author', '--body', 'late']);
check('post: rejected after resolve', afterResolve.code === 1 && /resolved/.test(afterResolve.err));

const stranger = await run(['post', '--thread', T, '--as', 'gemini', '--body', 'hi']);
check('post: rejected for non-participant', stranger.code === 1);

// --- turn enforcement ---
const E = 'enforce';
await run(['init', '--thread', E, '--participants', 'a,b']); // turn = a
const wrongTurn = await run(['post', '--thread', E, '--as', 'b', '--body', 'not my turn']);
check('turn: out-of-turn post rejected', wrongTurn.code === 1 && /not your turn/.test(wrongTurn.err));
check('turn: rejected post leaves no message', indices(E).length === 0);
const forced = await run(['post', '--thread', E, '--as', 'b', '--body', 'forced', '--force']);
check('turn: --force overrides turn', forced.code === 0 && indices(E).length === 1);

// --- init guards an existing thread ---
const R = 'reinit';
await run(['init', '--thread', R, '--participants', 'a,b']);
await run(['post', '--thread', R, '--as', 'a', '--body', 'first']);
const reinit = await run(['init', '--thread', R, '--participants', 'x,y']);
check('init: refuses existing thread', reinit.code === 1 && /already exists/.test(reinit.err));
check('init: refused reinit preserves participants', meta(R).participants.join(',') === 'a,b');
const reforce = await run(['init', '--thread', R, '--participants', 'x,y', '--force']);
check('init: --force resets participants', reforce.code === 0 && meta(R).participants.join(',') === 'x,y');
check('init: --force clears old messages', indices(R).length === 0);

// --- participant validation ---
const one = await run(['init', '--thread', 'p1', '--participants', 'solo']);
check('init: rejects a single participant', one.code === 1);
const dup = await run(['init', '--thread', 'p2', '--participants', 'a,a']);
check('init: rejects duplicate participants', dup.code === 1);
const three = await run(['init', '--thread', 'p3', '--participants', 'a,b,c']);
check('init: rejects three participants', three.code === 1);

// --- id safety / path traversal (unique outside name so the check is self-owned) ---
const escName = `escape-${process.pid}-${Date.now()}`;
const escape = await run(['init', '--thread', `../${escName}`, '--participants', 'a,b']);
check('id: rejects path-traversing thread id', escape.code === 1);
check('id: nothing written outside the root', !fs.existsSync(path.join(path.dirname(TMP), escName)));

// --- wait returns immediately when already resolved ---
const w = await run(['wait', '--thread', T, '--as', 'author', '--timeout', '2']);
check('wait: exits 0 on resolved thread', w.code === 0 && /status=resolved/.test(w.out));

// --- wait returns when it is your turn ---
const T2 = 'turn';
await run(['init', '--thread', T2, '--participants', 'a,b']);
await run(['post', '--thread', T2, '--as', 'a', '--body', 'over to you']);
const wt = await run(['wait', '--thread', T2, '--as', 'b', '--timeout', '3', '--interval', '1']);
check('wait: returns on your turn', wt.code === 0 && /your turn/.test(wt.out));
const wto = await run(['wait', '--thread', T2, '--as', 'a', '--timeout', '1', '--interval', '1']);
check('wait: exit 2 on timeout', wto.code === 2);

// --- numeric arg validation (a bad timeout must fail fast, not hang) ---
const badTimeout = await run(['wait', '--thread', T2, '--as', 'a', '--timeout', 'nope', '--interval', '1']);
check('wait: rejects non-numeric timeout (no hang)', badTimeout.code === 1 && /timeout/.test(badTimeout.err));
const badInterval = await run(['wait', '--thread', T2, '--as', 'a', '--timeout', '5', '--interval', '-1']);
check('wait: rejects non-positive interval', badInterval.code === 1);
const badCap = await run(['init', '--thread', 'badcap', '--participants', 'a,b', '--round-cap', '0']);
check('init: rejects non-positive round-cap', badCap.code === 1);

// --- participant checks on wait + kickoff (no silent stall / dead launcher) ---
const waitStranger = await run(['wait', '--thread', T2, '--as', 'stranger', '--timeout', '2']);
check('wait: rejects non-participant', waitStranger.code === 1 && /not a participant/.test(waitStranger.err));
const koStranger = await run(['kickoff', '--thread', T2, '--as', 'typo']);
check('kickoff: rejects non-participant handle', koStranger.code === 1 && /not a participant/.test(koStranger.err));

// --- concurrency: two simultaneous (forced) writes must not collide on index ---
const T3 = 'race';
await run(['init', '--thread', T3, '--participants', 'a,b']);
await Promise.all([
  run(['post', '--thread', T3, '--as', 'a', '--body', 'concurrent-1', '--force']),
  run(['post', '--thread', T3, '--as', 'b', '--body', 'concurrent-2', '--force']),
]);
check('lock: both concurrent forced posts survive', indices(T3).length === 2);
check('lock: concurrent indices are unique', new Set(indices(T3)).size === 2);

// --- round cap surfaces in wait output ---
const T4 = 'cap';
await run(['init', '--thread', T4, '--participants', 'a,b', '--round-cap', '2']);
await run(['post', '--thread', T4, '--as', 'a', '--body', 'm1']);
await run(['post', '--thread', T4, '--as', 'b', '--body', 'm2']);
const cap = await run(['wait', '--thread', T4, '--as', 'a', '--timeout', '2']);
check('cap: round cap warning shown', /ROUND CAP/.test(cap.out));

// --- kickoff is shell-safe even when the root path contains a space ---
const SPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'athread test ')); // note the space
{
  const spaceEnv = { ...process.env, ATHREAD_DIR: SPACE };
  const sp = (args) => new Promise((res) => {
    const p = spawn('node', [AT, ...args], { env: spaceEnv });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => res({ code, out, err }));
  });
  await sp(['init', '--thread', 'k', '--participants', 'claude,codex']);
  const ko = await sp(['kickoff', '--thread', 'k', '--as', 'codex']);
  check('kickoff: single-quotes the ATHREAD_DIR path', /export ATHREAD_DIR='[^']*athread test [^']*'/.test(ko.out));
  check('kickoff: quotes the AT path', /\bAT='[^']*athread\.mjs'/.test(ko.out));
  check('kickoff: greeting is a handle label, not an identity claim', /Your thread handle is "codex"/.test(ko.out) && !/You are "codex"/.test(ko.out));
  check('kickoff: tells the peer to load the agent-thread skill', /"agent-thread" skill is available/.test(ko.out));
  check('kickoff: points at SKILL.md when it exists on disk', /its entrypoint is: \S*SKILL\.md/.test(ko.out));
}
fs.rmSync(SPACE, { recursive: true, force: true });

fs.rmSync(TMP, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
