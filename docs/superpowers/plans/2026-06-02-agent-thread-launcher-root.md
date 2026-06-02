# Agent Thread Launcher Root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep `agent-thread` transcripts out of arbitrary worktrees while making Codex approval prompts stable enough to approve the `athread.mjs` command prefix once.

**Architecture:** Preserve `~/.agent-threads` as the implicit default root. Add `--root <path>` as a first-class override that takes precedence over `$ATHREAD_DIR`, keep `$ATHREAD_DIR` for compatibility, and make generated kickoff prompts skill-first with a complete direct-executable fallback loop. Generated commands must avoid shell variables and redundant default-root exports; long turns should use `--body-file` so post commands remain stable and shell-safe.

**Tech Stack:** Zero-dependency Node >= 18 CLI (`skills/agent-thread/scripts/athread.mjs`), self-contained Node test script (`skills/agent-thread/scripts/test-athread.mjs`), markdown skill/design docs.

---

## Current State

- Branch: `fix-agent-thread-workspace-root`.
- Existing uncommitted edits include an abandoned workspace-local root implementation in `athread.mjs`, `SKILL.md`, and `DESIGN.md`.
- Existing uncommitted test edits already include some red tests for the new direction, but they need cleanup before implementation.
- Empirical harness fact from this session: after the user approved the command prefix `/Users/knshiro/.agents/skills/agent-thread/scripts/athread.mjs`, subsequent direct `athread.mjs ...` thread commands did not re-prompt even though they wrote under `~/.agent-threads`.

## File Structure

- Modify `skills/agent-thread/scripts/test-athread.mjs`: test default root, `--root` precedence, skill-first kickoff output, complete executable fallback commands, `--body-file` guidance in kickoff text, and direct shebang execution.
- Modify `skills/agent-thread/scripts/athread.mjs`: restore the home default, parse `--root`, detect default root robustly, and rewrite kickoff output.
- Modify `skills/agent-thread/SKILL.md`: document root precedence, direct executable usage, complete fallback loop, and `--body-file` for long turns.
- Modify `skills/agent-thread/DESIGN.md`: document the global scratch-root rationale and approval-prefix tradeoff.
- Add/keep `docs/superpowers/plans/2026-06-02-agent-thread-launcher-root.md`: this implementation plan.

## Task 0: Clean The Abandoned Workspace-Local Base

**Files:**
- Modify: `skills/agent-thread/scripts/athread.mjs`
- Modify: `skills/agent-thread/SKILL.md`
- Modify: `skills/agent-thread/DESIGN.md`
- Modify: `skills/agent-thread/scripts/test-athread.mjs`

- [ ] **Step 1: Inspect current abandoned diff**

Run:

```bash
git diff -- skills/agent-thread/scripts/athread.mjs skills/agent-thread/SKILL.md skills/agent-thread/DESIGN.md skills/agent-thread/scripts/test-athread.mjs
```

Expected: diff includes the previous workspace-local default-root change. Do not build the new implementation on top of that production/docs change.

- [ ] **Step 2: Restore production/docs files to HEAD**

Run:

```bash
git restore skills/agent-thread/scripts/athread.mjs skills/agent-thread/SKILL.md skills/agent-thread/DESIGN.md
```

Expected: the workspace-local default root code and docs are removed. This is not discarding user work; it is removing Codex’s abandoned earlier implementation on this branch.

- [ ] **Step 3: Keep or rewrite only the relevant red tests**

If `skills/agent-thread/scripts/test-athread.mjs` still contains the obsolete assertion named `default root: uses nearest worktree .agent-threads when ATHREAD_DIR is unset`, remove that block. Keep tests that assert the approved behavior:

```js
check('default root: uses ~/.agent-threads when ATHREAD_DIR and --root are unset',
  fs.existsSync(path.join(defaultRoot, 'd', 'meta.json')));
check('default root: does not create a worktree-local thread root',
  !fs.existsSync(path.join(DEFCWD, '.agent-threads')));
```

- [ ] **Step 4: Confirm status**

Run:

```bash
git status --short
```

