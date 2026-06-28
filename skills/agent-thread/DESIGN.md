# agent-thread - design

## Problem

When one agent session produces a spec, plan, or PR and a second session
reviews it, the human becomes the message bus: copy the reviewer's report path
into the author session, copy the author's response back, repeat - sometimes 15
round-trips before the work is clean. The relaying is pure overhead.

Goal: let two already-running agent sessions (any mix of Claude Code and Codex,
on the same machine) discuss until the problem is resolved, with the human only
kicking each peer off once.

## Shape

A single skill following the [Agent Skills open standard](https://github.com/anthropics/skills),
plus one zero-dependency script. Deliberately **not** a daemon, server, or MCP -
the only substrate both harnesses share with zero setup is the local filesystem
and the shell, so that is the foundation.

```
skills/agent-thread/
  SKILL.md                 # the protocol/brain: author + reviewer + discuss recipes
  scripts/athread.mjs      # the CLI (init|post|resolve|wait|read|status|kickoff)
  scripts/test-athread.mjs # self-contained test (flow, locking, timeouts, cap)
```

## Channel

A thread is a directory, `~/.agent-threads/<id>/` by default (override with
`--root <path>` or `$ATHREAD_DIR`):

- `meta.json` - `{ participants:[a,b], turn, status, session, round_cap, created, updated }`
- `NNNN.<handle>.md` - append-only messages, one per turn, with an HTML-comment
  header (`from`/`to`/`round`/`ts`, plus `resolve` on the closing message).

The default root is global scratch state under the home directory, not worktree
state. This avoids changing `git status` or creating hidden folders in arbitrary
directories. Home vs the system temp dir is a close call - both work, since two
live agents imply the same boot and the files are actively polled, so neither is
swept mid-session. Home is the default for a mundane reason: a thread is a useful
transcript (you can `athread read` an old one to see what two agents worked out),
and a stable location keeps it findable and cleanable, whereas the temp dir would
GC that history (its no-accumulation behaviour is the fair counterpoint). It is
explicitly NOT about surviving reboots - a reboot kills the agent sessions too,
so a surviving file cannot be continued; persistence (`--follow`) is only about
idle gaps while both agents are alive.

Codex may ask once because the root is outside the workspace write sandbox; the
launcher uses a direct executable command so the user can approve the
`athread.mjs` prefix instead of approving arbitrary shell snippets. Long turns
use `--body-file` to keep post commands stable and avoid fragile shell quoting.
Users who want zero prompts beyond initial configuration can add the thread root
to Codex's writable roots. `init` self-ignores ONLY a dedicated `.agent-threads`
root; it never writes a `.gitignore` into an arbitrary `--root`/`$ATHREAD_DIR`,
which could otherwise ignore a whole repo. The kickoff bakes the absolute custom
root into fallback commands when needed, so both peers rendezvous regardless of
where it lives.

## Protocol

- **Turn-taking is enforced.** `meta.turn` names whose move it is; `post`/`resolve`
  flip the turn to the peer and are *rejected* unless `meta.turn` names the caller
  (a `--force` escape hatch exists for recovering a stuck thread). A mkdir lock
  serializes writes so the rare forced/concurrent post cannot collide on the
  message index. Thread ids and handles are validated as safe slugs, so a thread
  id can never path-traverse outside the root.
- **`wait` is the wake mechanic.** It polls until `turn == me` (or
  `status == resolved`), then prints the latest message. In Claude Code it is
  run as a background command so the harness re-invokes the session on the
  peer's turn; in Codex it is run inline or as a harness-managed background
  terminal that preserves output. After any non-resolving `post`, the same
  session must immediately rearm `wait` for its own handle; otherwise the thread
  is only logically handed off, not operationally watched. Either way: no human
  relay between rounds, and no human-facing progress narration while a wait is
  merely pending with no output.
- **Each turn has a contract.** The protocol is plain text, so the skill and
  generated kickoff both require peers to say what they inspected or changed,
  blockers or open questions, and what they need from the peer next. `resolve`
  is reserved for the actual resolve condition (or explicit session end), and
  round-cap/timeout cases escalate to the human instead of becoming vague
  "done" replies.
- **Roles vs identity are orthogonal.** Handles are free-form (`claude,codex` or
  `author,reviewer`); roles live in the SKILL recipes and the opening message,
  not in the CLI.
- **Kickoff is one paste.** `athread kickoff` emits a skill-first prompt plus a
  complete direct-executable fallback loop (with the absolute script path,
  custom root when needed, thread, and handle baked in) that the human pastes into
  the other session to launch the peer. The protocol text lives in one place.

## Collaboration patterns

The channel is pattern-agnostic: a turn-taking text loop between two peers. What
differs between collaboration types is only (a) the opening message the
initiator posts and (b) what "resolved" means - so the CLI and `kickoff` stay
generic, and the SKILL teaches patterns as fill-in-the-blanks. Review was the
motivating case; the named recipes are review, debate/decide, consult (leans on
a peer's *different capabilities* - model, tools, repo, web), delegate, pair
(driver/navigator), and brainstorm, with verify and cross-repo contract
negotiation as variants. Agents may improvise patterns; nothing in the protocol
constrains them to the named set.

The leverage of a second running session is one of: independent judgment,
different capabilities, parallelism, or separate context windows. When none
applies, the work should stay inline rather than open a thread.

## Termination & escalation

The human is pulled back in only on: `resolve` (converged), `round_cap` reached
(stuck - default 15, matching the observed pain), or `wait` timeout (peer
stalled). The loop never continues silently past the cap and never fabricates a
resolution the peer did not agree to.

## Persistent sessions

A bounded task resolves and the peer stops. But for an ongoing, multi-topic
collaboration, resolving each sub-topic ended the peer's loop and forced the
human to re-paste a launcher every time. `init --session` makes a durable channel
the easy path: unlimited round cap, and the kickoff emits `wait --follow`, which
never exits on timeout - it keeps polling and prints a periodic stderr heartbeat
so the terminal is visibly alive. The orchestrator keeps one session thread and
treats each topic as another turn; `resolve` is the single explicit "session
over" signal. `post` also emits a session-only stderr reminder with the exact
`wait --follow` command to rearm, while keeping stdout as the message filename
for scripts. Persistence is implemented as repeated bounded waits (heartbeat
window preserved), not one unbounded sleep, per Codex's harness note that an
indefinitely-open terminal is not independently resumable across sleep/cleanup.
A "lobby" thread (peer awaits the next thread after a resolve) was considered and
deferred - a persistent thread with explicit resolve covers the need.

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

## Coordinator primitives

A session that coordinates N worker threads (one agent-thread per worker) needs
three more affordances, all additive and backward-compatible:

- `status --all` - a read-only JSON fleet view over every thread under the root.
  It replaces a hand-maintained thread table and doubles as a divergence detector
  (a thread you believe is at the worker's turn that shows as idle at yours is the
  silent-drift signal). `updated` is the newest file mtime, not `meta.json`, so it
  reflects a thread mid-write; a garbled thread is flagged `{id,error}`, never
  crashes the listing; no lock is taken (a read-only snapshot must not block
  writers).
- `pending` - a non-blocking peek at the peer's notes since your last substantive
  post (exit 0 always, no turn, no write). It makes "check for a stop at a
  checkpoint" a first-class command instead of overloading `wait` (which, in a
  foreground loop, blocks if you are wrong about turn ownership - the Codex
  consult's point that decided this over "just use `wait --as me`").
- `wait --probe` - a single-shot, non-blocking turn check: exit 0 (+ window) when
  it is your turn or the thread resolved, exit 3 when the peer still holds it.
  `pending` answers "any new notes?"; `--probe` answers "did the turn flip to me?".
  It exists because a harness that does not re-invoke the model when a backgrounded
  `wait` completes (observed with Codex `exec` workers) must self-poll, and a tiny
  `--timeout` is the wrong tool: timeout exits 2 ("peer stalled, escalate"), so a
  worker polling a still-busy peer would keep false-escalating. Exit 3 is a
  dedicated "not yet your turn, not an error" sentinel, distinct from both the
  exit-2 timeout and the exit-1 usage error, so a self-poll loop reads it cleanly.
- `note --thread a,b,c` - broadcast one note to an explicit list. Explicit list,
  not an ownership-based `--all`: participation is not intent (a handle is also in
  parked, unrelated, and meta threads), so the set comes from `status --all`, not
  the CLI. Best-effort fan-out names each target's result and exits nonzero if any
  failed - so a dropped broadcast is visible, without a delivery-receipt (which
  was cut: a receipt would tempt gates to depend on best-effort notes).

A note delivery-receipt and an ownership-based `--all` broadcast were both
considered and cut for those reasons. These primitives were designed in a
three-voice brainstorm (the coordinating-parallel-sessions author, a peer
coordinator, and a Codex consult for the foreground-harness vote) conducted over
the agent-thread channel itself.

## Validation

The core - cross-harness rendezvous through the file channel - was proven with a
live spike before this was built: a Claude session (author) and a real Codex
session (reviewer) ran a two-round review of a planted-flaw spec, talking only
through `.agent-threads/`. Codex caught both planted flaws, the author revised,
Codex resolved - with zero human relaying after the initial paste. The CLI
(including the lockfile and timeout/cap behavior) is covered by
`scripts/test-athread.mjs`.

## Out of scope (YAGNI)

- No daemon / server / MCP.
- No cross-machine transport (filesystem only).
- No auto-launching the other harness; the human opens both sessions.
- No more than two participants.
- No durable cross-thread audit store.

## Possible future hardening

- `status --all` filters shipped: `--participant <handle>` (a filter on the
  participants column, NOT the rejected ownership-based `--all-mine`), `--open`,
  `--since <iso>`, and `--min-messages`/`--max-messages` (message count == the
  latest message index), all AND-composed. Motivated by a real 123-thread fleet
  where the unfiltered array was noisy. A `--before <iso>` complement (the
  staleness query: open threads NOT touched since X) is the obvious next add.
- **fs.watch as an optional accelerator, not a replacement** (Codex's verdict):
  events coalesce/miss, are weak on network/virtual filesystems, and can fire
  before `meta.json` is fully written. A robust version would run the same turn
  check on startup, on fs.watch events, *and* on the periodic poll as fallback.
  Given a 3s poll has negligible cost, only worth adding if near-instant wake
  justifies the extra code and tests - deferred for now.
- A second sibling skill for >2 participants or cross-machine, if a real need
  appears.
