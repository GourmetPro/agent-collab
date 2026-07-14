# Maintaining Continuous Handoffs Skill Design

Date: 2026-07-14
Status: Implemented

## Context

The repository has two collaboration skills. `agent-thread` coordinates two
running sessions through a turn-taking channel, and
`coordinating-parallel-sessions` coordinates several worktree-isolated streams.
The latter includes a large multi-session handoff template, but neither skill
provides a reusable continuity contract for long single-session work,
compaction, pause and resume, active operations, or ownership transfer.

The source project demonstrated both the value and the failure modes of a
durable handoff. A short current-state summary made compaction survivable, while
an undifferentiated append-only history eventually made the exact resume point
hard to find. The reusable lesson belongs in a standalone skill. Astro,
Cloudflare, CMS migration, generated-site, and release-specific procedures do
not belong in this coordination repository.

## Goals

1. Add a directly invocable and auto-discoverable
   `maintaining-continuous-handoffs` skill.
2. Define a compact mutable `HANDOFF.md` plus a sibling append-only `LOG.md`.
3. Make handoffs reconcile against real Git, process, thread, and deployment
   state instead of becoming a competing source of truth.
4. Compose the new skill with persistent `agent-thread` sessions and
   `coordinating-parallel-sessions` without duplicating generic guidance.
5. Improve discovery metadata and README documentation for the affected skills.

## Non-goals

- Do not add Astro, CMS, content migration, Cloudflare, generated-product, or
  release-specific skills.
- Do not create a handoff service, database, daemon, or update script.
- Do not require handoffs for small self-contained tasks.
- Do not turn the handoff into authoritative evidence or a replacement for Git,
  process inspection, thread state, CI, or deployment state.
- Do not change the `agent-thread` CLI or its on-disk protocol.
- Do not push, publish, or open a pull request as part of this change.

## Skill architecture

The new skill owns generic continuity. Existing skills retain only their
domain-specific overlays.

| Skill | Continuity responsibility |
|---|---|
| `maintaining-continuous-handoffs` | Decide when a handoff is warranted; create, update, resume, reconcile, and close the handoff pair. |
| `agent-thread` | For persistent sessions only, record the thread root, ID, handles, turn, wait command, and resolve condition in the handoff. The transcript remains the conversation evidence. |
| `coordinating-parallel-sessions` | Maintain a compact current worker roster plus stream ownership, worktrees, branches, thread IDs, waits, collision sets, merge order, canonical gates, peer coordinators, and resource policy. |

The new skill is user-invocable because a user may explicitly ask for a durable
handoff. Its description must also support natural discovery from phrases about
compaction, long-running work, pause and resume, ownership transfer, active
operations, or an audit trail. The description contains trigger conditions
only, begins with `Use when`, and does not summarize the workflow.

## Continuous-handoff workflow

The skill opens with this six-step job:

1. Decide whether durable continuity is needed.
2. Locate an existing repository-designated handoff pair or create one,
   defaulting to `tmp/HANDOFF.md` and `tmp/LOG.md` when local instructions do
   not specify other paths.
3. Reconcile the mutable summary against actual state before acting.
4. Update the mutable summary and append a timestamped log entry after every
   meaningful state change.
5. Resume from the single exact next action after compaction, interruption, or
   ownership transfer.
6. Close with a terminal outcome and no ambiguous remaining action.

It produces two sibling repository-local continuity artifacts. The defaults
must be in an ignored temporary location unless local instructions require
tracked handoff files.

## `HANDOFF.md` contract

`HANDOFF.md` contains current mutable state only. It never carries historical
log entries.

### `READ THIS FIRST`

This is the only mutable summary. It remains short and contains:

- the requested outcome;
- branch, worktree, and exact current commit when relevant;
- current binding decisions and explicitly superseded choices;
- current owner for each active path or workstream;
- active thread, process, terminal, CI run, or deployment identifiers;
- accepted evidence and the exact state it validates;
- current blockers or missing authority;
- one exact next action and its owner.

### `DECISIONS`

List only decisions that still govern current work. When a user correction
changes a decision, update the current entry immediately and record the
supersession in the append-only log. Evidence based on the superseded decision
is marked stale.

### `OWNERSHIP AND ACTIVE OPERATIONS`

Record one writer per path and enough process identity to reattach safely. A
typical row can state that `codex-ui` owns `skills/agent-thread/SKILL.md` in
worktree `feature/handoffs`, while terminal session `41872` is running the
zero-dependency test. Ownership transfer requires a recorded `DONE`, `HOLD`, or
`BLOCKED` handback before another writer takes the path.

### `EVIDENCE INDEX`

Record only checks actually completed. Each entry identifies the command or
gate, result, artifact path if any, and exact commit or generated output it
validates. A rebuild, formatter, post-processor, content mutation, or new commit
invalidates affected downstream evidence.