Expected: `athread.mjs`, `SKILL.md`, and `DESIGN.md` are clean or only contain changes from later tasks; the plan file remains untracked/modified; `test-athread.mjs` may remain modified with red tests.

## Task 1: Write Red Tests For Root, Kickoff, And Executable Behavior

**Files:**
- Modify: `skills/agent-thread/scripts/test-athread.mjs`

- [ ] **Step 1: Add test helpers for unset env, custom env, and direct execution**

Near the existing `env` and `runIn` helpers, add:

```js
const defaultEnv = { ...process.env };
delete defaultEnv.ATHREAD_DIR;

const runWithEnv = (extraEnv, args, opts = {}) => new Promise((resolve) => {
  const p = spawn('node', [AT, ...args], { cwd: opts.cwd, env: { ...process.env, ...extraEnv } });
  let out = '', err = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => resolve({ code, out, err }));
});

const runDirect = (dirEnv, args) => new Promise((resolve) => {
  const p = spawn(AT, args, { env: { ...process.env, ATHREAD_DIR: dirEnv } });
  let out = '', err = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (err += d));
  p.on('close', (code) => resolve({ code, out, err }));
});
```

- [ ] **Step 2: Add default-root and non-pollution tests**

After the git hygiene checks, add:

```js
const DEFHOME = fs.mkdtempSync(path.join(os.tmpdir(), 'athread-home-'));
const DEFCWD = fs.mkdtempSync(path.join(os.tmpdir(), 'athread-cwd-'));
fs.mkdirSync(path.join(DEFCWD, '.git'));
const defaultRoot = path.join(fs.realpathSync(DEFHOME), '.agent-threads');
await runWithEnv({ ...defaultEnv, HOME: DEFHOME }, ['init', '--thread', 'd', '--participants', 'a,b'], { cwd: DEFCWD });
check('default root: uses ~/.agent-threads when ATHREAD_DIR and --root are unset',
  fs.existsSync(path.join(defaultRoot, 'd', 'meta.json')));
check('default root: does not create a worktree-local thread root',
  !fs.existsSync(path.join(DEFCWD, '.agent-threads')));
```

- [ ] **Step 3: Add default-root kickoff tests**

Continue the same test block with:

```js
const defaultKo = await runWithEnv({ ...defaultEnv, HOME: DEFHOME }, ['kickoff', '--thread', 'd', '--as', 'b'], { cwd: DEFCWD });
check('kickoff default root: skill-first prompt names the thread and handle',
  /Use the agent-thread skill/.test(defaultKo.out) && /Join thread d as b/.test(defaultKo.out));
check('kickoff default root: omits redundant ATHREAD_DIR export and --root flag',
  !/export ATHREAD_DIR/.test(defaultKo.out) && !/--root /.test(defaultKo.out));
check('kickoff default root: fallback uses executable script directly',
  defaultKo.out.includes(`${AT} wait --thread d --as b`) && !/node "\$AT"/.test(defaultKo.out));
check('kickoff default root: fallback includes post via body-file and resolve',
  /post --thread d --as b --body-file /.test(defaultKo.out) && /resolve --thread d --as b --body /.test(defaultKo.out));
```

- [ ] **Step 4: Add custom-root precedence and shell-safety tests**

Continue the same test block with:

```js
const CUSTOM = fs.mkdtempSync(path.join(os.tmpdir(), 'athread custom '));
await runWithEnv({ ATHREAD_DIR: TMP }, ['init', '--root', CUSTOM, '--thread', 'custom', '--participants', 'a,b']);
check('--root: overrides ATHREAD_DIR for thread storage',
  fs.existsSync(path.join(CUSTOM, 'custom', 'meta.json')) && !fs.existsSync(path.join(TMP, 'custom', 'meta.json')));
const customKo = await runWithEnv({ ATHREAD_DIR: TMP }, ['kickoff', '--root', CUSTOM, '--thread', 'custom', '--as', 'b']);
check('kickoff custom root: uses --root in fallback instead of exporting ATHREAD_DIR',
  customKo.out.includes(`wait --root '${CUSTOM}' --thread custom --as b`) && !/export ATHREAD_DIR/.test(customKo.out));
check('kickoff custom root: fallback includes post and resolve with --root after the subcommand',
  customKo.out.includes(`post --root '${CUSTOM}' --thread custom --as b --body-file `)
    && customKo.out.includes(`resolve --root '${CUSTOM}' --thread custom --as b --body `));
```

