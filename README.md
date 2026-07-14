# agent-collab

Agent skills for coordinating work *between* agent sessions - distributed via
the [Agent Skills open standard](https://github.com/anthropics/skills).

## Skills

Auto-applied when relevant to the current task, and directly callable where
noted.

### `agent-thread`

Let two already-running agent sessions (any mix of Claude Code and Codex, same
machine) collaborate by taking turns through a shared on-disk thread, looping
until resolved - so you stop copy-pasting messages between two agents. The
channel is pattern-agnostic; it covers review, debate/decide, consult (a peer
with different tools/model/repo), delegate a sub-task, pair (driver/navigator),
and brainstorm. Triggers whenever you want a second agent to weigh in until you
converge, or want two open sessions to talk without you relaying. Either side can
also drop an out-of-band note at any time without taking the turn.
Invoke explicitly as `$agent-thread` in Codex or `/agent-thread` in Claude.
For a persistent session that may span compaction, a pause, or ownership
transfer, compose it with `maintaining-continuous-handoffs`.

- [SKILL.md](./skills/agent-thread/SKILL.md)
- [Design notes](./skills/agent-thread/DESIGN.md)
- CLI: [`scripts/athread.mjs`](./skills/agent-thread/scripts/athread.mjs) (zero deps, Node >= 18)

### `maintaining-continuous-handoffs`

Keep a repository-local `HANDOFF.md`/`LOG.md` pair current while work spans
compaction, pauses, active operations, or ownership transfers. `HANDOFF.md`
contains mutable resume state; `LOG.md` contains append-only history. The skill
reconciles recorded claims against real state and keeps exactly one next action
visible. Small same-turn tasks skip the pair entirely.
Invoke explicitly as `$maintaining-continuous-handoffs` in Codex or
`/maintaining-continuous-handoffs` in Claude.

- [SKILL.md](./skills/maintaining-continuous-handoffs/SKILL.md)
- [Concrete handoff pair example](./skills/maintaining-continuous-handoffs/references/handoff-example.md)

### `coordinating-parallel-sessions`

Coordinate N parallel agent sessions (Claude Code or Codex) from a single
coordinator session - one session per independent, PR-sized workstream, each in
its own git worktree and on its own `agent-thread` channel. The coordinator never
writes the code: it scopes the streams, gates every step (plan, implement,
review, UX-verify, PR, merge), adds a parallel-stream overlay to the canonical
`HANDOFF.md`/`LOG.md` pair, and sequences merges to avoid shared-file conflicts.
Triggers when you fan a large effort across several long-lived sessions and want
each gated and merged safely - the layer on top of `agent-thread`.
Invoke explicitly as `$coordinating-parallel-sessions` in Codex or
`/coordinating-parallel-sessions` in Claude.

- [SKILL.md](./skills/coordinating-parallel-sessions/SKILL.md)
- [Parallel handoff example](./skills/coordinating-parallel-sessions/references/parallel-handoff-example.md)

## Installation

```bash
# Install everything
npx skills add gourmetpro/agent-collab

# Or install a specific skill
npx skills add gourmetpro/agent-collab --skill agent-thread
```

For local development, symlink a skill into your agent's skills directory, e.g.
`~/.claude/skills/agent-thread -> skills/agent-thread`.

## Usage

Background skills auto-trigger from natural-language asks. For example:

> I just wrote this spec. Have another agent review it until there are no
> blocking issues left, and come back to me when it's resolved.

or

> Ask my other session (it has the backend repo open) what shape this API
> should be, and settle it with them.

The `agent-thread` skill activates, opens a thread, posts the opening message,
and hands you a one-paste launcher for your second session. From there the two
agents loop on their own until resolved.

## Contributing

Each skill follows the [Agent Skills open standard](https://github.com/anthropics/skills).
See [AGENTS.md](./AGENTS.md) for authoring conventions, frontmatter
requirements, and style rules.
