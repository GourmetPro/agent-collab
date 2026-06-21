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
const defaultEnv = { ...process.env };
delete defaultEnv.ATHREAD_DIR;

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
const runIn = (dirEnv, args) => new Promise((resolve) => {
  const p = spawn('node', [AT, ...args], { env: { ...process.env, ATHREAD_DIR: dirEnv } });
  let out = '', err = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => resolve({ code, out, err }));
});
const runWithEnv = (extraEnv, args, opts = {}) => new Promise((resolve) => {
  const p = spawn('node', [AT, ...args], { cwd: opts.cwd, env: { ...process.env, ...extraEnv } });
  let out = '', err = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => resolve({ code, out, err }));
});
const runDirect = (dirEnv, args) => new Promise((resolve) => {
  const p = spawn(AT, args, { env: { ...process.env, ATHREAD_DIR: dirEnv } });
  let out = '', err = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => resolve({ code, out, err }));
});
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
  check('kickoff: quotes the custom --root path',
    ko.out.includes(`--root '${SPACE}'`));
  check('kickoff: fallback uses the executable script directly',
    ko.out.includes(`${AT} wait --root '${SPACE}' --thread k --as codex`));
  check('kickoff: greeting is a handle label, not an identity claim', /Your thread handle is "codex"/.test(ko.out) && !/You are "codex"/.test(ko.out));
  check('kickoff: tells the peer to load the agent-thread skill', /Use the agent-thread skill/.test(ko.out));
  check('kickoff: points at SKILL.md when it exists on disk', /its entrypoint is: \S*SKILL\.md/.test(ko.out));
  check('kickoff: includes a turn contract for concrete handoffs',
    /Turn contract:/.test(ko.out) && /resolve only when/i.test(ko.out) && /what you need from the peer next/i.test(ko.out));
  check('kickoff: distinguishes managed background waits from shell backgrounding',
    /managed background terminal/i.test(ko.out) && /shell-background/i.test(ko.out));
}
fs.rmSync(SPACE, { recursive: true, force: true });

// --- git hygiene: self-ignore a dedicated `.agent-threads` root, never an arbitrary dir ---
const GIROOT = path.join(TMP, '.agent-threads');
await runIn(GIROOT, ['init', '--thread', 'g', '--participants', 'a,b']);
check('init: self-ignores a dedicated .agent-threads root',
  fs.existsSync(path.join(GIROOT, '.gitignore')) && fs.readFileSync(path.join(GIROOT, '.gitignore'), 'utf8').trim() === '*');
check('init: does NOT write a .gitignore into an arbitrary $ATHREAD_DIR (would clobber a repo)',
  !fs.existsSync(path.join(TMP, '.gitignore')));

// --- default/custom root selection + executable fallback ---
const DEFHOME = fs.mkdtempSync(path.join(os.tmpdir(), 'athread-home-'));
const DEFCWD = fs.mkdtempSync(path.join(os.tmpdir(), 'athread-cwd-'));
fs.mkdirSync(path.join(DEFCWD, '.git'));
const defaultRoot = path.join(fs.realpathSync(DEFHOME), '.agent-threads');
await runWithEnv({ ...defaultEnv, HOME: DEFHOME }, ['init', '--thread', 'd', '--participants', 'a,b'], { cwd: DEFCWD });
check('default root: uses ~/.agent-threads when ATHREAD_DIR and --root are unset',
  fs.existsSync(path.join(defaultRoot, 'd', 'meta.json')));
check('default root: does not create a worktree-local thread root',
  !fs.existsSync(path.join(DEFCWD, '.agent-threads')));
const defaultKo = await runWithEnv({ ...defaultEnv, HOME: DEFHOME }, ['kickoff', '--thread', 'd', '--as', 'b'], { cwd: DEFCWD });
check('kickoff default root: skill-first prompt names the thread and handle',
  /Use the agent-thread skill/.test(defaultKo.out) && /Join thread d as b/.test(defaultKo.out));
check('kickoff default root: omits redundant ATHREAD_DIR export and --root flag',
  !/export ATHREAD_DIR/.test(defaultKo.out) && !/--root /.test(defaultKo.out));
check('kickoff default root: fallback uses executable script directly',
  defaultKo.out.includes(`${AT} wait --thread d --as b`) && !/node "\$AT"/.test(defaultKo.out));
check('kickoff default root: fallback includes post via body-file and resolve',
  /post --thread d --as b --body-file /.test(defaultKo.out) && /resolve --thread d --as b --body /.test(defaultKo.out));
