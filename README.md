# Agent Skills

Agent skills for coordinating work *between* agent sessions - distributed via
the [Agent Skills open standard](https://github.com/anthropics/skills).

## Background Skills

Auto-applied when relevant to the current task.

### `agent-thread`

Let two already-running agent sessions (any mix of Claude Code and Codex, same
machine) review or discuss work by taking turns through a shared on-disk thread,
looping until resolved - so you stop copy-pasting report files between two
agents. Triggers whenever you want a second agent to review a spec/plan/PR until
it converges, or want two open sessions to talk without you relaying.

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

The `agent-thread` skill activates, opens a thread, posts the artifact, and
hands you a one-paste launcher for your second session. From there the two
agents loop on their own.

## Contributing

Each skill follows the [Agent Skills open standard](https://github.com/anthropics/skills).
See [AGENTS.md](./AGENTS.md) for authoring conventions, frontmatter
requirements, and style rules.