`--root` must appear after the subcommand because this CLI parses `process.argv[2]` as the command.

- [ ] **Step 5: Add direct shebang execution test and cleanup**

Complete the block with:

```js
const direct = await runDirect(CUSTOM, ['status', '--thread', 'custom']);
check('executable: athread.mjs runs directly through its shebang',
  direct.code === 0 && /"id": "custom"/.test(direct.out));
fs.rmSync(DEFHOME, { recursive: true, force: true });
fs.rmSync(DEFCWD, { recursive: true, force: true });
fs.rmSync(CUSTOM, { recursive: true, force: true });
```

- [ ] **Step 6: Update the existing space-path kickoff test**

Replace expectations for `export ATHREAD_DIR` and `AT=...` with direct fallback expectations:

```js
check('kickoff: quotes the custom --root path',
  ko.out.includes(`--root '${SPACE}'`));
check('kickoff: fallback uses the executable script directly',
  ko.out.includes(`${AT} wait --root '${SPACE}' --thread k --as codex`));
check('kickoff: greeting is a handle label, not an identity claim',
  /Your thread handle is "codex"/.test(ko.out) && !/You are "codex"/.test(ko.out));
check('kickoff: tells the peer to load the agent-thread skill',
  /Use the agent-thread skill/.test(ko.out));
check('kickoff: points at SKILL.md when it exists on disk',
  /its entrypoint is: \S*SKILL\.md/.test(ko.out));
```

- [ ] **Step 7: Verify RED**

Run:

```bash
node skills/agent-thread/scripts/test-athread.mjs
```

Expected: tests fail only in the new behavior area: default-root resolution, `--root`, kickoff shape, complete fallback loop, or direct executable behavior. Syntax errors or failures in existing turn-taking tests must be fixed before implementation.

## Task 2: Implement Root Resolution And Complete Executable Kickoff

**Files:**
- Modify: `skills/agent-thread/scripts/athread.mjs`

- [ ] **Step 1: Restore the home default and parse root after args**

Ensure imports include:

```js
import os from 'node:os';
```

After `const a = parseArgs(rest);`, define:

```js
function defaultRoot() {
  return path.resolve(path.join(os.homedir(), '.agent-threads'));
}

function rootFrom(args) {
  if (args.root === true) throw new Error('athread: --root requires a value');
  if (args.root !== undefined) return path.resolve(args.root);
  if (process.env.ATHREAD_DIR) return path.resolve(process.env.ATHREAD_DIR);
  return defaultRoot();
}

const root = rootFrom(a);
const usesDefaultRoot = path.normalize(root) === path.normalize(defaultRoot());
```

Remove the abandoned `findWorkspaceRoot` implementation.

- [ ] **Step 2: Add command formatting helpers**

Near `shq`, add helpers that put `--root` after each subcommand:

```js
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;
const unquotedSlug = (s) => SAFE.test(String(s)) ? String(s) : shq(s);
const selfTok = () => SAFE_PATH.test(SELF) ? SELF : shq(SELF);
const rootArg = () => usesDefaultRoot ? '' : ` --root ${shq(root)}`;
const cli = (subcommand) => `${selfTok()} ${subcommand}${rootArg()}`;
```

This keeps the common no-space install path bare for Codex prefix recognition, while still generating a pasteable fallback if the installed script path contains spaces or shell metacharacters.

- [ ] **Step 3: Rewrite `kickoffPrompt` as skill-first**

The prompt must begin with:

```text
Use the agent-thread skill. Join thread <threadId> as <handle>.
```

It must still include:
- the peer handle,
- the optional role line,
- the local `SKILL.md` path when present,
- session vs non-session guidance,
- a complete fallback loop.

- [ ] **Step 4: Generate complete fallback commands**

Inside `kickoffPrompt`, build commands like:

