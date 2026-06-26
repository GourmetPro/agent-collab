#!/usr/bin/env node
// athread - a zero-dependency, file-based thread for two agent sessions to take
// turns. Part of the `agent-thread` skill. Runs on any Node >= 18, no installs.
//
// Subcommands: init | post | resolve | wait | read | status | kickoff | help
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
  resolve: new Set([...commonOptions, 'as', 'body', 'body-file', 'force']),
  wait: new Set([...commonOptions, 'as', 'timeout', 'interval', 'follow']),
  read: new Set(commonOptions),
  status: new Set([...commonOptions, 'all']),
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
  ${exe} note [--root R] --thread T --as HANDLE < note.md

Options:
  --root <path>          Thread root. Defaults to $ATHREAD_DIR or ~/.agent-threads.
  --thread <id>          Thread id.
  --as <handle>          Your participant handle.
  --body <text>          Short one-line note body.
  --body-file <path>     File containing the note body.
  --help                 Show this help.

Notes:
  A note is appended WITHOUT changing whose turn it is, and may be sent
  regardless of whose turn it is. The peer sees it in its next wait window;
  notes never wake a pending wait. Rejected once the thread is resolved.
  The round cap counts substantive posts only, so notes never trip escalation.

Example:
  ${exe} note --thread review-1 --as author --body "STOP: that path is wrong, it is /srv/app"`,

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

Options:
  --root <path>          Thread root. Defaults to $ATHREAD_DIR or ~/.agent-threads.
  --thread <id>          Thread id.
  --as <handle>          Your participant handle.
  --timeout <seconds>    Timeout window. Default: 1800. Exit 2 on timeout.
  --interval <seconds>   Filesystem polling interval. Default: 3.
  --follow               Never exit on timeout; print a periodic stderr heartbeat.
  --help                 Show this help.

Output:
  When your turn arrives, prints the latest message and round/cap status.
  When resolved, prints the latest message and status=resolved.
  While pending, wait prints no stdout. Treat silence as expected.

Examples:
  ${exe} wait --thread review-1 --as author
  ${exe} wait --thread daily --as codex --follow --interval 3`,

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
  ${exe} status [--root R] --all

Options:
  --root <path>          Thread root. Defaults to $ATHREAD_DIR or ~/.agent-threads.
  --thread <id>          Thread id (single-thread mode).
  --all                  Read-only fleet view: a JSON array over every thread under
                         the root, each {id, participants, turn, status, rounds,
                         messages, notes, last, updated}. updated is the newest file
                         mtime; a garbled thread is flagged {id, error}, never crashes.
  --help                 Show this help.

Examples:
  ${exe} status --thread review-1
  ${exe} status --all`,

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
  resolve    Append a final turn and close the thread.
  wait       Block until your turn or resolution.
  read       Print the transcript.
  status     Print thread metadata as JSON.
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

// Pattern-agnostic: the peer's specific job arrives in the first message it
// waits for. This prompt only teaches the mechanics + the loop. An optional
// freeform --role label (e.g. "reviewer", "backend API owner", "navigator")
// is surfaced as a one-line hint. All shell-interpolated values are quoted so
// a path with spaces or shell metacharacters cannot break the one-paste launcher.
function kickoffPrompt({ handle, peer, threadId, role, session }) {
  const roleLine = role ? `Your collaboration role: ${role}.\n` : '';
  const T = unquotedSlug(threadId);
  const H = unquotedSlug(handle);
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
- After every post, immediately rearm the wait${session ? ' with --follow' : ''}; do not return to the human merely because the turn is now the peer's.
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
  return `Use the agent-thread skill. Join thread ${threadId} as ${handle}.

You are joining a shared agent-thread. Your thread handle is "${handle}" (use this exact value for --as); the peer's handle is "${peer}".
${roleLine}Communicate ONLY through the thread. ${loopVerb}
${framing}
${skillLine}

${turnContract}

${notesBlock}

If the skill is unavailable, use this executable CLI fallback. It has the exact CLI path, thread id, and --as handle for this collaboration.
Run wait as an active command or a harness-managed background terminal that preserves output and can be resumed. Do not shell-background it with &: that can detach the output from the agent.
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
    assertSafeId(id);
    const who = assertSafeHandle(a.as);
    console.log(writeMessage(id, who, bodyFrom(a), 'note', false));
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
      // never crashes the listing.
      const names = fs.existsSync(root)
        ? fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
        : [];
      const out = [];
      for (const tid of names) {
        if (!fs.existsSync(metaPath(tid))) continue; // not a thread dir
        try { out.push(threadSummary(tid)); }
        catch (e) { out.push({ id: tid, error: String(e.message || e) }); }
      }
      console.log(JSON.stringify(out, null, 2));
    } else {
      assertSafeId(id);
      const m = readMeta(id);
      const all = msgFiles(id);
      const notes = all.filter(isNoteFile).length;
      console.log(JSON.stringify({ ...m, rounds: all.length - notes, messages: all.length, notes }, null, 2));
    }
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
    const timeout = (a.timeout === undefined ? 1800 : posNum(a.timeout, 'timeout')) * 1000;
    const interval = (a.interval === undefined ? 3 : posNum(a.interval, 'interval')) * 1000;
    const start = Date.now();
    let windowStart = Date.now();
    for (;;) {
      const m = readMeta(id);
      const all = msgFiles(id);
      if (m.status === 'resolved') {
        printWindow(id, who);
        console.log('\n[athread] status=resolved');
        return;
      }
      if (m.turn === who && all.length) {
        printWindow(id, who);
        const round = substantiveFilesOf(id).length;
        const capped = m.round_cap != null && round >= m.round_cap;
        const capLabel = m.round_cap == null ? 'unlimited' : m.round_cap;
        console.log(`\n[athread] your turn (round ${round}, cap ${capLabel})${capped ? ' -- ROUND CAP reached: stop and escalate to the human' : ''}`);
        return;
      }
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
