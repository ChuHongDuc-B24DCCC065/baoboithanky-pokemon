const crypto = require("crypto");

/**
 * THỜI HẠN HIỆU LỰC CỦA CSRF TOKEN: 24 GIỜ
 */
const CSRF_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CSRF_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000; // 5 phút dung sai lệch đồng hồ

/**
 * Lấy CSRF Secret từ biến môi trường.
 * Nguyên tắc Fail-Closed: Nếu secret bị thiếu hoặc quá ngắn, ném lỗi dừng hoạt động ngay lập tức.
 * @returns {string}
 */
function getCsrfSecret() {
    const secret = process.env.CSRF_SECRET;
    if (!secret || typeof secret !== "string" || secret.trim().length < 32) {
        throw new Error(
            "[CSRF Config Error] CSRF_SECRET environment variable is missing or too short (minimum 32 characters / 256-bit entropy required). Fail-closed."
        );
    }
    return secret.trim();
}

/**
 * Trích xuất cookie từ request headers (không phụ thuộc cookie-parser)
 * @param {import("express").Request} req
 * @param {string} cookieName
 * @returns {string|null}
 */
function extractCookie(req, cookieName) {
    if (req.cookies && req.cookies[cookieName]) {
        return req.cookies[cookieName];
    }
    const cookieHeader = req.headers && req.headers.cookie;
    if (!cookieHeader || typeof cookieHeader !== "string") {
        return null;
    }
    const pairs = cookieHeader.split(";");
    for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i].trim();
        const eqIdx = pair.indexOf("=");
        if (eqIdx > 0) {
            const key = pair.substring(0, eqIdx).trim();
            if (key === cookieName) {
                return decodeURIComponent(pair.substring(eqIdx + 1).trim());
            }
        }
    }
    return null;
}

/**
 * Tạo chữ ký HMAC-SHA256 cho payload CSRF
 * @param {string} nonce
 * @param {string|number} timestamp
 * @param {string} scope
 * @returns {string} Hex signature
 */
function computeSignature(nonce, timestamp, scope) {
    const secret = getCsrfSecret();
    return crypto
        .createHmac("sha256", secret)
        .update(`${nonce}:${timestamp}:${scope}`)
        .digest("hex");
}

/**
 * Sinh CSRF Token có chữ ký mật mã
 * Cấu trúc: `${nonce}.${timestamp}.${scope}.${signature}`
 * @param {string} [scope="anon"] - "anon" hoặc user UID
 * @returns {string}
 */
function generateCsrfToken(scope = "anon") {
    const safeScope = (scope && typeof scope === "string") ? scope.trim() : "anon";
    const nonce = crypto.randomBytes(16).toString("hex");
    const timestamp = Date.now().toString();
    const signature = computeSignature(nonce, timestamp, safeScope);
    return `${nonce}.${timestamp}.${safeScope}.${signature}`;
}

/**
 * Thiết lập cookie poke.csrf lên response
 * @param {import("express").Response} res
 * @param {string} token
 */
function setCsrfCookie(res, token) {
    res.cookie("poke.csrf", token, {
        httpOnly: false, // Phải là false để JavaScript frontend có thể đọc và gửi vào x-csrf-token header
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: CSRF_TOKEN_MAX_AGE_MS
    });
}

/**
 * Xác minh tính hợp lệ của CSRF Token
 * @param {string} token - Chuỗi token định dạng `${nonce}.${timestamp}.${scope}.${signature}`
 * @param {string} expectedScope - "anon" hoặc user UID
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyCsrfToken(token, expectedScope) {
    if (!token || typeof token !== "string") {
        return { valid: false, reason: "CSRF token is empty or invalid format." };
    }

    const parts = token.split(".");
    if (parts.length !== 4) {
        return { valid: false, reason: "CSRF token structure is malformed." };
    }

    const [nonce, timestampStr, scope, signature] = parts;

    // 1. Kiểm tra nonce
    if (!nonce || nonce.length !== 32) {
        return { valid: false, reason: "Invalid nonce in CSRF token." };
    }

    // 2. Kiểm tra timestamp & hạn sử dụng
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
        return { valid: false, reason: "Invalid timestamp in CSRF token." };
    }

    const now = Date.now();
    if (timestamp > now + CSRF_CLOCK_SKEW_TOLERANCE_MS) {
        return { valid: false, reason: "CSRF token timestamp is in the future." };
    }
    if (now - timestamp > CSRF_TOKEN_MAX_AGE_MS) {
        return { valid: false, reason: "CSRF token has expired." };
    }

    // 3. Kiểm tra Scope (Session-Binding Check)
    const normalizedExpectedScope = (expectedScope && typeof expectedScope === "string")
        ? expectedScope.trim()
        : "anon";
    if (scope !== normalizedExpectedScope) {
        return { valid: false, reason: `CSRF scope mismatch: expected "${normalizedExpectedScope}", got "${scope}".` };
    }

    // 4. So khớp chữ ký HMAC bằng timingSafeEqual chống tấn công Timing Attack
    const expectedSignature = computeSignature(nonce, timestampStr, scope);
    const sigBuf = Buffer.from(signature, "hex");
    const expBuf = Buffer.from(expectedSignature, "hex");

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return { valid: false, reason: "CSRF HMAC signature mismatch." };
    }

    return { valid: true };
}

/**
 * Lấy danh sách allowed origins cho việc kiểm tra Origin / Referer
 * @param {import("express").Request} req
 * @returns {Set<string>}
 */
