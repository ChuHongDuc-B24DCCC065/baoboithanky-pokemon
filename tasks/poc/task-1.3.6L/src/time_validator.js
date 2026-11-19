/** Pure policy checks for the isolated PoC. */
function validateAuthTime(authTimeSeconds, currentServerTimeSeconds, maxAgeSeconds = 300, clockSkewSeconds = 30) {
  if (![authTimeSeconds, currentServerTimeSeconds, maxAgeSeconds, clockSkewSeconds].every(Number.isFinite) || authTimeSeconds <= 0 || currentServerTimeSeconds <= 0 || maxAgeSeconds !== 300 || clockSkewSeconds !== 30) return { valid: false, code: "INVALID_AUTH_TIME_INPUT" };
  if (authTimeSeconds > currentServerTimeSeconds + 30) return { valid: false, code: "AUTH_TIME_IN_FUTURE" };
  if (currentServerTimeSeconds - authTimeSeconds > 300) return { valid: false, code: "RECENT_SIGN_IN_REQUIRED" };
  return { valid: true, code: "VALID" };
}

function evaluateLeaseEligibility(job, currentServerTimeMs) {
  if (!job) return { eligible: false, code: "JOB_NOT_FOUND" };
  if (!Number.isFinite(currentServerTimeMs) || !["PENDING", "PROCESSING"].includes(job.status) || job.reviewRequired === true) return { eligible: false, code: "JOB_INELIGIBLE" };
  if (!Number.isInteger(job.retryCount) || !Number.isInteger(job.maxRetries) || job.retryCount < 0 || job.maxRetries < 1) return { eligible: false, code: "INVALID_RETRY_FIELDS" };
  if (job.retryCount >= job.maxRetries) return { eligible: false, code: "MAX_RETRIES_EXCEEDED" };
  if (job.lockedUntil !== undefined && job.lockedUntil !== null && !Number.isFinite(job.lockedUntil)) return { eligible: false, code: "INVALID_LEASE_EXPIRY" };
  if (job.lockedUntil > currentServerTimeMs) return { eligible: false, code: "LEASE_ACTIVE_UNEXPIRED" };
  return { eligible: true, code: "TAKEOVER_ELIGIBLE" };
}
module.exports = { validateAuthTime, evaluateLeaseEligibility };
