# Continuous handoff pair example

Adapt this concrete example to the current effort. Keep the headings and replace
the sample state; do not retain facts that were not verified.

# `HANDOFF.md`

## READ THIS FIRST

- **Objective:** Keep the legacy `/catalog` route public while completing the
  catalog refactor.
- **Status:** In progress. The user correction has been propagated; the current
  build predates that correction.
- **Git:** Worktree `Not yet verified`; branch `feature/catalog`; commit
  `a13f09c`; cleanliness `Not yet verified`.
- **Binding decision:** `/catalog` remains public. This supersedes the earlier
  removal decision.
- **Ownership:** `author` owns implementation. `reviewer-ui` owns read-only
  review and has not handed back.
- **Active operation:** Terminal session `41872` is running the production
  build for `a13f09c` before the corrected route decision.
- **Accepted evidence:** Focused catalog tests passed on `a13f09c`, but are
  `STALE` for the corrected route behavior. The active build is diagnostic only.
- **Blocker:** None.
- **Next action:** `author` sends the corrected public-route decision to
  `reviewer-ui` on the existing review channel.

## DECISIONS

| Decision | Current ruling | Evidence impact |
|---|---|---|
| Legacy catalog route | Keep `/catalog` public | Supersedes removal; prior route checks are `STALE`. |

## OWNERSHIP AND ACTIVE OPERATIONS

| Owner | Scope | State | Inspect or resume |
|---|---|---|---|
| `author` | Catalog implementation | `HOLD` pending build result | Terminal session `41872` |
| `reviewer-ui` | Current diff review | Active; no handback | Existing review channel |

## EVIDENCE INDEX

| Check | Exact state | Result | Status |
|---|---|---|---|
| Focused catalog tests | Commit `a13f09c`, removal decision | Passed | `STALE` after user correction |
| Production build | Commit `a13f09c`, terminal `41872` | Running | Diagnostic only |

## RISKS AND FOLLOW-UPS

- **Required:** Rerun route checks and the production build after preserving
  `/catalog` and incorporating the review handback.
- **Optional:** None.

# `LOG.md`

Entries are append-only and remain oldest to newest.

### 2026-07-14 18:42:11 JST — user correction superseded route removal

- User ruled that legacy `/catalog` must remain public.
- Marked focused tests and active build non-final because they use the previous
  removal decision.
- Review remains on the old decision until the correction is sent.