function getAllowedOrigins(req) {
    const allowed = new Set([
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://localhost:3000",
        "https://127.0.0.1:3000"
    ]);

    if (process.env.ALLOWED_ORIGINS) {
        process.env.ALLOWED_ORIGINS.split(",")
            .map(s => s.trim())
            .filter(Boolean)
            .forEach(origin => allowed.add(origin));
    }

    return allowed;
}

/**
 * Kiểm tra Origin / Referer header (Lớp 1 của CSRF Defense)
 * @param {import("express").Request} req
 * @returns {boolean}
 */
function validateRequestOrigin(req) {
    const originHeader = req.headers && req.headers.origin;
    const refererHeader = req.headers && req.headers.referer;
    const allowedOrigins = getAllowedOrigins(req);

    if (originHeader) {
        try {
            const parsedOrigin = new URL(originHeader).origin;
            return allowedOrigins.has(parsedOrigin);
        } catch {
            return false;
        }
    }

    if (refererHeader) {
        try {
            const parsedReferer = new URL(refererHeader).origin;
            return allowedOrigins.has(parsedReferer);
        } catch {
            return false;
        }
    }

    // Nếu không có cả Origin lẫn Referer trên request POST state-changing
    return false;
}

/**
 * Middleware Double-Submit Cookie CSRF Protection
 * Áp dụng cho các HTTP methods làm thay đổi trạng thái (POST, PUT, DELETE, PATCH).
 */
function csrfProtection(req, res, next) {
    // 1. Bỏ qua các safe methods
    const method = req.method ? req.method.toUpperCase() : "GET";
    if (["GET", "HEAD", "OPTIONS"].includes(method)) {
        return next();
    }

    // 2. Lớp 1: Kiểm tra Sec-Fetch-Site nếu trình duyệt gửi lên
    const secFetchSite = req.headers && req.headers["sec-fetch-site"];
    if (secFetchSite === "cross-site") {
        return res.status(403).json({
            success: false,
            message: "Yêu cầu bị từ chối do nguồn gốc chéo trang (Cross-site request blocked).",
            code: "CSRF_ORIGIN_INVALID"
        });
    }

    // 3. Lớp 1: Kiểm tra Origin / Referer
    if (!validateRequestOrigin(req)) {
        return res.status(403).json({
            success: false,
            message: "Yêu cầu bị từ chối do nguồn gốc không hợp lệ hoặc thiếu Origin/Referer header.",
            code: "CSRF_ORIGIN_INVALID"
        });
    }

    // 4. Lớp 2: Kiểm tra Double-Submit Cookie & Header
    const headerToken = req.headers && (req.headers["x-csrf-token"] || req.headers["x-xsrf-token"]);
    const cookieToken = extractCookie(req, "poke.csrf");

    if (!headerToken || typeof headerToken !== "string" || !cookieToken || typeof cookieToken !== "string") {
        return res.status(403).json({
            success: false,
            message: "CSRF token bị thiếu trong header x-csrf-token hoặc cookie poke.csrf.",
            code: "CSRF_TOKEN_INVALID"
        });
    }

    // Double-submit token check: cả hai phải khớp nhau từng ký tự
    if (headerToken.trim() !== cookieToken.trim()) {
        return res.status(403).json({
            success: false,
            message: "CSRF token trong header không khớp với cookie poke.csrf.",
            code: "CSRF_TOKEN_INVALID"
        });
    }

    // Xác định expected scope dựa trên trạng thái xác thực hiện thời của request
    let expectedScope = "anon";
    if (req.user && (req.user.uid || req.user.id)) {
        expectedScope = (req.user.uid || req.user.id).toString();
    }

    // 5. Kiểm tra chữ ký HMAC và Session-Binding
    let verification = verifyCsrfToken(headerToken.trim(), expectedScope);

    // Cho phép fallback kiểm tra scope "anon" nếu route là login hoặc register
    // (khi người dùng gửi form đăng nhập từ trạng thái guest)
    if (!verification.valid && expectedScope !== "anon") {
        const path = req.baseUrl + (req.path || "");
        if (path.includes("/login") || path.includes("/register")) {
            verification = verifyCsrfToken(headerToken.trim(), "anon");
        }
    }

    if (!verification.valid) {
        return res.status(403).json({
            success: false,
            message: `CSRF token không hợp lệ: ${verification.reason}`,
            code: "CSRF_TOKEN_INVALID"
        });
    }

    return next();
}

/**
 * Middleware tự động gắn hoặc làm mới cookie poke.csrf cho các GET request
 */
function ensureCsrfCookie(req, res, next) {
    // Nếu gặp sự cố hạ tầng kết nối Firebase (mạng/timeout), bảo toàn cookie hiện có, không đè thành anon
    if (req.authFailure && req.authFailure.type === "INFRASTRUCTURE_ERROR") {
        return next();
    }

    const existingToken = extractCookie(req, "poke.csrf");
    let scope = "anon";
    if (req.user && (req.user.uid || req.user.id)) {
        scope = (req.user.uid || req.user.id).toString();
    }

    if (!existingToken) {
        const token = generateCsrfToken(scope);
        setCsrfCookie(res, token);
    } else {
        const verification = verifyCsrfToken(existingToken, scope);
        if (!verification.valid) {
            const freshToken = generateCsrfToken(scope);
            setCsrfCookie(res, freshToken);
        }
    }

    return next();
}

module.exports = {
    getCsrfSecret,
    generateCsrfToken,
    setCsrfCookie,
    verifyCsrfToken,
    validateRequestOrigin,
    csrfProtection,
    ensureCsrfCookie,
    extractCookie
};
