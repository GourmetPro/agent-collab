#!/usr/bin/env node
// athread - a zero-dependency, file-based thread for two agent sessions to take
// turns. Part of the `agent-thread` skill. Runs on any Node >= 18, no installs.
//
// Subcommands: init | post | note | pending | resolve | wait | read | status | sweep | kickoff | help
//
// A thread is a directory under the resolved thread root:
//   meta.json        { participants, turn, status, round_cap, ... }
//   0001.<who>.md    append-only messages, one per turn
// `wait` polls the directory until it is your turn (or the thread is resolved),
// then prints the latest message. That is the whole "comes back to you" mechanic.
//
// Turn-taking is enforced: post/resolve are rejected unless meta.turn names you
// (pass --force to override, e.g. to recover a stuck thread).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const SELF = path.resolve(process.argv[1]);
const SAFE = /^[A-Za-z0-9._-]+$/; // thread ids and handles

function parseArgs(argv) {
  const out = { _: [], __unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') {
      out.h = true;
    } else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else if (a.startsWith('-')) {
      out.__unknown.push(a);
    } else out._.push(a);
  }
  return out;
}

const commonOptions = ['root', 'thread', 'help', 'h'];
const commandOptions = {
  init: new Set([...commonOptions, 'participants', 'turn', 'round-cap', 'session', 'force']),
  post: new Set([...commonOptions, 'as', 'body', 'body-file', 'force']),
  note: new Set([...commonOptions, 'as', 'body', 'body-file']),
  pending: new Set([...commonOptions, 'as']),
  resolve: new Set([...commonOptions, 'as', 'body', 'body-file', 'force']),
  wait: new Set([...commonOptions, 'as', 'timeout', 'interval', 'follow', 'probe']),
  read: new Set(commonOptions),
  status: new Set([...commonOptions, 'all', 'open', 'participant', 'since', 'min-messages', 'max-messages']),
  sweep: new Set([...commonOptions, 'as', 'all', 'open', 'participant', 'since', 'min-messages', 'max-messages', 'state', 'reset']),
  kickoff: new Set([...commonOptions, 'as', 'role']),
};

function validateOptions(command, args) {
  const allowed = commandOptions[command];
  if (!allowed) return;
  const unknown = [
    ...args.__unknown,
    ...Object.keys(args)
      .filter((key) => key !== '_' && key !== '__unknown' && !allowed.has(key))
      .map((key) => `--${key}`),
  ];
  if (unknown.length) {
    throw new Error(`athread: unknown option "${unknown[0]}" for ${command}; run ${path.basename(SELF)} help ${command} for usage`);
  }
}

const [, , cmd, ...rest] = process.argv;
const a = parseArgs(rest);
const id = a.thread || process.env.ATHREAD_ID || a._[0];
const helpRequested = cmd === 'help' || cmd === '--help' || cmd === '-h' || !!a.help || !!a.h;
const helpTopic = cmd === 'help'
  ? a._[0]
  : (cmd && cmd !== '--help' && cmd !== '-h' ? cmd : undefined);

function defaultRoot() {
  return path.resolve(path.join(os.homedir(), '.agent-threads'));
}

function rootFrom(args) {
  if (args.root === true) throw new Error('athread: --root requires a value');
  if (args.root !== undefined) return path.resolve(args.root);
  if (process.env.ATHREAD_DIR) return path.resolve(process.env.ATHREAD_DIR);
  return defaultRoot();
}

