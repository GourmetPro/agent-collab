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
const collect = (child) => new Promise((resolve, reject) => {
  let out = '', err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  child.on('close', (code) => resolve({ code, out, err }));
  child.on('error', reject);
});
const meta = (t) => JSON.parse(fs.readFileSync(path.join(TMP, t, 'meta.json'), 'utf8'));
const indices = (t) => fs.readdirSync(path.join(TMP, t)).filter((f) => /^\d{4}\./.test(f)).sort().map((f) => f.slice(0, 4));

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} - ${name}`);
  if (!cond) failures++;
};

// --- help output ---
const globalHelp = await run(['--help']);
check('help: global --help exits 0',
  globalHelp.code === 0 && /Usage:/.test(globalHelp.out) && /Commands:/.test(globalHelp.out) && globalHelp.err === '');
check('help: global output lists command-specific help forms',
  /help \[command\]/.test(globalHelp.out) && /<command> --help/.test(globalHelp.out));
const shortHelp = await run(['-h']);
check('help: -h exits 0 with global help',
  shortHelp.code === 0 && /file-based turn-taking/.test(shortHelp.out));
const waitHelp = await run(['wait', '--help']);
check('help: command --help shows wait docs',
  waitHelp.code === 0 && /Usage:\n  .* wait /.test(waitHelp.out) && /--follow/.test(waitHelp.out) && /Treat silence as expected/.test(waitHelp.out));
const postHelp = await run(['help', 'post']);
check('help: help <command> shows post docs',
  postHelp.code === 0 && /append your turn/i.test(postHelp.out) && /--body-file/.test(postHelp.out));
const helpHelp = await run(['help', 'help']);
check('help: help command has command-specific docs',
  helpHelp.code === 0 && /show global or command-specific help/i.test(helpHelp.out));
const rootHelp = await run(['wait', '--root', '--help']);
check('help: command help does not require incomplete option values',
  rootHelp.code === 0 && /Usage:\n  .* wait /.test(rootHelp.out));
const badHelp = await run(['help', 'nope']);
check('help: unknown topic exits 1',
  badHelp.code === 1 && /unknown help topic/.test(badHelp.err));
const missingCommand = await run([]);
check('help: missing command points to --help',
  missingCommand.code === 1 && /missing command/.test(missingCommand.err) && /--help/.test(missingCommand.err));
const unknownCommand = await run(['nope']);
check('help: unknown command points to --help',
  unknownCommand.code === 1 && /unknown command/.test(unknownCommand.err) && /--help/.test(unknownCommand.err));

// --- option validation ---
const U = 'unknownflag';
await run(['init', '--thread', U, '--participants', 'a,b']);
const unknownFlag = await run(['post', '--thread', U, '--as', 'a', '--message', 'hi']);
check('args: post rejects unknown --message flag',
  unknownFlag.code === 1 && /unknown option "--message"/.test(unknownFlag.err));
check('args: rejected unknown flag leaves no message', indices(U).length === 0);

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
const sessionPost = await run(['post', '--thread', SESS, '--as', 'a', '--body', 'hi']);
check('post (session): reminds poster to rearm wait --follow',
  sessionPost.out.trim() === '0001.a.md'
    && /session remains open/i.test(sessionPost.err)
    && /wait .*--thread sess --as a --follow/.test(sessionPost.err));
const sw = await run(['wait', '--thread', SESS, '--as', 'b', '--timeout', '2']);
check('wait: session thread reports cap unlimited, never ROUND CAP', /cap unlimited/.test(sw.out) && !/ROUND CAP/.test(sw.out));

// --- wait --follow: survives the timeout window instead of exiting ---
const SF = 'follow';
await run(['init', '--thread', SF, '--participants', 'a,b']);
const followP = collect(spawn('node', [AT, 'wait', '--thread', SF, '--as', 'b', '--follow', '--timeout', '1', '--interval', '1'], { env }));
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
check('kickoff (session): requires rearming wait after every post',
  /After every post, immediately rearm the wait/i.test(koS.out));
check('kickoff (session): suppresses empty wait progress updates',
  /stay silent/i.test(koS.out) && /still waiting/i.test(koS.out) && /progress updates/i.test(koS.out));
await run(['init', '--thread', 'knorm', '--participants', 'a,b']);
const koN = await run(['kickoff', '--thread', 'knorm', '--as', 'b']);
check('kickoff (non-session): uses --timeout, not --follow', /--timeout 1800/.test(koN.out) && !/--follow/.test(koN.out));
check('kickoff (non-session): suppresses empty wait progress updates',
  /stay silent/i.test(koN.out) && /still waiting/i.test(koN.out) && /progress updates/i.test(koN.out));

// --- notes: out-of-band, never take the turn ---
const N = 'notes';
await run(['init', '--thread', N, '--participants', 'a,b']); // turn = a
await run(['post', '--thread', N, '--as', 'a', '--body', 'over to you']); // 0001, turn = b
const noteByA = await run(['note', '--thread', N, '--as', 'a', '--body', 'extra context while you work']);
check('note: succeeds when it is NOT your turn', noteByA.code === 0);
check('note: does not change the turn', meta(N).turn === 'b');
check('note: file uses the ~note marker', noteByA.out.trim() === '0002.~note.a.md');
const noteByB = await run(['note', '--thread', N, '--as', 'b', '--body', 'note from the turn holder']);
check('note: the turn holder can also note without taking the turn',
  noteByB.code === 0 && noteByB.out.trim() === '0003.~note.b.md' && meta(N).turn === 'b');
const noteStranger = await run(['note', '--thread', N, '--as', 'zzz', '--body', 'hi']);
check('note: rejected for non-participant', noteStranger.code === 1 && /not a participant/.test(noteStranger.err));
await run(['post', '--thread', N, '--as', 'b', '--body', 'done']); // 0004, turn = a
await run(['resolve', '--thread', N, '--as', 'a', '--body', 'closing']); // 0005
const noteResolved = await run(['note', '--thread', N, '--as', 'b', '--body', 'too late']);
check('note: rejected after resolve', noteResolved.code === 1 && /resolved/.test(noteResolved.err));

// --- notes: dotted handles never collide with the ~note marker ---
const ND = 'notes-dotted';
await run(['init', '--thread', ND, '--participants', 'alpha.note,beta']); // turn = alpha.note
const dotPost = await run(['post', '--thread', ND, '--as', 'alpha.note', '--body', 'from dotted handle']);
check('note/dotted: substantive file for handle "alpha.note" is 0001.alpha.note.md (not misread as a note)',
  dotPost.code === 0 && dotPost.out.trim() === '0001.alpha.note.md');
const dotStatus = JSON.parse((await run(['status', '--thread', ND])).out);
check('status/dotted: dotted substantive counts as one round with zero notes',
  dotStatus.rounds === 1 && dotStatus.notes === 0 && dotStatus.messages === 1);
const dotNote = await run(['note', '--thread', ND, '--as', 'beta', '--body', 'a real note']);
check('note/dotted: a real note is 0002.~note.beta.md', dotNote.out.trim() === '0002.~note.beta.md');
const dotStatus2 = JSON.parse((await run(['status', '--thread', ND])).out);
check('status/dotted: a note does not increment the substantive round count',
  dotStatus2.rounds === 1 && dotStatus2.notes === 1 && dotStatus2.messages === 2);

// --- wait: notes do not wake a pending wait ---
const NWW = 'notewake';
await run(['init', '--thread', NWW, '--participants', 'a,b']); // turn a; b is waiting
const waitP = spawn('node', [AT, 'wait', '--thread', NWW, '--as', 'b', '--timeout', '4', '--interval', '1'], { env });
await new Promise((r) => setTimeout(r, 250));
await run(['note', '--thread', NWW, '--as', 'a', '--body', 'note before handoff']); // 0001 note
await new Promise((r) => setTimeout(r, 1250)); // cross at least one poll; a note alone must NOT return
await run(['post', '--thread', NWW, '--as', 'a', '--body', 'now your turn']); // 0002 subst, turn b
const waitR = await collect(waitP);
check('wait/notes: a note does not wake wait before the turn flips',
  waitR.code === 0
    && /0001\.~note\.a\.md/.test(waitR.out)
    && /0002\.a\.md/.test(waitR.out)
    && waitR.out.indexOf('0001.~note.a.md') < waitR.out.indexOf('0002.a.md'));

// --- wait: prints the window (interleaved notes) since my last substantive post ---
const WN = 'win';
await run(['init', '--thread', WN, '--participants', 'a,b']); // turn a
await run(['post', '--thread', WN, '--as', 'a', '--body', 'AAA']);   // 0001 subst, turn b
await run(['note', '--thread', WN, '--as', 'a', '--body', 'NOTE-from-a']); // 0002 note, turn still b
await run(['post', '--thread', WN, '--as', 'b', '--body', 'BBB']);   // 0003 subst, turn a
const winOut = await run(['wait', '--thread', WN, '--as', 'a', '--timeout', '2']);
check('wait/window: prints every message since my last substantive post, in order',
  /0002\.~note\.a\.md/.test(winOut.out) && /0003\.b\.md/.test(winOut.out)
    && winOut.out.indexOf('0002.~note.a.md') < winOut.out.indexOf('0003.b.md'));
check('wait/window: round line counts substantive only (note excluded)',
  /your turn \(round 2, cap 15\)/.test(winOut.out));

// --- a joiner with no prior post sees the whole thread from index 1 ---
const WJ = 'winjoin';
await run(['init', '--thread', WJ, '--participants', 'a,b']);
await run(['post', '--thread', WJ, '--as', 'a', '--body', 'hello b']);
const wj = await run(['wait', '--thread', WJ, '--as', 'b', '--timeout', '2']);
check('wait/window: joiner sees the opening message', /0001\.a\.md/.test(wj.out) && /hello b/.test(wj.out));

// --- round cap counts substantive posts only; notes never trip it ---
const WC = 'wincap';
await run(['init', '--thread', WC, '--participants', 'a,b', '--round-cap', '2']);
await run(['post', '--thread', WC, '--as', 'a', '--body', 'm1']); // 0001 subst (round 1), turn b
await run(['note', '--thread', WC, '--as', 'a', '--body', 'n1']); // 0002 note
await run(['note', '--thread', WC, '--as', 'a', '--body', 'n2']); // 0003 note
const notYetCap = await run(['wait', '--thread', WC, '--as', 'b', '--timeout', '2']);
check('cap/notes: two notes do not trip a cap-2 thread',
  notYetCap.code === 0 && /your turn \(round 1,/.test(notYetCap.out) && !/ROUND CAP/.test(notYetCap.out));
await run(['post', '--thread', WC, '--as', 'b', '--body', 'm2']); // 0004 subst (round 2), turn a
const atCap = await run(['wait', '--thread', WC, '--as', 'a', '--timeout', '2']);
check('cap/notes: the cap trips on the 2nd substantive message',
  /ROUND CAP/.test(atCap.out) && /round 2,/.test(atCap.out));

// --- note: help + option validation ---
const noteHelp = await run(['help', 'note']);
check('help: help note documents the out-of-band note',
  noteHelp.code === 0 && /without taking the turn/i.test(noteHelp.out) && /--body-file/.test(noteHelp.out));
check('help: global help lists the note command', /\n  note\s+Append an out-of-band note/.test(globalHelp.out));
await run(['init', '--thread', 'nv', '--participants', 'a,b']);
const noteUnknownFlag = await run(['note', '--thread', 'nv', '--as', 'a', '--message', 'x']);
check('args: note rejects unknown --message flag',
  noteUnknownFlag.code === 1 && /unknown option "--message"/.test(noteUnknownFlag.err));
check('args: rejected note leaves no message', indices('nv').length === 0);

// --- status --all: read-only fleet view across threads ---
const FA1 = 'fleet-a';
const FA2 = 'fleet-b';
await run(['init', '--thread', FA1, '--participants', 'coord,w1']); // turn coord
await run(['init', '--thread', FA2, '--participants', 'coord,w2']); // turn coord
await run(['post', '--thread', FA1, '--as', 'coord', '--body', 'go']); // FA1: turn w1, 1 substantive
await run(['note', '--thread', FA2, '--as', 'coord', '--body', 'fyi']); // FA2: 1 note, turn unchanged
const fa = await run(['status', '--all']);
check('status --all: exits 0 with a JSON array, no --thread required',
  fa.code === 0 && Array.isArray(JSON.parse(fa.out)) && !/thread id required/.test(fa.err));
const fleet = JSON.parse(fa.out);
const a1 = fleet.find((e) => e.id === FA1);
const a2 = fleet.find((e) => e.id === FA2);
check('status --all: FA1 shows turn=w1, 1 substantive round, 0 notes, last=1, participants',
  a1 && a1.turn === 'w1' && a1.rounds === 1 && a1.notes === 0 && a1.messages === 1 && a1.last === 1
    && Array.isArray(a1.participants) && a1.participants.join(',') === 'coord,w1');
check('status --all: FA2 shows turn=coord, 0 rounds, 1 note, 1 message, last=1',
  a2 && a2.turn === 'coord' && a2.rounds === 0 && a2.notes === 1 && a2.messages === 1 && a2.last === 1);
check('status --all: each entry carries an updated timestamp',
  a1 && typeof a1.updated === 'string' && a1.updated.length > 0);
fs.mkdirSync(path.join(TMP, 'not-a-thread'), { recursive: true });
const fa2 = await run(['status', '--all']);
check('status --all: skips a directory with no meta.json without crashing',
  fa2.code === 0 && !JSON.parse(fa2.out).some((e) => e.id === 'not-a-thread'));
const singleFA1 = JSON.parse((await run(['status', '--thread', FA1])).out);
check('status (single thread): shape unchanged - meta + rounds/messages/notes',
  singleFA1.id === FA1 && singleFA1.rounds === 1 && singleFA1.notes === 0
    && singleFA1.participants.join(',') === 'coord,w1');

// --- pending: non-blocking peek at peer notes since my last substantive post ---
const PD = 'pending-thread';
await run(['init', '--thread', PD, '--participants', 'co,wk']); // turn co
await run(['post', '--thread', PD, '--as', 'co', '--body', 'do the thing']); // 0001, turn wk (wk is now working)
const p0 = await run(['pending', '--thread', PD, '--as', 'wk']);
check('pending: exit 0 and no output when there are no notes', p0.code === 0 && p0.out.trim() === '');
await run(['note', '--thread', PD, '--as', 'co', '--body', 'STOP: abandon that, it is moot']); // 0002 note
const p1 = await run(['pending', '--thread', PD, '--as', 'wk']);
check('pending: prints the peer STOP note, exit 0',
  p1.code === 0 && /STOP: abandon that/.test(p1.out) && /0002\.~note\.co\.md/.test(p1.out));
check('pending: does not change the turn or write anything',
  meta(PD).turn === 'wk' && indices(PD).join(',') === '0001,0002');
await run(['note', '--thread', PD, '--as', 'wk', '--body', 'my own scratch note']); // 0003 note by wk
const p2 = await run(['pending', '--thread', PD, '--as', 'wk']);
check('pending: shows only the peer notes, not my own',
  /0002\.~note\.co\.md/.test(p2.out) && !/0003\.~note\.wk\.md/.test(p2.out));
const pStranger = await run(['pending', '--thread', PD, '--as', 'nobody']);
check('pending: rejects a non-participant', pStranger.code === 1 && /not a participant/.test(pStranger.err));

// --- note broadcast: one note fanned out to a list of threads ---
const B1 = 'bc-1', B2 = 'bc-2', B3 = 'bc-3';
await run(['init', '--thread', B1, '--participants', 'co,w1']);
await run(['init', '--thread', B2, '--participants', 'co,w2']);
await run(['init', '--thread', B3, '--participants', 'co,w3']);
await run(['post', '--thread', B1, '--as', 'co', '--body', 'go1']); // turn w1
await run(['post', '--thread', B2, '--as', 'co', '--body', 'go2']); // turn w2
await run(['resolve', '--thread', B3, '--as', 'co', '--body', 'done3']); // B3 resolved
const bc = await run(['note', '--thread', `${B1},${B2}`, '--as', 'co', '--body', 'shared DB resetting, hold test:db']);
check('note broadcast: posts to every listed thread, exit 0',
  bc.code === 0 && /bc-1: 0002\.~note\.co\.md/.test(bc.out) && /bc-2: 0002\.~note\.co\.md/.test(bc.out));
check('note broadcast: flips no turns', meta(B1).turn === 'w1' && meta(B2).turn === 'w2');
const bcFail = await run(['note', '--thread', `${B1},${B3}`, '--as', 'co', '--body', 'rebase before PR']);
check('note broadcast: nonzero exit when ANY target fails, with the failing id named',
  bcFail.code === 1 && /bc-1: 0003\.~note\.co\.md/.test(bcFail.out) && /bc-3: ERROR/.test(bcFail.out) && /resolved/.test(bcFail.out));
const bcEmpty = await run(['note', '--thread', `${B1},`, '--as', 'co', '--body', 'x']);
check('note broadcast: rejects an empty thread id', bcEmpty.code === 1 && /empty thread id/.test(bcEmpty.err));
const bcDup = await run(['note', '--thread', `${B1},${B1}`, '--as', 'co', '--body', 'x']);
check('note broadcast: rejects duplicate thread ids', bcDup.code === 1 && /duplicate thread/.test(bcDup.err));

// --- kickoff teaches out-of-band notes + the checkpoint ---
check('kickoff (non-session): explains notes do not take the turn',
  /does NOT take the turn/i.test(koN.out) && / note .*--as b/.test(koN.out));
check('kickoff (non-session): tells the peer to re-check before posting/resolving',
  /before you post or resolve/i.test(koN.out));
check('kickoff (session): also explains out-of-band notes',
  /does NOT take the turn/i.test(koS.out) && / note .*--as b/.test(koS.out));

fs.rmSync(TMP, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
