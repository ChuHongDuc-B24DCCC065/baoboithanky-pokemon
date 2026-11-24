const firebaseConfig = require("../config/firebase");
const firebaseAuthService = require("../services/firebaseAuthService");
const { extractCookie } = require("./csrfMiddleware");

/**
 * Kiểm tra xem lỗi Firebase Auth có phải do phiên làm việc không hợp lệ / hết hạn / bị thu hồi hay không
 * @param {Error} err
 * @returns {boolean}
 */
function isSessionAuthError(err) {
    if (!err) return false;
    const code = err.code || "";
    return (
        code === "auth/session-cookie-revoked" ||
        code === "auth/session-cookie-expired" ||
        code === "auth/argument-error" ||
        code === "auth/invalid-session-cookie"
    );
}

/**
 * Middleware phân quyền Admin (requireAdmin)
 * Bảo vệ các endpoint /api/admin/*:
 * - Kiểm tra Firebase Session Cookie (poke.sid) với checkRevoked=true
 * - Yêu cầu Firebase Custom Claims có admin: true
 * - Kiểm tra document người dùng trong Firestore và trạng thái isActive !== false
 * - Gắn thông tin Admin vào req.adminUser (không ghi đè hoặc can thiệp req.user)
 */
const requireAdmin = async (req, res, next) => {
    try {
        const sessionCookie = extractCookie(req, "poke.sid");

        // 1. Kiểm tra sự tồn tại của Session Cookie
        if (!sessionCookie) {
            return res.status(401).json({
                success: false,
                message: "Bạn cần đăng nhập để tiếp tục.",
                code: "UNAUTHORIZED"
            });
        }

        // 2. Xác thực Session Cookie với Firebase Admin SDK (checkRevoked = true)
        let decoded;
        try {
            decoded = await firebaseAuthService.verifySessionCookie(sessionCookie, true);
        } catch (authErr) {
            // Phân loại lỗi chính xác:
            // Chỉ lỗi session hết hạn, bị thu hồi hoặc sai định dạng mới trả 401.
            // Các lỗi kết nối hoặc lỗi hạ tầng của Firebase Auth phải trả 500.
            if (isSessionAuthError(authErr)) {
                return res.status(401).json({
                    success: false,
                    message: "Phiên đăng nhập không hợp lệ hoặc đã bị thu hồi.",
                    code: "UNAUTHORIZED"
                });
            }

            console.error("[Admin Auth Infrastructure Error]:", authErr.message);
            return res.status(500).json({
                success: false,
                message: "Lỗi hệ thống khi xác thực phiên đăng nhập.",
                code: "INTERNAL_ERROR"
            });
        }

        // 3. Kiểm tra Custom Claim admin: true
        if (decoded.admin !== true) {
            return res.status(403).json({
                success: false,
                message: "Truy cập bị từ chối. Yêu cầu quyền Quản trị viên (Admin).",
                code: "FORBIDDEN"
            });
        }

        // 4. Kiểm tra hồ sơ người dùng trong Firestore users/{uid}
        let userDoc;
        try {
            const db = firebaseConfig.getFirestore();
            userDoc = await db.collection("users").doc(decoded.uid).get();
        } catch (dbErr) {
            // Tuyệt đối không biến lỗi Firestore / hạ tầng mạng thành 401 hoặc 403
            console.error("[Admin Firestore Infrastructure Error]:", dbErr.message);
            return res.status(500).json({
                success: false,
                message: "Lỗi hệ thống khi truy vấn dữ liệu tài khoản quản trị.",
                code: "INTERNAL_ERROR"
            });
        }

        // Nếu không có hồ sơ người dùng trong Firestore
        if (!userDoc.exists) {
            return res.status(403).json({
                success: false,
                message: "Hồ sơ người dùng không tồn tại trên hệ thống.",
                code: "FORBIDDEN"
            });
        }

        const userData = userDoc.data() || {};

        // Nếu tài khoản đã bị vô hiệu hóa
        if (userData.isActive === false) {
            return res.status(403).json({
                success: false,
                message: "Tài khoản của bạn đã bị vô hiệu hóa.",
                code: "FORBIDDEN"
            });
        }

        // 5. Gắn thông tin Admin tối thiểu vào req.adminUser
        // NGUYÊN TẮC: Giữ nguyên req.user hiện tại, không ghi đè; chỉ giữ các trường thực sự cần thiết.
        req.adminUser = {
            uid: decoded.uid,
            username: userData.username || "",
            character: userData.character || "red",
            role: "admin"
        };

        return next();
    } catch (err) {
        console.error("[Admin Middleware Unexpected Error]:", err.message);
        return res.status(500).json({
            success: false,
            message: "Lỗi không xác định khi kiểm tra quyền quản trị.",
            code: "INTERNAL_ERROR"
        });
    }
};

module.exports = {
    requireAdmin,
    isSessionAuthError
};
