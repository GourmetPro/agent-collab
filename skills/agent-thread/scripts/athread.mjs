#!/usr/bin/env node
// athread - a zero-dependency, file-based thread for two agent sessions to take
// turns. Part of the `agent-thread` skill. Runs on any Node >= 18, no installs.
//
// Subcommands: init | post | resolve | wait | read | status | kickoff
//
// A thread is a directory:  $ATHREAD_DIR/<id>/
//   meta.json        { participants, turn, status, round_cap, ... }
//   0001.<who>.md    append-only messages, one per turn
// `wait` polls the directory until it is your turn (or the thread is resolved),
// then prints the latest message. That is the whole "comes back to you" mechanic.
//
// Turn-taking is enforced: post/resolve are rejected unless meta.turn names you
// (pass --force to override, e.g. to recover a stuck thread).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SELF = path.resolve(process.argv[1]);
const SAFE = /^[A-Za-z0-9._-]+$/; // thread ids and handles

function gitRootOrCwd() {
  let dir = process.cwd();
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

const root = process.env.ATHREAD_DIR
  ? path.resolve(process.env.ATHREAD_DIR)
  : path.join(gitRootOrCwd(), '.agent-threads');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

const [, , cmd, ...rest] = process.argv;
const a = parseArgs(rest);
const id = a.thread || process.env.ATHREAD_ID || a._[0];

function assertSafeId(i) {
  if (!i || i === true) throw new Error('athread: thread id required (--thread <id>)');
  if (i === '.' || i === '..' || !SAFE.test(i)) {
    throw new Error(`athread: unsafe thread id "${i}" (allowed: letters, digits, "." "_" "-")`);
  }
  return i;
}
function assertSafeHandle(h) {
  if (!h || h === true || !SAFE.test(h)) {
    throw new Error(`athread: unsafe or missing handle "${h}" (allowed: letters, digits, "." "_" "-")`);
  }
  return h;
}
// single-quote for safe interpolation into a shell snippet
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function posNum(val, name, { int = false } = {}) {
  if (val === true) throw new Error(`athread: --${name} requires a value`);
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0 || (int && !Number.isInteger(n))) {
    throw new Error(`athread: --${name} must be a positive ${int ? 'integer' : 'number'} (got "${val}")`);
  }
  return n;
}

const dir = (i) => path.join(root, i);
const metaPath = (i) => path.join(dir(i), 'meta.json');
const readMeta = (i) => JSON.parse(fs.readFileSync(metaPath(i), 'utf8'));
const writeMeta = (i, m) => fs.writeFileSync(metaPath(i), JSON.stringify(m, null, 2) + '\n');
const msgFiles = (i) => fs.readdirSync(dir(i)).filter((f) => /^\d{4}\./.test(f)).sort();
const otherOf = (m, who) => m.participants.find((p) => p !== who) || '(peer)';
const nowIso = () => new Date().toISOString();

const nextIndex = (i) => {
  const max = msgFiles(i).reduce((m, f) => Math.max(m, parseInt(f.slice(0, 4), 10)), 0);
  return String(max + 1).padStart(4, '0');
};

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Atomic-ish critical section: mkdir is atomic and fails if the dir exists.
function withLock(i, fn) {
  const lockDir = path.join(dir(i), '.lock');
  const deadline = Date.now() + 5000;
  for (;;) {
    try { fs.mkdirSync(lockDir); break; }
    catch {
      if (Date.now() > deadline) throw new Error('athread: could not acquire lock on ' + i);
      sleepSync(30);
    }
  }
  try { return fn(); }
  finally { try { fs.rmdirSync(lockDir); } catch { /* ignore */ } }
}

