---
name: agent-thread
description: >
  Use when two already-running agent sessions on the same machine need to
  collaborate on a review, decision, consultation, delegated sub-task,
  driver/navigator pairing, or brainstorm without the user relaying each turn.
  Triggers on asks like "have another agent review this", "get a second agent's
  opinion until we converge", "ask the other session about X", "let Codex and
  Claude work this out", "pair these two sessions", or "keep this cross-agent
  conversation open".
user-invocable: true
---

# agent-thread

Talk to another running agent session. Two sessions on the same machine (any mix
of Claude Code and Codex) hold a turn-taking conversation through a shared
on-disk thread, looping until one of them marks it resolved. The human kicks off
each peer once, then stays out of the loop - no copy-pasting messages between
sessions.

The conversation lives in plain files (`~/.agent-threads/<id>/` by default;
override with `--root <path>` or `$ATHREAD_DIR` for a custom shared root),
driven by one zero-dependency CLI: `scripts/athread.mjs`. The default avoids
hidden thread folders in arbitrary working directories and keeps transcripts
findable. There is no server, daemon, or MCP. `wait` is the whole mechanism: it
blocks until it is your turn, then prints the peer's latest message.

The channel is **pattern-agnostic**. What differs between collaboration types is
only two things: the opening message the initiator posts, and what "resolved"
means. The mechanics below are identical for all of them.

## Your job (in order)

1. Find the CLI: it is `scripts/athread.mjs` next to this file. Set
   `AT="<absolute path to scripts/athread.mjs>"` for the commands below. The
   script is executable directly; use `node "$AT"` only if a copied install lost
   its executable bit.
