const { getFirestore, FieldValue } = require("../config/firebase");
const {
    normalizeUsername,
    getSyntheticEmail,
    signInWithPasswordREST,
    createSessionCookie,
    verifySessionCookie,
    revokeRefreshTokens
} = require("../services/firebaseAuthService");
const {
    executeRegistration,
    VALID_CHARACTERS
} = require("../services/registrationSagaService");
const {
    generateCsrfToken,
    setCsrfCookie,
    extractCookie
} = require("../middleware/csrfMiddleware");
const { disconnectAllSocketsForUser } = require("../socket/activeSockets");
const worldRegistryService = require("../services/worldRegistryService");

// Map IDs and the default spawn come from the shared World Registry.
const DEFAULT_SPAWN_POSITION = worldRegistryService.getDefaultPosition();
const MAP_WHITELIST = worldRegistryService.getMapIds();
const VALID_FACINGS = ["up", "down", "left", "right"];

/**
 * Controller đăng ký tài khoản người chơi mới theo kiến trúc Durable Saga State Machine
 * POST /api/auth/register
 */
const register = async (req, res, next) => {
    try {
        const { username, password, character, idempotencyKey } = req.body || {};
        const key = req.headers?.["x-idempotency-key"] || idempotencyKey;

        const result = await executeRegistration({
            username,
            password,
            character,
            idempotencyKey: key
        });

        // Xoay vòng CSRF token cho khách
        const freshCsrf = generateCsrfToken("anon");
        setCsrfCookie(res, freshCsrf);

        return res.status(201).json({
            success: true,
            message: "Đăng ký tài khoản thành công. Vui lòng đăng nhập.",
            data: {
                user: {
                    id: result.uid,
                    username: result.username,
                    character: result.character,
                    createdAt: result.createdAt || new Date().toISOString()
                }
            }
        });
    } catch (err) {
        if (err.statusCode && err.statusCode < 500) {
            return res.status(err.statusCode).json({
                success: false,
                message: err.message,
                code: err.code || "REGISTRATION_ERROR"
            });
        }

        console.error("[Register Controller Error]:", err.message);
        return res.status(500).json({
            success: false,
            message: err.message || "Đã xảy ra lỗi hệ thống trong quá trình đăng ký.",
            code: err.code || "INTERNAL_ERROR"
        });
    }
};

/**
 * Controller đăng nhập tài khoản và cấp phát Firebase Session Cookie (poke.sid)
 * POST /api/auth/login
 */
const login = async (req, res, next) => {
    try {
        const { username, password } = req.body || {};

        if (!username || typeof username !== "string" || !password || typeof password !== "string") {
            return res.status(400).json({
                success: false,
                message: "Vui lòng cung cấp đầy đủ tên đăng nhập và mật khẩu.",
                code: "MISSING_FIELDS"
            });
        }

        const cleanUsername = normalizeUsername(username);
        const syntheticEmail = getSyntheticEmail(cleanUsername);

        // 1. Xác thực qua Firebase Auth REST API (signInWithPassword)
        let authResult = null;
        try {
            authResult = await signInWithPasswordREST(syntheticEmail, password);
        } catch (authErr) {
            if (authErr.statusCode && authErr.statusCode < 500) {
                return res.status(authErr.statusCode).json({
                    success: false,
                    message: authErr.message,
                    code: authErr.code || "INVALID_CREDENTIALS"
                });
            }
            throw authErr;
        }

        const { idToken, localId } = authResult;

        // 2. Truy vấn Firestore users/{uid} để kiểm tra trạng thái tài khoản
        const db = getFirestore();
        const userDoc = await db.collection("users").doc(localId).get();

        if (!userDoc.exists) {
            return res.status(401).json({
                success: false,
                message: "Hồ sơ người chơi không tồn tại trên hệ thống.",
                code: "INVALID_CREDENTIALS"
            });
        }

        const userData = userDoc.data() || {};
        if (userData.isActive === false) {
            return res.status(403).json({
                success: false,
                message: "Tài khoản đã bị vô hiệu hóa.",
                code: "ACCOUNT_DISABLED"
            });
        }

        // 3. Cấp phát Firebase Session Cookie (poke.sid) thời hạn 14 ngày
        const sessionCookieMaxAgeMs = 14 * 24 * 60 * 60 * 1000;
        const sessionCookie = await createSessionCookie(idToken, sessionCookieMaxAgeMs);

        res.cookie("poke.sid", sessionCookie, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            maxAge: sessionCookieMaxAgeMs
        });

        // 4. Cơ chế chống CSRF: Xoay vòng CSRF token và ràng buộc danh tính với UID (scope = localId)
        const newCsrfToken = generateCsrfToken(localId);
        setCsrfCookie(res, newCsrfToken);

        const position = (userData.position && Number.isInteger(userData.position.x) && Number.isInteger(userData.position.y))
            ? {
                x: userData.position.x,
                y: userData.position.y,
                map: userData.position.map || DEFAULT_SPAWN_POSITION.map,
                facing: userData.position.facing || DEFAULT_SPAWN_POSITION.facing
            }
            : { ...DEFAULT_SPAWN_POSITION };

        return res.status(200).json({
            success: true,
            message: "Đăng nhập thành công.",
            data: {
                user: {
                    id: localId,
                    username: userData.username || cleanUsername,
                    character: userData.character || "red",
                    position: position,
                    createdAt: userData.createdAt || new Date().toISOString()
                }
            }
        });
    } catch (err) {
        console.error("[Login Controller Error]:", err.message);
        return res.status(500).json({
            success: false,
            message: "Đã xảy ra lỗi hệ thống trong quá trình đăng nhập.",
            code: "INTERNAL_ERROR"
        });
    }
};