```js
const T = unquotedSlug(threadId);
const H = unquotedSlug(handle);
const waitCmd = session
  ? `${cli('wait')} --thread ${T} --as ${H} --follow --interval 3`
  : `${cli('wait')} --thread ${T} --as ${H} --timeout 1800 --interval 3`;
const bodyFile = 'PATH_YOU_WROTE';
const postCmd = `${cli('post')} --thread ${T} --as ${H} --body-file ${shq(bodyFile)}`;
const resolveCmd = `${cli('resolve')} --thread ${T} --as ${H} --body "<the outcome>"`;
```

The fallback loop must show:

```text
1. <waitCmd>
2. Do the requested work.
3. Write your reply to a temp file your environment can write. Replace PATH_YOU_WROTE below with that path, then run:
   <postCmd>
4. If the shared goal is met, run:
   <resolveCmd>
5. Otherwise repeat from step 1.
```

For session threads, say not to resolve until the peer says the session is over.

- [ ] **Step 5: Remove shell variables and redundant exports**

Confirm the generated prompt does not include:

```text
AT=
T=
export ATHREAD_DIR=
node "$AT"
```

The prompt may mention `$ATHREAD_DIR` only in explanatory docs, not as a generated launcher command.

- [ ] **Step 6: Verify GREEN for script tests**

Run:

```bash
node skills/agent-thread/scripts/test-athread.mjs
```

Expected: `all checks passed`.

## Task 3: Update Skill And Design Docs

**Files:**
- Modify: `skills/agent-thread/SKILL.md`
- Modify: `skills/agent-thread/DESIGN.md`

- [ ] **Step 1: Restore global scratch-root wording**

In `SKILL.md`, describe the root as:

```md
The conversation lives in plain files (`~/.agent-threads/<id>/` by default;
override with `--root <path>` or `$ATHREAD_DIR` for a custom shared root).
```

Add one sentence: the default avoids hidden thread folders in arbitrary working directories and keeps transcripts findable.

- [ ] **Step 2: Document root precedence**

In the CLI reference, state:

```md
All commands take `--thread <id>`. The thread root is `--root <path>`, else
`$ATHREAD_DIR`, else `~/.agent-threads/`.
```

Add `--root <path>` to the command table descriptions where appropriate.

- [ ] **Step 3: Update command examples to direct executable usage**

Change examples from:

```sh
node "$AT" init --thread <id> --participants <you>,<peer>
```

to:

```sh
"$AT" init --thread <id> --participants <you>,<peer>
```

Note that `scripts/athread.mjs` is executable directly; `node "$AT"` is a fallback if a copied install loses its executable bit.

- [ ] **Step 4: Add long-body guidance**

In `SKILL.md`, replace the current final sentence about `--body-file` with stronger guidance:

```md
For multi-paragraph turns, write the body to a temp file and use `--body-file`.
This keeps shell quoting simple and makes Codex approval prompts stable; reserve
`--body "..."` for short one-line turns.
```

- [ ] **Step 5: Update design rationale**

In `DESIGN.md`, include:

```md
The default root is global scratch state under the home directory, not worktree
state. This avoids changing `git status` or creating hidden folders in arbitrary
directories. Codex may ask once because the root is outside the workspace write
sandbox; the launcher uses a direct executable command so the user can approve
the `athread.mjs` prefix instead of approving arbitrary shell snippets. Long
turns use `--body-file` to keep post commands stable.
```

- [ ] **Step 6: Scan for stale wording**

Run:

```bash
rg "workspace-local|nearest git worktree|export ATHREAD_DIR|node \"\\$AT\"|--root|--body-file|~/.agent-threads" skills/agent-thread README.md
```

Expected:
- no “workspace-local” or “nearest git worktree” default-root wording remains;
- no generated-launcher examples use `export ATHREAD_DIR` or `node "$AT"`;
- `--root`, `--body-file`, and `~/.agent-threads` appear in the intended docs.

## Task 4: Review With Claude Before Installing

**Files:**
- Review: all modified files

- [ ] **Step 1: Post implementation summary to Claude**

Use the existing persistent thread `agent-thread-launcher-root`.

Post a concise message with:
- changed files,
- key behavior decisions,
- test command and result,
- any open caveats.

