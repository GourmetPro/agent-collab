# agent-thread Anytime Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an out-of-band `note` message to `agent-thread` so either session can speak at any time without claiming the turn, picked up by the peer at its next checkpoint.

**Architecture:** Keep turn-taking for the substantive handoff (`post`/`resolve`). Add a `note` command that appends an indexed message file named `NNNN.~note.<who>.md` on the single monotonic index stream, never touching `meta.turn`/`meta.status`. `wait` prints the window of messages since the caller's last substantive post (catching interleaved notes) and counts only substantive files for the round cap. All changes are additive; a thread with zero notes keeps identical `post`/`resolve`/wait-after-handoff behavior, and `status` only gains fields.

**Tech Stack:** One zero-dependency Node (>= 18) script, `skills/agent-thread/scripts/athread.mjs`, with a self-contained spawn-based test `skills/agent-thread/scripts/test-athread.mjs`. No package manager, no test framework.

## Global Constraints

- Zero dependencies; stock Node >= 18; no `package.json`, no installs.
- Run the whole test with: `node skills/agent-thread/scripts/test-athread.mjs` (expects `all checks passed`).
- The kind marker is the literal token `~note`; `~` is outside the handle alphabet `SAFE = /^[A-Za-z0-9._-]+$/`, so it can never collide with a handle. Always test note-ness BEFORE the substantive pattern.
- Notes never change `meta.turn` or `meta.status`, never wake a pending `wait`, and are rejected once `status == resolved`.
- Round/cap and message-header `round:` count substantive files only. Raw file index is for ordering and the window only.
- No emojis in skill body prose or code comments. `Yes`/`No` in tables. Forward-slash paths. SKILL.md body stays under 500 lines.
- All edits happen in the worktree `/Users/knshiro/dev/agent-collab-bidir-notes`; the live script at `/Users/knshiro/dev/agent-collab/...` is never touched.

---

### Task 1: `note` command, classification helpers, and additive `status` counts

**Files:**
- Modify: `skills/agent-thread/scripts/athread.mjs`
- Test: `skills/agent-thread/scripts/test-athread.mjs`

**Interfaces:**
- Produces (internal helpers used by Task 2):
  - `isNoteFile(f: string): boolean` - true for `NNNN.~note.<who>.md`
  - `fileIndex(f: string): number` - the 4-digit index
  - `substantiveFilesOf(i: string): string[]` - sorted message files excluding notes
  - `authorFromFile(f: string): string` - handle that wrote `f` (dot-safe)
  - `lastSubstantiveIndex(i: string, who: string): number` - 0 if none
- Produces (CLI): `note --thread T --as W (--body | --body-file | stdin)` -> prints the created filename; `status` JSON gains `messages` and `notes`, and `rounds` becomes the substantive count.

- [ ] **Step 1: Write the failing tests**

Insert this block in `skills/agent-thread/scripts/test-athread.mjs` immediately BEFORE the final `fs.rmSync(TMP, { recursive: true, force: true });` line:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node skills/agent-thread/scripts/test-athread.mjs`
Expected: FAIL — `note` is an unknown command (exit 1 paths differ), and `status` has no `messages`/`notes` keys.

- [ ] **Step 3: Add classification helpers**

In `skills/agent-thread/scripts/athread.mjs`, just after the line `const msgFiles = (i) => fs.readdirSync(dir(i)).filter((f) => /^\d{4}\./.test(f)).sort();`, add:

```js
const isNoteFile = (f) => /^\d{4}\.~note\./.test(f);
const fileIndex = (f) => parseInt(f.slice(0, 4), 10);
const substantiveFilesOf = (i) => msgFiles(i).filter((f) => !isNoteFile(f));
// Handles may contain dots, so derive the author from the filename, not by splitting on ".".
const authorFromFile = (f) => f.slice(5).replace(/\.md$/, '').replace(/^~note\./, '');
const lastSubstantiveIndex = (i, who) => substantiveFilesOf(i)
  .filter((f) => authorFromFile(f) === who)
  .reduce((max, f) => Math.max(max, fileIndex(f)), 0);
