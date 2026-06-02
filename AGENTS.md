# Agent Instructions

Rules for contributing to this repository.

## What this repo is

A collection of [Agent Skills](https://github.com/anthropics/skills) for
coordinating work between agent sessions, distributed via
[skills.sh](https://skills.sh/). Each skill lives at `skills/<skill-name>/` with
a `SKILL.md` entrypoint plus optional supporting files and scripts. No build
step and no package manager - the unit of work is a skill directory.

## Skill frontmatter

Every `SKILL.md` starts with YAML frontmatter:

```yaml
---
name: skill-name
description: Use when [specific triggers, symptoms, contexts]. Triggers on phrases like "...".
user-invocable: false
---
```

- `name`: lowercase, hyphens only, 64-char max. Pick a name distinctive enough
  to avoid collision with other skills a consumer might install.
- `description`: third person, starts with `Use when...`, **describes triggering
  conditions only - never summarizes the workflow**. 1024-char max. Cover
  synonyms and concrete trigger phrases so retrieval matches loose asks.
- `user-invocable: false` for background skills that should auto-trigger from
  natural-language asks. Omit (or set `true`) for skills invoked explicitly.

## SKILL.md body

- Body under 500 lines. If approaching that, split into sibling `.md` files or a
  `references/` directory.
- Open with the skill's job in 3-6 numbered steps, then describe what it
  produces.
- Treat the body as a router: list recipes/references in a table and instruct
  future Claude to open only the relevant one.
- Include a "When NOT to use" section to prevent over-triggering.
- Use consistent terminology (one term per concept). Forward-slash paths only.
- Avoid time-sensitive statements.

## Scripts

Skills here **may** ship runnable utilities (this is the difference from a
pure-markdown skills repo).

- Place executables under `skills/<skill>/scripts/` and have `SKILL.md` instruct
  the consumer to run them.
- Keep them **zero-dependency** and runnable with a stock runtime (e.g. Node
  >= 18, or POSIX sh). No `package.json`, no installs - a consumer who runs
  `npx skills add` must be able to use the script immediately.
- Ship a self-contained test next to the script (`test-<name>.mjs`) and keep it
  green. Run it with the stock runtime; no test framework.

## Style

- **No emojis in skill body prose, contributor docs, or code comments.** Emojis
  inside *example output* are fine when domain-appropriate.
- Use `Yes` / `No` in tables, not checkmarks or emoji.
- Inline concrete sample values, not `{{placeholders}}`. Examples should be
  runnable or previewable as-is.
- One excellent example per pattern beats five mediocre ones.

## File layout

```
skills/<skill>/
  SKILL.md
  scripts/<tool>.mjs        # optional, zero-dep
  scripts/test-<tool>.mjs   # optional test
  references/<topic>.md     # optional, one level deep from SKILL.md
```

Reference files must be one level deep from `SKILL.md` - never a chain of
cross-references. Files over ~100 lines start with a contents list.

## Adding or editing a skill

1. Create or edit `skills/<skill-name>/SKILL.md` with the frontmatter above.
2. If it ships a script, keep it zero-dep and its test green.
3. Add or update the one-line entry in `README.md`.
4. Verify the description matches what the body actually does - drift between
   description and body is the most common discovery bug.

## Out of scope

- Project-specific credentials, IDs, or workspace config - skills are reusable
  across consumers.
- Heavyweight build, lint, or framework tooling. There is none and this repo
  does not need any.
