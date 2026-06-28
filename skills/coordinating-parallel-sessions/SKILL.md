---
name: coordinating-parallel-sessions
description: >
  Use when one coordinator session must drive several other agent sessions
  (Claude Code or Codex) running in parallel, each owning an independent
  PR-sized workstream in its own git worktree, gating every step - plan,
  implement, review, UX-verify, PR, merge - instead of writing the code itself.
  For a task that decomposes into roughly 3-6 independent workstreams, each big
  enough to fill its own context window, where parallelism plus independent
  review beats doing it inline, or where long-running/flaky streams need active
  liveness and recovery management. Triggers on asks like "I'll launch the
  sessions, you coordinate them", "run several agents in parallel on separate
  branches and gate each", "coordinate the sessions fixing X", "keep a living
  handoff across these sessions", "fan this big effort across multiple sessions
  and merge them safely". Not for one or two small changes (do those inline);
  not for two peers talking it out (use agent-thread).
user-invocable: true
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
6. **Coordinate peer fleets when needed.** If another coordinator is also
   landing streams into the same main branch, open a peer-coordinator channel and
   agree on disjointness, named contracts, and landing signals before merging.
7. **Recover quiet streams.** Use thread state plus worktree git state to tell
   working from deaf/stalled; salvage committed work and revive sessions when
   needed. See [When the squad goes quiet](#when-the-squad-goes-quiet). When the
   user launches the sessions then leaves, also run the
   [Unattended runs](#unattended-runs) rules: workers never escalate (they route
   privileged commands to you), and each keeps its own compaction-safe handoff.
8. **Resolve and tear down.** Resolve a thread only when its work is MERGED and
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
| Diagnose a quiet or stalled worker | [When the squad goes quiet](#when-the-squad-goes-quiet) |
| Run a fleet the user launched then left | [Unattended runs](#unattended-runs) |
| Land the PRs without conflicts | [Merge sequencing](#merge-sequencing) |
| Share one main branch with another coordinator | [Multiple coordinators, shared main](#multiple-coordinators-shared-main) |
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

The kickoff each session receives must name the contract explicitly from turn
one:

- **Implementation discipline** you expect (for example "implement test-first").
- **Wait discipline.** After EVERY post or interruption, rearm `wait --follow`
  and keep/poll the captured tool output. Codex-style harnesses may not auto-wake
  the model when a background wait completes, so the worker must self-poll - a
  `wait --probe` between work chunks returns exit 0 (drain and act) or exit 3
  (still the peer's turn; keep working), without the false-stall risk of a tiny
  `--timeout`.
- **Own-handoff discipline.** Each worker keeps its OWN compaction-safe
  `tmp/HANDOFF.md` in its worktree, updated as it goes and re-read after each of
  its own compactions - the same habit the coordinator uses, mirrored per worker.
- **For unattended runs, the no-escalation rule** (see
  [Unattended runs](#unattended-runs)) goes in the kickoff and as the FIRST line
  of the worker's `tmp/HANDOFF.md`, so it survives the worker's own compaction.

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
- **Resolve contracts from the code.** For shared DTOs, exported prop types,
  migrations, route names, and helper signatures, read the actual file on the
  worker branch. Do not rely on dispatch text or memory of the agreed contract.
- **Verify what tests cannot catch.** Mocked boundaries (an LLM `parse`, an HTTP
  client) pass over real-world failure modes. Independently check the risky edge.
- **Read the UX screenshots yourself.** A signoff on a described screenshot is not
  a signoff.

## The living handoff (the key pattern)

A single compaction-safe file, updated on EVERY state change (handback, approval,
change-request, merge, decision, blocker). It holds: the resume-after-compaction
runbook; role and workflow rules; the stream status box (agent/thread/branch,
state, git evidence, wait id); exact wait/poller re-arm commands and parked
threads; approved contracts and open decisions; merge order and the shared-file
conflict set; the canonical CI gate; liveness/revive notes; a resource policy;
and a dated running log (newest last). Goal: the file alone is enough to resume
coordinating with full history, so compaction is cheap.

Start it from `references/handoff-template.md`. The discipline is not the format -
it is updating it on every state change. A stale handoff is worse than none,
because it lies.

## agent-thread discipline for a coordinator

You are running many threads at once. The agent-thread loop still holds (post to
hand back, then arm a captured `wait` for your handle), with multi-thread
additions:

- **Know the silent-void failure.** A wrong `--as` on the live thread is rejected
  loudly by turn guards. A post to a stale-but-valid thread id can succeed while
  no session is listening because the worker reset and rejoined under a different
  id or handle. The handoff table catches typos; it does not prove liveness.
- **Handshake every join or relaunch before assigning work.** The worker's first
  post must echo `joined thread <id> as <handle>, cwd=<worktree>,
  branch=<branch>, standing by`. Verify id, handle, cwd, and branch against the
  handoff table, then assign the real task.
- **Treat missing handback after a reset as a pairing problem first.** If you did
  not get a fresh handshake, make the first post a probe. No peer turn inside a
  normal handback window means `read`/`status` that thread and ask the USER what
  id plus `--as` the launched session actually shows. Do not wait forever on a
  silent worker.
- **The coordinator owns each pairing.** On reset, re-issue `kickoff` to mint the
  id/handle, or re-init the same id with `--force`. Do not let a worker invent a
  replacement thread id.
- **Never arm a wait on a thread already at `turn=claude`.** It returns
  immediately and busy-loops. Respond first; arm only after you post (which flips
  the turn back to the session).
- **Park a signed-off or idle session by holding the turn** - leave it at
  `turn=claude` and record `PARKED - do not re-arm; I initiate next post` in the
  handoff. Do not send a no-op "stand by" post, because that hands the turn to a
  worker with nothing to do. Re-engage later by posting a real task (flips turn
  to the session) then arming.
- **Resolve a thread only when its work is MERGED and signed off**, not at code
  signoff.
- **Stay silent while waits are pending, but do not trust silence as progress.**
  Do not narrate polling. One armed wait per thread at a time, or one poller over
  all active threads if your harness reaps long-lived waits.
- Track every armed wait or poller's exact command and task id in the handoff so
  a restart or compaction can re-arm them.
- Sweep `pending --thread <id> --as <coordinator>` for every active thread on
  each wake, timeout, or poller heartbeat. Notes do not flip the turn, so `wait`
  will miss checkpoint-only signals until you sweep.
- **Use `note` only for out-of-band signals, when available.** Notes do not flip
  the turn and do not replace the handback post. Use them for advisory
  fire-and-forget signals such as "main moved; rebase before your next push" or a
  peer-coordinator heads-up while the peer has the turn. If a worker must
  acknowledge before continuing safely, use a turn-passing post or ask the human
  to interrupt. A STOP note is only a request seen at the next checkpoint, not a
  guaranteed halt. Reflect durable state in the handoff because notes are
  ephemeral.
- **One complete handback per round; do not post-then-amend.** Bundle everything
  actionable for the worker - CI fixes, UX polish, rebase instructions - into a
  single turn-passing post, so a round finishes in one worker pass. The trap: you
  post, then notice more work and send it as a `note`; the worker's `wait`
  returned on your post, it works exactly the posted items, and never reads the
  follow-up note (for a Codex worker mid-round a note is functionally invisible
  until a human makes it run `pending`). Re-read the diff, CI, and mockup BEFORE
  posting - that is cheaper than a missed note plus a human nudge plus a partial
  round. If you genuinely must add work after handing off, prefer letting it ride
  as the next round's post; only use a note plus an explicit human nudge if it
  must land in the current round.

## When the squad goes quiet

Thread state alone cannot distinguish "worker is busy" from "worker is deaf".
Use the handoff status box plus out-of-band git probes before deciding.

- **Probe liveness from the worktree.** For each stream, check
  `git -C <worktree> branch --show-current`, `git -C <worktree> status --short`,
  `git -C <worktree> log -1 --format=%ci`, and `athread status --thread <id>`.
  The handoff's `Evidence (git)` cell should summarize branch, dirty/clean, last
  commit age, and turn.
- **Interpret silence conservatively.** `turn=<worker>` + old branch + clean tree
  + no commits past the normal cadence means a deaf or stalled worker, not
  patience. Dirty files or new commits mean progress exists, but the stream may
  still be stuck on a final handback or UX step.
- **Read the worktree directly.** Gate plans, diffs, screenshots, and drafted
  notes from the worker's checked-out files when the post channel is flaky.
  Shared git object storage makes the branch/worktree the evidence.
- **Salvage completed work.** If a quiet worker has committed a finished diff,
  review it directly, run the agreed gates you need, then push/open/merge the PR
  as coordinator mechanics. If a resumed worker has valuable uncommitted work,
  first ask it to make a checkpoint commit before continuing.
- **Revive the fleet deliberately.** Keep per-worker relaunch prompts in the
  handoff. If the user is available, ask them to relaunch the affected sessions
  into the existing threads. If the user explicitly delegated unattended recovery
  and a stream is dead, reassign it to a scoped replacement worker/subagent in a
  prepared worktree; the coordinator still reviews the diff and never writes the
  implementation.

## Unattended runs

When the user launches the worker sessions and then leaves, the coordinator
session is the only attended one. Two rules turn an unattended fleet from
fragile to reliable; put both in every worker kickoff.

- **No worker may escalate or block on an approval prompt.** No human is watching
  the worker session, so a command that needs a permission grant the worker
  cannot give itself (a sandbox/permission escalation, a denied command, a
  privileged `git`/`gh` op, anything `--admin`) must NOT pop a dialog into an
  empty room - that stalls forever and looks identical to "slow". Instead the
  worker POSTs the coordinator the exact command + cwd + reason and passes the
  turn. **The coordinator runs it** (the coordinator's session is attended) and
  returns the output. Expect inbound "please run X" posts and be ready to be the
  fleet's hands for anything needing real permissions.
- **Each worker keeps its own compaction-safe `tmp/HANDOFF.md`** in its worktree
  (gitignored `tmp/` is per-worktree), updated as it goes and re-read after each
  of its own compactions. The FIRST line must be the no-escalation rule, so a
  freshly compacted worker does not re-learn to block on approval. A minimal top:

  ```
  # <thread> handoff (compaction-safe)
  ## RULE #1 - NEVER ESCALATE: no human is watching. If a command needs approval
  ## I can't grant, POST lead the exact command + cwd and ask lead to run it.
  ## Task: <one line>   Branch / worktree: <branch> / <path>
  ## State (newest last):  - <ts> did/ran X (result) / blocked on Y
  ## Next: <one line>
  ```

- **Deliver these rules via the kickoff post, not a note.** A note does not wake
  a parked `wait` and a Codex worker will not sweep it, so a note is the wrong
  channel for anything actionable - the protocol must be in the kickoff (and
  re-stated on task posts). See
  [one complete handback per round](#agent-thread-discipline-for-a-coordinator).
- **Diagnosing an escalation-blocked worker vs a deaf one.** Both show
  `turn=<worker>` + no new post. The tell is the worktree: an escalation-blocked
  worker often has a dirty tree / partial work and a shell waiting on a prompt; a
  wait-deaf worker is pristine on the old branch. Either way a human nudge
  unblocks the moment; the durable fix is the no-escalation rule above.
- **Do not pre-emptively abandon the cheaper fleet.** Codex workers cost far
  fewer tokens, which matters across a multi-stream fleet, and an interactive
  Codex session left polling its own wait can run unattended. Hedge with a short
  liveness deadline (a `Monitor` on the worker's worktree branch + dirty state
  that emits progress-or-stall), and pivot a stream to a Claude subagent only on
  a real, confirmed stall - not on the first quiet window.

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

## Multiple coordinators, shared main

Merge sequencing assumes one coordinator can see every branch. When two or more
coordinators run separate fleets into the same main branch, add one peer
coordinator `--session` channel and run these checks there:

- **Cross-fleet disjointness check up front.** Each coordinator shares planned
  file globs or actual touched files per branch. For existing branches,
  `git log origin/main..HEAD --name-only` is enough.
- **Disjoint streams: no freeze.** Rebase on latest main immediately before each
  PR or merge, land when green, and ping the peer when main moves. This is safe
  only because the touch sets are disjoint.
- **Overlapping streams: name the contract or serialize.** If both fleets touch
  the same file or API shape, either promote it to a named contract owned and
  frozen by one side, or agree on a serial merge order for those streams. Let
  non-overlapping streams keep flowing.
- **Landing-signal pings are mandatory.** Announce squash merges that move main,
  and announce when a named contract lands. The dependent side re-rebases or
  re-verifies on that signal instead of polling.
- **Keep visibility in the handoff.** Record the peer channel, the peer's live
  streams, the disjointness regime, shared contracts, and pings owed.

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
  them inline unless they are long-running/flaky enough to need active liveness
  and recovery management.
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
| Posting to the handoff's thread id without confirming a live listener | Require the join handshake before assigning work; a stale id can accept posts silently. |
| Treating silence as proof of work | Probe the worker worktree and thread metadata; silence is ambiguous. |
| Missing checkpoint notes | Sweep `pending` on every wake or poller heartbeat; notes do not wake `wait`. |
| Sending a no-op "stand by" post | Park by holding `turn=claude`; re-engage only with a real task. |
| Arming a wait on a thread already at `turn=claude` | Respond first; arm only after you post. |
| Re-arming a parked thread | Record `PARKED - do not re-arm; I initiate next post`; post only when you are ready to re-engage. |
| Resolving a thread at code signoff | Resolve only after the work is MERGED. |
| Letting the handoff go stale | Update it on every state change; a stale handoff lies. |
| Merging branches in arbitrary order | Identify shared-file collisions; merge-rebase-CI-merge in sequence. |
| Assuming no-freeze is safe across peer coordinators | First prove disjoint touch sets; otherwise name and freeze a contract or serialize the overlap. |
| Using `note` as a handback or hard stop | Notes are advisory and best-effort; use turn-passing posts for gates and human interruption for hard stops. |
| Posting a handback, then amending it with a note | Bundle everything actionable into one complete post per round; a Codex worker mid-round never reads the follow-up note. |
| Letting an unattended worker block on an approval prompt | Kickoff rule: the worker posts you the command + cwd + reason; you (the attended session) run it and return output. |
| Pre-emptively abandoning the Codex fleet on first silence | Probe liveness; pivot a stream to a subagent only on a confirmed stall - Codex workers are the cheaper fleet. |
| Gating on the wrong test command | Read `.github/workflows/*`; pin the canonical gates. |
| Trusting a contract from memory | Read the exported type/schema/helper in the worker branch. |
| Leaving idle dev servers and browsers running | Kill them; serialize heavy local runs through the coordinator. |
| Spawning the sessions yourself | Normal mode: the user launches each session. Only use a scoped replacement worker/subagent in explicit unattended degraded mode. |