function bodyFrom(args) {
  if (args['body-file']) return fs.readFileSync(args['body-file'], 'utf8');
  if (typeof args.body === 'string') return args.body;
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function writeMessage(i, who, body, kind, force) {
  assertSafeHandle(who);
  return withLock(i, () => {
    const m = readMeta(i);
    if (!m.participants.includes(who)) {
      throw new Error(`athread: "${who}" is not a participant of ${i} (${m.participants.join(', ')})`);
    }
    if (m.status === 'resolved') {
      throw new Error(`athread: thread ${i} is already resolved`);
    }
    if (m.turn !== who && !force) {
      throw new Error(`athread: not your turn on ${i} (turn=${m.turn}, you=${who}); pass --force to override`);
    }
    const n = nextIndex(i);
    const to = otherOf(m, who);
    const file = `${n}.${who}.md`;
    const tag = kind ? ` ${kind}` : '';
    const header = `<!-- from:${who} to:${to}${tag} round:${parseInt(n, 10)} ts:${nowIso()} -->`;
    fs.writeFileSync(path.join(dir(i), file), `${header}\n${body.replace(/\s+$/, '')}\n`);
    m.turn = to;
    m.updated = nowIso();
    if (kind === 'resolve') m.status = 'resolved';
    writeMeta(i, m);
    return file;
  });
}

function printLatest(i) {
  const all = msgFiles(i);
  if (!all.length) return;
  const f = all[all.length - 1];
  console.log(`===== ${f} =====`);
  console.log(fs.readFileSync(path.join(dir(i), f), 'utf8').trimEnd());
}

// Pattern-agnostic: the peer's specific job arrives in the first message it
// waits for. This prompt only teaches the mechanics + the loop. An optional
// freeform --role label (e.g. "reviewer", "backend API owner", "navigator")
// is surfaced as a one-line hint. All shell-interpolated values are quoted so
// a path with spaces or shell metacharacters cannot break the one-paste launcher.
function kickoffPrompt({ handle, peer, threadId, role }) {
  const roleLine = role ? `Your collaboration role: ${role}.\n` : '';
  const AT = shq(SELF);
  const DIR = shq(root);
  const T = shq(threadId);
  const H = shq(handle);
  const skillPath = path.resolve(path.dirname(SELF), '..', 'SKILL.md');
  const skillLine = 'If an "agent-thread" skill is available in your environment, load it now for the full protocol (collaboration patterns, escalation rules).'
    + (fs.existsSync(skillPath) ? ` If you can read local files, its entrypoint is: ${skillPath}` : '');
  return `You are joining a shared agent-thread. Your thread handle is "${handle}" (use this exact value for --as); the peer's handle is "${peer}".
${roleLine}Communicate ONLY through the thread, using this zero-dep Node CLI. Loop until the thread is resolved.

${skillLine}
Then follow the concrete loop below; it has the exact CLI path, thread root, thread id, and --as handle for this collaboration.

  AT=${AT}
  export ATHREAD_DIR=${DIR}
  T=${T}

Loop:
  1. node "$AT" wait --thread "$T" --as ${H} --timeout 1800 --interval 3
     (blocks until it is your turn, then prints the peer's latest message + round/cap)
  2. Do your part of what the message asks. Read or inspect anything it references (files, paths, the working tree).
  3. Reply with your turn:
       node "$AT" post --thread "$T" --as ${H} --body "<your turn>"
     When the shared goal is met, end the thread instead of posting:
       node "$AT" resolve --thread "$T" --as ${H} --body "<the outcome>"
  4. If the thread is resolved, STOP. Otherwise repeat from step 1.

Your specific task and goal are in the first message you receive. Keep each turn concrete and brief. If you hit the round cap or a wait times out, stop and tell the human.`;
}

async function main() {
  if (cmd === 'init') {
    assertSafeId(id);
    const participants = (a.participants === true ? '' : (a.participants || 'author,reviewer'))
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (participants.length !== 2) {
      throw new Error('athread: exactly two distinct participants required (--participants a,b)');
    }
    if (participants[0] === participants[1]) {
      throw new Error('athread: participants must be distinct');
    }
    participants.forEach(assertSafeHandle);
    const turn = a.turn && a.turn !== true ? a.turn : participants[0];
    if (!participants.includes(turn)) {
      throw new Error(`athread: --turn "${turn}" is not one of the participants`);
    }
    const roundCap = a['round-cap'] === undefined ? 15 : posNum(a['round-cap'], 'round-cap', { int: true });
    const exists = fs.existsSync(metaPath(id));
    if (exists && !a.force) {
      throw new Error(`athread: thread ${id} already exists; pass --force to reset it`);
    }
    fs.mkdirSync(dir(id), { recursive: true });
    if (exists && a.force) {
      for (const f of msgFiles(id)) fs.rmSync(path.join(dir(id), f));
      try { fs.rmdirSync(path.join(dir(id), '.lock')); } catch { /* ignore */ }
    }
    writeMeta(id, {
      id,
      participants,
      turn,
      status: 'open',
      round_cap: roundCap,
      created: nowIso(),
    });
    console.log(id);
  } else if (cmd === 'post') {
    assertSafeId(id);
    console.log(writeMessage(id, a.as, bodyFrom(a), undefined, a.force));
  } else if (cmd === 'resolve') {
    assertSafeId(id);
    console.log(writeMessage(id, a.as, bodyFrom(a) || 'RESOLVED - no blocking issues.', 'resolve', a.force));
  } else if (cmd === 'read') {
    assertSafeId(id);
    for (const f of msgFiles(id)) {
      console.log(`===== ${f} =====`);
      console.log(fs.readFileSync(path.join(dir(id), f), 'utf8').trimEnd() + '\n');
    }
  } else if (cmd === 'status') {
    assertSafeId(id);
    const m = readMeta(id);
    console.log(JSON.stringify({ ...m, rounds: msgFiles(id).length }, null, 2));
  } else if (cmd === 'kickoff') {
    assertSafeId(id);
    const m = readMeta(id);
    const handle = assertSafeHandle(a.as && a.as !== true ? a.as : m.participants[1]);
    if (!m.participants.includes(handle)) {
      throw new Error(`athread: "${handle}" is not a participant of ${id} (${m.participants.join(', ')})`);
    }
    const peer = otherOf(m, handle);
    const role = typeof a.role === 'string' ? a.role : '';
    console.log(kickoffPrompt({ handle, peer, threadId: id, role }));
  } else if (cmd === 'wait') {
    assertSafeId(id);
    const who = assertSafeHandle(a.as);
    const m0 = readMeta(id);
    if (!m0.participants.includes(who)) {
      throw new Error(`athread: "${who}" is not a participant of ${id} (${m0.participants.join(', ')})`);
    }
    const timeout = (a.timeout === undefined ? 1800 : posNum(a.timeout, 'timeout')) * 1000;
    const interval = (a.interval === undefined ? 3 : posNum(a.interval, 'interval')) * 1000;
    const start = Date.now();
    for (;;) {
      const m = readMeta(id);
      const all = msgFiles(id);
      if (m.status === 'resolved') {
        printLatest(id);
        console.log('\n[athread] status=resolved');
        return;
      }
      if (m.turn === who && all.length) {
        printLatest(id);
        const round = all.length;
        const capped = round >= m.round_cap;
        console.log(`\n[athread] your turn (round ${round}, cap ${m.round_cap})${capped ? ' -- ROUND CAP reached: stop and escalate to the human' : ''}`);
        return;
      }
      if (Date.now() - start > timeout) {
        console.error(`[athread] wait timed out after ${timeout / 1000}s -- peer went quiet; escalate to the human`);
        process.exit(2);
      }
      await sleep(interval);
    }
  } else {
    console.error('usage: athread init|post|resolve|wait|read|status|kickoff');
    console.error('  --thread <id> --as <handle> [--body <text> | --body-file <path>] [--force]');
    process.exit(1);
  }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
