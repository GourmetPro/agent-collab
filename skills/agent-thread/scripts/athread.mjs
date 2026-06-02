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

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SELF = path.resolve(process.argv[1]);

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

function writeMessage(i, who, body, kind) {
  if (!who) throw new Error('athread: --as <handle> is required');
  return withLock(i, () => {
    const m = readMeta(i);
    if (!m.participants.includes(who)) {
      throw new Error(`athread: "${who}" is not a participant of ${i} (${m.participants.join(', ')})`);
    }
    if (m.status === 'resolved') {
      throw new Error(`athread: thread ${i} is already resolved`);
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

function kickoffPrompt({ role, handle, peer, threadId }) {
  const r = role.toLowerCase();
  const act = r === 'reviewer'
    ? `If blocking issues remain:\n       node "$AT" post    --thread $T --as ${handle} --body "<numbered, concrete findings>"\n     If none remain:\n       node "$AT" resolve --thread $T --as ${handle} --body "<one line: why it is clean now>"`
    : `Revise the artifact to address the findings, then:\n       node "$AT" post --thread $T --as ${handle} --body "<what you changed / any pushback>"`;
  const step2 = r === 'reviewer'
    ? 'If the message references an artifact path, (re-)read that file.'
    : "Read the reviewer's findings.";
  const onlyNote = r === 'reviewer' ? 'Review only - do NOT edit the artifact yourself. ' : '';
  return `You are the ${role.toUpperCase()} peer ("${handle}") in an agent-thread loop with peer "${peer}".
Communicate ONLY through the shared file thread, using this zero-dep Node CLI. Loop until the thread is resolved.

  AT=${SELF}
  export ATHREAD_DIR=${root}
  T=${threadId}

Loop:
  1. node "$AT" wait --thread $T --as ${handle} --timeout 1800 --interval 3
     (blocks until it is your turn, then prints the latest message + round/cap)
  2. ${step2}
  3. ${act}
  4. If the thread is resolved, STOP. Otherwise repeat from step 1.

${onlyNote}Keep each turn concrete and brief. If you hit the round cap or a wait times out, stop and tell the human.`;
}

async function main() {
  if (cmd === 'init') {
    const participants = (a.participants || 'author,reviewer').split(',').map((s) => s.trim());
    if (!id) throw new Error('athread: thread id required (--thread <id>)');
    fs.mkdirSync(dir(id), { recursive: true });
    writeMeta(id, {
      id,
      participants,
      turn: a.turn || participants[0],
      status: 'open',
      round_cap: Number(a['round-cap'] || 15),
      created: nowIso(),
    });
    console.log(id);
  } else if (cmd === 'post') {
    console.log(writeMessage(id, a.as, bodyFrom(a)));
  } else if (cmd === 'resolve') {
    console.log(writeMessage(id, a.as, bodyFrom(a) || 'RESOLVED - no blocking issues.', 'resolve'));
  } else if (cmd === 'read') {
    for (const f of msgFiles(id)) {
      console.log(`===== ${f} =====`);
      console.log(fs.readFileSync(path.join(dir(id), f), 'utf8').trimEnd() + '\n');
    }
  } else if (cmd === 'status') {
    const m = readMeta(id);
    console.log(JSON.stringify({ ...m, rounds: msgFiles(id).length }, null, 2));
  } else if (cmd === 'kickoff') {
    const m = readMeta(id);
    const handle = a.as || m.participants[1];
    const peer = otherOf(m, handle);
    const role = a.role || (handle === m.participants[0] ? 'author' : 'reviewer');
    console.log(kickoffPrompt({ role, handle, peer, threadId: id }));
  } else if (cmd === 'wait') {
    const who = a.as;
    if (!who) throw new Error('athread: --as <handle> is required');
    const timeout = Number(a.timeout || 1800) * 1000;
    const interval = Number(a.interval || 3) * 1000;
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
    console.error('  --thread <id> --as <handle> [--body <text> | --body-file <path>]');
    process.exit(1);
  }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
