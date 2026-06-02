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

// posting to a resolved thread is rejected
const afterResolve = await run(['post', '--thread', T, '--as', 'author', '--body', 'late']);
check('post: rejected after resolve', afterResolve.code === 1 && /resolved/.test(afterResolve.err));

// non-participant is rejected
const stranger = await run(['post', '--thread', T, '--as', 'gemini', '--body', 'hi']);
check('post: rejected for non-participant', stranger.code === 1);

// --- wait returns immediately when already resolved ---
const w = await run(['wait', '--thread', T, '--as', 'author', '--timeout', '2']);
check('wait: exits 0 on resolved thread', w.code === 0);
check('wait: reports resolved', /status=resolved/.test(w.out));

// --- wait returns when it is your turn ---
const T2 = 'turn';
await run(['init', '--thread', T2, '--participants', 'a,b']);
await run(['post', '--thread', T2, '--as', 'a', '--body', 'over to you']);
const wt = await run(['wait', '--thread', T2, '--as', 'b', '--timeout', '3', '--interval', '1']);
check('wait: returns on your turn', wt.code === 0 && /your turn/.test(wt.out));

// --- wait times out (exit 2) when it is not your turn ---
const wto = await run(['wait', '--thread', T2, '--as', 'a', '--timeout', '1', '--interval', '1']);
check('wait: exit 2 on timeout', wto.code === 2);

// --- concurrency: two simultaneous posts must not collide on the index ---
const T3 = 'race';
await run(['init', '--thread', T3, '--participants', 'a,b']);
await Promise.all([
  run(['post', '--thread', T3, '--as', 'a', '--body', 'concurrent-1']),
  run(['post', '--thread', T3, '--as', 'b', '--body', 'concurrent-2']),
]);
check('lock: both concurrent posts survive', indices(T3).length === 2);
check('lock: concurrent indices are unique', new Set(indices(T3)).size === 2);

// --- round cap surfaces in wait output ---
const T4 = 'cap';
await run(['init', '--thread', T4, '--participants', 'a,b', '--round-cap', '2']);
await run(['post', '--thread', T4, '--as', 'a', '--body', 'm1']);
await run(['post', '--thread', T4, '--as', 'b', '--body', 'm2']);
const cap = await run(['wait', '--thread', T4, '--as', 'a', '--timeout', '2']);
check('cap: round cap warning shown', /ROUND CAP/.test(cap.out));

fs.rmSync(TMP, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