function helpText(topic) {
  const exe = path.basename(SELF);
  const commandHelp = {
    init: `${exe} init - create a two-participant thread.

Usage:
  ${exe} init [--root R] --thread T --participants A,B [--turn A] [--round-cap N]
  ${exe} init [--root R] --thread T --participants A,B --session

Options:
  --root <path>          Thread root. Defaults to $ATHREAD_DIR or ~/.agent-threads.
  --thread <id>          Thread id. Safe slug only: letters, digits, ".", "_", "-".
  --participants A,B     Exactly two distinct handles. Defaults to author,reviewer.
  --turn <handle>        Initial turn holder. Defaults to the first participant.
  --round-cap <N>        Max message count before wait warns to escalate. Default: 15.
  --session              Ongoing channel: unlimited round cap; kickoff uses wait --follow.
  --force                Reset an existing thread and clear old messages.
  --help                 Show this help.

Examples:
  ${exe} init --thread review-1 --participants author,reviewer
  ${exe} init --thread daily --participants codex,claude --session`,

    post: `${exe} post - append your turn and hand control to the peer.

Usage:
  ${exe} post [--root R] --thread T --as HANDLE (--body TEXT | --body-file FILE)
  ${exe} post [--root R] --thread T --as HANDLE < reply.md

Options:
  --root <path>          Thread root. Defaults to $ATHREAD_DIR or ~/.agent-threads.
  --thread <id>          Thread id.
  --as <handle>          Your participant handle.
  --body <text>          Short one-line body.
  --body-file <path>     File containing the turn body. Preferred for long replies.
  --force                Post even if it is not your turn.
  --help                 Show this help.

Notes:
  post is rejected unless --as matches the current turn, except with --force.
  On session threads, post prints the exact wait --follow command to stderr.

Example:
  ${exe} post --thread review-1 --as author --body-file /tmp/reply.md`,

    note: `${exe} note - append an out-of-band note without taking the turn.

Usage:
  ${exe} note [--root R] --thread T --as HANDLE (--body TEXT | --body-file FILE)
  ${exe} note [--root R] --thread A,B,C --as HANDLE --body TEXT   (broadcast)
  ${exe} note [--root R] --thread T --as HANDLE < note.md

Options:
  --root <path>          Thread root. Defaults to $ATHREAD_DIR or ~/.agent-threads.
  --thread <id|a,b,c>    One thread id, or a comma list to broadcast the same note.
  --as <handle>          Your participant handle.
  --body <text>          Short one-line note body.
  --body-file <path>     File containing the note body.
  --help                 Show this help.

Notes:
  A note is appended WITHOUT changing whose turn it is, and may be sent
  regardless of whose turn it is. The peer sees it in its next wait window;
  notes never wake a pending wait. Rejected once the thread is resolved.
  The round cap counts substantive posts only, so notes never trip escalation.
  Broadcast (comma list): best-effort fan-out; prints "id: <file>" or "id: ERROR ..."
  per thread, rejects empty/duplicate ids, and exits nonzero if ANY target failed
  (a non-zero exit reports write landing, NOT that the peer has collected the note).

Example:
  ${exe} note --thread review-1 --as author --body "STOP: that path is wrong, it is /srv/app"`,

    pending: `${exe} pending - non-blocking peek at the peer's notes for you.

Usage:
  ${exe} pending [--root R] --thread T --as HANDLE

Options:
  --root <path>          Thread root. Defaults to $ATHREAD_DIR or ~/.agent-threads.
  --thread <id>          Thread id.
  --as <handle>          Your participant handle.
  --help                 Show this help.

Notes:
  Prints the peer's notes since your last substantive post, then exits 0 (prints
  nothing, still exit 0, when there are none). Never blocks, never writes, takes
  no turn. This is the checkpoint primitive: a turn-holder mid-task can check for
  a "stop"/correction note without ending its turn. (In a backgrounded wait loop,
  "wait --as me" also returns immediately when it is your turn.)

Example:
  ${exe} pending --thread review-1 --as reviewer`,

    resolve: `${exe} resolve - append a final turn and close the thread.

Usage:
  ${exe} resolve [--root R] --thread T --as HANDLE [--body TEXT | --body-file FILE]

Options:
  --root <path>          Thread root. Defaults to $ATHREAD_DIR or ~/.agent-threads.
  --thread <id>          Thread id.
  --as <handle>          Your participant handle.
  --body <text>          Resolution text. Defaults to a short resolved message.
  --body-file <path>     File containing the resolution text.
  --force                Resolve even if it is not your turn.
  --help                 Show this help.

Example:
  ${exe} resolve --thread review-1 --as reviewer --body "No blocking issues remain."`,

    wait: `${exe} wait - block until it is your turn or the thread resolves.

Usage:
  ${exe} wait [--root R] --thread T --as HANDLE [--timeout S] [--interval S]
  ${exe} wait [--root R] --thread T --as HANDLE --follow [--timeout S] [--interval S]
  ${exe} wait [--root R] --thread T --as HANDLE --probe

Options:
  --root <path>          Thread root. Defaults to $ATHREAD_DIR or ~/.agent-threads.
  --thread <id>          Thread id.
  --as <handle>          Your participant handle.
  --timeout <seconds>    Timeout window. Default: 1800. Exit 2 on timeout.
  --interval <seconds>   Filesystem polling interval. Default: 3.
  --follow               Never exit on timeout; print a periodic stderr heartbeat.
  --probe                Single-shot, non-blocking: check once and return now.
                         Cannot combine with --follow (--timeout/--interval unused).
  --help                 Show this help.

Output:
  When your turn arrives, prints the latest message and round/cap status.
  When resolved, prints the latest message and status=resolved.
  While pending, wait prints no stdout. Treat silence as expected.

Exit codes:
  0   Your turn (window printed when there are messages) or the thread is resolved.
  2   Timed out waiting (blocking mode only; --follow never times out).
  3   --probe only: not yet your turn (peer still holds it). No output; not an
      error - a self-polling worker can keep working and probe again later.
  1   Usage or state error.

Examples:
  ${exe} wait --thread review-1 --as author
  ${exe} wait --thread daily --as codex --follow --interval 3
  ${exe} wait --thread daily --as codex --probe   # poll once; exit 3 if not yet your turn`,

    read: `${exe} read - print the whole transcript.

Usage:
  ${exe} read [--root R] --thread T

Options:
  --root <path>          Thread root. Defaults to $ATHREAD_DIR or ~/.agent-threads.
  --thread <id>          Thread id.
  --help                 Show this help.

Example:
  ${exe} read --thread review-1`,

    status: `${exe} status - print thread metadata as JSON.

Usage:
  ${exe} status [--root R] --thread T
  ${exe} status [--root R] --all [filters]

Options:
  --root <path>          Thread root. Defaults to $ATHREAD_DIR or ~/.agent-threads.
  --thread <id>          Thread id (single-thread mode).
  --all                  Read-only fleet view: a JSON array over every thread under
                         the root, each {id, participants, turn, status, rounds,
                         messages, notes, last, updated}. updated is the newest file
                         mtime; a garbled thread is flagged {id, error}, never crashes.
  --participant <h>      (with --all) only threads where <h> is a participant.
  --open                 (with --all) only threads whose status is open.
  --since <iso>          (with --all) only threads with updated >= <iso>.
  --min-messages <N>     (with --all) only threads with >= N messages.
  --max-messages <N>     (with --all) only threads with <= N messages.
  --help                 Show this help.

Filters are AND-composed; a garbled thread is dropped from a filtered result.

Examples:
  ${exe} status --thread review-1
  ${exe} status --all
  ${exe} status --all --participant intake --open
  ${exe} status --all --open --since 2026-06-25 --min-messages 20`,

    sweep: `${exe} sweep - turn-start safety net: print only the threads that moved.

Usage:
  ${exe} sweep [--root R] --thread A,B,C [--as HANDLE] [--state F] [--reset]
  ${exe} sweep [--root R] --all [--participant H] [--open] [...] [--as HANDLE]

Options:
  --root <path>          Thread root. Defaults to $ATHREAD_DIR or ~/.agent-threads.
  --thread <a,b,c>       Explicit set of threads to sweep (comma list).
  --all [filters]        Derive the set from the root; same filters as status --all
                         (--participant/--open/--since/--min-messages/--max-messages).
                         Scope it (e.g. --participant YOU) so you do not sweep other
                         efforts' threads on a shared machine.
  --as <handle>          Your handle. Keys the state file and adds "mine": turn==you.
  --state <path>         State file. Default: <root>/.athread-sweep[.<as>].json.
  --reset                Ignore the saved baseline: report every thread, re-baseline.
  --help                 Show this help.

Notes:
  Snapshots turn/status/message/note counts per thread, diffs against the last
  sweep (a small JSON state file), prints ONLY changed threads as a JSON array
  (each with "firstSeen", plus "mine" when --as is given), then saves the new
  baseline. Resolved threads count as changes you may have missed. Unlike a
  background watcher, a sweep has no live-process dependency - run it first on
  every wake to catch anything a dead watcher missed. A missing/corrupt state
  file just re-baselines; a missing/garbled thread is flagged {id,error}, never
  crashes. Read-only on the threads (no turn, no post).

Examples:
  ${exe} sweep --thread review-1,review-2,review-3 --as lead
  ${exe} sweep --all --participant lead --open --as lead`,

    kickoff: `${exe} kickoff - emit a one-paste launcher for the other session.

Usage:
  ${exe} kickoff [--root R] --thread T --as HANDLE [--role "short label"]

Options:
  --root <path>          Thread root. Defaults to $ATHREAD_DIR or ~/.agent-threads.
  --thread <id>          Thread id.
  --as <handle>          Peer handle that will receive the launcher.
  --role <label>         Optional role hint included in the launcher.
  --help                 Show this help.

Example:
  ${exe} kickoff --thread review-1 --as reviewer --role "reviewer"`,

    help: `${exe} help - show global or command-specific help.

Usage:
  ${exe} --help
  ${exe} help [command]
  ${exe} <command> --help

Examples:
  ${exe} help wait
  ${exe} post --help`,
  };
  if (!topic) {
    return `${exe} - file-based turn-taking for two local agent sessions.

Usage:
  ${exe} <command> [options]
  ${exe} help [command]
  ${exe} <command> --help

Commands:
  init       Create or reset a thread.
  post       Append your turn and hand control to the peer.
  note       Append an out-of-band note without taking the turn.
  pending    Non-blocking peek at the peer's notes for you.
  resolve    Append a final turn and close the thread.
  wait       Block until your turn or resolution.
  read       Print the transcript.
  status     Print thread metadata as JSON (--all for a fleet view).
  sweep      Print only the threads that changed since your last sweep.
  kickoff    Emit a one-paste launcher for the peer session.
  help       Show global or command-specific help.

Global options:
  --root <path>          Thread root. Defaults to $ATHREAD_DIR or ~/.agent-threads.
  --thread <id>          Thread id. Can also come from $ATHREAD_ID or a positional id.
  -h, --help             Show help.

Thread ids and handles must be safe slugs: letters, digits, ".", "_", "-".
Run "${exe} help wait" or "${exe} wait --help" for command-specific docs.`;
  }
  return commandHelp[topic];
}

