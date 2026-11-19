/** In-memory authorization model for the Task 1.3.6L PoC. Not Firestore. */
class AuthorityStore {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.authSessions = new Map();
    this.accountControls = new Map();
    this.deletionJobs = new Map();
    this.profiles = new Map();
    this.gameData = new Map();
    this.usernameReservations = new Map();
  }

  seedAccount(uid, sessionHash, username) {
    const now = this.now();
    this.authSessions.set(sessionHash, { uid, status: "ACTIVE", sessionGeneration: 1, expiresAt: now + 86400000 });
    this.accountControls.set(uid, { status: "ACTIVE", sessionGeneration: 1, globalLogoutPending: false });
    this.profiles.set(uid, { uid, username, status: "ACTIVE" });
    this.gameData.set(`${uid}/main`, { sample: true });
    if (username) this.usernameReservations.set(username.toLowerCase(), { ownerUid: uid, reservedAt: now });
  }

  evaluateAuthorization(uid, sessionHash) {
    const session = this.authSessions.get(sessionHash);
    const control = this.accountControls.get(uid);
    if (!session || session.uid !== uid) return { allowed: false, code: "SESSION_NOT_FOUND_OR_MISMATCH" };
    if (session.status !== "ACTIVE" || !Number.isFinite(session.expiresAt) || session.expiresAt <= this.now()) return { allowed: false, code: "SESSION_REVOKED_OR_EXPIRED" };
    if (!control) return { allowed: false, code: "ACCOUNT_CONTROL_MISSING" };
    if (control.status !== "ACTIVE") return { allowed: false, code: "ACCOUNT_NOT_ACTIVE" };
    if (control.globalLogoutPending === true) return { allowed: false, code: "GLOBAL_LOGOUT_PENDING" };
    if (!Number.isInteger(control.sessionGeneration) || session.sessionGeneration !== control.sessionGeneration) return { allowed: false, code: "GENERATION_MISMATCH" };
    // Any job, including malformed/unknown states, blocks access (fail closed).
    if (this.deletionJobs.has(uid)) return { allowed: false, code: "DELETION_JOB_EXISTS" };
    return { allowed: true, code: "AUTHORIZED" };
  }

  commitDeletionLock(uid, sessionHash) {
    const decision = this.evaluateAuthorization(uid, sessionHash);
    if (!decision.allowed) return { success: false, code: decision.code };
    const control = this.accountControls.get(uid);
    const nextGeneration = control.sessionGeneration + 1;
    // Sequential Map simulation only; this is NOT an atomic Firestore transaction.
    control.status = "DELETING";
    control.sessionGeneration = nextGeneration;
    control.globalLogoutPending = true;
    const profile = this.profiles.get(uid);
    if (profile) profile.status = "DELETING";
    this.deletionJobs.set(uid, { uid, status: "PENDING", retryCount: 0, maxRetries: 5, currentStep: 0 });
    return { success: true, newGeneration: nextGeneration };
  }

  globalLogout(uid) {
    const control = this.accountControls.get(uid);
    if (!control || control.status !== "ACTIVE" || !Number.isInteger(control.sessionGeneration)) return { success: false, code: "ACCOUNT_CONTROL_INVALID" };
    control.sessionGeneration += 1;
    control.globalLogoutPending = true;
    return { success: true, generation: control.sessionGeneration };
  }
}

module.exports = { AuthorityStore };
