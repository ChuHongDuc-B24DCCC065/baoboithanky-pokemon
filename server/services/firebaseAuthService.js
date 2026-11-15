const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const {
    getAuth,
    validateEmulatorEndpoint,
    resolveFirebaseEnvironment
} = require("../config/firebase");

const SYNTHETIC_DOMAIN = "player.poke-engine.internal";
const SYNTHETIC_EMAIL_REGEX = /^[a-zA-Z0-9_]{3,20}@player\.poke-engine\.internal$/;
const IDEMPOTENCY_KEY_REGEX = /^[a-zA-Z0-9_-]{16,64}$/;

/**
 * Chuẩn hóa username theo quy tắc trò chơi
 * @param {string} username
 * @returns {string}
 */
function normalizeUsername(username) {
    if (!username || typeof username !== "string") {
        throw new Error("[Auth Service] Username must be a non-empty string.");
    }
    return username.trim().toLowerCase();
}

/**
 * Tạo synthetic internal email mapping từ username
 * @param {string} normalizedUsername
 * @returns {string}
 */
function getSyntheticEmail(normalizedUsername) {
    const cleanUsername = normalizeUsername(normalizedUsername);
    return `${cleanUsername}@${SYNTHETIC_DOMAIN}`;
}

/**
 * Kiểm tra tính hợp lệ của synthetic internal email
 * @param {string} email
 * @returns {boolean}
 */
function isSyntheticEmail(email) {
    if (!email || typeof email !== "string") return false;
    return SYNTHETIC_EMAIL_REGEX.test(email.trim().toLowerCase());
}

/**
 * Kiểm tra tính hợp lệ của Idempotency Key (UUID v4 hoặc chuỗi URL-safe 16-64 ký tự)
 * @param {string} key
 * @returns {boolean}
 */
function validateIdempotencyKey(key) {
    if (!key || typeof key !== "string") return false;
    return IDEMPOTENCY_KEY_REGEX.test(key.trim());
}

/**
 * Lấy bí mật băm Idempotency Payload Fingerprint từ biến môi trường
 * Nguyên tắc Fail-Closed: Thiếu hoặc quá ngắn là dừng ngay lập tức.
 * @returns {string}
 */
function getIdempotencySecret() {
    const secret = process.env.IDEMPOTENCY_SECRET;
    if (!secret || typeof secret !== "string" || secret.trim().length < 32) {
        throw new Error(
            "[Idempotency Config Error] IDEMPOTENCY_SECRET environment variable is missing or too short (minimum 32 characters / 256-bit entropy required). Fail-closed."
        );
    }
    return secret.trim();
}

/**
 * Tính toán Keyed HMAC-SHA256 Fingerprint cho payload đăng ký
 * @param {string} normalizedUsername
 * @param {string} password
 * @param {string} character
 * @returns {string} Hex HMAC digest
 */
function calculatePayloadFingerprint(normalizedUsername, password, character) {
    const secret = getIdempotencySecret();
    const cleanUsername = normalizeUsername(normalizedUsername);
    const cleanChar = (character || "red").trim().toLowerCase();
    const payload = `${cleanUsername}:${password}:${cleanChar}`;

    return crypto
        .createHmac("sha256", secret)
        .update(payload)
        .digest("hex");
}

/**
 * Helper thực hiện HTTP/HTTPS request thuần túy (không cài thêm axios/node-fetch)
 * @param {string} urlString
 * @param {Object} options
 * @param {string} [bodyData]
 * @returns {Promise<{ statusCode: number, headers: Object, data: any }>}
 */
function executeHttpRequest(urlString, options = {}, bodyData = null) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(urlString);
        const isHttps = parsedUrl.protocol === "https:";
        const client = isHttps ? https : http;

        const reqOptions = {
            protocol: parsedUrl.protocol,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (isHttps ? 443 : 80),
            path: `${parsedUrl.pathname}${parsedUrl.search}`,
            method: options.method || "GET",
            headers: options.headers || {},
            timeout: options.timeout || 15000
        };

        if (bodyData && !reqOptions.headers["Content-Length"]) {
            reqOptions.headers["Content-Length"] = Buffer.byteLength(bodyData);
        }

        const req = client.request(reqOptions, (res) => {
            let chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                const rawBody = Buffer.concat(chunks).toString("utf8");
                let parsedJson = null;
                try {
                    parsedJson = JSON.parse(rawBody);
                } catch {
                    parsedJson = rawBody;
                }
                resolve({
                    statusCode: res.statusCode || 200,
                    headers: res.headers,
                    data: parsedJson
                });
            });
        });

        req.on("error", (err) => reject(err));
        req.on("timeout", () => {
            req.destroy(new Error(`[HTTP Request Timeout] Request to ${urlString} timed out.`));
        });

        if (bodyData) {
            req.write(bodyData);
        }
        req.end();
    });
}

/**
 * Đăng nhập bằng email nội bộ và mật khẩu thông qua Firebase Auth REST API
 * (accounts:signInWithPassword)
 * @param {string} email - Synthetic email
 * @param {string} password - Mật khẩu người chơi
 * @returns {Promise<{ idToken: string, localId: string, refreshToken: string, expiresIn: string }>}
 */