function printHelp(topic) {
  const text = helpText(topic);
  if (!text) {
    console.error(`athread: unknown help topic "${topic}"`);
    console.error(`Run ${path.basename(SELF)} --help for available commands.`);
    process.exit(1);
  }
  console.log(text);
}

if (helpRequested) {
  printHelp(helpTopic);
  process.exit(0);
}
validateOptions(cmd, a);

// Threads live OUTSIDE any repo by default, so they are never tracked by git.
// Override with --root or $ATHREAD_DIR (e.g. point it at a repo or temp dir).
const root = rootFrom(a);
const usesDefaultRoot = path.normalize(root) === path.normalize(defaultRoot());

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
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;
const unquotedSlug = (s) => (SAFE.test(String(s)) ? String(s) : shq(s));
const selfTok = () => (SAFE_PATH.test(SELF) ? SELF : shq(SELF));
const rootArg = () => (usesDefaultRoot ? '' : ` --root ${shq(root)}`);
const cli = (subcommand) => `${selfTok()} ${subcommand}${rootArg()}`;
const followWaitCmd = (threadId, handle) =>
  `${cli('wait')} --thread ${unquotedSlug(threadId)} --as ${unquotedSlug(handle)} --follow --interval 3`;

function posNum(val, name, { int = false } = {}) {
  if (val === true) throw new Error(`athread: --${name} requires a value`);
  const n = Number(val);
  if (!Number.isFinite(n) || n <= 0 || (int && !Number.isInteger(n))) {
    throw new Error(`athread: --${name} must be a positive ${int ? 'integer' : 'number'} (got "${val}")`);
  }
  return n;
}
function nonNegInt(val, name) {
  if (val === true) throw new Error(`athread: --${name} requires a number`);
  const n = Number(val);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`athread: --${name} must be a non-negative integer (got "${val}")`);
  }
  return n;
}

