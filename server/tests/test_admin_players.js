/**
 * BỘ KIỂM THỬ MODULE PLAYERS (ADMIN DASHBOARD)
 * (Unit, Pagination, Search, Security & Status Toggle Validation Suite)
 * 
 * Tuân thủ quy định AGENTS.md:
 * - Chạy trong môi trường test độc lập (NODE_ENV=test).
 * - Sử dụng test doubles / mock Firebase isolated.
 * - Tuyệt đối KHÔNG kết nối Firebase Production.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.NODE_ENV = "test";
process.env.CSRF_SECRET = "super-secret-test-key-32-chars-length!!";
process.env.IDEMPOTENCY_SECRET = "another-secret-key-for-idempotency-32chars";

const firebaseConfig = require("../config/firebase");
const firebaseAuthService = require("../services/firebaseAuthService");
const adminService = require("../services/adminService");
const adminController = require("../controllers/adminController");
const { requireAdmin } = require("../middleware/adminMiddleware");
const { validateOrigin } = require("../middleware/authMiddleware");
const { csrfProtection, generateCsrfToken } = require("../middleware/csrfMiddleware");
const adminRoutes = require("../routes/adminRoutes");

let passCount = 0;
let failCount = 0;

function it(description, fn) {
    try {
        fn();
        console.log(`  [PASS] ${description}`);
        passCount++;
    } catch (err) {
        console.error(`  [FAIL] ${description}`);
        console.error(`         ${err.message}`);
        failCount++;
    }
}

async function itAsync(description, fn) {
    try {
        await fn();
        console.log(`  [PASS] ${description}`);
        passCount++;
    } catch (err) {
        console.error(`  [FAIL] ${description}`);
        console.error(`         ${err.message}`);
        failCount++;
    }
}

/**
 * Mock Request & Response Helper
 */
function createMockHttp({
    method = "GET",
    url = "/",
    cookie,
    csrfCookie,
    headers = {},
    reqUser,
    adminUser,
    query = {},
    params = {},
    body = {}
} = {}) {
    let cookieHeader = "";
    if (cookie) cookieHeader += `poke.sid=${cookie}; `;
    if (csrfCookie) cookieHeader += `poke.csrf=${csrfCookie}; `;

    const req = {
        method,
        url,
        baseUrl: "/api/admin",
        path: url,
        headers: {
            cookie: cookieHeader.trim(),
            ...headers
        },
        user: reqUser ? { ...reqUser } : undefined,
        adminUser: adminUser ? { ...adminUser } : undefined,
        query,
        params,
        body
    };

    let statusCode = 200;
    let jsonBody = null;

    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        json(data) {
            jsonBody = data;
            return this;
        }
    };

    return {
        req,
        res,
        getResponse: () => ({ statusCode, jsonBody })
    };
}

/**
 * Helper thực thi chuỗi middleware tuần tự
 */
async function executePipeline(middlewares, req, res) {
    let index = 0;
    const next = async (err) => {
        if (err) throw err;
        if (index < middlewares.length) {
            const mw = middlewares[index++];
            await mw(req, res, next);
        }
    };
    await next();
}

