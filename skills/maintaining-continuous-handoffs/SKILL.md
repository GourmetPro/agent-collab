---
name: maintaining-continuous-handoffs
description: >
  Use when work is long-running, likely to cross context compaction or a session
  restart, paused with active processes or external waits, transferred between
  owners, or needs a durable resume point and audit trail. Triggers on asks like
  "keep a continuous handoff", "prepare for compaction", "leave this resumable",
  "another agent will take over", "pause and continue later", or "record the
  exact current state".
---

# maintaining-continuous-handoffs

Maintain one durable handoff pair that makes interrupted work safe to resume.

## Your job

1. **Check that a handoff is warranted.** Use one for long-running, paused,
   multi-owner, or compaction-prone work. Skip it for a task that will finish in
   the current turn without an active wait or ownership transfer.
2. **Choose one canonical pair.** Follow repository instructions or reuse the
   existing files. Otherwise use the repository's ignored temporary area,
   conventionally `tmp/HANDOFF.md` and `tmp/LOG.md`. Do not create competing
   pairs.
3. **Reconcile before acting.** Compare the handoff with actual Git, process,
   thread, CI, or deployment state. Repair stale current state before resuming.
4. **Update on meaningful transitions.** Rewrite current state in `HANDOFF.md`,
   then append one timestamped audit entry to `LOG.md`. Do not log routine
   commands.
5. **Resume from one exact action.** Name the action and owner. Inspect an
   existing operation before replacing or duplicating it.
6. **Close terminally.** Record the final outcome and evidence, clear active
   operations, and state that no required action remains.

## What you produce

Produce two sibling repository-local files: mutable current state in
`HANDOFF.md` and oldest-to-newest history in append-only `LOG.md`. Use
[`references/handoff-example.md`](references/handoff-example.md) as the concrete
shape, adapting its sample values to the current work.

The handoff pair is a navigation artifact, not evidence. Git, the live process,
thread metadata, CI, and deployment providers remain authoritative.

## Router

