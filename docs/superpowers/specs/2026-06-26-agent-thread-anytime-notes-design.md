# agent-thread anytime notes - design

Date: 2026-06-26
Status: approved (design converged with a Codex peer over the agent-thread channel itself)

## Problem

`agent-thread` is strictly turn-based: `meta.turn` names whose move it is, and
`post`/`resolve` are rejected unless it is your turn. This means the **waiting**
agent is muted until the peer hands the turn back. There are real moments where
the waiting side wants to speak before then:

- the human injects new info into the idle session ("also check the auth flow",
  "the path is actually /foo") and it wants to forward that to the busy peer;
- it realizes the peer's in-flight task is moot and wants to say "stop";
- it has an addendum or correction to the request already in flight;
- more generally, the human wants the two sides to be able to talk whenever.

The ask: make the channel **bidirectional at any time** without losing what
turn-taking buys.

## The constraint that dominates the design

A busy LLM agent is **not polling the thread while it generates** - it only
reads at checkpoints (when its `wait` returns, or when it chooses to re-read).
So in a pure files+shell channel, **no model delivers real-time mid-work
interruption.** "Send anytime" can only mean: *deposit a message anytime; the
peer sees it the next time it reads.* True preemption would require harness-level
injection into the peer's session, which this skill deliberately refuses to
depend on (no daemon, no MCP). The design is honest about this limit: "stop" is
**best-effort**, landing at the peer's next checkpoint.

## Decision: Option A - turn-taking plus anytime notes

Keep turn-taking for the substantive handoff (`post`/`resolve`). Add a new
**`note`** message that either participant may drop at **any time**, which
**never** claims the turn. The turn-holder collects notes at its checkpoints.

This delivers the substance of duplex (talk anytime) without the hazard of true
duplex. The turn baton still answers "whose move is it to *advance the work*",
while notes let either side interject freely around it.

### Rejected: Option B - full duplex (drop the turn gate)

Either side posts anytime; `wait` wakes on any unseen message via a per-handle
read cursor. Rejected because:

- Its headline benefit (real-time interruption) is illusory here - the
  checkpoints-only constraint above is identical under both models.
- What it actually adds over A is "either side can advance substantive work with
  no turn baton", which is exactly the fork / double-advance hazard the channel
  was built to avoid (two autonomous agents both deciding it is their move).
- It costs a new persisted read-cursor state, a new race surface, and a rewrite
  of the trivially-correct `wait` wake rule - to buy something the medium cannot
  deliver.

## Mechanics

### The `note` command

```
athread note [--root R] --thread T --as W (--body "..." | --body-file F | < file)
```

- Acquires the same `mkdir` lock as `post`; validates that `W` is a participant
  and the thread is `open`.
- Appends an indexed message file, then **returns without changing `meta.turn`
  or `meta.status`**. Updates `meta.updated`.
- **Allowed regardless of whose turn it is**, from either participant. (When it
  is already your turn you would normally just `post`; allowing `note` anytime
  keeps the rule a single sentence.)
- **Rejected once `status == resolved`**, same as `post`.
- No `--force` semantics needed: a note never contends for the turn, so it never
  needs to override it. (`--force` stays a `post`/`resolve` recovery hatch.)

### Filename convention and the single index stream

Handles may contain dots (`SAFE = /^[A-Za-z0-9._-]+$/`), so a `.note.md`
**suffix** marker is ambiguous: a substantive file for a handle named
`alpha.note` is `0001.alpha.note.md`, which a suffix test cannot distinguish
from a note by handle `alpha`. The kind marker must therefore be a token that
**cannot appear in a handle**.

- Substantive messages keep the existing name: `NNNN.<who>.md`.
- Notes use a leading kind marker: `NNNN.~note.<who>.md`. `~` is outside the
  `SAFE` handle alphabet, so a substantive file can never collide with the
  marker, and `<who>` may safely contain dots.
- **One monotonic index stream**: notes consume an index too, so `nextIndex`,
  chronological ordering, and the lock stay trivial. Classification is a cheap
  **filename** test - no header parsing:
  - any message: `^(\d{4})\.` (unchanged `msgFiles` filter);
  - note: `^\d{4}\.~note\.` ; author = the segment between `.~note.` and `.md`;
  - substantive: matches `^(\d{4})\.(.+)\.md$` **after** the note test fails;
    author = the segment between the index dot and `.md`.
  Always test note-ness **first**, since the substantive pattern also matches a
  note filename.

The message header gains a `note` tag for notes (mirrors how `resolve` is
tagged), so `read` output is self-describing.

### `wait`: print the window, return immediately when it is your turn

- When `turn == who` (already your turn) or the thread is `resolved`, `wait`
  returns immediately (it already does today).
- Instead of printing only the latest message, `wait` prints the **window**: all
  message files (substantive **and** notes) whose index is greater than the
  caller's **last substantive message index**, in chronological order, followed
  by the usual round/cap line.
  - This catches interleaved notes with **no persisted cursor**. It is a
    *derived context window*, not true unseen-state; it intentionally may replay
    the caller's own notes. (Do not call it "unseen" in docs/tests.)
  - First `wait` by a joiner (no prior message from `who`) starts at index 0, so
    it prints the whole thread so far - correct.
