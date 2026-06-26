# agent-thread coordinator primitives - design

Date: 2026-06-26
Status: approved (3-voice brainstorm: original writer of coordinating-parallel-sessions, a peer coordinator, and a Codex consult for the foreground-harness vote)

## Problem

Anytime notes shipped. The next question, raised by two coordinator agents who
run N parallel worker sessions (one agent-thread per worker): what would most
improve agent-thread for that fan-out use case? Their lived pain this session: a
shared-Postgres reset cascade across workers, a "main moved - rebase" that had to
be force-posted because it was the worker's turn, a heads-up stuck at a peer's
turn, and a hand-maintained thread table that is itself the source of the
"silent divergence" trap (a thread you believe is at the worker's turn that has
actually been idle at yours for 20 minutes).

## Decision: three additive CLI primitives

Build, in order: `status --all`, `pending`, broadcast `note --thread a,b,c`.
Cut: a note delivery-receipt, and an ownership-based `--all` broadcast.

All three are additive and backward-compatible (new command / new flag;
`post`/`note`/`wait`/`resolve` and single-thread `status` untouched). A thread
that uses none of them behaves exactly as today. Each degrades to "unknown
command" / "unknown option" on an un-synced install - never a wrong-but-silent
result - so the coordinator skill may reference them without hard-depending on
them.

### 1. `status --all` (build first) - read-only fleet view

```
athread status --all [--root R]
```

- Enumerates every thread directory under the root (a dir containing
  `meta.json`); ignores non-thread dirs.
- Emits a JSON array; per thread:
  `{ id, participants, turn, status, rounds (substantive), messages, notes, last, updated }`
  where `last` is the highest message index and `updated` is the **newest file
  mtime in the thread dir** (Codex: catches a thread mid-write before `meta.json`
  catches up).
- Read-only: **no lock** (a read-only snapshot must not block live writers).
  Reads each thread defensively; a missing/garbled `meta.json` is emitted as
  `{ id, error }`, never crashes the whole listing.
- Why first: cheapest, zero protocol change, and it is the **divergence
  detector** the coordinator skill's liveness rule (Gap 1) otherwise leaves to
  pure discipline. One glance replaces the hand-maintained thread table.

### 2. `pending` - non-blocking peek at notes

```
athread pending --thread T --as W [--root R]
```

- Prints the peer's notes since my last substantive index (note files where
  `authorFromFile != me`, index > `lastSubstantiveIndex(me)`), then exits 0.
  Prints nothing (still exit 0) when there are none.
- **Never blocks, never writes, no turn semantics, no wake/ack implication.**
- Single thread only (a multi-thread `pending` can come later).
- Why build it (the one contested call, broken by the Codex/foreground vote):
  the turn-holder's "STOP at a checkpoint" needs a way to check for a note
  WITHOUT ending its turn. "Just run `wait --as me`, it returns immediately when
  it's your turn" is true only for a Claude-Code backgrounded loop; in a
  foreground/managed-terminal loop it overloads a turn-state command (window +
  round/cap line) as a poll and BLOCKS if the caller is wrong about whose turn it
  is. `pending` is the clean, harness-agnostic checkpoint primitive. The skill
  recipe names `pending`; `wait --as me` is mentioned only as the
  Claude-backgrounded convenience.

### 3. broadcast `note --thread a,b,c` - fan-out one note

```
athread note --thread a,b,c --as W (--body "..." | --body-file F)
```

- `--thread` accepts a comma list (mirrors `--participants`); empty or duplicate
  items are rejected.
- Posts the note to each listed thread, each write under that thread's own lock,
  flipping no turns - best-effort fan-out.
- Prints one stdout line per thread (filename on success, `ERROR: ...` on a
  resolved/missing/invalid thread). Exits **nonzero if ANY target failed**
  (Codex: best-effort must not mean silent loss - a dropped broadcast must be
  visible, which is exactly the coordinator's "did all 4 workers get the hold?"
  worry).
- Single `--thread x` is unchanged (one note, today's behavior).
- **No `--all`.** Rejected unanimously on reflection: "participation is not
  intent" - the set of threads a handle is a participant in includes parked,
  stale, unrelated, and the coordinators' own meta/brainstorm threads. A safe
  group broadcast would need durable run-grouping metadata the CLI does not have.
  The coordinator composes the explicit set from `status --all`.

### Cut

- **Delivery-receipt / "note collected yet".** Unanimous reject. It would tempt
  callers to build gates that depend on best-effort notes, rotting the one bright
  line ("gates never depend on a note; the turn-passing post is the only reliable
  channel"). The reliable "did you get it?" already exists: ask for an ack on the
  next turn-passing post.
- **`--all` broadcast** (see above).

## The two resolved splits (provenance)

- **Broadcast set:** writer = explicit-list-only; coordinator wanted `--all`
  = threads I'm in. Resolved to explicit-list (writer + Codex): participation is
  not intent. Coordinator keeps the ergonomics via `status --all` -> compose set.
- **`pending`:** writer = build (skill needs it); coordinator = skip/thin (his
  Claude wait is backgrounded, never blocks). Resolved to **build** by the Codex
  foreground-harness vote: `wait --as me` as a poll is operationally wrong and can
  block; `pending` is the right primitive.

The coordinator also flagged he is one source across two handles (`intake` on the
live thread), so his lived examples are not independent corroboration of the
writer; weighted accordingly.

## Skill coupling (A), owned by the writer

The coordinating-parallel-sessions "Out-of-band signals (notes)" recipe
(Deliverable 5) is owned by the writer's writing-skills pass - NOT edited here,
to avoid colliding with the in-flight edits on that skill. This change ships only
the agent-thread CLI + agent-thread's own SKILL/DESIGN docs, and hands the writer
the frozen CLI surface. The recipe stays small and adds one coordinator rule from
the brainstorm: **don't orchestrate with notes** (no note->ack->note
choreography; notes signal, the turn-passing post coordinates).

## Testing

TDD, extending `scripts/test-athread.mjs`:
- `status --all`: lists each thread with turn/rounds/messages/notes/last;
  derives `updated` from file mtime; does not require `--thread`; skips a dir
  with no `meta.json` without crashing; a dotted-handle thread is fine.
- `pending`: prints a peer note, exit 0; prints nothing + exit 0 when none; never
  flips the turn or writes; only the peer's notes (not my own); single thread.
- broadcast: one note lands in each listed thread; turns unchanged; per-thread
  ok/fail lines; nonzero exit if one target is resolved/missing; empty/duplicate
  items rejected; single `--thread x` still posts exactly one note.
- backward-compat: every existing check stays green.

## Provenance

Brainstormed over two parallel agent-thread session channels (one per coordinator
agent) plus a Codex consult, with this session as the hub synthesizing one slate.
Build order: `status --all` -> `pending` -> broadcast. Cut: receipts, `--all`.
