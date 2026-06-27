# Living handoff - template

Copy this into a single file (for example `tmp/coordination-handoff.md`) at the
start of a multi-session effort and update it on EVERY state change. The goal:
at any moment this one file is enough for a fresh coordinator to resume with full
history, so compaction or a session restart is cheap. The sample values below
(three sessions A/B/C, thread ids, branches) are illustrative - replace them
with your effort's real values.

---

# <Effort name> coordination - handoff (compaction-safe)

## Resume after compaction - do this first
0. Env: `AT=<abs-path-to-athread.mjs>` `ROOT=<thread-root>`
   `MY_HANDLE=<coordinator-handle>`. Constraint: <e.g. local DB only>.
1. Re-arm waits. Use a real background task (`run_in_background:true` in Claude
   Code), not shell `&` or `disown`, so output stays attached to the harness. If
   a wait already fired during the gap, read its output first; a handback may be
   waiting.
   - A: `node "$AT" wait --root "$ROOT" --thread effort-stream-a --as "$MY_HANDLE" --follow --interval 3`
     (bg `<task id>`, turn=<session handle>).
   - B: PARKED - do not re-arm; I initiate next post.
   - Peer coordinator: `node "$AT" wait --thread peer-coordinator-thread --as "$MY_HANDLE" --follow --interval 3`
     (omit if there is no peer coordinator).
2. Check state with `status`/`read` for each thread.
3. Resume from the per-stream State cells and Running log.

> **STATUS <date>:** <one-line current state: which streams are merged, which
> are in review, which are blocked>.
> **NEXT:** <the single next action and who owns it>.

**Role:** I (the coordinator, in the `<coordinator-worktree>` worktree) coordinate
N parallel sessions. I do NOT write the implementation. Planning model = <hybrid /
single>; fan-out = <N> streams.

**Workflow rules:**
- I do NOT spawn the sessions. The USER launches each session in its worktree and
  pastes the agent-thread kickoff. I set up worktrees/threads/specs and coordinate.
- Each session implements test-first, runs the canonical CI gates, reports the
  DIFF on its thread. I review and gate.
- After code signoff each session does a UX pass (exercise the change in the
  running app + screenshots) -> I review the screenshots -> once satisfied, the
  session opens its own PR -> CI runs -> I sequence merge order and merge when CI
  is green.

## Maintenance protocol (KEEP THIS FILE LIVE)
Update this handoff on EVERY meaningful state change - a handback, an approval, a
requested change, a merge, a decision, a new blocker. Keep each session's State
cell current and append a dated line to the Running log. The file alone must be
enough to resume.

## Stream status
All worktrees branched off the SAME base commit; each has its own install. Keep
this box current on every state change. The `Evidence (git)` cell is the liveness
truth: branch, clean/dirty, last commit age, and thread turn.

┌────────────┬──────────────────────────────────────┬────────────────────────────────────────┬────────────────────┬───────────┐
│ Stream     │ Agent / thread / branch              │ State                                  │ Evidence (git)     │ Wait      │
├────────────┼──────────────────────────────────────┼────────────────────────────────────────┼────────────────────┼───────────┤
│ A - API    │ codex-a / effort-stream-a /          │ Implementing after plan approval;      │ branch fix/api,    │ bg123     │
│            │ fix/api                              │ next handback should be diff + gates.  │ dirty, turn=codex  │           │
├────────────┼──────────────────────────────────────┼────────────────────────────────────────┼────────────────────┼───────────┤
│ B - UI     │ codex-b / effort-stream-b /          │ PR accepted, merge-held; parked until  │ clean tree,        │ -         │
│            │ fix/ui                               │ the next real task or merge.           │ turn=claude        │           │
├────────────┼──────────────────────────────────────┼────────────────────────────────────────┼────────────────────┼───────────┤
│ C - Tests  │ codex-c / effort-stream-c /          │ Review requested changes; waiting for  │ last commit 12m,   │ bg456     │
│            │ fix/tests                            │ updated diff.                          │ 2 files dirty      │           │
└────────────┴──────────────────────────────────────┴────────────────────────────────────────┴────────────────────┴───────────┘

**Session details:**
- A: handle=`codex`, worktree=`stream-a`, spec=in thread, scope=<scope>.
- B: handle=`codex`, worktree=`stream-b`, spec=`specs/B.md`, scope=<scope>.
- C: handle=`codex`, worktree=`stream-c`, spec=`specs/C.md`, scope=<scope>.

**Wait/poller re-arm commands:**
- A: `node "$AT" wait --root "$ROOT" --thread effort-stream-a --as "$MY_HANDLE" --follow --interval 3`
- B: PARKED - do not re-arm; I initiate next post.
- C: `node "$AT" wait --root "$ROOT" --thread effort-stream-c --as "$MY_HANDLE" --follow --interval 3`

**Revive prompts:** <path or paste text per worker, used if terminals/sessions die>.

## Peer coordinators / shared main
Omit this section if you are the only coordinator landing into main.

- **Peer channel:** `peer-coordinator-thread` (`agent-thread --session`; I am
  `<my handle>`, peer is `<their handle>`).
- **Peer's live streams:** <their in-flight streams plus which are idle>.
- **Disjointness regime:** disjoint -> no-freeze plus rebase-before-PR; or
  overlap on `<file>` -> <named-contract owner plus freeze, or serialized order>.
- **Shared named contracts:** `<e.g. compose-output DTO>` - owner `<who>`, held
  stable; change requires pre-merge ping.
- **Pings owed:** me -> peer when `<my stream>` squash-merges; peer -> me when
  `<their stream>` lands or changes my verify touchpoint.

## Merge order / conflict watch
Shared-file collisions across branches: `<path/to/shared/schema>` (A + C),
`<path/to/shared/test>` (A + C), `<i18n files>` (B + C). Plan: merge one, rebase
the rest onto updated main, resolve, re-run CI, merge next. Sequence the tightest
coupling (A + C) adjacent and rebase the second.

Migrations: A none (free order); B none; C adds `<timestamp>_<name>` (additive,
distinct object) - independent of others, any order.

## Canonical CI gate (verified from `.github/workflows/<file>`)
CI runs `<exact commands, e.g. lint + typecheck + test:unit + test:db>`. It does
NOT run `<the misleading default, e.g. npm test>`, whose config omits `<setup>`
and shows `<N>` spurious failures - IGNORE those. Hold every session to the
canonical gates before signoff.

## Decisions made
- <decision 1 - the call + where it is recorded + whether it still needs relaying
  to a session>.
- <decision 2>.

## Still open / TODO
- <open item>.
- <deferred follow-up + whether a backlog item is filed>.

## Running log (newest last)
- **<date>** - Created N worktrees off `<base>`, installed deps, opened N
  agent-thread session channels. A: plan approved (<tightening>); implementing.
  B: plan approved; implementing. C: plan approved; implementing. Nothing merged.
- **<date>** - A handed back diff: REVIEWED, CHANGES REQUESTED - <blocker the
  tests could not catch>. B handed back: SIGNED OFF (all canonical gates green).
  C still implementing. Wait ids re-armed.
- **<date>** - B PR opened, CI green, MERGED `<sha>`, thread resolved. C rebased
  onto post-B main (resolved <files>), opened PR, auto-merging on green CI. A
  fixing review items. <date the effort is expected to close>.