- `wait` **does not wake on notes** while it is not your turn. Waking the waiter
  on a note is a spurious wake (it cannot act - not its turn - and would just
  re-wait); notes flow primarily waiter -> turn-holder anyway. Waking-on-notes
  only pays off with a persisted cursor to dedupe repeats, i.e. Option B's
  complexity. So `wait` returns only on `turn == me` or `resolved`.

### Rounds and the cap count substantive messages only

Because notes consume indices, the round/cap accounting must ignore them:

- `round` shown to users and used for the cap = **count of substantive files**,
  not total files.
- Header `round:` is the substantive round, never the raw file index:
  - a substantive `post`/`resolve` header = the **next** substantive round count
    (the round it is creating);
  - a `note` header = the **current** substantive round count (it rides
    alongside the present state and does not advance it).
- The raw file index is kept only for ordering and the window computation.
- Consequence: a note can never prematurely trip the 15-round escalation, and a
  thread with **zero notes** has an unchanged substantive round count.

### `status` reports both counts

`status` JSON adds: total message count, substantive round count, and note
count - so neither a human nor the escalation logic is misled by interleaved
notes.

### Checkpoints (protocol, not code)

- The turn-holder runs `wait --as me` (returns immediately, prints the window)
  **at the start of its turn** and again **right before it posts or resolves**,
  so late notes - including "stop" / "don't resolve" - are seen at the two
  natural moments. **Resolve is a checkpoint too.**
- Accepted minor redundancy: the pre-post check re-prints the peer's last turn
  message; harmless.
- **Property worth documenting:** sending a note does **not** disturb your armed
  `wait`. Because a note does not flip the turn, the waiter's existing background
  `wait --as me` stays valid - the waiter fires a note and keeps the same wait;
  no teardown / re-arm. This is what makes "human injects info into the idle
  session -> forward it to the busy peer" cheap, and is the core motivating flow.

### Best-effort race, documented not closed

A note can arrive **after** the turn-holder's pre-post checkpoint and **before**
its `post` acquires the lock. Then the transcript may show a stale `post` ahead
of a "stop" note. This is inherent to a best-effort, cursor-free design and is
**documented, not closed** in v1. Closing it would need ack indices or persisted
per-handle read cursors (Option B territory) - deferred unless a real need for
hard stop semantics appears. `--force` remains the recovery hatch; after a force,
run `read` since the derived window can look odd.

### No `--urgent` in v1

`--urgent` would imply an interrupt semantic the channel does not have. Users
write `URGENT:` / `STOP:` in the note body; the CLI renders note batches visibly.
If notification/priority behavior is added later, `--urgent` can arrive as a
non-breaking addition.

## Surface of change

Code (`scripts/athread.mjs`):
- new `note` subcommand + its option allow-list and `help note` text;
- `writeMessage` (or a sibling) able to append a note without flipping turn;
- a substantive-only round counter used by `wait` and message headers;
- `wait` prints the window since the caller's last substantive index;
- `status` reports total / substantive / note counts;
- `kickoff` fallback loop mentions `note` and the checkpoint rule.

Tests (`scripts/test-athread.mjs`):
- note does not flip the turn;
- note is allowed when it is not your turn (both directions);
- note is rejected after `resolve`;
- `wait` prints the window including interleaved notes, in order;
- round cap counts substantive only (notes never trip it; a zero-note thread is
  unchanged);
- first wait by a joiner prints from index 0;
- a note written while a substantive `wait` is armed does not affect that wait's
  turn/resolve completion;
- **dotted-handle regression:** participants `alpha.note,beta` and `a.b,c-d` -
  substantive files for these handles are never misclassified as notes, the
  last-substantive lookup is correct, and a zero-note thread with such handles is
  unchanged.

Docs:
- `SKILL.md`: "wake mechanic" (notes never wake `wait`), "turn contract"
  (checkpoint before post/resolve; a note never means it is your turn), CLI
  reference row for `note`, and the kickoff/fallback text.
- `DESIGN.md`: a "anytime notes" subsection capturing the decision and the race.
- `README.md`: one-line mention if the feature list warrants it.

## Backward compatibility

Strictly additive. On a thread with no `note` files:

- `post` / `resolve` behavior is identical;
- an ordinary `wait` after a handoff prints the same single message (the window
  degenerates to "messages since my last substantive post" = the peer's one new
  turn message = today's "latest"), and still does not return on an empty,
  just-initialized thread even when `turn == who` (the `all.length` guard is
  preserved);
- substantive round count equals total message count.

`status` is **additive only** - existing fields are unchanged, new count fields
are added. No `meta.json` migration. Already-running `wait`/`post` processes are
unaffected (their code is already in memory); the next invocation simply picks up
the superset behavior.

## Out of scope (YAGNI)

- No persisted read cursors / ack indices (would be Option B).
- No `wait` waking on notes.
- No `--urgent` / priority / notification semantics.
- No daemon, MCP, fs.watch, cross-machine, or >2 participants (unchanged).

## Provenance

This design was debated and converged with a Codex peer **through the
agent-thread channel itself** (thread `bidir-design`): the dogfood is the
validation. Codex contributed the first-class `note` command (vs `post --force`),
the substantive-only cap counting, the "derived window, not unseen state"
framing, and the catch that a `.note.md` suffix collides with dotted handles
(hence the `~note` marker); this session contributed the filename convention, the
round/index decoupling, the `status` counts, the "note does not disturb your
armed wait" property, and the resolve-as-checkpoint rule.