### `RISKS AND FOLLOW-UPS`

Separate required blockers from optional ideas. Do not hide required work as a
follow-up, and do not convert speculative improvements into current scope.

## `LOG.md` contract

`LOG.md` contains the append-only chronology. Append entries oldest to newest
with full date, time, and timezone after a binding decision, correction,
ownership change, handback, commit, gate verdict, evidence invalidation,
active-process change, deployment, external mutation, blocker, or completion.
Do not edit, reorder, or delete older entries. Routine commands and progress
narration do not warrant entries.

## Resume and stale-state behavior

On resume, read `HANDOFF.md` before exploring broadly. Read `LOG.md` only when
historical context is needed for audit or reconciliation. Then verify current
claims against the nearest authoritative state:

- Git for branch, commit, and working-tree state;
- the actual process or terminal for a running command;
- the thread CLI for turn and resolution state;
- CI or deployment providers for external run state.

If reality differs, repair `HANDOFF.md` and append a reconciliation entry to
`LOG.md` before continuing. Never duplicate an operation merely because the
handoff says it was active but the original process has not yet been inspected.

## When not to use

Do not create a handoff for a small task that can finish in the current context
without an active wait, ownership transfer, or meaningful audit requirement.
Do not create a competing pair when the repository already names authoritative
current-state and historical continuity files that can carry the required
fields.

## Repository integration

### New files

- `skills/maintaining-continuous-handoffs/SKILL.md`
- `skills/maintaining-continuous-handoffs/references/handoff-example.md`

The reference is a concrete example rather than a placeholder-filled form. It
stays below 100 lines so it does not need a contents list.

### `agent-thread`

- Add a conditional requirement to use `maintaining-continuous-handoffs` when
  an `init --session` collaboration may span compaction, pauses, or ownership
  transfer.
- Keep bounded threads free of mandatory handoff ceremony.
- Explain that thread files are the transcript evidence and the handoff stores
  only the resume coordinates.
- Update `DESIGN.md` with the same boundary.

### `coordinating-parallel-sessions`

- Add `maintaining-continuous-handoffs` as a required sub-skill.
- Remove generic handoff creation, update, resume, and audit instructions that
  the new skill owns.
- Retain the parallel-specific status and merge overlay, including one compact
  current-state and routing row per worker.
- Rename `references/handoff-template.md` to
  `references/parallel-handoff-example.md` and rewrite it as a concrete overlay
  on the generic handoff contract.
- Rewrite frontmatter description text so it contains triggering conditions,
  not the plan, implement, review, and merge workflow.

### README

- Add the new skill, trigger summary, explicit invocation syntax, and reference
  link.
- Update the parallel-session reference link.
- Explain that persistent threads and parallel coordination compose with the
  new continuity skill.

## Evaluation design

Skill behavior is evaluated one skill at a time using fresh read-only agents.
No evaluation agent may edit repository files.

### RED baseline scenarios

Run realistic prompts without the new skill:

1. Prepare for compaction while a build and reviewer are active.
2. Resume from a stale handoff after Git or process state changed.
3. Record a user correction that supersedes an accepted decision.
4. Transfer one owned path between writers.
5. Complete a small self-contained edit that should not create a handoff.
6. Coordinate a persistent `agent-thread` or parallel-session effort across a
   pause.

Record omissions and rationalizations without supplying the intended answer.

### GREEN acceptance rubric

With the new skill, a fresh agent must:

- keep the exact resume point in a short mutable section;
- record binding decisions, ownership, process or thread identifiers, accepted
  evidence, blockers, and one next action;
- append meaningful events without rewriting history;
- reconcile claims against real state on resume;
- mark affected evidence stale after exact output changes;
- avoid a handoff for the small-task counterexample;
- compose with persistent threads and parallel coordination;
- keep current state in `HANDOFF.md` and history in `LOG.md`;
- avoid copying generic guidance back into the existing skills.

### Repository checks

For each changed skill:

- validate frontmatter, matching directory and name, and description length;
- require a trigger-only description beginning with `Use when`;
- keep `SKILL.md` below 500 lines;
- keep references one level deep;
- reject unresolved placeholders, emoji prose, broken relative links, and
  Windows-style paths;
- verify README behavior matches the skill;
- run `node skills/agent-thread/scripts/test-athread.mjs` unchanged;
- run final fresh-context forward tests before moving to the next skill.

## Acceptance criteria

The work is complete when the new skill passes its evaluations, produces the
`HANDOFF.md`/`LOG.md` pair, the two existing skills use it only at their proper
trigger boundaries, the parallel handoff reference contains only the specialized
overlay, documentation links resolve, the existing CLI tests pass, and the final
diff contains no project-specific Astro-blog guidance.