const dir = (i) => path.join(root, i);
const metaPath = (i) => path.join(dir(i), 'meta.json');
const readMeta = (i) => JSON.parse(fs.readFileSync(metaPath(i), 'utf8'));
const writeMeta = (i, m) => fs.writeFileSync(metaPath(i), JSON.stringify(m, null, 2) + '\n');
const msgFiles = (i) => fs.readdirSync(dir(i)).filter((f) => /^\d{4}\./.test(f)).sort();
const isNoteFile = (f) => /^\d{4}\.~note\./.test(f);
const fileIndex = (f) => parseInt(f.slice(0, 4), 10);
const substantiveFilesOf = (i) => msgFiles(i).filter((f) => !isNoteFile(f));
// Handles may contain dots, so derive the author from the filename, not by splitting on ".".
const authorFromFile = (f) => f.slice(5).replace(/\.md$/, '').replace(/^~note\./, '');
const lastSubstantiveIndex = (i, who) => substantiveFilesOf(i)
  .filter((f) => authorFromFile(f) === who)
  .reduce((max, f) => Math.max(max, fileIndex(f)), 0);
const lastIndexOf = (i) => msgFiles(i).reduce((m, f) => Math.max(m, fileIndex(f)), 0);
// Newest file mtime in the thread dir - more current than meta.json mid-write.
const updatedOf = (i) => {
  let mtime = 0;
  for (const f of fs.readdirSync(dir(i))) {
    try { mtime = Math.max(mtime, fs.statSync(path.join(dir(i), f)).mtimeMs); } catch { /* ignore */ }
  }
  return mtime ? new Date(mtime).toISOString() : null;
};
function threadSummary(i) {
  const m = readMeta(i);
  const all = msgFiles(i);
  const notes = all.filter(isNoteFile).length;
  return {
    id: i,
    participants: m.participants,
    turn: m.turn,
    status: m.status,
    rounds: all.length - notes,
    messages: all.length,
    notes,
    last: lastIndexOf(i),
    updated: updatedOf(i),
  };
}
const otherOf = (m, who) => m.participants.find((p) => p !== who) || '(peer)';
const nowIso = () => new Date().toISOString();

// One thread's summary, or a non-crashing {id,error} for a missing/garbled thread.
function summarizeOrError(tid) {
  if (!fs.existsSync(metaPath(tid))) return { id: tid, error: 'no such thread' };
  try { return threadSummary(tid); }
  catch (e) { return { id: tid, error: String(e.message || e) }; }
}

