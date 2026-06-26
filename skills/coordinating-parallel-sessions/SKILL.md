---
name: coordinating-parallel-sessions
description: >
  Use when one coordinator session must drive several other agent sessions
  (Claude Code or Codex) running in parallel, each owning an independent
  PR-sized workstream in its own git worktree, gating every step - plan,
  implement, review, UX-verify, PR, merge - instead of writing the code itself.
  For a task that decomposes into roughly 3-6 independent workstreams, each big
  enough to fill its own context window, where parallelism plus independent
  review beats doing it inline. Triggers on asks like "I'll launch the sessions,
  you coordinate them", "run several agents in parallel on separate branches and
  gate each", "coordinate the sessions fixing X", "keep a living handoff across
  these sessions", "fan this big effort across multiple sessions and merge them
  safely". Not for one or two small changes (do those inline); not for two peers
  talking it out (use agent-thread).
user-invocable: false
---

# coordinating-parallel-sessions

Coordinate N parallel agent sessions - one per workstream - from a single
coordinator session: scope the streams, gate every step, sequence the merges.
The coordinator NEVER writes the implementation. It sets up worktrees, threads,
and specs; reviews and gates plan -> implement -> review -> UX -> PR -> merge;
keeps a living handoff; and merges in a safe order. Each stream runs in its own
git worktree and talks to the coordinator over its own agent-thread channel.

**REQUIRED SUB-SKILL:** Use agent-thread for the per-session channel - one
`--session` thread per stream. This skill is the multi-session layer on top of
it; it assumes you already know the agent-thread wait/post loop.

## Your job (in order)

