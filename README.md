# Agent Skills

Agent skills for coordinating work *between* agent sessions - distributed via
the [Agent Skills open standard](https://github.com/anthropics/skills).

## Background Skills

Auto-applied when relevant to the current task.

### `agent-thread`

Let two already-running agent sessions (any mix of Claude Code and Codex, same
machine) collaborate by taking turns through a shared on-disk thread, looping
until resolved - so you stop copy-pasting messages between two agents. The
channel is pattern-agnostic; it covers review, debate/decide, consult (a peer
with different tools/model/repo), delegate a sub-task, pair (driver/navigator),
and brainstorm. Triggers whenever you want a second agent to weigh in until you
converge, or want two open sessions to talk without you relaying.

- [SKILL.md](./skills/agent-thread/SKILL.md)
- [Design notes](./skills/agent-thread/DESIGN.md)
- CLI: [`scripts/athread.mjs`](./skills/agent-thread/scripts/athread.mjs) (zero deps, Node >= 18)

## Installation

```bash
# Install everything
npx skills add <org>/agent-skills

# Or install a specific skill
npx skills add <org>/agent-skills --skill agent-thread
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
