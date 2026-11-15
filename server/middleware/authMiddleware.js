const { getFirestore } = require("../config/firebase");
const { verifySessionCookie } = require("../services/firebaseAuthService");
const { extractCookie, validateRequestOrigin } = require("./csrfMiddleware");

/**
 * Phân biệt request từ API hay từ trình duyệt điều hướng trang
 * @param {import("express").Request} req
 * @returns {boolean}
 */
const isApiRequest = (req) => {
    const url = req.originalUrl || req.path || "";
    return Boolean(
        url.startsWith("/api/") ||
        req.path.startsWith("/api/") ||
        req.xhr ||
        (req.headers.accept && req.headers.accept.includes("application/json"))
    );
};

/**
 * Middleware yêu cầu người dùng phải đăng nhập và tài khoản đang hoạt động
 * Ưu tiên xác thực Firebase Session Cookie (poke.sid) với checkRevoked=true,
 * và fallback sang MongoDB session trong giai đoạn chuyển đổi.
 */
const requireAuth = async (req, res, next) => {
    try {
        const sessionCookie = extractCookie(req, "poke.sid");

        // 1. ƯU TIÊN SỐ 1: Xác thực Firebase Session Cookie
        if (sessionCookie) {
            try {
                const decoded = await verifySessionCookie(sessionCookie, true);
                const db = getFirestore();
                const userDoc = await db.collection("users").doc(decoded.uid).get();

                if (!userDoc.exists) {
                    res.clearCookie("poke.sid", { path: "/" });
                    if (isApiRequest(req)) {
                        return res.status(401).json({
                            success: false,
                            message: "Tài khoản không tồn tại trên hệ thống.",
                            code: "UNAUTHORIZED"
                        });
                    }
                    return res.redirect("/login");
                }

                const userData = userDoc.data() || {};
                if (userData.isActive === false) {
                    res.clearCookie("poke.sid", { path: "/" });
                    if (isApiRequest(req)) {
                        return res.status(401).json({
                            success: false,
                            message: "Tài khoản của bạn đã bị vô hiệu hóa.",
                            code: "UNAUTHORIZED"
                        });
                    }
                    return res.redirect("/login");
                }

                // Gắn user profile vào req.user
                req.user = {
                    uid: decoded.uid,
                    id: decoded.uid,
                    username: userData.username,
                    character: userData.character || "red",
                    isActive: userData.isActive !== false,
                    createdAt: userData.createdAt || null
                };

                return next();
            } catch (firebaseErr) {
                // Cookie bị thu hồi hoặc không hợp lệ -> xóa cookie và từ chối
                res.clearCookie("poke.sid", { path: "/" });
                if (isApiRequest(req)) {
                    return res.status(401).json({
                        success: false,
                        message: "Phiên đăng nhập đã hết hạn hoặc bị thu hồi.",
                        code: "UNAUTHORIZED"
                    });
                }
                return res.redirect("/login");
            }
        }

        // 2. Không có session hợp lệ
        if (isApiRequest(req)) {
            return res.status(401).json({
                success: false,
                message: "Bạn cần đăng nhập để tiếp tục.",
                code: "UNAUTHORIZED"
            });
        }
        return res.redirect("/login");
    } catch (err) {
        console.error("[Auth Middleware Error]:", err.message);
        if (isApiRequest(req)) {
            return res.status(500).json({
                success: false,
                message: "Lỗi hệ thống khi xác thực tài khoản.",
                code: "INTERNAL_ERROR"
            });
        }
        return res.status(500).send("Lỗi hệ thống khi xác thực tài khoản.");
    }
};

/**
 * Middleware chỉ cho phép khách (chưa đăng nhập) truy cập trang Login/Register
 */
const requireGuest = async (req, res, next) => {
    try {
        const sessionCookie = extractCookie(req, "poke.sid");

        if (sessionCookie) {
            try {
                const decoded = await verifySessionCookie(sessionCookie, true);
                const db = getFirestore();
                const userDoc = await db.collection("users").doc(decoded.uid).get();

                if (userDoc.exists && userDoc.data().isActive !== false) {
                    if (isApiRequest(req)) {
                        return res.status(400).json({
                            success: false,
                            message: "Bạn đã đăng nhập rồi.",
                            code: "ALREADY_AUTHENTICATED"
                        });
                    }
                    return res.redirect("/");
                }
            } catch {
                res.clearCookie("poke.sid", { path: "/" });
            }
        }

        return next();
    } catch (err) {
        console.error("[Guest Middleware Error]:", err.message);
        return next();
    }
};

/**
 * Middleware kiểm tra tính hợp lệ của Origin đối với các API thay đổi dữ liệu
 */
const validateOrigin = (req, res, next) => {
    const secFetchSite = req.headers && req.headers["sec-fetch-site"];
    if (secFetchSite === "cross-site") {
        return res.status(403).json({
            success: false,
            message: "Yêu cầu bị từ chối do nguồn gốc chéo trang (Cross-site request blocked).",
            code: "INVALID_ORIGIN"
        });
    }

    if (!validateRequestOrigin(req)) {
        return res.status(403).json({
            success: false,
            message: "Yêu cầu bị từ chối do nguồn gốc không hợp lệ (Origin mismatch).",
            code: "INVALID_ORIGIN"
        });
    }

    return next();
};

module.exports = {
    requireAuth,
    requireGuest,
    validateOrigin,
    isApiRequest
};