/**
 * Controller đăng xuất thiết bị hiện tại (Single-device logout)
 * Không thu hồi refresh tokens trên Firebase Auth
 * POST /api/auth/logout
 */
const logout = (req, res, next) => {
    try {
        res.clearCookie("poke.sid", { path: "/" });

        // Xoay vòng CSRF token trở lại scope "anon"
        const anonCsrf = generateCsrfToken("anon");
        setCsrfCookie(res, anonCsrf);

        return res.status(200).json({
            success: true,
            message: "Đăng xuất thành công."
        });
    } catch (err) {
        console.error("[Logout Controller Error]:", err.message);
        return res.status(500).json({
            success: false,
            message: "Đã xảy ra lỗi hệ thống trong quá trình đăng xuất.",
            code: "INTERNAL_ERROR"
        });
    }
};

/**
 * Controller đăng xuất toàn bộ thiết bị (Logout-all)
 * Thu hồi refresh tokens trên Firebase Auth và cưỡng chế ngắt toàn bộ Socket.IO connections
 * POST /api/auth/logout-all
 */
const logoutAll = async (req, res, next) => {
    try {
        const uid = req.user && (req.user.uid || req.user.id);
        if (!uid) {
            return res.status(401).json({
                success: false,
                message: "Bạn cần đăng nhập để thực hiện hành động này.",
                code: "UNAUTHORIZED"
            });
        }

        // 1. Thu hồi toàn bộ refresh tokens của người dùng trên Firebase Auth
        await revokeRefreshTokens(uid);

        // 2. Cưỡng chế ngắt toàn bộ kết nối vật lý Socket.IO đang mở của người dùng
        const disconnectedCount = disconnectAllSocketsForUser(uid);

        // 3. Xóa session cookie trên thiết bị hiện tại
        res.clearCookie("poke.sid", { path: "/" });

        // 4. Xoay vòng CSRF token trở lại scope "anon"
        const anonCsrf = generateCsrfToken("anon");
        setCsrfCookie(res, anonCsrf);

        return res.status(200).json({
            success: true,
            message: "Đã đăng xuất khỏi tất cả thiết bị.",
            data: {
                disconnectedSockets: disconnectedCount
            }
        });
    } catch (err) {
        console.error("[Logout-All Controller Error]:", err.message);
        return res.status(500).json({
            success: false,
            message: "Đã xảy ra lỗi hệ thống khi đăng xuất khỏi tất cả thiết bị.",
            code: "INTERNAL_ERROR"
        });
    }
};

/**
 * Controller lấy thông tin tài khoản hiện tại từ Session Cookie
 * GET /api/auth/me
 */
