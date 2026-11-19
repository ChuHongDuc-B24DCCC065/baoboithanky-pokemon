/** Deletion and lease simulator. All state is in-memory; no Firebase/Auth calls. */
const crypto = require("crypto");
const { evaluateLeaseEligibility } = require("./time_validator");
class DeletionEngine {
  constructor(authorityStore, { now = () => Date.now(), tokenFactory = () => crypto.randomBytes(24).toString("hex"), leaseEpochFactory = null } = {}) {
    this.authorityStore = authorityStore; this.now = now; this.tokenFactory = tokenFactory; this.externalAuthDeleted = new Set();
  }
  acquireLease(uid, workerId, leaseDurationMs = 60000) {
    const job = this.authorityStore.deletionJobs.get(uid), control = this.authorityStore.accountControls.get(uid), now = this.now();
    if (!job) return { success: false, code: "JOB_NOT_FOUND" };
    if (!control || control.status !== "DELETING") return { success: false, code: "ACCOUNT_NOT_DELETING" };
    if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0 || !workerId) return { success: false, code: "INVALID_LEASE_REQUEST" };
    const eligibility = evaluateLeaseEligibility(job, now);
    if (!eligibility.eligible) return { success: false, code: eligibility.code };
    const leaseToken = this.tokenFactory();
    if (typeof leaseToken !== "string" || leaseToken.length < 32) return { success: false, code: "INVALID_LEASE_TOKEN" };
    // Sequential simulation only. A Firestore implementation must transactionally increment epoch.
    job.leaseEpoch = Number.isInteger(job.leaseEpoch) ? job.leaseEpoch + 1 : 1;
    job.status = "PROCESSING"; job.lockedBy = workerId; job.leaseToken = leaseToken; job.lockedUntil = now + leaseDurationMs; job.lastHeartbeatAt = now; job.retryCount += 1;
    return { success: true, leaseToken, leaseEpoch: job.leaseEpoch, lockedUntil: job.lockedUntil };
  }
  _ownsLease(job, control, workerId, leaseToken, leaseEpoch) {
    return !!job && !!control && control.status === "DELETING" && job.status === "PROCESSING" && job.lockedBy === workerId && job.leaseToken === leaseToken && Number.isInteger(leaseEpoch) && job.leaseEpoch === leaseEpoch && Number.isFinite(job.lockedUntil) && job.lockedUntil > this.now();
  }
  fencedUpdateProgress(uid, workerId, leaseToken, leaseEpoch, nextStep, stepName) {
    const job = this.authorityStore.deletionJobs.get(uid), control = this.authorityStore.accountControls.get(uid);
    if (!job) return { success: false, code: "JOB_NOT_FOUND" };
    if (!this._ownsLease(job, control, workerId, leaseToken, leaseEpoch)) return { success: false, code: "STALE_WORKER_WRITE_REJECTED" };
    job.currentStep = nextStep; job.stepName = stepName; return { success: true, currentStep: nextStep };
  }
  executeStep6_DeleteAuth(uid) { if (this.externalAuthDeleted.has(uid)) return { success: true, code: "AUTH_USER_ALREADY_ABSENT_IDEMPOTENT" }; this.externalAuthDeleted.add(uid); return { success: true, code: "AUTH_USER_DELETED" }; }
  commitFinalComplete(uid, workerId, leaseToken, leaseEpoch) {
    const job = this.authorityStore.deletionJobs.get(uid), control = this.authorityStore.accountControls.get(uid);
    if (!job || !control) return { success: false, code: "MISSING_DOCUMENTS" };
    if (!this._ownsLease(job, control, workerId, leaseToken, leaseEpoch)) return { success: false, code: "STALE_WORKER_WRITE_REJECTED" };
    const uidPrefix = `${uid}/`;
    if ([...this.authorityStore.gameData.keys()].some(k => k.startsWith(uidPrefix)) || this.authorityStore.profiles.has(uid) || [...this.authorityStore.usernameReservations.values()].some(r => r.ownerUid === uid)) return { success: false, code: "RESIDUAL_DATA_PREVENTS_COMPLETION" };
    if (!this.externalAuthDeleted.has(uid)) return { success: false, code: "AUTH_USER_STILL_PRESENT" };
    // Sequential Map simulation only; not an atomic Firestore transaction.
    job.status = "COMPLETED"; job.stepName = "VERIFY_AND_COMPLETE"; job.completedAt = this.now(); control.status = "DELETED";
    return { success: true, jobStatus: "COMPLETED", controlStatus: "DELETED" };
  }
}
module.exports = { DeletionEngine };
