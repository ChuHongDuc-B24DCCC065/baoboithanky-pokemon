# Task 1.3.6L isolated security PoC harness

This harness exercises selected Task K invariants using in-memory models and a local loopback Socket.IO server. It does not connect to Firebase, Firestore, Google Cloud, MongoDB, or production services. A passing simulation is not proof of production behavior or Firestore transaction semantics.

## Run

From this directory:

```powershell
node tests/run_all_poc.js
```

The runner writes sanitized results to `evidence/sanitized_evidence.json` and exits nonzero when an assertion fails or an unexpected error occurs. To verify failure propagation deliberately:

```powershell
node tests/run_all_poc.js --self-test-failure
```

That command is expected to exit nonzero; run the normal command afterward to restore passing-run evidence.

## Result labels

- `SIMULATION_PASS`: an assertion passed against in-memory behavior or local loopback transport.
- `BLOCKED`: an assertion could not run because required Firebase Emulator integration is absent.
- `UNVERIFIED`: infrastructure behavior such as Redis multi-instance routing is not represented.
- `FAIL` / `ERROR`: an executed assertion failed / unexpected runner error occurred.

The auth-time baseline remains 300 seconds maximum age and 30 seconds future skew. An age of 330 seconds is denied by this harness and remains an OPEN QUESTION for the architecture owner; it is not accepted as policy.
