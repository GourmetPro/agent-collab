# Living handoff - template

Copy this into a single file (for example `tmp/coordination-handoff.md`) at the
start of a multi-session effort and update it on EVERY state change. The goal:
at any moment this one file is enough for a fresh coordinator to resume with full
history, so compaction or a session restart is cheap. The sample values below
(three sessions A/B/C, thread ids, branches) are illustrative - replace them
with your effort's real values.

---

# <Effort name> coordination - handoff (compaction-safe)

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

## The sessions
All worktrees branched off the SAME base commit; each has its own install.

| Session | Thread id | Worktree | Branch | Spec | Scope | State |
|---|---|---|---|---|---|---|
| A | `effort-stream-a` | `stream-a` | `fix/stream-a` | in thread | <scope> | implementing (turn=codex) |
| B | `effort-stream-b` | `stream-b` | `fix/stream-b` | `specs/B.md` | <scope> | signed off, PR open |
| C | `effort-stream-c` | `stream-c` | `feat/stream-c` | `specs/C.md` | <scope> | review: changes requested |

**Armed background wait task ids:** B=`bw4itv2ze` (awaiting PR URL), C=`bh18ikl00`
(on UX pass). A is at turn=claude - do NOT arm a wait on a thread already at
turn=claude.

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
