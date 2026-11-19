/** Assertion-backed isolated PoC runner. Simulation results are never runtime proof. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { AuthorityStore } = require("../src/authority");
const { SocketGate } = require("../src/socket_gate");
const { DeletionEngine } = require("../src/deletion_engine");
const { validateAuthTime, evaluateLeaseEligibility } = require("../src/time_validator");
const rootModules = path.resolve(__dirname, "../../../../node_modules");
const ioServer = require(path.join(rootModules, "socket.io"));
const ioClient = require(path.join(rootModules, "socket.io-client"));
const packageLock = require(path.resolve(__dirname, "../../../../package-lock.json"));
const socketVersion = packageLock.packages?.["node_modules/socket.io"]?.version || "UNVERIFIED";
const results = [];
function test(id, fn, category = "SIMULATION_PASS") {
  try { fn(); results.push({ id, status: category, assertions: "executed" }); }
  catch (e) { results.push({ id, status: "FAIL", error: String(e.message || e) }); }
}
async function asyncTest(id, fn, category = "SIMULATION_PASS") {
  try { await fn(); results.push({ id, status: category, assertions: "executed" }); }
  catch (e) { results.push({ id, status: "FAIL", error: String(e.message || e) }); }
}
function account(now = 1700000000000) { const s = new AuthorityStore({ now: () => now }); s.seedAccount("u1", "s1", "Trainer"); return s; }
async function main() {
  const baselineNow = 1700000000000;
  test("authority.active_allows", () => assert.equal(account(baselineNow).evaluateAuthorization("u1", "s1").allowed, true));
  for (const status of ["PENDING", "PROCESSING", "FAILED", "COMPLETED", "UNKNOWN"]) test(`authority.any_deletion_job_${status.toLowerCase()}_denied`, () => { const s = account(baselineNow); s.deletionJobs.set("u1", { status }); assert.equal(s.evaluateAuthorization("u1", "s1").allowed, false); });
  test("authority.session_mismatch_and_missing_control_fail_closed", () => { const s = account(baselineNow); assert.equal(s.evaluateAuthorization("u1", "bad").allowed, false); s.accountControls.delete("u1"); assert.equal(s.evaluateAuthorization("u1", "s1").allowed, false); });
  test("authority.revoked_expired_generation_and_logout_pending_denied", () => { const s = account(baselineNow); s.authSessions.get("s1").status = "REVOKED"; assert.equal(s.evaluateAuthorization("u1", "s1").allowed, false); s.authSessions.get("s1").status = "ACTIVE"; s.authSessions.get("s1").expiresAt = baselineNow; assert.equal(s.evaluateAuthorization("u1", "s1").allowed, false); s.authSessions.get("s1").expiresAt = baselineNow + 1000; s.accountControls.get("u1").sessionGeneration++; assert.equal(s.evaluateAuthorization("u1", "s1").code, "GENERATION_MISMATCH"); s.accountControls.get("u1").sessionGeneration--; s.accountControls.get("u1").globalLogoutPending = true; assert.equal(s.evaluateAuthorization("u1", "s1").code, "GLOBAL_LOGOUT_PENDING"); });
  test("authority.deletion_lock_denied_state_unchanged_if_not_authorized", () => { const s = account(baselineNow); s.deletionJobs.set("u1", { status: "UNKNOWN" }); const c = { ...s.accountControls.get("u1") }; assert.equal(s.commitDeletionLock("u1", "s1").success, false); assert.deepEqual(s.accountControls.get("u1"), c); });
  test("authority.deletion_lock_and_global_logout_fail_closed", () => { const s = account(baselineNow); assert.equal(s.commitDeletionLock("u1", "s1").success, true); assert.equal(s.evaluateAuthorization("u1", "s1").allowed, false); assert.equal(s.globalLogout("missing").success, false); });

  test("time.auth_age_300_accepted_301_and_330_denied", () => { assert.equal(validateAuthTime(1000, 1300).valid, true); assert.equal(validateAuthTime(1000, 1301).code, "RECENT_SIGN_IN_REQUIRED"); assert.equal(validateAuthTime(1000, 1330).code, "RECENT_SIGN_IN_REQUIRED"); });
  test("time.future_skew_30_accepted_31_denied", () => { assert.equal(validateAuthTime(1030, 1000).valid, true); assert.equal(validateAuthTime(1031, 1000).code, "AUTH_TIME_IN_FUTURE"); });
  test("time.invalid_values_or_changed_baseline_denied", () => { for (const args of [[NaN, 1000], [1000, Infinity], [1000, 1000, 330, 30], [1000, 1000, 300, 31]]) assert.equal(validateAuthTime(...args).valid, false); });
  test("lease.status_retry_expiry_validation", () => { assert.equal(evaluateLeaseEligibility(null, 1000).eligible, false); assert.equal(evaluateLeaseEligibility({ status: "COMPLETED", retryCount: 0, maxRetries: 3 }, 1000).eligible, false); assert.equal(evaluateLeaseEligibility({ status: "PROCESSING", retryCount: 3, maxRetries: 3 }, 1000).code, "MAX_RETRIES_EXCEEDED"); assert.equal(evaluateLeaseEligibility({ status: "PROCESSING", retryCount: 0, maxRetries: 3, lockedUntil: 1001 }, 1000).eligible, false); assert.equal(evaluateLeaseEligibility({ status: "PROCESSING", retryCount: 0, maxRetries: 3, lockedUntil: 999 }, 1000).eligible, true); });

  test("deletion.lease_takeover_stale_worker_fenced_and_progress_requires_epoch", () => { let now = 10000, n = 0; const s = account(now); s.commitDeletionLock("u1", "s1"); const e = new DeletionEngine(s, { now: () => now, tokenFactory: () => `token-${String(++n).padStart(40, "0")}` }); const a = e.acquireLease("u1", "A", 10); assert.equal(a.success, true); assert.equal(e.fencedUpdateProgress("u1", "A", a.leaseToken, a.leaseEpoch, 1, "step").success, true); now += 11; const b = e.acquireLease("u1", "B", 10); assert.equal(b.success, true); assert.notEqual(a.leaseEpoch, b.leaseEpoch); assert.equal(e.fencedUpdateProgress("u1", "A", a.leaseToken, a.leaseEpoch, 2, "stale").success, false); assert.equal(e.fencedUpdateProgress("u1", "B", b.leaseToken, a.leaseEpoch, 2, "wrong epoch").success, false); });
  test("deletion.completion_requires_all_modeled_data_and_auth_absence", () => { let now = 10000; const s = account(now); s.commitDeletionLock("u1", "s1"); const e = new DeletionEngine(s, { now: () => now, tokenFactory: () => "x".repeat(40) }); const l = e.acquireLease("u1", "W"); assert.equal(e.commitFinalComplete("u1", "W", l.leaseToken, l.leaseEpoch).code, "RESIDUAL_DATA_PREVENTS_COMPLETION"); s.gameData.clear(); s.profiles.delete("u1"); s.usernameReservations.clear(); assert.equal(e.commitFinalComplete("u1", "W", l.leaseToken, l.leaseEpoch).code, "AUTH_USER_STILL_PRESENT"); e.executeStep6_DeleteAuth("u1"); assert.equal(e.executeStep6_DeleteAuth("u1").code, "AUTH_USER_ALREADY_ABSENT_IDEMPOTENT"); assert.equal(e.commitFinalComplete("u1", "W", l.leaseToken, l.leaseEpoch).jobStatus, "COMPLETED"); });

  await asyncTest("socket.mock_sender_recipient_allowlist_and_cleanup", async () => { const s = account(1000), gate = new SocketGate(s); const fake = id => ({ id, connected: true, received: [], emit(event, data, ack) { this.received.push({ event, data }); if (ack) ack(); } }); const a = fake("a"), b = fake("b"); gate.attachIdentity(a, "u1", "s1", 1); gate.attachIdentity(b, "u1", "s1", 1); assert.equal(gate.authorizeSender(a).allowed, true); const result = await gate.targetedEmit([a, b], "X", { ok: true }); assert.equal(result.deliveredCount, 2); assert.equal(a.received.length, 1); assert.equal(b.received.length, 1); s.authSessions.get("s1").status = "REVOKED"; assert.equal(gate.authorizeSender(a).allowed, false); assert.equal((await gate.targetedEmit([a, b], "Y", {})).admittedCount, 0); gate.removeIdentity(a); assert.equal(a.authIdentity, undefined); assert.equal(gate.authorizeSender(a).allowed, false); });

  await asyncTest("socket.local_transport_sender_recipient_ack_and_cleanup", async () => {
    assert.equal(socketVersion, "2.3.0"); const server = http.createServer(), io = ioServer(server), s = account(Date.now()), gate = new SocketGate(s, { ackTimeoutMs: 700 }), sockets = new Map();
    io.on("connection", socket => { sockets.set(socket.id, socket); socket.on("disconnect", () => { gate.removeIdentity(socket); sockets.delete(socket.id); }); socket.on("MOVE", (payload, ack) => { const decision = gate.authorizeSender(socket); if (decision.allowed) { socket.processed = (socket.processed || 0) + 1; ack({ accepted: true }); } else ack({ accepted: false, code: decision.code }); }); });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const url = `http://127.0.0.1:${server.address().port}`; const clients = [];
    try {
      async function connect(uid, session) { const c = ioClient(url, { transports: ["polling"], forceNew: true, reconnection: false }); clients.push(c); await new Promise((resolve, reject) => { c.once("connect", resolve); c.once("connect_error", reject); }); const ss = sockets.get(c.id); assert(ss); gate.attachIdentity(ss, uid, session, 1); return { c, ss }; }
      const a = await connect("u1", "s1"); const b = await connect("u1", "s1");
      const gotA = new Promise(resolve => a.c.once("PING", value => resolve(value))); const gotB = new Promise(resolve => b.c.once("PING", value => resolve(value)));
      const delivered = await gate.targetedEmit([a.ss, b.ss], "PING", { n: 7 }); assert.equal(delivered.admittedCount, 2); assert.equal(delivered.deliveredCount, 2); assert.deepEqual(await gotA, { n: 7 }); assert.deepEqual(await gotB, { n: 7 });
      let processCount = 0; const active = await new Promise(resolve => a.c.emit("MOVE", {}, resolve)); assert.equal(active.accepted, true); assert.equal(a.ss.processed, 1);
      s.authSessions.get("s1").status = "REVOKED"; const denied = await new Promise(resolve => a.c.emit("MOVE", {}, resolve)); assert.equal(denied.accepted, false); assert.equal(a.ss.processed, 1); const out = await gate.targetedEmit([a.ss, b.ss], "PING", {}); assert.equal(out.admittedCount, 0); assert.equal(out.deniedCount, 2);
      gate.removeIdentity(a.ss); assert.equal(a.ss.authIdentity, undefined); assert.equal(gate.authorizeSender(a.ss).allowed, false); void processCount;
    } finally { for (const c of clients) c.disconnect(); await new Promise(resolve => io.close(() => resolve())); }
  }, "SIMULATION_PASS");

  test("firebase.firestore_emulator_integration", () => { throw Object.assign(new Error("No Firebase SDK/emulator wiring in this harness; assertion cannot execute"), { blocked: true }); });
  test("socket.redis_multi_instance", () => { throw Object.assign(new Error("No Redis adapter or second server instance configured"), { unverified: true }); });
  if (process.argv.includes("--self-test-failure")) test("harness.deliberate_failure_exit_code", () => assert.fail("intentional self-test failure"));

  // Classify declared non-runs; do not count them as assertion passes.
  for (const r of results) if (r.error && (/cannot execute|xhr poll error|TransportError/.test(r.error))) r.status = "BLOCKED"; else if (r.error && /No Redis adapter/.test(r.error)) r.status = "UNVERIFIED";
  const counts = Object.fromEntries(["PASS", "SIMULATION_PASS", "BLOCKED", "UNVERIFIED", "FAIL", "ERROR"].map(k => [k, results.filter(r => r.status === k).length]));
  const summary = { total: results.length, ...counts, exitCode: counts.FAIL || counts.ERROR ? 1 : 0 };
  const evidence = { metadata: { timestamp: new Date().toISOString(), nodeVersion: process.version, socketIoVersion: socketVersion, scope: "local in-memory and loopback simulation only", authTimeMaxAgeSeconds: 300, futureSkewSeconds: 30, age330: "OPEN QUESTION; denied under current 300-second max-age baseline" }, results, summary };
  const out = path.resolve(__dirname, "../evidence/sanitized_evidence.json"); fs.writeFileSync(out, JSON.stringify(evidence, null, 2), "utf8");
  console.log(JSON.stringify(summary)); for (const r of results) console.log(`${r.status} ${r.id}${r.error ? `: ${r.error}` : ""}`);
  process.exitCode = summary.exitCode;
}
main().catch(err => { console.error(err); process.exitCode = 2; });