2. Decide whether you are **joining** or **initiating**:
   - The human pasted a kickoff prompt -> you are **joining**. Follow that prompt;
     your specific task is in the first message you `wait` for.
   - You want a peer's help -> you are **initiating**. Pick a
     [pattern](#collaboration-patterns) (or improvise) and run
     [the loop](#running-a-collaboration-initiator).
3. Loop to convergence, honoring the [escalation rules](#escalation--termination).
4. After every non-resolving `post`, immediately rearm `wait` for your handle
   and keep its output attached to the agent. Do not report back to the human
   merely because the turn is now the peer's, and do not narrate empty polling
   while `wait` is still pending.
5. When the thread resolves (or escalates), report the outcome to the human in
   one short summary.

## Collaboration patterns

Pick the row that fits, or improvise your own - the CLI does not care. Each
pattern is just a way to fill in the opening post and the resolve condition.

| Pattern | Shape | The opening post asks for... | "Resolved" means... |
|---|---|---|---|
| **Review** | one leads, critical | "critique this artifact at /abs/path; post blocking issues" | no blocking issues remain |
| **Debate / decide** | symmetric, critical | "argue this against me: option A vs B" | an agreed decision, or a crisp framed disagreement for the human |
| **Consult** | one asks, informational | "here is my blocker / question; you have <tool/model/repo> I don't" | you got the answer you needed |
| **Delegate** | one leads, generative | "do this scoped sub-task and report back" | the sub-task is delivered and integrated |
| **Pair** (driver/navigator) | one edits, one steers | "watch my diffs in <path> and steer me turn by turn" | the change is done and the navigator signs off |
| **Brainstorm** | symmetric, generative | "let's riff on ideas for X, build on each other" | a synthesized shortlist both peers back |

Variants: **verify** is Review aimed at correctness/facts (the peer independently
re-derives or re-runs your result instead of judging design taste);
**contract negotiation** is Decide across two repos (e.g. a frontend session and
a backend session settling an API shape, each session in its own working tree).

The leverage of a *second running session* is usually one of: independent
judgment (a fresh context sees what you can't), **different capabilities**
(another model, different tools/MCPs, a different repo's working tree, web
access), parallelism, or keeping two big jobs in separate context windows. If
none of those apply, do it inline instead.

## Running a collaboration (initiator)

The loop is the same for every pattern; only your opening post changes.

1. Start the thread (pick a short readable id). Handles are **thread labels used
   with `--as`, not agent identities** - prefer role labels like `author,reviewer`
   or `driver,navigator`; reserve harness labels like `claude,codex` for when that
   makes routing clearer:
   ```
   "$AT" init --thread <id> --participants <you>,<peer>
   ```
   `--round-cap N` defaults to 15.
2. Post the opening turn. State the **pattern**, your role and the peer's role,
   point at anything by **absolute path**, and say what **"resolved" looks like**:
   ```
   "$AT" post --thread <id> --as <you> \
     --body "Pattern: review. You are the reviewer. Critique the spec at /abs/path. Post concrete blocking issues; resolve when none remain. Don't edit it yourself."
   ```
3. Hand the human a one-paste launcher for the other session:
   ```
   "$AT" kickoff --thread <id> --as <peer> [--role "<short label>"]
   ```
   Print its output and tell the human: "Paste this into your other agent session."
   (`--role` is an optional one-line hint; the real task is in your opening post.)
4. Wait for the peer (see [the wake mechanic](#the-wake-mechanic)):
   ```
   "$AT" wait --thread <id> --as <you>
   ```
5. On each peer turn: do your part (revise the artifact, answer, integrate the
   sub-task, react to the idea...), then follow the [turn contract](#turn-contract)
   and `post` your reply - or `resolve` if the shared goal is met. If you
   posted, immediately `wait` again. The post is the handoff; the wait is what
   keeps the agent-thread alive.
6. Loop step 4-5 until the thread resolves, the round cap trips, or `wait` times
   out. Then summarize for the human.

## Turn contract

Every turn must leave the peer able to continue without human interpretation.
Before you `post` or `resolve`, decide whether you are handing back, resolving,
or escalating to the human.

- If handing back, state what you inspected, changed, decided, or ruled out;
  name any blockers or open questions; and say exactly what you need from the
  peer next.
- After a handoff `post`, immediately rearm `wait` for your own handle. On a
  session thread, this means `wait --follow` (or re-running the same captured
  wait if your harness reaped it). Keep the command as an active captured tool
  session, or poll/resume that tool session until you consume its output. Do not
  stop at `status`, finalize with an unobserved wait pending, or tell the human
  "turn is now <peer>" while the thread remains open.
- While an armed `wait` is still pending and has produced no peer turn,
  resolution, or timeout, stay silent. Do not send periodic "still waiting",
  "no output yet", or background-terminal progress updates to the human.
- Do not send courtesy no-op handoffs such as "stand by" or "nothing pending".
  If the peer has handed control to you and you have no next task, hold the turn
  and leave the peer's wait armed. If you accidentally receive a no-op while a
  session must remain open, either post a real next task, resolve, or pass the
  turn back once and immediately rearm; never idle indefinitely while holding
  the turn.
- Use `resolve` only when the opening resolve condition is satisfied and no peer
  action remains. For `init --session`, resolve only when the whole session is
  over.
- If `wait` reports `ROUND CAP reached` or times out, stop and summarize to the
  human instead of posting a pretend resolution.
- Do not post only "done", "looks good", "waiting", or a generic summary.

## Out-of-band notes

Turn-taking governs the substantive handoff, but either side may drop a `note`
at any time to add context, a correction, or a "stop" - without claiming the
turn:

```
"$AT" note --thread <id> --as <you> --body "STOP: that path is wrong, it is /srv/app"
```

- A note never changes whose turn it is, and **seeing a note never means it is
  your turn**.
- The peer picks notes up at its next **checkpoint**. The single-purpose way to
  check is `pending --as <you>` (prints the peer's notes since your last
  substantive post, then exits 0; never blocks, takes no turn) - run it at
  natural checkpoints, e.g. before a `post`/`resolve` or before an expensive
  step. (In a backgrounded `wait` loop you can also re-run `wait --as <you>`,
  which returns immediately when it is already your turn and prints the same
  window.)
- If you coordinate several threads, sweep `pending --as <you>` on every wake,
  timeout, or re-arm cycle. `wait` returns only on a turn flip or resolution; it
  will not wake you for checkpoint notes such as "contract frozen".
- Notes never wake a pending `wait` and never count toward the round cap.
- Sending a note does **not** disturb your already-armed `wait` (the turn did
  not change), so the waiting side can forward something the human just told it
  and keep the same wait.
- Best-effort: a note can land just after the peer's checkpoint, so a "stop" may
  arrive one message late. For a hard stop, fall back to the human.
- **Broadcast** the same note to several threads at once with a comma list:
  `note --thread a,b,c --as <you> --body "..."` (best-effort fan-out, flips no
  turns, exits nonzero if any target failed - the nonzero reports write landing,
  not that a peer has collected it).
- **Fleet view:** `status --all` lists every thread under the root (turn, rounds,
  notes, last activity) - a read-only cross-check of who is at whose turn, useful
  when one session coordinates several threads.

## The wake mechanic

`wait` polls the thread and returns the moment it is your turn. If the turn is
already yours, an immediate successful return is normal; reserve nonzero exits
for timeout or invalid state. Notes never wake a pending `wait` - they are
surfaced in the window the next time `wait` returns on your turn. How you run it
depends on your harness:

- **Claude Code:** a harness-managed background `wait` can wake you when it
  exits, but it can also be reaped at idle boundaries or compaction. Record the
  exact re-arm command, read any captured output before re-arming, and consider
  bounded waits or a status poller when coordinating many threads.
- **Codex / other:** keep `wait` tied to a tool session whose output the harness
  preserves, and do not end your assistant turn assuming a completed background
  wait will auto-wake the model. A foreground command is the simple version; a
  harness-managed terminal is fine if you actively poll/resume it and consume the
  printed turn. Do not shell-background `wait` with `&` (it can detach the output
  from the agent). If the terminal is reaped, just re-run the same `wait`. For a
  session thread, use `wait --follow`; a finite `--timeout` is only a fallback
  and must be rearmed before reporting back to the human. This is about captured
  tool output, not OS window focus.
- **If your harness does not wake you when a backgrounded `wait` completes**, you
  must self-poll. `wait --probe` is the primitive for that: a single-shot,
  non-blocking check that exits 0 when the turn is yours (printing the peer's turn
  window when there are messages) or the thread resolved, and exits 3 - distinct
  from a timeout - when the peer still holds the turn. Run it at your own
  checkpoints between work; exit 0 means drain and act, exit 3 means keep working
  and probe again later. It never blocks, so it cannot misread a healthy "still
  the peer's turn" as a stall the way a tiny `--timeout` would (that returns exit
  2, "escalate to the human").

For every harness, run one captured `wait` at a time and treat silence as the
expected pending state, not proof that the peer is working. Keep the blocking
`wait` as its own command; do not pipe it through commands like `head`, which can
turn a blocker into an instant no-op. If you must poll a managed terminal to
collect output, poll at the coarsest practical cadence and only surface a real
peer turn, resolution, round-cap signal, timeout, or direct human-requested
status.

**A long-lived background watcher is best-effort, never the source of truth.** A
persistent backgrounded `wait` (or a watcher process) can have its harness event
routing severed at idle or context-compaction boundaries: the OS process keeps
looping but its output stops reaching you, with no error, so a thread can resolve
and you never hear it. So if you are watching anything for more than a few
minutes - and especially across more than one thread - back the watcher with a
turn-start sweep: on every wake (a delivered event, a human message, or any
re-entry) run `status --all` (or `sweep`) over the threads you own BEFORE acting.
That check has no live-process dependency and catches whatever a dead watcher
missed. Prefer short, break-on-first-event watchers that you re-arm each round
over one long persistent loop, and treat silence as a trigger to sweep, never as
evidence that nothing changed.

Either way, after you `post`, the turn is the peer's; immediately rearm your
next `wait` so it returns when they hand it back.

For an **ongoing, multi-topic collaboration**, create the thread with
`init --session`: the peer's kickoff then uses `wait --follow` (waits
indefinitely across idle gaps, with a periodic stderr heartbeat) and the round
cap is unlimited. Keep one session thread and treat each new topic as another
turn; `resolve` only when the whole collaboration is done. Do not open a fresh
thread (and re-paste a launcher) per topic - that ends the peer's loop. Do not
leave a session thread after posting unless it has resolved or escalated; keep a
captured `wait --follow` active for your handle.

### Durable continuity for persistent sessions

**REQUIRED SUB-SKILL:** Use `maintaining-continuous-handoffs` when an
`init --session` collaboration may span context compaction, an overnight pause,
a session restart, or ownership transfer. Bounded threads that will resolve in
the current context do not need a separate handoff.

Record these resume coordinates in the canonical handoff:

- thread root, thread id, both handles, and current turn;
- exact re-arm or probe command;
- current topic and resolve condition;
- related branch, worktree, owner, and active operation identifiers;
- one exact next action.

For any coordinate not supplied or inspected, record `Not yet verified`. Never
derive the task worktree from the skill path or the agent's current directory.
The next-action owner normally matches `meta.turn`, but a thread turn does not
transfer ownership of another session's terminal or process. Record that
operation separately unless the peer explicitly owns it.

The thread transcript remains the evidence for what the peers said. The handoff
connects that transcript to wider work state and tells the next agent how to
resume. Do not use a checkpoint `note` as a substitute: notes are best-effort,
do not wake a pending wait, and do not capture Git or external operations.

On resume, reconcile the handoff against `status` or `sweep` before posting,
rearming, or replacing an operation.

## Escalation - termination

Pull the human back in (stop looping, summarize) when any of these happen:

| Condition | Signal | What to do |
|---|---|---|
| Converged | a peer ran `resolve` (`wait` prints `status=resolved`) | Summarize the outcome and the final state. |
| Stuck | round count reaches `round_cap` (`wait` prints `ROUND CAP reached`) | Stop. Summarize the open disagreement and your recommendation; let the human decide. |
| Peer went quiet | `wait` exits non-zero (timeout) | Stop. Tell the human the peer stalled; offer to resume. |

Never loop silently past the cap, and never invent a resolution the peer did not
agree to.

## CLI reference

Thread commands take `--thread <id>`. The thread root is `--root <path>`, else
`$ATHREAD_DIR`, else `~/.agent-threads/`. Generated kickoff prompts use `--root`
for non-default roots instead of exporting `$ATHREAD_DIR`; manual users may
still set `$ATHREAD_DIR`. `help` does not require a thread. Run `$AT --help`,
`$AT help <command>`, or `$AT <command> --help` for built-in CLI documentation.

| Command | Purpose |
|---|---|
| `init [--root R] --thread T --participants a,b [--round-cap N] [--turn a] [--session] [--force]` | Create a thread (exactly two distinct handles). `--session` = unlimited round cap + `wait --follow` in the kickoff, for ongoing multi-topic channels. Fails if `T` already exists unless `--force`, which resets it and clears old messages. |
| `post [--root R] --thread T --as W (--body "..." \| --body-file F) [--force]` | Add your turn; flips the turn to the peer. Rejected unless it is your turn (`--force` overrides). |
| `note [--root R] --thread T\|a,b,c --as W (--body "..." \| --body-file F)` | Add an out-of-band note. Does NOT change the turn; allowed regardless of whose turn it is; rejected after `resolve`. The peer sees it in its next `wait` window; notes never wake a pending `wait`, and never count toward the round cap. A comma list broadcasts to several threads (best-effort; "id: file" / "id: ERROR" per thread; nonzero exit if any failed). |
| `pending [--root R] --thread T --as W` | Non-blocking peek: print the peer's notes since your last substantive post, then exit 0 (nothing + exit 0 when none). Never blocks, never writes, takes no turn - the checkpoint primitive for a turn-holder mid-task. |
| `resolve [--root R] --thread T --as W [--body "..."] [--force]` | Close the thread (no more posts allowed). Same turn rule as `post`. |
| `wait [--root R] --thread T --as W [--timeout S] [--interval S] [--follow]` | Block until your turn or resolved; print the window since your last substantive post (any interleaved notes included). Exit 2 on timeout, unless `--follow`, which never gives up (prints a stderr heartbeat and keeps waiting) - for session threads. |
| `wait [--root R] --thread T --as W --probe` | Single-shot, non-blocking turn check: exit 0 when it is your turn (printing the window when there are messages) or resolved, else exit 3 (peer still holds the turn - not an error, nothing printed). For a self-polling loop on a harness that does not auto-wake on a backgrounded `wait`. Cannot combine with `--follow`. |
| `read [--root R] --thread T` | Print the whole transcript. |
| `status [--root R] --thread T \| --all [filters]` | Single thread: meta as JSON with `rounds` (substantive), `messages`, `notes`. `--all`: read-only JSON array over every thread under the root (id, participants, turn, status, rounds, messages, notes, last, updated); a garbled thread is flagged, never crashes. Filters (AND-composed) narrow `--all`: `--participant <h>`, `--open`, `--since <iso>`, `--min-messages <N>`, `--max-messages <N>`. |
| `sweep [--root R] (--thread a,b,c \| --all [filters]) [--as W] [--state F] [--reset]` | Turn-start safety net: snapshot a thread set, diff against the last sweep (a small JSON state file), print ONLY the changed threads (turn flip, new notes, resolution) - each with `firstSeen`, plus `mine` when `--as` is given. Read-only on threads; default state `<root>/.athread-sweep[.<as>].json`; `--reset` re-baselines. No live-process dependency, so it catches what a dead background watcher missed. |
| `kickoff [--root R] --thread T --as W [--role "label"]` | Emit a self-contained paste-prompt to launch the other peer. |
| `help [command]` | Print global or command-specific CLI documentation. |

Turn-taking is enforced: `post`/`resolve` only succeed when `meta.turn` names
you, so a confused peer cannot post twice or talk over the other. `--force` is
the escape hatch for recovering a stuck thread. Thread ids and handles must be
safe slugs (letters, digits, `.` `_` `-`) - no path separators.

For multi-paragraph turns, write the body to a temp file and use `--body-file`.
This keeps shell quoting simple and makes Codex approval prompts stable; reserve
`--body "..."` for short one-line turns. Piped stdin also works for long bodies.

## When NOT to use

- **One session can do it alone.** If none of the leverage reasons above apply,
  do the work inline; do not spin up a second agent for ceremony.
- **The two agents are on different machines.** This channel is the local
  filesystem. Cross-machine needs a different transport (out of scope).
- **More than two participants.** The turn model is strictly two peers.
- **You need a durable, queryable audit trail across many threads.** This is a
  scratch channel under `.agent-threads/`, not a system of record.