async function signInWithPasswordREST(email, password) {
    const envConfig = resolveFirebaseEnvironment();
    let endpointUrl = "";

    if (envConfig.isEmulator) {
        // Emulator mode: bắt buộc validate host loopback
        const authHost = validateEmulatorEndpoint(envConfig.authHost, "Auth");
        endpointUrl = `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`;
    } else {
        // Production mode: bắt buộc có Web API Key
        const apiKey = process.env.FIREBASE_WEB_API_KEY;
        if (!apiKey || typeof apiKey !== "string" || apiKey.trim() === "") {
            throw new Error(
                "[Firebase Auth REST Error] FIREBASE_WEB_API_KEY is missing in production environment. Fail-closed."
            );
        }
        endpointUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey.trim())}`;
    }

    const payload = JSON.stringify({
        email: email.trim().toLowerCase(),
        password: password,
        returnSecureToken: true
    });

    let res = null;
    try {
        res = await executeHttpRequest(endpointUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            timeout: 15000
        }, payload);
    } catch (netErr) {
        throw new Error(`[Firebase Auth REST Connection Error]: ${netErr.message}`);
    }

    if (res.statusCode !== 200) {
        const errorData = res.data && res.data.error ? res.data.error : {};
        const errorMessage = errorData.message || "UNKNOWN_ERROR";

        if (
            errorMessage === "EMAIL_NOT_FOUND" ||
            errorMessage === "INVALID_PASSWORD" ||
            errorMessage === "INVALID_LOGIN_CREDENTIALS"
        ) {
            const err = new Error("Tên đăng nhập hoặc mật khẩu không chính xác.");
            err.code = "INVALID_CREDENTIALS";
            err.statusCode = 401;
            throw err;
        }

        if (errorMessage === "USER_DISABLED") {
            const err = new Error("Tài khoản đã bị vô hiệu hóa.");
            err.code = "ACCOUNT_DISABLED";
            err.statusCode = 403;
            throw err;
        }

        const err = new Error(`Firebase Auth REST Error: ${errorMessage}`);
        err.code = "FIREBASE_AUTH_ERROR";
        err.statusCode = res.statusCode;
        throw err;
    }

    return {
        idToken: res.data.idToken,
        localId: res.data.localId,
        refreshToken: res.data.refreshToken,
        expiresIn: res.data.expiresIn
    };
}

/**
 * Firebase Admin SDK: Tạo tài khoản người dùng
 * @param {string} syntheticEmail
 * @param {string} password
 * @param {string} displayName
 * @returns {Promise<import("firebase-admin/auth").UserRecord>}
 */
async function createUser(syntheticEmail, password, displayName) {
    const adminAuth = getAuth();
    return adminAuth.createUser({
        email: syntheticEmail,
        password: password,
        displayName: displayName
    });
}

/**
 * Firebase Admin SDK: Xóa tài khoản bồi hoàn
 * NGUYÊN TẮC BẢO MẬT: BẮT BUỘC CHỈ NHẬN targetUid (chuỗi UID), TUYỆT ĐỐI KHÔNG XÓA THEO EMAIL/USERNAME.
 * @param {string} targetUid - Firebase User UID
 * @returns {Promise<void>}
 */
async function deleteUser(targetUid) {
    if (!targetUid || typeof targetUid !== "string" || targetUid.trim() === "") {
        throw new Error("[Auth Service Security] deleteUser requires a valid targetUid string.");
    }
    const adminAuth = getAuth();
    return adminAuth.deleteUser(targetUid.trim());
}

/**
 * Firebase Admin SDK: Tìm kiếm user theo synthetic email
 * @param {string} syntheticEmail
 * @returns {Promise<import("firebase-admin/auth").UserRecord>}
 */
async function getUserByEmail(syntheticEmail) {
    const adminAuth = getAuth();
    return adminAuth.getUserByEmail(syntheticEmail.trim().toLowerCase());
}

/**
 * Firebase Admin SDK: Lấy user record theo UID
 * @param {string} uid
 * @returns {Promise<import("firebase-admin/auth").UserRecord>}
 */
async function getUser(uid) {
    const adminAuth = getAuth();
    return adminAuth.getUser(uid.trim());
}

/**
 * Firebase Admin SDK: Cấp phát Session Cookie
 * @param {string} idToken
 * @param {number} expiresInMs
 * @returns {Promise<string>}
 */
async function createSessionCookie(idToken, expiresInMs = 14 * 24 * 60 * 60 * 1000) {
    const adminAuth = getAuth();
    return adminAuth.createSessionCookie(idToken, { expiresIn: expiresInMs });
}

/**
 * Firebase Admin SDK: Xác minh Session Cookie với kiểm tra thu hồi (checkRevoked = true)
 * @param {string} sessionCookie
 * @param {boolean} [checkRevoked=true]
 * @returns {Promise<import("firebase-admin/auth").DecodedIdToken>}
 */
async function verifySessionCookie(sessionCookie, checkRevoked = true) {
    const adminAuth = getAuth();
    return adminAuth.verifySessionCookie(sessionCookie, checkRevoked);
}

/**
 * Firebase Admin SDK: Thu hồi toàn bộ refresh tokens của một UID
 * @param {string} uid
 * @returns {Promise<void>}
 */
async function revokeRefreshTokens(uid) {
    if (!uid || typeof uid !== "string") {
        throw new Error("[Auth Service] revokeRefreshTokens requires a valid uid.");
    }
    const adminAuth = getAuth();
    return adminAuth.revokeRefreshTokens(uid.trim());
}

module.exports = {
    SYNTHETIC_DOMAIN,
    SYNTHETIC_EMAIL_REGEX,
    IDEMPOTENCY_KEY_REGEX,
    normalizeUsername,
    getSyntheticEmail,
    isSyntheticEmail,
    validateIdempotencyKey,
    getIdempotencySecret,
    calculatePayloadFingerprint,
    executeHttpRequest,
    signInWithPasswordREST,
    createUser,
    deleteUser,
    getUserByEmail,
    getUser,
    createSessionCookie,
    verifySessionCookie,
    revokeRefreshTokens
};