1. **Check the shape fits.** Only coordinate when the task decomposes into ~3-6
   INDEPENDENT, PR-sized streams, each big enough to own a context window, where
   parallelism plus independent review wins. One or two small changes: do them
   inline. Two peers hashing out one thing: use agent-thread directly. See
   [When NOT to use](#when-not-to-use).
2. **Set up each stream.** A dedicated git worktree (branched off the SAME base
   commit, its own dependency install), one agent-thread `--session` channel, and
   a spec (a file per stream, or in-thread for a complex one). The USER launches
   each session in its worktree and pastes the kickoff - you never spawn them.
   See [Setup](#setup-per-stream).
3. **Open the living handoff.** Copy `references/handoff-template.md` to one file
   and keep it live on EVERY state change. This is the highest-value habit of the
   whole skill. See [The living handoff](#the-living-handoff-the-key-pattern).
4. **Gate each stream through the pipeline.** Plan -> implement -> review -> UX ->
   PR -> merge, with a real coordinator gate at each stage. See
   [The pipeline](#the-pipeline-gate-every-stream).
5. **Sequence the merges.** Identify shared-file collisions up front; merge one,
   rebase the rest onto updated main, re-run CI, merge next. See
   [Merge sequencing](#merge-sequencing).
6. **Resolve and tear down.** Resolve a thread only when its work is MERGED and
   signed off. Proactively kill idle dev servers and browsers. See
   [Resource coordination](#resource-coordination).

## What you produce

A set of independently reviewed, CI-green PRs merged into one base branch in a
conflict-safe order, plus a living handoff doc that captures the full history so
the effort survives compaction or a coordinator restart.

## Router

Open only the section you need.

| You are about to... | Read |
|---|---|
| Stand up the worktrees/threads/specs | [Setup](#setup-per-stream) |
| Start or maintain the handoff doc | [The living handoff](#the-living-handoff-the-key-pattern) + `references/handoff-template.md` |
| Run a stream through its gates | [The pipeline](#the-pipeline-gate-every-stream) |
| Drive the agent-thread waits as a coordinator | [agent-thread discipline](#agent-thread-discipline-for-a-coordinator) |
| Land the PRs without conflicts | [Merge sequencing](#merge-sequencing) |
| Stop the machine from melting | [Resource coordination](#resource-coordination) |

## Setup (per stream)

- **Dedicated git worktree** per stream, all branched off the SAME base commit,
  each with its own dependency install (isolation: no shared-cache or branch
  contention). Gotcha: gitignored env files (`.env`, `.env*.local`) do NOT travel
  with `git worktree add` - seed each worktree's local env before its session can
  run a dev server or scripts.
- **One agent-thread `--session` channel per stream** (unlimited round cap). The
  USER launches each session in its worktree and pastes the kickoff; the
  coordinator only sets up and coordinates.
- **A spec per stream** (or in-thread for the one complex stream).
- **Distinct dev-server PORT per worktree** so parallel servers do not collide.

The kickoff each session receives must name the implementation discipline you
expect (for example "implement test-first") so the contract is explicit from
turn one.

## The pipeline (gate every stream)

Every stream passes the same gates. The session does the work; the coordinator
holds the gate and does not advance the stream until satisfied.

| Stage | Session does | Coordinator gate |
|---|---|---|
| 1. Plan | Posts a short plan BEFORE any code | Approve with tightenings. Independent sparring is real value - a fresh session catches blind spots your own recon missed. |
| 2. Implement | Writes the failing test first, then the code | None yet - let it work. |
| 3. Code review | Posts the actual DIFF (not a prose summary) | Review the DIFF, not the report. Verify claims tests cannot catch (a wire-format regex a mocked test skips over but that 400s in prod). For the riskiest stream, run the canonical CI gates yourself. |
| 4. UX pass | Exercises the change in the running app, screenshots each meaningful state to `<worktree>/tmp/ux/<stream>/` | Read the screenshots yourself and give a visual verdict. When a state sits behind generation, have the session seed the artifact directly to reach it. |
| 5. PR | Opens its own PR once you are satisfied | Confirm scope; note it in the handoff. |
| 6. Merge | - | CI is the gate. Merge when green, in the [sequenced order](#merge-sequencing). |

Rules that make the gates real:
- **Review the diff, not the report.** A session's summary is a claim; the diff
  is the evidence. Read the diff.
- **Verify what tests cannot catch.** Mocked boundaries (an LLM `parse`, an HTTP
  client) pass over real-world failure modes. Independently check the risky edge.
- **Read the UX screenshots yourself.** A signoff on a described screenshot is not
  a signoff.

## The living handoff (the key pattern)

A single compaction-safe file, updated on EVERY state change (handback, approval,
change-request, merge, decision, blocker). It holds: role and workflow rules; the
streams table (thread id <-> worktree <-> branch <-> spec <-> scope <-> state);
armed wait task ids; approved contracts and open decisions; merge order and the
shared-file conflict set; the canonical CI gate; a resource policy; and a dated
running log (newest last). Goal: the file alone is enough to resume coordinating
with full history, so compaction is cheap.

Start it from `references/handoff-template.md`. The discipline is not the format -
it is updating it on every state change. A stale handoff is worse than none,
because it lies.

## agent-thread discipline for a coordinator

You are running many threads at once. The agent-thread loop still holds (post to
hand back, then arm a background `wait` for your handle; the harness re-invokes
you on the peer's turn), with multi-thread additions:

- **Never arm a wait on a thread already at `turn=claude`.** It returns
  immediately and busy-loops. Respond first; arm only after you post (which flips
  the turn back to the session).
- **Park a signed-off or idle session by NOT re-arming** - leave it at
  `turn=claude`. Re-engage later by posting (flips turn to the session) then
  arming.
- **Resolve a thread only when its work is MERGED and signed off**, not at code
  signoff.
- **Stay silent while waits are pending.** Do not narrate polling. One armed wait
  per thread at a time.
- Track every armed wait's task id in the handoff so a restart can re-arm them.

## Merge sequencing

Parallel branches off one base will collide on shared files (schemas, shared
tests, shared models, i18n message files, shared query modules). Before any
merge, identify the collision set and write it in the handoff.

Then: **merge one -> rebase the rest onto updated main -> re-run CI -> merge
next.** Sequence the most tightly coupled branches (those editing the same files)
adjacent, and rebase the second of each pair. Independent additive migrations
(distinct timestamps and objects) do not conflict, but still flag the landing
order. If the repo requires up-to-date branches before merge, update each branch
just before its merge so it picks up what already landed.

## Know your canonical CI gate

Know exactly what CI runs (read `.github/workflows/*`). It is frequently NOT the
default test command. Sessions chasing a misconfigured default (a test command
whose config omits a required setup and emits a wall of spurious failures) waste
hours gating on the wrong thing. Pin every session to the same canonical gates,
and record them in the handoff so nobody rediscovers it.

## Resource coordination

N worktrees, each with a dev server, local test suites, and a headless browser,
will crush the machine. Enforce:

- **CI is the gate.** Once a PR is open, sessions do NOT run local full suites
  (the DB/integration suite that spins a database container is the heavy one).
  Serialize any needed local heavy run through the coordinator, one at a time.
- **Dev server and browser OFF when idle.** The coordinator proactively kills
  idle ones; sessions stop their own when idle.
- **Watch for OTHER efforts on the same machine** adding load that you do not
  coordinate.

## When NOT to use

- **One or two small changes.** Coordinating overhead exceeds the benefit - do
  them inline.
- **Two peers settling one question** (review, debate, a single delegated
  sub-task). Use agent-thread directly; you do not need the coordinator layer.
- **Tightly coupled work that cannot be split into independent PR-sized streams.**
  If every stream blocks on every other, parallelism is fake - keep it in one
  session.
- **You will write the code.** This skill is for a coordinator that gates others'
  work. If you are implementing, you are not coordinating.

## Common mistakes

| Mistake | Fix |
|---|---|
| Reviewing the session's summary instead of the diff | Always read the actual diff; the summary is a claim. |
| Signing off on a described screenshot | Read the PNG yourself before signoff. |
| Arming a wait on a thread already at `turn=claude` | Respond first; arm only after you post. |
| Resolving a thread at code signoff | Resolve only after the work is MERGED. |
| Letting the handoff go stale | Update it on every state change; a stale handoff lies. |
| Merging branches in arbitrary order | Identify shared-file collisions; merge-rebase-CI-merge in sequence. |
| Gating on the wrong test command | Read `.github/workflows/*`; pin the canonical gates. |
| Leaving idle dev servers and browsers running | Kill them; serialize heavy local runs through the coordinator. |
| Spawning the sessions yourself | The user launches each session; you set up and coordinate. |