async function runTestSuite() {
    console.log("==================================================================");
    console.log(" BẮT ĐẦU CHẠY BỘ KIỂM THỬ MODULE PLAYERS (test_admin_players.js)");
    console.log("==================================================================\n");

    const originalGetFirestore = firebaseConfig.getFirestore;
    const originalGetAuth = firebaseConfig.getAuth;
    const originalVerifySessionCookie = firebaseAuthService.verifySessionCookie;

    // -------------------------------------------------------------------------
    // NHÓM 1: BẢO VỆ ROUTE PLAYERS VỚI REQUIRE_ADMIN MIDDLEWARE
    // -------------------------------------------------------------------------
    console.log("--- 1. AUTH & ROLE GUARDS ---");

    await itAsync("Từ chối HTTP 401 khi không có session cookie", async () => {
        const { req, res, getResponse } = createMockHttp({ cookie: null });
        let nextCalled = false;
        await requireAdmin(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 401);
        assert.strictEqual(jsonBody.code, "UNAUTHORIZED");
    });

    await itAsync("Từ chối HTTP 403 khi user thường truy cập (không có admin: true)", async () => {
        const { req, res, getResponse } = createMockHttp({ cookie: "user-cookie" });
        let nextCalled = false;

        firebaseAuthService.verifySessionCookie = async () => ({
            uid: "regular-user-uid",
            admin: false
        });

        await requireAdmin(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 403);
        assert.strictEqual(jsonBody.code, "FORBIDDEN");
    });

    // -------------------------------------------------------------------------
    // NHÓM 2: SANITIZATION & PUBLIC FIELDS WHITELIST
    // -------------------------------------------------------------------------
    console.log("\n--- 2. DATA SANITIZATION ---");

    it("sanitizePlayer loại bỏ triệt để email, mật khẩu, token và chỉ giữ các trường an toàn", () => {
        const rawData = {
            uid: "player-999",
            username: "red_master",
            character: "red",
            isActive: true,
            position: { x: 5, y: 10, map: "forest_route", facing: "up" },
            email: "red@player.poke-engine.internal", // nhạy cảm
            passwordHash: "$2b$10$secretHash", // nhạy cảm
            internalTokens: ["tok1", "tok2"], // nhạy cảm
            createdAt: "2026-11-19T00:00:00.000Z",
            updatedAt: "2026-11-19T01:00:00.000Z"
        };

        const sanitized = adminService.sanitizePlayer(rawData, "player-999");

        assert.strictEqual(sanitized.uid, "player-999");
        assert.strictEqual(sanitized.username, "red_master");
        assert.strictEqual(sanitized.character, "red");
        assert.strictEqual(sanitized.isActive, true);
        assert.strictEqual(sanitized.position.map, "forest_route");
        assert.strictEqual(sanitized.position.x, 5);
        assert.strictEqual(sanitized.position.y, 10);
        assert.strictEqual(sanitized.position.facing, "up");
        assert.strictEqual(sanitized.email, undefined, "Email không được phép rò rỉ");
        assert.strictEqual(sanitized.passwordHash, undefined, "Mật khẩu không được phép rò rỉ");
        assert.strictEqual(sanitized.internalTokens, undefined, "Tokens không được phép rò rỉ");
    });

    // -------------------------------------------------------------------------
    // NHÓM 3: GET PLAYERS LIST (PAGINATION & SEARCH)
    // -------------------------------------------------------------------------
    console.log("\n--- 3. PLAYERS LIST & PAGINATION & SEARCH ---");

    await itAsync("Lấy danh sách người chơi phân trang server-side thành công", async () => {
        const mockUsers = [
            { id: "u1", data: () => ({ uid: "u1", username: "ash", character: "red", isActive: true }) },
            { id: "u2", data: () => ({ uid: "u2", username: "brock", character: "brendan", isActive: true }) }
        ];

        let capturedLimit = null;
        let capturedOffset = null;

        const fakeFirestore = {
            collection: (col) => {
                assert.strictEqual(col, "users");
                return {
                    orderBy: (field, dir) => {
                        assert.strictEqual(field, "username");
                        assert.strictEqual(dir, "asc");
                        return {
                            count: () => ({
                                get: async () => ({ data: () => ({ count: 25 }) })
                            }),
                            limit: (lim) => {
                                capturedLimit = lim;
                                return {
                                    offset: (off) => {
                                        capturedOffset = off;
                                        return {
                                            get: async () => mockUsers
                                        };
                                    }
                                };
                            }
                        };
                    },
                    count: () => ({
                        get: async () => ({ data: () => ({ count: 25 }) })
                    })
                };
            }
        };

        firebaseConfig.getFirestore = () => fakeFirestore;

        const { req, res, getResponse } = createMockHttp({
            adminUser: { uid: "admin-root", role: "admin" },
            query: { page: "2", limit: "10" }
        });

        await adminController.getPlayers(req, res);

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(jsonBody.success, true);
        assert.strictEqual(jsonBody.data.players.length, 2);
        assert.strictEqual(jsonBody.data.pagination.page, 2);
        assert.strictEqual(jsonBody.data.pagination.limit, 10);
        assert.strictEqual(jsonBody.data.pagination.total, 25);
        assert.strictEqual(jsonBody.data.pagination.totalPages, 3);
        assert.strictEqual(capturedLimit, 10);
        assert.strictEqual(capturedOffset, 10); // (2 - 1) * 10
    });

    await itAsync("Tìm kiếm người chơi theo username sử dụng range filter chuẩn hóa", async () => {
        let capturedWhereField = [];
        let capturedWhereOp = [];
        let capturedWhereVal = [];

        const fakeFirestore = {
            collection: () => ({
                where: function (field, op, val) {
                    capturedWhereField.push(field);
                    capturedWhereOp.push(op);
                    capturedWhereVal.push(val);
                    return this;
                },
                orderBy: () => ({
                    limit: () => ({
                        offset: () => ({
                            get: async () => [
                                { id: "u1", data: () => ({ uid: "u1", username: "pikachu_fan", character: "red", isActive: true }) }
                            ]
                        })
                    })
                }),
                count: () => ({
                    get: async () => ({ data: () => ({ count: 1 }) })
                })
            })
        };

        firebaseConfig.getFirestore = () => fakeFirestore;

        const { req, res, getResponse } = createMockHttp({
            adminUser: { uid: "admin-root", role: "admin" },
            query: { search: "  Pikachu  " }
        });

        await adminController.getPlayers(req, res);

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(jsonBody.data.players[0].username, "pikachu_fan");
        // Kiểm tra tiền tố tìm kiếm đã được chuẩn hóa chữ thường
        assert.strictEqual(capturedWhereVal[0], "pikachu");
        assert.strictEqual(capturedWhereVal[1], "pikachu\uf8ff");
    });

    // -------------------------------------------------------------------------
    // NHÓM 4: GET PLAYER DETAIL
    // -------------------------------------------------------------------------
    console.log("\n--- 4. GET PLAYER DETAIL ---");

    await itAsync("Lấy chi tiết hồ sơ người chơi thành công", async () => {
        firebaseConfig.getFirestore = () => ({
            collection: () => ({
                doc: (id) => ({
                    get: async () => ({
                        exists: true,
                        data: () => ({
                            uid: id,
                            username: "gary_oak",
                            character: "blue",
                            isActive: true,
                            position: { map: "village_pine", x: 10, y: 15, facing: "left" }
                        })
                    })
                })
            })
        });

        const { req, res, getResponse } = createMockHttp({
            adminUser: { uid: "admin-root", role: "admin" },
            params: { uid: "target-gary" }
        });

        await adminController.getPlayerDetail(req, res);

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(jsonBody.data.username, "gary_oak");
        assert.strictEqual(jsonBody.data.position.map, "village_pine");
    });

    await itAsync("Trả về HTTP 404 khi UID người chơi không tồn tại", async () => {
        firebaseConfig.getFirestore = () => ({
            collection: () => ({
                doc: () => ({
                    get: async () => ({ exists: false })
                })
            })
        });

        const { req, res, getResponse } = createMockHttp({
            adminUser: { uid: "admin-root", role: "admin" },
            params: { uid: "non-existent-uid" }
        });

        await adminController.getPlayerDetail(req, res);

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(statusCode, 404);
        assert.strictEqual(jsonBody.code, "PLAYER_NOT_FOUND");
    });

    // -------------------------------------------------------------------------
    // NHÓM 5: UPDATE PLAYER STATUS (LOCK / UNLOCK)
    // -------------------------------------------------------------------------
    console.log("\n--- 5. LOCK & UNLOCK PLAYER STATUS ---");

    await itAsync("Từ chối HTTP 400 khi Admin cố tình tự khóa tài khoản của chính mình", async () => {
        const { req, res, getResponse } = createMockHttp({
            adminUser: { uid: "admin-self-uid", role: "admin" },
            params: { uid: "admin-self-uid" },
            body: { isActive: false }
        });

        await adminController.updatePlayerStatus(req, res);

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(statusCode, 400);
        assert.strictEqual(jsonBody.code, "CANNOT_LOCK_SELF");
    });

    await itAsync("Từ chối HTTP 400 khi trường isActive không phải boolean", async () => {
        const { req, res, getResponse } = createMockHttp({
            adminUser: { uid: "admin-root", role: "admin" },
            params: { uid: "player-target" },
            body: { isActive: "not-a-bool" }
        });

        await adminController.updatePlayerStatus(req, res);

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(statusCode, 400);
        assert.strictEqual(jsonBody.code, "INVALID_BODY");
    });

    await itAsync("Khóa tài khoản thành công: Cập nhật Firebase Auth, thu hồi token, ngắt socket và cập nhật Firestore", async () => {
        let authUpdatedDisabled = null;
        let tokenRevokedUid = null;
        let firestoreUpdatedPayload = null;

        firebaseConfig.getAuth = () => ({
            updateUser: async (uid, params) => {
                authUpdatedDisabled = params.disabled;
            },
            revokeRefreshTokens: async (uid) => {
                tokenRevokedUid = uid;
            }
        });

        firebaseConfig.getFirestore = () => ({
            collection: () => ({
                doc: (id) => ({
                    get: async () => ({
                        exists: true,
                        data: () => ({ uid: id, username: "troublemaker", isActive: true })
                    }),
                    update: async (payload) => {
                        firestoreUpdatedPayload = payload;
                    }
                })
            })
        });

        const { req, res, getResponse } = createMockHttp({
            adminUser: { uid: "admin-root", role: "admin" },
            params: { uid: "player-to-lock" },
            body: { isActive: false }
        });

        await adminController.updatePlayerStatus(req, res);

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(jsonBody.success, true);
        assert.strictEqual(jsonBody.data.isActive, false);
        assert.strictEqual(authUpdatedDisabled, true, "Firebase Auth phải được disable");
        assert.strictEqual(tokenRevokedUid, "player-to-lock", "Refresh tokens phải được thu hồi");
        assert.strictEqual(firestoreUpdatedPayload.isActive, false, "Firestore isActive phải là false");
    });

    await itAsync("Mở khóa tài khoản thành công: Bật lại Firebase Auth và cập nhật Firestore isActive = true", async () => {
        let authUpdatedDisabled = null;
        let firestoreUpdatedPayload = null;

        firebaseConfig.getAuth = () => ({
            updateUser: async (uid, params) => {
                authUpdatedDisabled = params.disabled;
            }
        });

        firebaseConfig.getFirestore = () => ({
            collection: () => ({
                doc: (id) => ({
                    get: async () => ({
                        exists: true,
                        data: () => ({ uid: id, username: "reformed_player", isActive: false })
                    }),
                    update: async (payload) => {
                        firestoreUpdatedPayload = payload;
                    }
                })
            })
        });

        const { req, res, getResponse } = createMockHttp({
            adminUser: { uid: "admin-root", role: "admin" },
            params: { uid: "player-to-unlock" },
            body: { isActive: true }
        });

        await adminController.updatePlayerStatus(req, res);

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(jsonBody.success, true);
        assert.strictEqual(jsonBody.data.isActive, true);
        assert.strictEqual(authUpdatedDisabled, false, "Firebase Auth phải được re-enable (disabled: false)");
        assert.strictEqual(firestoreUpdatedPayload.isActive, true, "Firestore isActive phải là true");
    });

    await itAsync("Xử lý lỗi an toàn: Báo lỗi 500 kèm partialSync khi Firestore lỗi sau khi Auth đã disable", async () => {
        firebaseConfig.getAuth = () => ({
            updateUser: async () => {},
            revokeRefreshTokens: async () => {}
        });

        firebaseConfig.getFirestore = () => ({
            collection: () => ({
                doc: () => ({
                    get: async () => ({ exists: true }),
                    update: async () => {
                        throw new Error("Firestore database connection lost");
                    }
                })
            })
        });

        const { req, res, getResponse } = createMockHttp({
            adminUser: { uid: "admin-root", role: "admin" },
            params: { uid: "player-partial-sync" },
            body: { isActive: false }
        });

        await adminController.updatePlayerStatus(req, res);

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(statusCode, 500);
        assert.strictEqual(jsonBody.code, "FIRESTORE_UPDATE_FAILED");
        assert.strictEqual(jsonBody.partialSync, true);
    });

    // -------------------------------------------------------------------------
    // NHÓM 6: CSRF & ORIGIN SECURITY (SEC-01 BẢO VỆ PATCH /players/:uid/status)
    // -------------------------------------------------------------------------
    console.log("--- 6. CSRF & ORIGIN SECURITY (SEC-01) ---");

    it("1. Định tuyến: Route PATCH /players/:uid/status đăng ký đúng thứ tự: validateOrigin -> csrfProtection -> updatePlayerStatus", () => {
        const patchRouteLayer = adminRoutes.stack.find(
            layer => layer.route && layer.route.path === "/players/:uid/status" && layer.route.methods.patch
        );
        assert.ok(patchRouteLayer, "Phải tìm thấy layer PATCH /players/:uid/status trên adminRoutes");
        const handlers = patchRouteLayer.route.stack;
        assert.strictEqual(handlers.length, 3, "Phải có đúng 3 handlers trên route");
        assert.strictEqual(handlers[0].name, "validateOrigin", "Handler 1 phải là validateOrigin");
        assert.strictEqual(handlers[1].name, "csrfProtection", "Handler 2 phải là csrfProtection");
        assert.strictEqual(handlers[2].name, "updatePlayerStatus", "Handler 3 phải là updatePlayerStatus");
    });

    await itAsync("2. Thiếu CSRF token: csrfProtection từ chối HTTP 403 CSRF_TOKEN_INVALID", async () => {
        const { req, res, getResponse } = createMockHttp({
            method: "PATCH",
            url: "/players/p123/status",
            headers: { origin: "http://localhost:3000" },
            reqUser: { uid: "admin-root" },
            adminUser: { uid: "admin-root", role: "admin" },
            params: { uid: "p123" },
            body: { isActive: false }
        });

        let nextCalled = false;
        await csrfProtection(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false, "next() không được phép gọi khi thiếu CSRF token");
        assert.strictEqual(statusCode, 403);
        assert.strictEqual(jsonBody.code, "CSRF_TOKEN_INVALID");
    });

    await itAsync("3. CSRF token sai hoặc bị sửa đổi chữ ký: csrfProtection từ chối HTTP 403 CSRF_TOKEN_INVALID", async () => {
        const forgedToken = "12345678901234567890123456789012.1700000000000.admin-root.fakehmacsignature1234567890abcdef1234567890abcdef1234567890abcdef";
        const { req, res, getResponse } = createMockHttp({
            method: "PATCH",
            url: "/players/p123/status",
            headers: {
                origin: "http://localhost:3000",
                "x-csrf-token": forgedToken
            },
            csrfCookie: forgedToken,
            reqUser: { uid: "admin-root" },
            adminUser: { uid: "admin-root", role: "admin" },
            params: { uid: "p123" },
            body: { isActive: false }
        });

        let nextCalled = false;
        await csrfProtection(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 403);
        assert.strictEqual(jsonBody.code, "CSRF_TOKEN_INVALID");
    });

    await itAsync("4. CSRF token không khớp scope (scope anon/user khác thay vì Admin): csrfProtection từ chối HTTP 403 CSRF_TOKEN_INVALID", async () => {
        const wrongScopeToken = generateCsrfToken("victim-user-123");
        const { req, res, getResponse } = createMockHttp({
            method: "PATCH",
            url: "/players/p123/status",
            headers: {
                origin: "http://localhost:3000",
                "x-csrf-token": wrongScopeToken
            },
            csrfCookie: wrongScopeToken,
            reqUser: { uid: "admin-root" },
            adminUser: { uid: "admin-root", role: "admin" },
            params: { uid: "p123" },
            body: { isActive: false }
        });

        let nextCalled = false;
        await csrfProtection(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 403);
        assert.strictEqual(jsonBody.code, "CSRF_TOKEN_INVALID");
    });

    await itAsync("5. Thiếu Origin và Referer header: validateOrigin từ chối HTTP 403 INVALID_ORIGIN", async () => {
        const { req, res, getResponse } = createMockHttp({
            method: "PATCH",
            url: "/players/p123/status",
            headers: {},
            reqUser: { uid: "admin-root" },
            params: { uid: "p123" },
            body: { isActive: false }
        });

        let nextCalled = false;
        await validateOrigin(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 403);
        assert.strictEqual(jsonBody.code, "INVALID_ORIGIN");
    });

    await itAsync("6. Origin không thuộc whitelist (ví dụ: http://attacker.com): validateOrigin từ chối HTTP 403 INVALID_ORIGIN", async () => {
        const { req, res, getResponse } = createMockHttp({
            method: "PATCH",
            url: "/players/p123/status",
            headers: {
                origin: "http://attacker.com"
            },
            reqUser: { uid: "admin-root" },
            params: { uid: "p123" },
            body: { isActive: false }
        });

        let nextCalled = false;
        await validateOrigin(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 403);
        assert.strictEqual(jsonBody.code, "INVALID_ORIGIN");
    });

    await itAsync("7. Sec-Fetch-Site cross-site: validateOrigin từ chối HTTP 403 INVALID_ORIGIN", async () => {
        const { req, res, getResponse } = createMockHttp({
            method: "PATCH",
            url: "/players/p123/status",
            headers: {
                origin: "http://localhost:3000",
                "sec-fetch-site": "cross-site"
            },
            reqUser: { uid: "admin-root" },
            params: { uid: "p123" },
            body: { isActive: false }
        });

        let nextCalled = false;
        await validateOrigin(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 403);
        assert.strictEqual(jsonBody.code, "INVALID_ORIGIN");
    });

    await itAsync("8. Pipeline hợp lệ toàn diện: Đúng Admin + Đúng Origin + Đúng CSRF cập nhật thành công HTTP 200", async () => {
        let authUpdatedDisabled = null;
        let firestoreUpdatedPayload = null;

        firebaseConfig.getAuth = () => ({
            updateUser: async (uid, params) => {
                authUpdatedDisabled = params.disabled;
            },
            revokeRefreshTokens: async () => {}
        });

        firebaseConfig.getFirestore = () => ({
            collection: () => ({
                doc: (id) => ({
                    get: async () => ({
                        exists: true,
                        data: () => ({ uid: id, username: "valid_csrf_player", isActive: true })
                    }),
                    update: async (payload) => {
                        firestoreUpdatedPayload = payload;
                    }
                })
            })
        });

        const validToken = generateCsrfToken("admin-root");
        const { req, res, getResponse } = createMockHttp({
            method: "PATCH",
            url: "/players/player-valid-csrf/status",
            headers: {
                origin: "http://localhost:3000",
                "x-csrf-token": validToken
            },
            csrfCookie: validToken,
            reqUser: { uid: "admin-root" },
            adminUser: { uid: "admin-root", role: "admin" },
            params: { uid: "player-valid-csrf" },
            body: { isActive: false }
        });

        await executePipeline([validateOrigin, csrfProtection, adminController.updatePlayerStatus], req, res);

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(jsonBody.success, true);
        assert.strictEqual(jsonBody.data.isActive, false);
        assert.strictEqual(authUpdatedDisabled, true);
        assert.strictEqual(firestoreUpdatedPayload.isActive, false);
    });

    it("9. Kiểm tra Client Frontend admin.js: Trích xuất poke.csrf, đính kèm X-CSRF-Token và phân biệt mã lỗi", () => {
        const adminJsPath = path.join(__dirname, "../../public/admin/js/admin.js");
        assert.ok(fs.existsSync(adminJsPath), "File public/admin/js/admin.js phải tồn tại");
        const adminJsContent = fs.readFileSync(adminJsPath, "utf8");

        assert.ok(adminJsContent.includes("function getCsrfToken()"), "admin.js phải có hàm getCsrfToken()");
        assert.ok(adminJsContent.includes('parts[0] === "poke.csrf"'), "getCsrfToken() phải trích xuất cookie poke.csrf");
        assert.ok(adminJsContent.includes('"X-CSRF-Token": csrfToken'), "executeStatusToggle() phải gửi header X-CSRF-Token");
        assert.ok(adminJsContent.includes('resData.code === "INVALID_ORIGIN"'), "admin.js phải kiểm tra mã lỗi INVALID_ORIGIN");
        assert.ok(adminJsContent.includes('resData.code === "CSRF_TOKEN_INVALID"'), "admin.js phải kiểm tra mã lỗi CSRF_TOKEN_INVALID");
    });

    await itAsync("10. Safe methods: GET /players và GET /players/:uid không bị ảnh hưởng bởi CSRF hay Origin", async () => {
        firebaseConfig.getFirestore = () => ({
            collection: () => ({
                doc: (id) => ({
                    get: async () => ({
                        exists: true,
                        data: () => ({ uid: id, username: "safe_method_player", isActive: true })
                    })
                })
            })
        });

        // GET request không gửi Origin và không gửi CSRF token
        const { req, res, getResponse } = createMockHttp({
            method: "GET",
            url: "/players/safe-player",
            headers: {},
            adminUser: { uid: "admin-root", role: "admin" },
            params: { uid: "safe-player" }
        });

        await adminController.getPlayerDetail(req, res);

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(statusCode, 200, "GET request phải thành công không cần CSRF token");
        assert.strictEqual(jsonBody.success, true);
        assert.strictEqual(jsonBody.data.username, "safe_method_player");
    });

    // Khôi phục modules gốc
    firebaseConfig.getFirestore = originalGetFirestore;
    firebaseConfig.getAuth = originalGetAuth;
    firebaseAuthService.verifySessionCookie = originalVerifySessionCookie;

    console.log("\n==================================================================");
    console.log(` KẾT QUẢ TEST MODULE PLAYERS: ${passCount} PASS / ${failCount} FAIL`);
    console.log("==================================================================");

    if (failCount > 0) {
        process.exit(1);
    }
}

runTestSuite().catch((err) => {
    console.error("Lỗi thực thi test suite:", err);
    process.exit(1);
});
