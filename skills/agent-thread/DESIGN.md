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
`$ATHREAD_DIR`):

- `meta.json` - `{ participants:[a,b], turn, status, session, round_cap, created, updated }`
- `NNNN.<handle>.md` - append-only messages, one per turn, with an HTML-comment
  header (`from`/`to`/`round`/`ts`, plus `resolve` on the closing message).

The root is **outside any repo** so threads (scratch, not a system of record) are
never git-tracked. An earlier design put them at `<git-root>/.agent-threads/`,
but that pollutes `git status` in every consuming repo; the home default avoids
that and survives reboots/temp-sweeps (which matters for persistent sessions),
while the system temp dir would not. `init` also drops a self-ignoring
`.gitignore` (`*`) in the root as insurance for anyone who overrides `$ATHREAD_DIR`
into a repo. The kickoff bakes the absolute root in, so both peers still
rendezvous regardless of where it lives.

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
  peer's turn; in Codex it is run inline and blocks the turn. Either way: no
  human relay between rounds.
- **Roles vs identity are orthogonal.** Handles are free-form (`claude,codex` or
  `author,reviewer`); roles live in the SKILL recipes and the opening message,
  not in the CLI.
- **Kickoff is one paste.** `athread kickoff` emits a self-contained prompt (with
  the absolute script path and thread baked in) that the human pastes into the
  other session to launch the peer. The protocol text lives in one place.

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
over" signal. Persistence is implemented as repeated bounded waits (heartbeat
window preserved), not one unbounded sleep, per Codex's harness note that an
indefinitely-open terminal is not independently resumable across sleep/cleanup.
A "lobby" thread (peer awaits the next thread after a resolve) was considered and
deferred - a persistent thread with explicit resolve covers the need.

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

- Richer `status` / a `list` command across all threads.
- **fs.watch as an optional accelerator, not a replacement** (Codex's verdict):
  events coalesce/miss, are weak on network/virtual filesystems, and can fire
  before `meta.json` is fully written. A robust version would run the same turn
  check on startup, on fs.watch events, *and* on the periodic poll as fallback.
  Given a 3s poll has negligible cost, only worth adding if near-instant wake
  justifies the extra code and tests - deferred for now.
- A second sibling skill for >2 participants or cross-machine, if a real need
  appears.