const me = async (req, res, next) => {
    try {
        const sessionCookie = extractCookie(req, "poke.sid");

        // Nhánh 1: Xác thực Firebase Session Cookie (Ưu tiên số 1)
        if (sessionCookie) {
            try {
                const decoded = await verifySessionCookie(sessionCookie, true);
                const db = getFirestore();
                const userDoc = await db.collection("users").doc(decoded.uid).get();

                if (!userDoc.exists) {
                    res.clearCookie("poke.sid", { path: "/" });
                    return res.status(401).json({
                        success: false,
                        message: "Tài khoản không tồn tại trên hệ thống.",
                        code: "UNAUTHORIZED"
                    });
                }

                const userData = userDoc.data() || {};
                if (userData.isActive === false) {
                    res.clearCookie("poke.sid", { path: "/" });
                    return res.status(401).json({
                        success: false,
                        message: "Tài khoản của bạn đã bị vô hiệu hóa.",
                        code: "UNAUTHORIZED"
                    });
                }

                const position = (userData.position && Number.isInteger(userData.position.x) && Number.isInteger(userData.position.y))
                    ? {
                        x: userData.position.x,
                        y: userData.position.y,
                        map: userData.position.map || DEFAULT_SPAWN_POSITION.map,
                        facing: userData.position.facing || DEFAULT_SPAWN_POSITION.facing
                    }
                    : { ...DEFAULT_SPAWN_POSITION };

                return res.status(200).json({
                    success: true,
                    data: {
                        user: {
                            id: decoded.uid,
                            username: userData.username,
                            character: userData.character || "red",
                            position: position,
                            createdAt: userData.createdAt || null
                        }
                    }
                });
            } catch (firebaseAuthErr) {
                // Token bị thu hồi (auth/session-cookie-revoked) hoặc hết hạn
                res.clearCookie("poke.sid", { path: "/" });
                return res.status(401).json({
                    success: false,
                    message: "Phiên đăng nhập đã hết hạn hoặc bị thu hồi.",
                    code: "UNAUTHORIZED"
                });
            }
        }

        // Không có session hợp lệ
        return res.status(401).json({
            success: false,
            message: "Phiên đăng nhập đã hết hạn hoặc không tồn tại.",
            code: "UNAUTHORIZED"
        });
    } catch (err) {
        console.error("[Me Controller Error]:", err.message);
        return res.status(500).json({
            success: false,
            message: "Lỗi hệ thống khi lấy thông tin tài khoản.",
            code: "INTERNAL_ERROR"
        });
    }
};

/**
 * Controller lưu vị trí người chơi vào Firestore users/{uid}
 * POST /api/auth/position
 * Yêu cầu: requireAuth (Firebase session) + csrfProtection
 * Ràng buộc bảo mật: Chỉ cập nhật UID của chính phiên đăng nhập hiện tại
 */
const savePosition = async (req, res, next) => {
    try {
        const uid = req.user && (req.user.uid || req.user.id);
        if (!uid) {
            return res.status(401).json({
                success: false,
                message: "Không xác định được danh tính người chơi.",
                code: "UNAUTHORIZED"
            });
        }

        const { x, y, map, facing } = req.body || {};

        // 1. Kiểm tra tọa độ tile trong collision grid của map đã đăng ký
        if (!Number.isInteger(x) || x < 0) {
            return res.status(400).json({
                success: false,
                message: "Tọa độ X không hợp lệ.",
                code: "INVALID_COORDINATES"
            });
        }

        if (!Number.isInteger(y) || y < 0) {
            return res.status(400).json({
                success: false,
                message: "Tọa độ Y không hợp lệ.",
                code: "INVALID_COORDINATES"
            });
        }

        // 2. Kiểm tra tên bản đồ thuộc whitelist hợp lệ
        const selectedMap = (typeof map === "string" && map.trim().length > 0) ? map.trim() : "test";
        if (!MAP_WHITELIST.includes(selectedMap)) {
            return res.status(400).json({
                success: false,
                message: "Bản đồ không hợp lệ trong danh mục trò chơi.",
                code: "INVALID_MAP"
            });
        }

        if (!worldRegistryService.isWalkable(selectedMap, x, y)) {
            return res.status(400).json({
                success: false,
                message: "Vị trí nằm ngoài bản đồ hoặc bị collision chặn.",
                code: "INVALID_POSITION"
            });
        }

        // 3. Kiểm tra hướng nhìn (facing)
        const selectedFacing = (typeof facing === "string" && VALID_FACINGS.includes(facing.trim().toLowerCase()))
            ? facing.trim().toLowerCase()
            : "down";

        const positionData = {
            x: x,
            y: y,
            map: selectedMap,
            facing: selectedFacing
        };

        const db = getFirestore();
        const userRef = db.collection("users").doc(uid);

        // Chỉ cập nhật position và updatedAt cho chính user hiện tại (fencing theo UID của session)
        await userRef.update({
            position: positionData,
            updatedAt: FieldValue.serverTimestamp()
        });

        return res.status(200).json({
            success: true,
            message: "Vị trí người chơi đã được lưu thành công.",
            data: {
                position: positionData
            }
        });
    } catch (err) {
        console.error("[Save Position Controller Error]:", err.message);
        return res.status(500).json({
            success: false,
            message: "Đã xảy ra lỗi hệ thống khi lưu vị trí người chơi.",
            code: "INTERNAL_ERROR"
        });
    }
};

module.exports = {
    register,
    login,
    logout,
    logoutAll,
    me,
    savePosition,
    DEFAULT_SPAWN_POSITION,
    MAP_WHITELIST,
    VALID_CHARACTERS
};