```

- [ ] **Step 4: Teach `writeMessage` to write notes without flipping the turn**

Replace the entire `writeMessage` function with:

```js
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
    if (!note && m.turn !== who && !force) {
      throw new Error(`athread: not your turn on ${i} (turn=${m.turn}, you=${who}); pass --force to override`);
    }
    const n = nextIndex(i);
    const to = otherOf(m, who);
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
```

- [ ] **Step 5: Add the `note` command handler**

In `main()`, immediately after the `post` command block (after its closing `}` that ends `else if (cmd === 'post') { ... }`), add:

```js
  } else if (cmd === 'note') {
    assertSafeId(id);
    const who = assertSafeHandle(a.as);
    console.log(writeMessage(id, who, bodyFrom(a), 'note', false));
```

- [ ] **Step 6: Register the `note` option allow-list**

In the `commandOptions` object, add this entry after the `post` line:

```js
  note: new Set([...commonOptions, 'as', 'body', 'body-file']),
```

- [ ] **Step 7: Make `status` counts additive**

Replace the `status` command block with:

```js
  } else if (cmd === 'status') {
    assertSafeId(id);
    const m = readMeta(id);
    const all = msgFiles(id);
    const notes = all.filter(isNoteFile).length;
    console.log(JSON.stringify({ ...m, rounds: all.length - notes, messages: all.length, notes }, null, 2));
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node skills/agent-thread/scripts/test-athread.mjs`
Expected: PASS — `all checks passed` (existing checks plus the new note/status checks).

- [ ] **Step 9: Commit**

```bash
git add skills/agent-thread/scripts/athread.mjs skills/agent-thread/scripts/test-athread.mjs
git commit -m "feat(athread): add out-of-band note command + additive status counts"
```

---

### Task 2: `wait` prints the window and counts substantive rounds only

**Files:**
- Modify: `skills/agent-thread/scripts/athread.mjs`
- Test: `skills/agent-thread/scripts/test-athread.mjs`

**Interfaces:**
- Consumes: `substantiveFilesOf`, `fileIndex`, `lastSubstantiveIndex` from Task 1.
- Produces: `printWindow(i, who)` replacing `printLatest(i)`; `wait` prints every file with index > caller's last substantive index, then a round/cap line whose round is the substantive count.

- [ ] **Step 1a: Factor a shared `collect` helper for spawned waits**

Near the top of `test-athread.mjs`, immediately after the `runDirect` helper definition (before `const meta = ...`), add:

```js
const collect = (child) => new Promise((resolve, reject) => {
  let out = '', err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  child.on('close', (code) => resolve({ code, out, err }));
  child.on('error', reject);
});
```

Then refactor the existing `wait --follow` test to use it (no second ad hoc collector). Replace the `const followP = new Promise((resolve) => { const p = spawn(...); ... });` block with:

```js
const followP = collect(spawn('node', [AT, 'wait', '--thread', SF, '--as', 'b', '--follow', '--timeout', '1', '--interval', '1'], { env }));
```

- [ ] **Step 1b: Write the failing tests**

Insert this block in `test-athread.mjs` immediately before the final `fs.rmSync(TMP, ...)` line (after Task 1's block):

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node skills/agent-thread/scripts/test-athread.mjs`
Expected: FAIL — the round line reads `round 3` (counts the notes) and the cap trips early.

- [ ] **Step 3: Replace `printLatest` with `printWindow`**

Replace the entire `printLatest` function with:

```js
function printWindow(i, who) {
  const since = lastSubstantiveIndex(i, who);
  for (const f of msgFiles(i).filter((file) => fileIndex(file) > since)) {
    console.log(`===== ${f} =====`);
    console.log(fs.readFileSync(path.join(dir(i), f), 'utf8').trimEnd());
  }
}
```

- [ ] **Step 4: Use the window and substantive round count inside `wait`**

In the `wait` command block, in the resolved branch replace `printLatest(id);` with `printWindow(id, who);`. In the your-turn branch replace `printLatest(id);` with `printWindow(id, who);` and replace `const round = all.length;` with `const round = substantiveFilesOf(id).length;`. The your-turn branch becomes:

```js
      if (m.turn === who && all.length) {
        printWindow(id, who);
        const round = substantiveFilesOf(id).length;
        const capped = m.round_cap != null && round >= m.round_cap;
        const capLabel = m.round_cap == null ? 'unlimited' : m.round_cap;
        console.log(`\n[athread] your turn (round ${round}, cap ${capLabel})${capped ? ' -- ROUND CAP reached: stop and escalate to the human' : ''}`);
        return;
      }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node skills/agent-thread/scripts/test-athread.mjs`
Expected: PASS — `all checks passed`.

- [ ] **Step 6: Commit**

```bash
git add skills/agent-thread/scripts/athread.mjs skills/agent-thread/scripts/test-athread.mjs
git commit -m "feat(athread): wait prints the window since last substantive post; cap counts substantive only"
```

---

### Task 3: `note` help text, global command listing, and option validation

**Files:**
- Modify: `skills/agent-thread/scripts/athread.mjs`
- Test: `skills/agent-thread/scripts/test-athread.mjs`

**Interfaces:**
- Consumes: the `note` command from Task 1.
- Produces: `help note` text; `note` listed in global help; unknown flags on `note` rejected with exit 1.

- [ ] **Step 1: Write the failing tests**

Insert before the final `fs.rmSync(TMP, ...)` line:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node skills/agent-thread/scripts/test-athread.mjs`
Expected: FAIL — `help note` returns the unknown-topic error and global help has no `note` row.

- [ ] **Step 3: Add the `note` row to the global help Commands list**

In `helpText`, in the global (no-topic) help string, add a `note` line right after the `post` line so the Commands block reads:

```
  post       Append your turn and hand control to the peer.
  note       Append an out-of-band note without taking the turn.
  resolve    Append a final turn and close the thread.
```

- [ ] **Step 4: Add the `help note` topic**

In the `commandHelp` object, add this entry after the `post` entry:

```js
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node skills/agent-thread/scripts/test-athread.mjs`
Expected: PASS — `all checks passed`.

- [ ] **Step 6: Commit**

```bash
git add skills/agent-thread/scripts/athread.mjs skills/agent-thread/scripts/test-athread.mjs
git commit -m "docs(athread): note help topic, global listing, and option validation"
```

---

### Task 4: Kickoff guidance + SKILL/DESIGN/README docs

**Files:**
- Modify: `skills/agent-thread/scripts/athread.mjs` (the `kickoffPrompt` function)
- Modify: `skills/agent-thread/SKILL.md`
- Modify: `skills/agent-thread/DESIGN.md`
- Modify: `README.md`
- Test: `skills/agent-thread/scripts/test-athread.mjs`

**Interfaces:**
- Consumes: the `note` command and the checkpoint rule.
- Produces: kickoff text that explains notes and the pre-post checkpoint; documentation parity in SKILL/DESIGN/README.

- [ ] **Step 1: Write the failing tests**

Insert before the final `fs.rmSync(TMP, ...)` line (the `koN` and `koS` kickoff outputs are already captured earlier in the file):

```js
// --- kickoff teaches out-of-band notes + the checkpoint ---
check('kickoff (non-session): explains notes do not take the turn',
  /does NOT take the turn/i.test(koN.out) && / note .*--as b/.test(koN.out));
check('kickoff (non-session): tells the peer to re-check before posting/resolving',
  /before you post or resolve/i.test(koN.out));
check('kickoff (session): also explains out-of-band notes',
  /does NOT take the turn/i.test(koS.out) && / note .*--as b/.test(koS.out));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node skills/agent-thread/scripts/test-athread.mjs`
Expected: FAIL — kickoff output has no note/checkpoint text.

- [ ] **Step 3: Add the notes paragraph to `kickoffPrompt`**

In `kickoffPrompt`, after the line `const postCmd = ...;` add:

```js
  const noteCmd = `${cli('note')} --thread ${T} --as ${H} --body "<context, correction, or STOP>"`;
  const notesBlock = `Out-of-band notes: either side may add a note at any time. A note does NOT take the turn, and seeing one never means it is your turn. Use it to add context, a correction, or a STOP while the peer is working:
  ${noteCmd}
Re-run your wait at the start of your turn and again right before you post or resolve, so you pick up any notes that arrived while you were working.`;
```

Then insert `${notesBlock}` into the returned template string on its own line, immediately after the `${turnContract}` interpolation:

```js
${turnContract}

${notesBlock}

If the skill is unavailable, use this executable CLI fallback. ...
```

- [ ] **Step 4: Run the kickoff tests to verify they pass**

Run: `node skills/agent-thread/scripts/test-athread.mjs`
Expected: PASS — `all checks passed`.

- [ ] **Step 5: Update SKILL.md**

In `skills/agent-thread/SKILL.md`:

a) In the CLI reference table, add this row after the `post` row:

```
| `note [--root R] --thread T --as W (--body "..." \| --body-file F)` | Add an out-of-band note. Does NOT change the turn; allowed regardless of whose turn it is; rejected after `resolve`. The peer sees it in its next `wait` window; notes never wake a pending `wait`, and never count toward the round cap. |
```

b) Add this subsection immediately after the "## Turn contract" section:

```markdown
## Out-of-band notes

Turn-taking governs the substantive handoff, but either side may drop a `note`
at any time to add context, a correction, or a "stop" - without claiming the
turn:

```
"$AT" note --thread <id> --as <you> --body "STOP: that path is wrong, it is /srv/app"
```

- A note never changes whose turn it is, and **seeing a note never means it is
  your turn**.
- The peer picks notes up at its next **checkpoint**: re-run `wait --as <you>`
  at the start of your turn and again right before you `post` or `resolve`. The
  window `wait` prints includes any notes since your last substantive post.
- Notes never wake a pending `wait` and never count toward the round cap.
- Sending a note does **not** disturb your already-armed `wait` (the turn did
  not change), so the waiting side can forward something the human just told it
  and keep the same wait.
- Best-effort: a note can land just after the peer's pre-post checkpoint, so a
  "stop" may arrive one message late. For a hard stop, fall back to the human.
```

c) In the "## The wake mechanic" section, add this sentence to the paragraph that explains what `wait` returns on: `Notes never wake a pending wait - they are surfaced in the window the next time wait returns on your turn.`

- [ ] **Step 6: Update DESIGN.md**

In `skills/agent-thread/DESIGN.md`, add this subsection just before "## Validation":

```markdown
## Anytime notes

Strict turn-taking muted the waiting side until the peer replied. `note` adds an
out-of-band message either participant can append at any time without claiming
the turn, so the waiting side can forward late context, a correction, or a stop.
It is deliberately the smaller of the two options considered: full duplex (drop
the turn gate, wake on any unseen message via a per-handle cursor) was rejected
because its real-time benefit is illusory here - a busy agent only reads at
checkpoints - while it would surrender the "no double-advance" invariant and add
cursor state. Notes keep every existing guarantee: only `post`/`resolve` move the
turn. Mechanics: notes share the one monotonic index stream but are named
`NNNN.~note.<who>.md` (the `~` cannot appear in a handle, so a dotted handle like
`alpha.note` is never misclassified); `wait` prints the window since the caller's
last substantive post and counts only substantive files for the cap; the pre-post
checkpoint is best-effort, with the check-then-post race documented, not closed.
```

- [ ] **Step 7: Update README.md**

In `README.md`, under the `agent-thread` bullet list (the three links), add a one-line mention of notes after the existing description paragraph, e.g. append to the paragraph: `Either side can also drop an out-of-band note at any time without taking the turn.`

- [ ] **Step 8: Run the full test suite and re-read the docs**

Run: `node skills/agent-thread/scripts/test-athread.mjs`
Expected: PASS — `all checks passed`. Then read the three doc files to confirm the additions are coherent and emoji-free.

- [ ] **Step 9: Commit**

```bash
git add skills/agent-thread/scripts/athread.mjs skills/agent-thread/scripts/test-athread.mjs skills/agent-thread/SKILL.md skills/agent-thread/DESIGN.md README.md
git commit -m "docs(athread): teach notes in kickoff, SKILL, DESIGN, README"
```

---

## Self-Review

**Spec coverage:**
- `note` command (never flips turn, any-turn, rejected after resolve, non-participant rejected): Task 1.
- `~note` filename on one index stream + dotted-handle safety: Task 1 (helpers + tests).
- `wait` window since last substantive index, returns immediately on your turn: Task 2.
- Round/cap counts substantive only; header round semantics: Task 1 (header) + Task 2 (cap).
- `status` additive counts: Task 1.
- Notes never wake `wait`: preserved by construction (wait only returns on turn==me/resolved; note writes do not touch turn/status), regression-tested with a spawned pending wait (Task 2, Step 1b), and documented in SKILL (Task 4).
- Checkpoint protocol + "note does not disturb armed wait" + best-effort race + no `--urgent`: documented in kickoff + SKILL + DESIGN (Task 4).
- Backward compatibility (zero-note threads unchanged): guarded by existing tests staying green across all tasks.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows runnable assertions.

**Type consistency:** Helper names (`isNoteFile`, `fileIndex`, `substantiveFilesOf`, `authorFromFile`, `lastSubstantiveIndex`, `printWindow`) are defined in Task 1/2 and used consistently in Task 2's `wait` edits. The `note` kind string is `'note'` everywhere; filenames are `NNNN.~note.<who>.md` everywhere.