check('kickoff default root: does not bake in the initiator temp dir',
  !defaultKo.out.includes(os.tmpdir()) && /PATH_YOU_WROTE/.test(defaultKo.out));
check('kickoff default root: includes a concrete turn contract',
  /Turn contract:/.test(defaultKo.out) && /Do not answer only with/.test(defaultKo.out));

const CUSTOM = fs.mkdtempSync(path.join(os.tmpdir(), 'athread custom '));
await runWithEnv({ ATHREAD_DIR: TMP }, ['init', '--root', CUSTOM, '--thread', 'custom', '--participants', 'a,b']);
check('--root: overrides ATHREAD_DIR for thread storage',
  fs.existsSync(path.join(CUSTOM, 'custom', 'meta.json')) && !fs.existsSync(path.join(TMP, 'custom', 'meta.json')));
const customKo = await runWithEnv({ ATHREAD_DIR: TMP }, ['kickoff', '--root', CUSTOM, '--thread', 'custom', '--as', 'b']);
check('kickoff custom root: uses --root in fallback instead of exporting ATHREAD_DIR',
  customKo.out.includes(`wait --root '${CUSTOM}' --thread custom --as b`) && !/export ATHREAD_DIR/.test(customKo.out));
check('kickoff custom root: fallback includes post and resolve with --root after the subcommand',
  customKo.out.includes(`post --root '${CUSTOM}' --thread custom --as b --body-file `)
    && customKo.out.includes(`resolve --root '${CUSTOM}' --thread custom --as b --body `));
check('kickoff custom root: does not bake in an initiator body-file path',
  !/athread-custom-b\.md/.test(customKo.out) && /PATH_YOU_WROTE/.test(customKo.out));
const direct = await runDirect(CUSTOM, ['status', '--thread', 'custom']);
check('executable: athread.mjs runs directly through its shebang',
  direct.code === 0 && /"id": "custom"/.test(direct.out));
fs.rmSync(DEFHOME, { recursive: true, force: true });
fs.rmSync(DEFCWD, { recursive: true, force: true });
fs.rmSync(CUSTOM, { recursive: true, force: true });

// --- sessions: unlimited cap + session marker ---
const SESS = 'sess';
await run(['init', '--thread', SESS, '--participants', 'a,b', '--session']);
check('init --session: marks the thread as a session', meta(SESS).session === true);
check('init --session: round cap is unlimited (null)', meta(SESS).round_cap === null);
const sessCap = await run(['init', '--thread', 'sc', '--participants', 'a,b', '--session', '--round-cap', '5']);
check('init: rejects --session combined with --round-cap', sessCap.code === 1 && /--session/.test(sessCap.err));
await run(['post', '--thread', SESS, '--as', 'a', '--body', 'hi']);
const sw = await run(['wait', '--thread', SESS, '--as', 'b', '--timeout', '2']);
check('wait: session thread reports cap unlimited, never ROUND CAP', /cap unlimited/.test(sw.out) && !/ROUND CAP/.test(sw.out));

// --- wait --follow: survives the timeout window instead of exiting ---
const SF = 'follow';
await run(['init', '--thread', SF, '--participants', 'a,b']);
const followP = new Promise((resolve) => {
  const p = spawn('node', [AT, 'wait', '--thread', SF, '--as', 'b', '--follow', '--timeout', '1', '--interval', '1'], { env });
  let out = '', err = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => resolve({ code, out, err }));
});
await new Promise((r) => setTimeout(r, 2500)); // cross at least one timeout window
await run(['post', '--thread', SF, '--as', 'a', '--body', 'late turn']);
const fr = await followP;
check('wait --follow: does not exit on timeout, returns on the turn', fr.code === 0 && /your turn/.test(fr.out));
check('wait --follow: emits a heartbeat to stderr while waiting', /still waiting/.test(fr.err));

// --- kickoff is session-aware ---
const koS = await run(['kickoff', '--thread', SESS, '--as', 'b']);
check('kickoff (session): wait uses --follow',
  /wait .*--thread sess --as b --follow/.test(koS.out));
check('kickoff (session): frames an ongoing session', /ongoing session/i.test(koS.out));
check('kickoff (session): turn contract keeps resolve reserved for session end',
  /Turn contract:/.test(koS.out) && /resolve only when the session is over/i.test(koS.out));
await run(['init', '--thread', 'knorm', '--participants', 'a,b']);
const koN = await run(['kickoff', '--thread', 'knorm', '--as', 'b']);
check('kickoff (non-session): uses --timeout, not --follow', /--timeout 1800/.test(koN.out) && !/--follow/.test(koN.out));

fs.rmSync(TMP, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
