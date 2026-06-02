---
name: agent-thread
description: >
  Use when you want one running agent session to collaborate with another
  running agent session (any mix of Claude Code and Codex, same machine) by
  taking turns through a shared channel until the work is resolved - instead of
  you manually copy-pasting messages or report files between the two. Covers
  many collaboration shapes: have a peer review a spec/plan/PR, debate a
  decision (A vs B), consult a peer that has different tools/model/repo/web
  access, delegate a scoped sub-task, pair (driver/navigator) on a working
  tree, or brainstorm. Triggers on asks like "have another agent review this",
  "get a second agent's opinion until we converge", "ask the other session
  about X", "let codex and claude work this out", "I asked an agent to do X,
  they'll come back to you via Y", or wanting two open sessions to talk without
  you relaying.
user-invocable: false
---

# agent-thread

Talk to another running agent session. Two sessions on the same machine (any mix
of Claude Code and Codex) hold a turn-taking conversation through a shared
on-disk thread, looping until one of them marks it resolved. The human kicks off
each peer once, then stays out of the loop - no copy-pasting messages between
sessions.

The conversation lives in plain files (`<git-root>/.agent-threads/<id>/`), driven
by one zero-dependency CLI: `scripts/athread.mjs`. There is no server, daemon, or
MCP. `wait` is the whole mechanism: it blocks until it is your turn, then prints
the peer's latest message.

The channel is **pattern-agnostic**. What differs between collaboration types is
only two things: the opening message the initiator posts, and what "resolved"
means. The mechanics below are identical for all of them.

## Your job (in order)

1. Find the CLI: it is `scripts/athread.mjs` next to this file. Set
   `AT="<absolute path to scripts/athread.mjs>"` for the commands below.
2. Decide whether you are **joining** or **initiating**:
   - The human pasted a kickoff prompt -> you are **joining**. Follow that prompt;
     your specific task is in the first message you `wait` for.
   - You want a peer's help -> you are **initiating**. Pick a
     [pattern](#collaboration-patterns) (or improvise) and run
     [the loop](#running-a-collaboration-initiator).
3. Loop to convergence, honoring the [escalation rules](#escalation--termination).
4. When the thread resolves (or escalates), report the outcome to the human in
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

1. Start the thread (pick a short readable id; handles are free-form - use the
   harness names `claude,codex` or roles `author,reviewer`):
   ```
   node "$AT" init --thread <id> --participants <you>,<peer>
   ```
   `--round-cap N` defaults to 15.
2. Post the opening turn. State the **pattern**, your role and the peer's role,
   point at anything by **absolute path**, and say what **"resolved" looks like**:
   ```
   node "$AT" post --thread <id> --as <you> \
     --body "Pattern: review. You are the reviewer. Critique the spec at /abs/path. Post concrete blocking issues; resolve when none remain. Don't edit it yourself."
   ```
3. Hand the human a one-paste launcher for the other session:
   ```
   node "$AT" kickoff --thread <id> --as <peer> [--role "<short label>"]
   ```
   Print its output and tell the human: "Paste this into your other agent session."
   (`--role` is an optional one-line hint; the real task is in your opening post.)
4. Wait for the peer (see [the wake mechanic](#the-wake-mechanic)):
   ```
   node "$AT" wait --thread <id> --as <you>
   ```
5. On each peer turn: do your part (revise the artifact, answer, integrate the
   sub-task, react to the idea...), then `post` your reply - or `resolve` if the
   shared goal is met. Then `wait` again.
6. Loop step 4-5 until the thread resolves, the round cap trips, or `wait` times
   out. Then summarize for the human.

## The wake mechanic

`wait` polls the thread and returns the moment it is your turn. How you run it
depends on your harness:

- **Claude Code:** run `wait` as a **background** Bash command. The harness
  re-invokes you when it exits, so you are woken on the peer's turn without
  burning a foreground turn polling. When notified, read the command's output
  file, act, post, and background another `wait`.
- **Codex / other:** run `wait` inline. It blocks the current turn until the
  peer replies, then your turn continues. Loop normally.

Either way, after you `post`, the turn is the peer's; your next `wait` returns
when they hand it back.

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

All commands take `--thread <id>`. The thread root is `$ATHREAD_DIR`, else
`<git-root>/.agent-threads/`.

| Command | Purpose |
|---|---|
| `init --thread T --participants a,b [--round-cap N] [--turn a] [--force]` | Create a thread (exactly two distinct handles). Fails if `T` already exists unless `--force`, which resets it and clears old messages. |
| `post --thread T --as W (--body "..." \| --body-file F) [--force]` | Add your turn; flips the turn to the peer. Rejected unless it is your turn (`--force` overrides). |
| `resolve --thread T --as W [--body "..."] [--force]` | Close the thread (no more posts allowed). Same turn rule as `post`. |
| `wait --thread T --as W [--timeout S] [--interval S]` | Block until your turn or resolved; print latest. Exit 2 on timeout. |
| `read --thread T` | Print the whole transcript. |
| `status --thread T` | Print meta + round count as JSON. |
| `kickoff --thread T --as W [--role "label"]` | Emit a self-contained paste-prompt to launch the other peer. |

Turn-taking is enforced: `post`/`resolve` only succeed when `meta.turn` names
you, so a confused peer cannot post twice or talk over the other. `--force` is
the escape hatch for recovering a stuck thread. Thread ids and handles must be
safe slugs (letters, digits, `.` `_` `-`) - no path separators.

`--body-file` and piped stdin both work for long bodies, so you never have to
cram a multi-paragraph turn onto one shell line.

## When NOT to use

- **One session can do it alone.** If none of the leverage reasons above apply,
  do the work inline; do not spin up a second agent for ceremony.
- **The two agents are on different machines.** This channel is the local
  filesystem. Cross-machine needs a different transport (out of scope).
- **More than two participants.** The turn model is strictly two peers.
- **You need a durable, queryable audit trail across many threads.** This is a
  scratch channel under `.agent-threads/`, not a system of record.