Use a short direct command or `--body-file`; avoid inline multi-paragraph shell bodies.

- [ ] **Step 2: Wait for Claude review**

Run:

```bash
/Users/knshiro/.agents/skills/agent-thread/scripts/athread.mjs wait --thread agent-thread-launcher-root --as codex --timeout 1800 --interval 3
```

Expected: Claude replies with blocking issues or no blockers. If blockers remain, revise one round at a time and repeat Task 4.

## Task 5: Sync Installed Copy And Live-Verify Approval Behavior

**Files:**
- Source: `skills/agent-thread/**`
- Destination after approval: `/Users/knshiro/.agents/skills/agent-thread/**`

- [ ] **Step 1: Confirm installed copy path**

Run:

```bash
ls -l /Users/knshiro/.agents/skills/agent-thread /Users/knshiro/.claude/skills/agent-thread
```

Expected: `.claude/skills/agent-thread` points at the `.agents` installed copy. The installed copy is what live kickoff prompts use until the user syncs it.

- [ ] **Step 2: Request approval to sync installed files**

Request approval before writing outside the repo. Copy exactly:

```bash
cp skills/agent-thread/SKILL.md /Users/knshiro/.agents/skills/agent-thread/SKILL.md
cp skills/agent-thread/DESIGN.md /Users/knshiro/.agents/skills/agent-thread/DESIGN.md
cp skills/agent-thread/scripts/athread.mjs /Users/knshiro/.agents/skills/agent-thread/scripts/athread.mjs
cp skills/agent-thread/scripts/test-athread.mjs /Users/knshiro/.agents/skills/agent-thread/scripts/test-athread.mjs
```

Expected: installed copy reflects repo behavior after user approval.

- [ ] **Step 3: Verify installed test script**

Run:

```bash
node /Users/knshiro/.agents/skills/agent-thread/scripts/test-athread.mjs
```

Expected: `all checks passed`.

- [ ] **Step 4: Live-verify command prefix approval**

Use the live thread as the testbed. Post a short message with the installed direct executable:

```bash
/Users/knshiro/.agents/skills/agent-thread/scripts/athread.mjs post --thread agent-thread-launcher-root --as codex --body "Live verification: direct athread.mjs prefix still posts without a new bespoke approval prompt."
```

Expected: no new bespoke approval prompt if the prefix approval is active. If it prompts, record the prompt details and discuss with Claude; the command-shape design does not fully solve the harness problem without a saved prefix approval or writable-root configuration.

## Task 6: Final Verification

**Files:**
- Verify: all modified files

- [ ] **Step 1: Run repo test suite**

Run:

```bash
node skills/agent-thread/scripts/test-athread.mjs
```

Expected: `all checks passed`.

- [ ] **Step 2: Check executable bit**

Run:

```bash
git ls-files -s skills/agent-thread/scripts/athread.mjs
```

Expected: mode starts with `100755`.

- [ ] **Step 3: Inspect diff**

Run:

```bash
git diff -- skills/agent-thread/scripts/athread.mjs skills/agent-thread/scripts/test-athread.mjs skills/agent-thread/SKILL.md skills/agent-thread/DESIGN.md docs/superpowers/plans/2026-06-02-agent-thread-launcher-root.md
```

Expected:
- no workspace-local default-root implementation;
- `--root` accepted after subcommands and taking precedence over `$ATHREAD_DIR`;
- kickoff is skill-first and includes a complete direct executable fallback loop;
- fallback post guidance uses `--body-file`;
- default-root kickoff omits `--root` and `ATHREAD_DIR`.

- [ ] **Step 4: Check worktree status**

Run:

```bash
git status --short
```

Expected: only planned agent-thread files and this plan file are modified/added.

## Self-Review

- Spec coverage: Covers global root, approval-prefix behavior, `--root`, `$ATHREAD_DIR` compatibility, complete fallback loop, `--body-file`, installed-copy sync, Claude review, and live verification.
- Placeholder scan: No placeholders remain.
- Type consistency: The plan consistently uses `--root`, `$ATHREAD_DIR`, `root`, `usesDefaultRoot`, `kickoffPrompt`, `runWithEnv`, and `runDirect`.