// Read-only fleet view over every thread under the root, honoring the same
// AND-composed filters as `status --all`. Shared by `status --all` and `sweep`.
function fleetView(args) {
  const wantOpen = !!args.open;
  const wantPart = (args.participant !== undefined && args.participant !== true) ? args.participant : null;
  const minMsgs = args['min-messages'] !== undefined ? nonNegInt(args['min-messages'], 'min-messages') : null;
  const maxMsgs = args['max-messages'] !== undefined ? nonNegInt(args['max-messages'], 'max-messages') : null;
  let sinceMs = null;
  if (args.since !== undefined) {
    if (args.since === true) throw new Error('athread: --since requires an ISO timestamp');
    const d = new Date(args.since);
    if (Number.isNaN(d.getTime())) throw new Error(`athread: --since must be an ISO date (got "${args.since}")`);
    sinceMs = d.getTime();
  }
  const filtering = wantOpen || wantPart != null || minMsgs != null || maxMsgs != null || sinceMs != null;
  const names = fs.existsSync(root)
    ? fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
    : [];
  const out = [];
  for (const tid of names) {
    if (!fs.existsSync(metaPath(tid))) continue; // not a thread dir
    let s;
    // A garbled thread can't be matched against a predicate, so drop it when
    // filtering; surface it as {id,error} only in the unfiltered listing.
    try { s = threadSummary(tid); }
    catch (e) { if (!filtering) out.push({ id: tid, error: String(e.message || e) }); continue; }
    if (wantOpen && s.status !== 'open') continue;
    if (wantPart != null && !s.participants.includes(wantPart)) continue;
    if (minMsgs != null && s.messages < minMsgs) continue;
    if (maxMsgs != null && s.messages > maxMsgs) continue;
    if (sinceMs != null && !(s.updated && new Date(s.updated).getTime() >= sinceMs)) continue;
    out.push(s);
  }
  return out;
}

// A thread's change-signal for `sweep`: any turn/status/message/note movement
// changes the string. Errors carry their text so a CHANGING error re-surfaces
// while a steady one quiets after the first sweep.
const signalOf = (s) => (s.error ? `ERROR:${s.error}` : `${s.turn}|${s.status}|${s.messages}|${s.notes}`);

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
  const note = kind === 'note';
  return withLock(i, () => {
    const m = readMeta(i);
    if (!m.participants.includes(who)) {
      throw new Error(`athread: "${who}" is not a participant of ${i} (${m.participants.join(', ')})`);
    }
    if (m.status === 'resolved') {
      throw new Error(`athread: thread ${i} is already resolved`);
    }
    // A note never claims the turn, so it skips the turn check; post/resolve still enforce it.
    if (!note && m.turn !== who && !force) {
      throw new Error(`athread: not your turn on ${i} (turn=${m.turn}, you=${who}); pass --force to override`);
    }
    const n = nextIndex(i);
    const to = otherOf(m, who);
    // round counts substantive messages only: a post is the next round, a note rides the current one.
    const substantive = substantiveFilesOf(i).length;
    const round = note ? substantive : substantive + 1;
    const file = note ? `${n}.~note.${who}.md` : `${n}.${who}.md`;
    const tag = kind ? ` ${kind}` : '';
    const header = `<!-- from:${who} to:${to}${tag} round:${round} ts:${nowIso()} -->`;
    fs.writeFileSync(path.join(dir(i), file), `${header}\n${body.replace(/\s+$/, '')}\n`);
    if (!note) {
      m.turn = to;
      if (kind === 'resolve') m.status = 'resolved';
    }
    m.updated = nowIso();
    writeMeta(i, m);
    return file;
  });
}

// Print every message since the caller's last substantive post (their context
// window), so interleaved notes are surfaced, not just the latest message.
function printWindow(i, who) {
  const since = lastSubstantiveIndex(i, who);
  for (const f of msgFiles(i).filter((file) => fileIndex(file) > since)) {
    console.log(`===== ${f} =====`);
    console.log(fs.readFileSync(path.join(dir(i), f), 'utf8').trimEnd());
  }
}

// Single-shot check used by both the blocking wait loop and the non-blocking
// --probe: if the thread is resolved or it is `who`'s turn, print any available
// window + status line and return true. Otherwise return false without printing,
// so the caller decides whether to keep waiting (loop) or exit with the "not yet
// your turn" sentinel (probe).
function emitTurnOrResolved(i, who) {
  const m = readMeta(i);
  if (m.status === 'resolved') {
    printWindow(i, who);
    console.log('\n[athread] status=resolved');
    return true;
  }
  if (m.turn === who) {
    printWindow(i, who);
    const round = substantiveFilesOf(i).length;
    const capped = m.round_cap != null && round >= m.round_cap;
    const capLabel = m.round_cap == null ? 'unlimited' : m.round_cap;
    console.log(`\n[athread] your turn (round ${round}, cap ${capLabel})${capped ? ' -- ROUND CAP reached: stop and escalate to the human' : ''}`);
    return true;
  }
  return false;
}

