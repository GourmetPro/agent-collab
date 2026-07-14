# Parallel handoff overlay example

Use `maintaining-continuous-handoffs` for the canonical `HANDOFF.md`/`LOG.md`
pair. Add these concrete current-state sections to `HANDOFF.md`, replacing
sample values only with inspected facts. Keep all chronology in `LOG.md`.
Unknown values remain `Not yet verified`.

## PARALLEL STREAMS

| Stream | Owner and scope | Git state | Thread state | Phase and next action |
|---|---|---|---|---|
| API | `worker-a`; API files | `feat/api`; dirty; no commit | `api-stream`; turn `worker-a` | Implementing. `worker-a` creates a checkpoint commit. |
| UI | `worker-b`; UI files | `feat/ui` at `b220011`; cleanliness `Not yet verified` | `ui-stream`; turn `lead`; `PARKED` | Review signed off. `lead` decides landing order after A commits. |
| Docs | `worker-c`; docs files | `feat/docs`; commit `Not yet verified` | `docs-stream`; turn `worker-c` | `BLOCKED` on the committed API contract. `worker-c` hands back the block. |

## THREADS AND WAITS

- **Root:** `/tmp/threads`
- **Coordinator handle:** `lead`
- **API:** captured wait terminal `501`; inspect before replacing it. Exact
  re-arm command is `Not yet verified`.
- **UI:** parked at `turn=lead`; do not re-arm or send a no-op post.
- **Docs:** no wait is armed. Inspect `docs-stream` before arming one.
- **Turn-start action:** Sweep `api-stream,ui-stream,docs-stream` using the
  verified local `agent-thread` executable. Its path is `Not yet verified`.

## DEPENDENCIES AND CONTRACTS

| Consumer | Dependency | Owner | Release condition |
|---|---|---|---|
| Docs | API contract | `worker-a` | Inspect the committed contract and its SHA before unblocking `worker-c`. |

Do not relay a shared contract from dispatch text or memory. Read the actual
exported file on the owning branch.

## MERGE ORDER AND COLLISIONS

- **Potential collision:** `package-lock.json` is in the API and UI touch sets.
- **Landing rule:** Keep API and UI adjacent. The second stream rebases onto the
  updated base, resolves the lockfile from actual dependency intent, and reruns
  the canonical gate.
- **Current order:** `Not yet decided`; neither stream is a merge candidate.

## CANONICAL GATES

| Gate | Applies to | Current evidence |
|---|---|---|
| `npm test` | Every rebased merge candidate | No accepted result recorded. |

Tie each future result to the exact stream commit and rebased base in the
canonical `EVIDENCE INDEX`.

## PEER COORDINATORS

No peer coordinator is active. If another fleet shares main, record its channel,
touch sets, named contracts, and landing signals here.

## RESOURCE POLICY

- Keep idle dev servers and browsers stopped.
- Keep at most one captured wait per thread.
- Serialize local commands that mutate shared output.
