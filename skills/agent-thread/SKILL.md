---
name: agent-thread
description: >
  Use when you have produced a spec, plan, design doc, or PR in one agent
  session and want a second agent session (Claude or Codex) to review or
  discuss it, looping back and forth until resolved - instead of you manually
  copy-pasting report files between two agents. Triggers on asks like "have
  another agent review this", "get a second agent's opinion until we converge",
  "I asked an agent to do X, they'll come back to you via Y", "run a review
  loop between two sessions", "let codex and claude discuss this until done",
  or wanting two open agent sessions to talk to each other without you
  relaying. Also for any peer-to-peer turn-taking exchange between two agent
  sessions on the same machine.
user-invocable: false
---

# agent-thread

Two agent sessions on the same machine (any mix of Claude Code and Codex) hold
a turn-taking conversation through a shared on-disk thread, looping until one of
them marks it resolved. The human kicks off each peer once, then stays out of
the loop - no copy-pasting report paths between sessions.

The conversation lives in plain files (`<git-root>/.agent-threads/<id>/`), driven
by one zero-dependency CLI: `scripts/athread.mjs`. There is no server, daemon, or
MCP. `wait` is the whole mechanism: it blocks until it is your turn, then prints
the peer's latest message.

## Your job (in order)

1. Find the CLI: it is `scripts/athread.mjs` next to this file. Set
   `AT="<absolute path to scripts/athread.mjs>"` for the commands below.
2. **Pick your role** from the request:
   - You just produced an artifact and want it reviewed -> you are the **author**. Go to [Author recipe](#author-recipe).
   - The human pasted a kickoff prompt asking you to review something -> you are the **reviewer**. That prompt already contains your loop; just follow it.
   - Two peers are hashing out an open decision (no single author) -> [Discuss recipe](#discuss-recipe).
3. Run your recipe's loop to convergence, honoring [escalation rules](#escalation--termination).
4. When the thread resolves (or escalates), report the outcome to the human in one short summary.

## Author recipe

You wrote the spec/plan/PR; you want a peer to review it until there are no
blocking issues left.

1. Start the thread (pick a short readable id, e.g. the artifact basename):
   ```
   node "$AT" init --thread <id> --participants <you>,<peer>
   ```
   Handles are free-form. Use the harness names if that is how the human thinks
   (`claude,codex`), or roles (`author,reviewer`). `--round-cap N` defaults to 15.
2. Post the opening turn - point at the artifact by absolute path and state what
   you want:
   ```
   node "$AT" post --thread <id> --as <you> \
     --body "I'm the author. Review the artifact at /abs/path. Post concrete blocking issues; resolve when none remain. Don't edit it yourself."
   ```
3. Hand the human a one-paste launcher for the other session:
   ```
   node "$AT" kickoff --thread <id> --as <peer> --role reviewer
   ```
   Print its output and tell the human: "Paste this into your other agent session."
4. Wait for the reviewer (see [the wake mechanic](#the-wake-mechanic)):
   ```
   node "$AT" wait --thread <id> --as <you>
   ```
5. On each reviewer turn: address the findings by **actually revising the
   artifact**, then post a short reply describing what changed (and any
   reasoned pushback). Then `wait` again.
6. Loop step 4-5 until the reviewer `resolve`s, the round cap trips, or `wait`
   times out. Then summarize for the human.

## Reviewer recipe

Usually you arrive here because the human pasted a kickoff prompt - follow it.
If you need to drive it yourself, the loop is:

1. `node "$AT" wait --thread <id> --as <you>` - blocks until your turn, prints the latest message.
2. (Re-)read the referenced artifact.
3. Decide if blocking issues remain:
   - yes -> `node "$AT" post --thread <id> --as <you> --body "<numbered, concrete findings>"`
   - no  -> `node "$AT" resolve --thread <id> --as <you> --body "<one line: why it's clean now>"`
4. If you resolved, stop. Otherwise `wait` again.

Review only; do not edit the artifact. Keep each turn concrete and brief - the
author needs to act on it, not parse an essay.

## Discuss recipe

Symmetric variant for two peers hashing out a decision with no single author
(e.g. "should we use approach A or B?"). Same loop, but **either** peer may
`resolve` once they agree, and the resolve body states the agreed conclusion.
Start it exactly like the author recipe, but the opening post asks a question
instead of requesting a review.

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
| Converged | a peer ran `resolve` (`wait` prints `status=resolved`) | Summarize the outcome and the final artifact state. |
| Stuck in disagreement | round count reaches `round_cap` (`wait` prints `ROUND CAP reached`) | Stop. Summarize the open disagreement and your recommendation; let the human decide. |
| Peer went quiet | `wait` exits non-zero (timeout) | Stop. Tell the human the peer stalled; offer to resume. |

Never loop silently past the cap, and never invent a resolution the peer did not
agree to.

## CLI reference

All commands take `--thread <id>`. The thread root is `$ATHREAD_DIR`, else
`<git-root>/.agent-threads/`.

| Command | Purpose |
|---|---|
| `init --thread T --participants a,b [--round-cap N] [--turn a]` | Create a thread. |
| `post --thread T --as W (--body "..." \| --body-file F)` | Add your turn; flips the turn to the peer. |
| `resolve --thread T --as W [--body "..."]` | Close the thread (no more posts allowed). |
| `wait --thread T --as W [--timeout S] [--interval S]` | Block until your turn or resolved; print latest. Exit 2 on timeout. |
| `read --thread T` | Print the whole transcript. |
| `status --thread T` | Print meta + round count as JSON. |
| `kickoff --thread T --as W --role reviewer\|author` | Emit a self-contained paste-prompt to launch the other peer. |

`--body-file` and piped stdin both work for long bodies, so you never have to
cram a multi-paragraph review onto one shell line.

## When NOT to use

- **One session can do it alone.** If you just want a self-review pass, do it
  inline; do not spin up a second agent.
- **The two agents are on different machines.** This channel is the local
  filesystem. Cross-machine needs a different transport (out of scope).
- **More than two participants.** The turn model is strictly two peers.
- **You need a durable, queryable audit trail across many threads.** This is a
  scratch channel under `.agent-threads/`, not a system of record.