// Pattern-agnostic: the peer's specific job arrives in the first message it
// waits for. This prompt only teaches the mechanics + the loop. An optional
// freeform --role label (e.g. "reviewer", "backend API owner", "navigator")
// is surfaced as a one-line hint. All shell-interpolated values are quoted so
// a path with spaces or shell metacharacters cannot break the one-paste launcher.
function kickoffPrompt({ handle, peer, threadId, role, session }) {
  const roleLine = role ? `Your collaboration role: ${role}.\n` : '';
  const T = unquotedSlug(threadId);
  const H = unquotedSlug(handle);
  // The skill-first opening line must be self-sufficient: a user who knows the
  // peer already has the skill copies only that sentence, so a custom root has to
  // ride along (otherwise the peer defaults to ~/.agent-threads and never finds
  // the thread). For the default root there is nothing to carry.
  const rootTok = SAFE_PATH.test(root) ? root : shq(root);
  const rootHint = usesDefaultRoot ? '' : ` (thread root: ${rootTok})`;
  const rootLine = usesDefaultRoot
    ? ''
    : `\nThread root is ${rootTok} - pass it as --root on every athread command.`;
  const bodyFile = 'PATH_YOU_WROTE';
  const skillPath = path.resolve(path.dirname(SELF), '..', 'SKILL.md');
  const skillLine = 'Use the agent-thread skill if it is available in your environment; it contains the full protocol (collaboration patterns, escalation rules).'
    + (fs.existsSync(skillPath) ? ` If you can read local files, its entrypoint is: ${skillPath}` : '');
  const loopVerb = session
    ? 'This is an ongoing session: keep looping until the peer resolves the thread or tells you the session is over.'
    : 'Loop until the thread is resolved.';
  const framing = session
    ? '\nOngoing session: reply one turn at a time and keep waiting between turns. Do NOT resolve until the peer says the session is over.\n'
    : '';
  const resolveRule = session
    ? 'Resolve only when the session is over and no more turns are needed.'
    : 'Resolve only when the shared goal is met and no peer action is needed.';
  const turnContract = `Turn contract:
- Before each post, decide whether you are handing back, resolving, or escalating to the human.
- If handing back, say what you inspected or changed, blockers or open questions, and what you need from the peer next.
- ${resolveRule}
- After every post, immediately rearm the wait${session ? ' with --follow' : ''} and keep its output attached; do not return to the human merely because the turn is now the peer's.
- While wait is pending and has no output, stay silent; do not send periodic "still waiting" or background-terminal progress updates to the human.
- Do not answer only with "done", "looks good", "waiting", or a generic summary.`;
  const waitCmd = session
    ? followWaitCmd(threadId, handle)
    : `${cli('wait')} --thread ${T} --as ${H} --timeout 1800 --interval 3`;
  const postCmd = `${cli('post')} --thread ${T} --as ${H} --body-file ${shq(bodyFile)}`;
  const noteCmd = `${cli('note')} --thread ${T} --as ${H} --body "<context, correction, or STOP>"`;
  const notesBlock = `Out-of-band notes: either side may add a note at any time. A note does NOT take the turn, and seeing one never means it is your turn. Use it to add context, a correction, or a STOP while the peer is working:
  ${noteCmd}
Re-run your wait at the start of your turn and again right before you post or resolve, so you pick up any notes that arrived while you were working.`;
  const resolveCmd = `${cli('resolve')} --thread ${T} --as ${H} --body "<the outcome>"`;
  const resolveStep = session
    ? `4. If the peer says the session is over, resolve it:\n       ${resolveCmd}\n  5. Otherwise repeat from step 1.`
    : `4. If the shared goal is met, resolve it:\n       ${resolveCmd}\n  5. Otherwise repeat from step 1.`;
  const footer = session
    ? 'Your specific task is in the first message you receive. Keep each turn concrete and brief. `wait --follow` keeps waiting across idle gaps; if your terminal is reaped, just re-run the same wait command. Stop only when the peer resolves the thread.'
    : 'Your specific task and goal are in the first message you receive. Keep each turn concrete and brief. If you hit the round cap or a wait times out, stop and tell the human.';
  return `Use the agent-thread skill. Join thread ${threadId} as ${handle}${rootHint}.

You are joining a shared agent-thread. Your thread handle is "${handle}" (use this exact value for --as); the peer's handle is "${peer}".${rootLine}
${roleLine}Communicate ONLY through the thread. ${loopVerb}
${framing}
${skillLine}

${turnContract}

${notesBlock}

If the skill is unavailable, use this executable CLI fallback. It has the exact CLI path, thread id, and --as handle for this collaboration.
Run wait as an active command or a harness-managed background terminal that preserves output and can be resumed. Do not shell-background it with &: that can detach the output from the agent.
Do not finalize your assistant turn assuming a completed background wait will auto-wake you. Keep the wait tool call active, or actively poll/resume the managed terminal and consume its output.
If the wait is still pending and produces no output, do not narrate that state to the human. Only surface an actual peer turn, resolution, round-cap signal, timeout, or direct human-requested status.

Loop:
  1. ${waitCmd}
     (waits until it is your turn, then prints the peer's latest message${session ? '; --follow keeps waiting across idle gaps and prints a heartbeat to stderr' : ' + round/cap'})
  2. Do your part of what the message asks. Read or inspect anything it references (files, paths, the working tree).
  3. Write your reply to a temp file your environment can write. Replace ${bodyFile} below with that path (quote it if it contains spaces), then post it:
       ${postCmd}
  ${resolveStep}

${footer}`;
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
    const session = !!a.session;
    if (session && a['round-cap'] !== undefined) {
      throw new Error('athread: --session implies an unlimited round cap; do not combine it with --round-cap');
    }
    const roundCap = session
      ? null // sessions are unlimited
      : (a['round-cap'] !== undefined ? posNum(a['round-cap'], 'round-cap', { int: true }) : 15);
    const exists = fs.existsSync(metaPath(id));
    if (exists && !a.force) {
      throw new Error(`athread: thread ${id} already exists; pass --force to reset it`);
    }
    fs.mkdirSync(dir(id), { recursive: true });
    // Self-ignore ONLY a dedicated `.agent-threads` root. Never drop a "*"
    // .gitignore into an arbitrary $ATHREAD_DIR -- it could ignore a whole repo.
    if (path.basename(root) === '.agent-threads') {
      try { fs.writeFileSync(path.join(root, '.gitignore'), '*\n', { flag: 'wx' }); } catch { /* already there */ }
    }
    if (exists && a.force) {
      for (const f of msgFiles(id)) fs.rmSync(path.join(dir(id), f));
      try { fs.rmdirSync(path.join(dir(id), '.lock')); } catch { /* ignore */ }
    }
    writeMeta(id, {
      id,
      participants,
      turn,
      status: 'open',
      session,
      round_cap: roundCap,
      created: nowIso(),
    });
    console.log(id);
  } else if (cmd === 'post') {
    assertSafeId(id);
    const who = assertSafeHandle(a.as);
    const file = writeMessage(id, who, bodyFrom(a), undefined, a.force);
    console.log(file);
    const m = readMeta(id);
    if (m.session && m.status === 'open') {
      console.error(`[athread] session remains open; immediately rearm wait: ${followWaitCmd(id, who)}`);
    }
  } else if (cmd === 'note') {
    const who = assertSafeHandle(a.as);
    const spec = (a.thread !== undefined && a.thread !== true) ? String(a.thread) : (process.env.ATHREAD_ID || a._[0] || '');
    const ids = spec.split(',').map((s) => s.trim());
    const body = bodyFrom(a);
    if (ids.length === 1) {
      assertSafeId(ids[0]);
      console.log(writeMessage(ids[0], who, body, 'note', false));
    } else {
      // Broadcast: validate the whole set up front, then best-effort fan-out.
      if (ids.some((t) => t === '')) throw new Error('athread: empty thread id in --thread list');
      const seen = new Set();
      for (const t of ids) {
        if (seen.has(t)) throw new Error(`athread: duplicate thread id "${t}" in --thread list`);
        seen.add(t);
      }
      ids.forEach(assertSafeId);
      let failed = 0;
      for (const t of ids) {
        try { console.log(`${t}: ${writeMessage(t, who, body, 'note', false)}`); }
        catch (e) { failed++; console.log(`${t}: ERROR ${String(e.message || e)}`); }
      }
      // best-effort must not mean silent loss: a dropped target forces nonzero exit.
      if (failed) process.exit(1);
    }
  } else if (cmd === 'pending') {
    // Non-blocking checkpoint peek: print the PEER's notes since my last
    // substantive post, then exit 0. No turn semantics, no write, never blocks.
    assertSafeId(id);
    const who = assertSafeHandle(a.as);
    const m = readMeta(id);
    if (!m.participants.includes(who)) {
      throw new Error(`athread: "${who}" is not a participant of ${id} (${m.participants.join(', ')})`);
    }
    const since = lastSubstantiveIndex(id, who);
    for (const f of msgFiles(id).filter((file) => isNoteFile(file) && fileIndex(file) > since && authorFromFile(file) !== who)) {
      console.log(`===== ${f} =====`);
      console.log(fs.readFileSync(path.join(dir(id), f), 'utf8').trimEnd());
    }
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
    if (a.all) {
      // Read-only fleet view: enumerate every thread dir under the root. No lock
      // (a snapshot must not block live writers); a garbled thread is flagged,
      // never crashes the listing. Optional filters narrow it, AND-composed.
      console.log(JSON.stringify(fleetView(a), null, 2));
    } else {
      assertSafeId(id);
      const m = readMeta(id);
      const all = msgFiles(id);
      const notes = all.filter(isNoteFile).length;
      console.log(JSON.stringify({ ...m, rounds: all.length - notes, messages: all.length, notes }, null, 2));
    }
  } else if (cmd === 'sweep') {
    // Turn-start safety net for a coordinator: snapshot a named set of threads,
    // diff against the last sweep's signals (a tiny on-disk state file), and
    // print ONLY the threads that moved (turn flip, new notes, resolution). This
    // is the authoritative wake source the findings call for - background
    // watchers can silently stop delivering events, but a sweep has no
    // live-process dependency and catches anything they missed.
    const who = (a.as !== undefined && a.as !== true) ? assertSafeHandle(a.as) : null;
    const hasThread = a.thread !== undefined && a.thread !== true;
    const useAll = !!a.all;
    if (hasThread && useAll) throw new Error('athread: sweep takes either --thread a,b,c or --all, not both');
    if (!hasThread && !useAll) throw new Error('athread: sweep needs --thread a,b,c or --all');
    let entries;
    if (useAll) {
      entries = fleetView(a); // honors --participant/--open/--since/--min/max-messages
    } else {
      const ids = String(a.thread).split(',').map((s) => s.trim());
      if (ids.some((t) => t === '')) throw new Error('athread: empty thread id in --thread list');
      const seen = new Set();
      for (const t of ids) {
        if (seen.has(t)) throw new Error(`athread: duplicate thread id "${t}" in --thread list`);
        seen.add(t);
      }
      ids.forEach(assertSafeId);
      entries = ids.map(summarizeOrError);
    }
    // State file: default beside the root, keyed by handle so two coordinators
    // sharing a root keep separate baselines. The leading dot + .json keeps it
    // out of `status --all` (which only enumerates directories).
    const statePath = (a.state !== undefined && a.state !== true)
      ? path.resolve(a.state)
      : path.join(root, `.athread-sweep${who ? `.${who}` : ''}.json`);
    let prior = {};
    if (!a.reset) {
      try { prior = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
      catch { prior = {}; } // missing or corrupt baseline: re-baseline, never crash the safety net
    }
    const nextState = a.reset ? {} : { ...prior };
    const changed = [];
    for (const e of entries) {
      const sig = signalOf(e);
      const was = prior[e.id];
      nextState[e.id] = sig;
      if (was !== sig) {
        const firstSeen = was === undefined;
        changed.push(e.error
          ? { ...e, firstSeen, changed: true }
          : (who ? { ...e, mine: e.turn === who, firstSeen } : { ...e, firstSeen }));
      }
    }
    try { fs.writeFileSync(statePath, JSON.stringify(nextState, null, 2) + '\n'); }
    catch (err) { process.stderr.write(`[athread] sweep: could not persist state to ${statePath}: ${String(err.message || err)}\n`); }
    console.log(JSON.stringify(changed, null, 2));
  } else if (cmd === 'kickoff') {
    assertSafeId(id);
    const m = readMeta(id);
    const handle = assertSafeHandle(a.as && a.as !== true ? a.as : m.participants[1]);
    if (!m.participants.includes(handle)) {
      throw new Error(`athread: "${handle}" is not a participant of ${id} (${m.participants.join(', ')})`);
    }
    const peer = otherOf(m, handle);
    const role = typeof a.role === 'string' ? a.role : '';
    console.log(kickoffPrompt({ handle, peer, threadId: id, role, session: !!m.session }));
  } else if (cmd === 'wait') {
    assertSafeId(id);
    const who = assertSafeHandle(a.as);
    const m0 = readMeta(id);
    if (!m0.participants.includes(who)) {
      throw new Error(`athread: "${who}" is not a participant of ${id} (${m0.participants.join(', ')})`);
    }
    const follow = !!a.follow; // never give up on timeout; persist across idle gaps
    const probe = !!a.probe; // single-shot: check once, never block
    if (probe && follow) {
      throw new Error('athread: --probe is single-shot; do not combine it with --follow');
    }
    if (probe) {
      // Non-blocking peek at turn ownership for a self-polling worker loop: print
      // and exit 0 when it is your turn or the thread resolved, else exit 3 (a
      // distinct "not yet your turn" sentinel - NOT a timeout/error). Lets a
      // harness that does not auto-wake on a backgrounded wait poll cheaply
      // without misreading a healthy "still the peer's turn" as a stall.
      if (emitTurnOrResolved(id, who)) return;
      process.exit(3);
    }
    const timeout = (a.timeout === undefined ? 1800 : posNum(a.timeout, 'timeout')) * 1000;
    const interval = (a.interval === undefined ? 3 : posNum(a.interval, 'interval')) * 1000;
    const start = Date.now();
    let windowStart = Date.now();
    for (;;) {
      if (emitTurnOrResolved(id, who)) return;
      if (Date.now() - windowStart > timeout) {
        if (follow) {
          const mins = Math.round((Date.now() - start) / 60000);
          process.stderr.write(`[athread] still waiting on ${id} as ${who} (${mins}m elapsed)\n`);
          windowStart = Date.now();
        } else {
          console.error(`[athread] wait timed out after ${timeout / 1000}s -- peer went quiet; escalate to the human`);
          process.exit(2);
        }
      }
      await sleep(interval);
    }
  } else {
    console.error(cmd ? `athread: unknown command "${cmd}"` : 'athread: missing command');
    console.error(`Run ${path.basename(SELF)} --help for usage.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
