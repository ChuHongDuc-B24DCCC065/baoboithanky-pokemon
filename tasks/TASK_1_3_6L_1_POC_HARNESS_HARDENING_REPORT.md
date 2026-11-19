# Task 1.3.6L.1 — PoC Harness Hardening Report

**Result type:** Design and harness verification report; no production implementation.  
**Scope:** `tasks/poc/task-1.3.6L/` plus this authorized report only.  
**Decision:** L.1 is **not fully closable as an end-to-end security PoC** while the local Socket.IO transport and Firebase Emulator checks remain blocked. The assertion-backed in-memory portion is passing and the runner correctly propagates deliberate failures.

## Summary

The harness now derives result labels from executed assertions or explicit infrastructure limits. The prior synthetic PoC A PASS declarations were removed. Its evidence file is regenerated without session hashes, socket identifiers, or lease tokens. The harness distinguishes a passing simulation from a test against Firebase or a live Socket.IO transport.

The Task K time baseline was preserved: `auth_time` age is limited to 300 seconds, and future skew is limited to 30 seconds independently. The 330-second boundary is denied by the present implementation and remains an **OPEN QUESTION**, not an accepted standard.

## Changes made

| File | Change |
|---|---|
| `tasks/poc/task-1.3.6L/src/authority.js` | Restored and hardened fail-closed in-memory authorization; any existing deletion job blocks authorization. Explicitly labels deletion lock as a sequential Map model, not Firestore atomicity. |
| `tasks/poc/task-1.3.6L/src/socket_gate.js` | Uses canonical registered socket identity, clears identity on removal, gates sender and recipient, targets allow-listed sockets only, and counts acknowledgements/timeouts. |
| `tasks/poc/task-1.3.6L/src/deletion_engine.js` | Adds injected time/token sources, lease eligibility and epoch fencing, retry increment, and modeled residual checks for profiles, game data descendants, username reservations, and simulated Auth absence. |
| `tasks/poc/task-1.3.6L/src/time_validator.js` | Validates inputs and enforces the unchanged 300-second age / 30-second future-skew limits. Validates lease status, expiry, and retry fields. |
| `tasks/poc/task-1.3.6L/tests/run_all_poc.js` | Replaces hardcoded PASS results with actual assertions, produces status counts and sanitized evidence, includes deliberate failure injection, and marks unavailable integration checks accurately. |
| `tasks/poc/task-1.3.6L/README.md` | Documents run commands, result labels, simulation limits, and the time baseline. |
| `tasks/poc/task-1.3.6L/evidence/sanitized_evidence.json` | Regenerated from the final normal run; contains no token or socket ID values. |
| `tasks/TASK_1_3_6L_1_POC_HARNESS_HARDENING_REPORT.md` | This report. |

No package, lockfile, production source, Firebase configuration, MongoDB, or prior report was changed by this task. The repository already contained numerous unrelated modified and untracked files before work; they were preserved. The initial `git status --short --untracked-files=all` baseline included modified root application files and untracked docs/server/tasks artifacts. The post-run status still shows those same out-of-scope paths. New/updated L.1 paths are confined to the table above.

## Verification commands and outcomes

Commands were run from `D:\cc\Poke-Engine\tasks\poc\task-1.3.6L` using Node.js `v22.14.0`.

| Command | Exit code | Outcome |
|---|---:|---|
| `node tests/run_all_poc.js` (normal run 1) | 0 | 17 `SIMULATION_PASS`, 2 `BLOCKED`, 1 `UNVERIFIED`, 0 `FAIL`, 0 `ERROR`. |
| `node tests/run_all_poc.js` (normal run 2; final evidence restored) | 0 | Same counts; final evidence file reflects this normal run. |
| `node tests/run_all_poc.js --self-test-failure` | 1 | The deliberate assertion failed and the runner returned nonzero as required. This evidence was subsequently replaced by the final normal run. |
| `git status --short --untracked-files=all` | 0 | Existing unrelated changes remained present; L.1 artifacts are within approved paths. |
| `git diff --stat` | 0 | Shows pre-existing tracked root modifications only; L.1 files are untracked and therefore do not appear in this diff stat. |

### Final status table

| Status | Count | Meaning |
|---|---:|---|
| `PASS` | 0 | No claim of a Firebase/runtime PASS was made. |
| `SIMULATION_PASS` | 17 | Assertion passed against the in-memory model or mock socket gate. |
| `FAIL` | 0 | No assertion failed in the final normal run. The deliberate failure run intentionally had 1 `FAIL` and exit code 1. |
| `BLOCKED` | 2 | Local Socket.IO loopback integration received `xhr poll error` / HTTP 503; Firebase Emulator wiring is absent. |
| `UNVERIFIED` | 1 | Redis-backed multi-instance Socket.IO routing is not represented. |
| `ERROR` | 0 | No unexpected error in the final normal run. |

The loopback transport test uses the installed Socket.IO dependency, but this environment returned a transport 503 before a client session was established. The test is therefore not reported as passed. The pure gate behavior, including sender/recipient denial and identity cleanup, does pass its separate mock-based assertions.

## Limits of verification

- The in-memory `Map` operations do not prove Firestore transaction atomicity, retry behavior, recursive deletion, or commit-time fencing.
- The simulated Auth deletion set does not contact Firebase Auth.
- The Firebase Emulator suite was not executed because this harness has no Firebase SDK/emulator integration configured. No claim about Java installation is made by this run.
- Multi-server routing and Redis adapter failure behavior remain unverified.
- The local Socket.IO transport assertion is blocked by the observed HTTP 503 in this environment.
- No production runtime, deployment environment, or live account was accessed.
- `git diff --stat` does not include untracked files; Git status was used to inspect those paths. The report itself is also untracked until separately staged/committed by the owner.

## Out of scope

- The earlier Task 1.3.6L report contains broader Firebase/atomicity wording that is not established by this harness. It was left untouched; review or correction belongs outside L.1.
- Enabling the Firebase Emulator, adding Firebase packages/configuration, enabling Redis multi-instance tests, and changing production code are outside scope.
- The `auth_time` 330-second boundary remains an OPEN QUESTION for the owner because this task must retain the K baseline of maximum age 300 seconds and future skew 30 seconds.

## L.1 closure conclusion

**Harness hardening work: completed within scope. End-to-end PoC closure: not yet established.** The runner’s passing path and nonzero failure path were both observed, and the final evidence records actual assertion outcomes. L.1 may be closed as a harness-hardening task if its acceptance criterion is assertion-backed, sanitized, fail-propagating local harness behavior. It must not be represented as complete Firebase or multi-instance security validation while the listed checks remain `BLOCKED` / `UNVERIFIED`.