| Situation | Use |
|---|---|
| Starting long work | [Create or adopt the handoff](#create-or-adopt-the-handoff) |
| A decision, owner, process, or gate changed | [Record a transition](#record-a-transition) |
| Context compacted or another owner resumed | [Resume and reconcile](#resume-and-reconcile) |
| A worker hands work back | [Transfer ownership](#transfer-ownership) |
| Historical context is needed | [Maintain `LOG.md`](#maintain-logmd) |
| Work reached a terminal outcome | [Close the handoff](#close-the-handoff) |
| Need the complete file shape | [`references/handoff-example.md`](references/handoff-example.md) |

## Create or adopt the handoff

Use sibling paths in this order:

1. the `HANDOFF.md` and `LOG.md` paths named by repository instructions;
2. the existing pair for this effort;
3. ignored repository-local paths such as `tmp/HANDOFF.md` and `tmp/LOG.md`.

If repository instructions name only `HANDOFF.md`, place `LOG.md` beside it
unless those instructions designate another history path.

If no ignored location exists, ask before introducing a tracked or persistent
artifact outside the repository's conventions. Never overwrite an unrelated
pair.

When adopting a legacy combined handoff, move its historical entries verbatim
and in order to `LOG.md`, then leave only current state in `HANDOFF.md`. This is
a one-time split; after it, never rewrite earlier `LOG.md` entries.

Create these sections in `HANDOFF.md`:

### `READ THIS FIRST`

This is the only mutable summary. Keep it short enough to scan before any other
exploration. Include:

- objective and current status;
- branch, worktree, and commit when relevant;
- binding decisions, including the current result of any correction;
- ownership and active process, terminal, thread, CI, or deployment IDs;
- accepted evidence tied to the exact state it validates;
- blockers or missing authority;
- exactly one next action and its owner.

Populate fields only from state inspected for the current task. Write `Not yet
verified` when an identifier or fact is unknown. Do not infer task state from
the skill's path, the agent's current directory, or a sample value.

### `DECISIONS`

List decisions that still govern the work. When a decision changes, replace the
current value here and record the supersession in `LOG.md`. Mark evidence based
on the old decision stale.

### `OWNERSHIP AND ACTIVE OPERATIONS`

Name one writer per path or workstream. For each active operation, record enough
identity to inspect or reattach: command purpose plus process, terminal, thread,
CI run, or deployment ID. A claim such as "build running" without an identifier
is not resumable state.

### `EVIDENCE INDEX`

Record only checks actually completed. Tie each result to the commit, generated
output, or external state it inspected. Mark affected entries `STALE` after a
new commit, rebuild, formatter, post-processor, content mutation, or changed
decision invalidates them.

### `RISKS AND FOLLOW-UPS`

Separate required blockers from optional ideas. Do not hide required completion
work in follow-up language.

## Maintain `LOG.md`

Keep history out of `HANDOFF.md`. Append full `YYYY-MM-DD HH:MM:SS TZ` entries
to `LOG.md`, oldest to newest. Never edit, reorder, or delete earlier entries.
Each entry states only an observed transition and its evidence. Keep current or
future actions in `HANDOFF.md`, even when an action follows directly from the
logged event.

## Record a transition

Update after a meaningful change:

- binding decision or user correction;
- ownership assignment, interruption, or handback;
- commit or branch change;
- gate verdict or evidence invalidation;
- process, thread, CI run, or deployment state change;
- external mutation;
- blocker or terminal completion.

Perform the update in this order:

1. Inspect the nearest authoritative state.
2. Rewrite `HANDOFF.md` current state.
3. Append one `LOG.md` entry stating what changed and the observed evidence.

Log only observations and actions already completed. Put future work in the one
next action or required follow-ups. Do not append entries for every command,
poll, or progress message.

## Resume and reconcile

1. Read `HANDOFF.md` before broad repository exploration. Read `LOG.md` only
   when audit or reconciliation needs historical context.
2. Verify its claims against the nearest authority.
3. Preserve unexplained dirty work and external state.
4. If any claim drifted, update `HANDOFF.md` and append a reconciliation entry
   to `LOG.md` without inventing a cause.
5. Execute the one exact next action.

Never restart a quiet build, worker, CI run, or deployment until its recorded
identifier has been inspected. Silence is not proof that the operation stopped.

## Transfer ownership

The current writer records a handback state:

- `DONE`: the owned scope is complete and evidence is named;
- `HOLD`: useful work or an active operation remains, with an exact resume point;
- `BLOCKED`: the missing input, authority, or external state is named.

Record changed paths, current commit or dirty state, checks actually run,
active identifiers, limitations, and the single next action. The receiving
owner verifies these claims before writing. Append the handback transition to
`LOG.md`.

## Close the handoff

Set status to the terminal outcome, clear active ownership and operation rows,
and record final evidence in `HANDOFF.md`; append the completion entry to
`LOG.md`. State either that no required action remains or name the exact
user-owned action that is outside the completed scope.

Do not claim completion when an implementation, verification, deployment, or
handoff action required by the objective remains open.

## When NOT to use

- A small task will finish in the current turn with no active wait or handback.
- The repository already has authoritative current-state and history files that
  carry the required fields; adopt them instead of creating a competing pair.
- You only need a conversation transcript. Use the collaboration channel's own
  transcript; add a handoff only when wider work must survive interruption.
- You need a backlog or project history after the work ends. Use the project's
  issue tracker or durable documentation instead.

## Common mistakes

| Mistake | Correction |
|---|---|
| Write a handoff only in chat | Save the canonical `HANDOFF.md`/`LOG.md` pair. |
| Keep history inside `HANDOFF.md` | Move it verbatim to `LOG.md`; keep only current state in `HANDOFF.md`. |
| Keep only a long chronology | Maintain current resume state separately in `HANDOFF.md`. |
| Put an unperformed next action in `LOG.md` | Keep it only in `HANDOFF.md`; log it after it occurs. |
| List several possible next steps | Choose one exact action and owner. |
| Treat the handoff as authoritative | Reconcile against Git, processes, threads, CI, or deployments. |
| Treat a persistent thread as the whole handoff | Keep the transcript there; record wider resume coordinates in the handoff. |
| Record “build running” | Include the inspectable process or terminal identifier. |
| Log every command | Append only meaningful state transitions. |
| Copy or infer an unverified value | Write `Not yet verified` until the current task's authority is inspected. |
| Log an action before doing it | Keep it as the next action; append it only after completion. |
| Leave stale evidence green | Tie evidence to exact state and mark it stale after invalidating changes. |
