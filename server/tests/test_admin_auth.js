/**
 * BỘ KIỂM THỬ XÁC THỰC & PHÂN QUYỀN ADMIN (PHASE B)
 * (Unit, Middleware, Controller & CLI Validation Suite)
 * 
 * Tuân thủ nghiêm ngặt quy định:
 * - Chạy trong môi trường test (NODE_ENV=test).
 * - Sử dụng test doubles / mock Firebase isolated.
 * - Tuyệt đối KHÔNG kết nối Firebase Production.
 */

const assert = require("assert");
const http = require("http");
const express = require("express");

process.env.NODE_ENV = "test";
process.env.CSRF_SECRET = "super-secret-test-key-32-chars-length!!";
process.env.IDEMPOTENCY_SECRET = "another-secret-key-for-idempotency-32chars";

const { requireAdmin, isSessionAuthError } = require("../middleware/adminMiddleware");
const { getMe } = require("../controllers/adminController");
const { getAdminProfile } = require("../services/adminService");
const { parseArgs } = require("../../scripts/grant-admin");
const firebaseConfig = require("../config/firebase");
const firebaseAuthService = require("../services/firebaseAuthService");

// Biến đếm kết quả test
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
 * Tạo mock Request & Response cho Express Middleware
 */
function createMockHttp({ cookie, reqUser = { existingUserProp: "preserved_value" } } = {}) {
    const req = {
        headers: {
            cookie: cookie ? `poke.sid=${cookie}` : ""
        },
        user: reqUser ? { ...reqUser } : undefined
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

async function runTestSuite() {
    console.log("==================================================================");
    console.log(" BẮT ĐẦU CHẠY BỘ KIỂM THỬ ADMIN PHASE B (test_admin_auth.js)");
    console.log("==================================================================\n");

    // -------------------------------------------------------------------------
    // NHÓM 1: HELPER & CLI ARGUMENT PARSER TESTS
    // -------------------------------------------------------------------------
    console.log("--- 1. CLI ARGUMENT PARSER TESTS ---");

    it("CLI parseArgs hỗ trợ flag --username", () => {
        const parsed = parseArgs(["--username", "ash_ketchum"]);
        assert.strictEqual(parsed.username, "ash_ketchum");
    });

    it("CLI parseArgs hỗ trợ flag rút gọn -u", () => {
        const parsed = parseArgs(["-u", "gary_oak"]);
        assert.strictEqual(parsed.username, "gary_oak");
    });

    it("CLI parseArgs hỗ trợ flag --uid", () => {
        const parsed = parseArgs(["--uid", "firebase-uid-12345"]);
        assert.strictEqual(parsed.uid, "firebase-uid-12345");
    });

    it("CLI parseArgs hỗ trợ tham số trực tiếp (positional argument)", () => {
        const parsed = parseArgs(["brock_pewter"]);
        assert.strictEqual(parsed.username, "brock_pewter");
    });

    // -------------------------------------------------------------------------
    // NHÓM 2: ERROR CLASSIFICATION TESTS
    // -------------------------------------------------------------------------
    console.log("\n--- 2. ERROR CLASSIFICATION TESTS ---");

    it("isSessionAuthError nhận diện đúng mã lỗi session hết hạn hoặc bị thu hồi", () => {
        assert.strictEqual(isSessionAuthError({ code: "auth/session-cookie-revoked" }), true);
        assert.strictEqual(isSessionAuthError({ code: "auth/session-cookie-expired" }), true);
        assert.strictEqual(isSessionAuthError({ code: "auth/argument-error" }), true);
        assert.strictEqual(isSessionAuthError({ code: "auth/invalid-session-cookie" }), true);
    });

    it("isSessionAuthError từ chối các mã lỗi hạ tầng/mạng", () => {
        assert.strictEqual(isSessionAuthError({ code: "ECONNREFUSED" }), false);
        assert.strictEqual(isSessionAuthError({ code: "auth/internal-error" }), false);
        assert.strictEqual(isSessionAuthError({ code: "ETIMEDOUT" }), false);
        assert.strictEqual(isSessionAuthError(null), false);
    });

    // -------------------------------------------------------------------------
    // NHÓM 3: REQUIRE_ADMIN MIDDLEWARE TESTS
    // -------------------------------------------------------------------------
    console.log("\n--- 3. REQUIRE_ADMIN MIDDLEWARE TESTS ---");

    // Lưu trữ tham chiếu gốc để khôi phục sau test
    const originalVerifySessionCookie = firebaseAuthService.verifySessionCookie;
    const originalGetFirestore = firebaseConfig.getFirestore;

    await itAsync("Từ chối HTTP 401 khi không gửi cookie poke.sid", async () => {
        const { req, res, getResponse } = createMockHttp({ cookie: null });
        let nextCalled = false;

        await requireAdmin(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 401);
        assert.strictEqual(jsonBody.code, "UNAUTHORIZED");
    });

    await itAsync("Từ chối HTTP 401 khi session cookie bị thu hồi (revoked)", async () => {
        const { req, res, getResponse } = createMockHttp({ cookie: "revoked-cookie" });
        let nextCalled = false;

        firebaseAuthService.verifySessionCookie = async () => {
            const err = new Error("Session cookie has been revoked.");
            err.code = "auth/session-cookie-revoked";
            throw err;
        };

        await requireAdmin(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 401);
        assert.strictEqual(jsonBody.code, "UNAUTHORIZED");
    });

    await itAsync("Từ chối HTTP 401 khi session cookie không hợp lệ hoặc sai cú pháp", async () => {
        const { req, res, getResponse } = createMockHttp({ cookie: "malformed-cookie" });
        let nextCalled = false;

        firebaseAuthService.verifySessionCookie = async () => {
            const err = new Error("Invalid session cookie.");
            err.code = "auth/invalid-session-cookie";
            throw err;
        };

        await requireAdmin(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 401);
        assert.strictEqual(jsonBody.code, "UNAUTHORIZED");
    });

    await itAsync("Trả về HTTP 500 khi Firebase Auth gặp lỗi hạ tầng mạng", async () => {
        const { req, res, getResponse } = createMockHttp({ cookie: "any-cookie" });
        let nextCalled = false;

        firebaseAuthService.verifySessionCookie = async () => {
            const err = new Error("Firebase Auth service unavailable.");
            err.code = "auth/internal-error";
            throw err;
        };

        await requireAdmin(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 500);
        assert.strictEqual(jsonBody.code, "INTERNAL_ERROR");
    });

    await itAsync("Từ chối HTTP 403 khi user đã xác thực nhưng KHÔNG CÓ claim admin: true", async () => {
        const { req, res, getResponse } = createMockHttp({ cookie: "regular-user-cookie" });
        let nextCalled = false;

        firebaseAuthService.verifySessionCookie = async () => {
            return {
                uid: "user-123",
                admin: false // hoặc undefined
            };
        };

        await requireAdmin(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 403);
        assert.strictEqual(jsonBody.code, "FORBIDDEN");
    });

    await itAsync("Từ chối HTTP 403 khi user có claim admin: true nhưng không tìm thấy document trong Firestore", async () => {
        const { req, res, getResponse } = createMockHttp({ cookie: "admin-cookie" });
        let nextCalled = false;

        firebaseAuthService.verifySessionCookie = async () => {
            return { uid: "admin-missing-doc", admin: true };
        };

        firebaseConfig.getFirestore = () => ({
            collection: () => ({
                doc: () => ({
                    get: async () => ({ exists: false })
                })
            })
        });

        await requireAdmin(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 403);
        assert.strictEqual(jsonBody.code, "FORBIDDEN");
    });

    await itAsync("Từ chối HTTP 403 khi Admin bị vô hiệu hóa tài khoản (isActive: false)", async () => {
        const { req, res, getResponse } = createMockHttp({ cookie: "admin-cookie" });
        let nextCalled = false;

        firebaseAuthService.verifySessionCookie = async () => {
            return { uid: "admin-disabled", admin: true };
        };

        firebaseConfig.getFirestore = () => ({
            collection: () => ({
                doc: () => ({
                    get: async () => ({
                        exists: true,
                        data: () => ({ username: "bad_admin", isActive: false })
                    })
                })
            })
        });

        await requireAdmin(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 403);
        assert.strictEqual(jsonBody.code, "FORBIDDEN");
    });

    await itAsync("Trả về HTTP 500 khi Firestore gặp lỗi kết nối/hạ tầng", async () => {
        const { req, res, getResponse } = createMockHttp({ cookie: "admin-cookie" });
        let nextCalled = false;

        firebaseAuthService.verifySessionCookie = async () => {
            return { uid: "admin-db-crash", admin: true };
        };

        firebaseConfig.getFirestore = () => ({
            collection: () => ({
                doc: () => ({
                    get: async () => {
                        const err = new Error("Firestore connection timeout.");
                        err.code = "ETIMEDOUT";
                        throw err;
                    }
                })
            })
        });

        await requireAdmin(req, res, () => { nextCalled = true; });

        const { statusCode, jsonBody } = getResponse();
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 500);
        assert.strictEqual(jsonBody.code, "INTERNAL_ERROR");
    });

    await itAsync("Chấp thuận (next) khi Admin hợp lệ: Gắn req.adminUser và bảo tồn nguyên vẹn req.user", async () => {
        const initialReqUser = { id: "admin-777", uid: "admin-777", customMeta: "keep-me" };
        const { req, res, getResponse } = createMockHttp({
            cookie: "valid-admin-cookie",
            reqUser: initialReqUser
        });
        let nextCalled = false;

        firebaseAuthService.verifySessionCookie = async () => {
            return {
                uid: "admin-777",
                admin: true,
                secretInternalClaim: "should-not-leak"
            };
        };

        firebaseConfig.getFirestore = () => ({
            collection: () => ({
                doc: () => ({
                    get: async () => ({
                        exists: true,
                        data: () => ({
                            username: "super_admin",
                            character: "red",
                            isActive: true
                        })
                    })
                })
            })
        });

        await requireAdmin(req, res, () => { nextCalled = true; });

        assert.strictEqual(nextCalled, true);
        assert.ok(req.adminUser, "req.adminUser phải được tạo");
        assert.strictEqual(req.adminUser.uid, "admin-777");
        assert.strictEqual(req.adminUser.username, "super_admin");
        assert.strictEqual(req.adminUser.role, "admin");
        assert.strictEqual(req.adminUser.character, "red");
        // Kiểm tra không rò rỉ toàn bộ custom claims vào adminUser
        assert.strictEqual(req.adminUser.secretInternalClaim, undefined);
        // Kiểm tra req.user ban đầu được bảo tồn nguyên vẹn
        assert.strictEqual(req.user.customMeta, "keep-me");
        assert.strictEqual(req.user.uid, "admin-777");
    });

    // -------------------------------------------------------------------------
    // NHÓM 4: CONTROLLER & ENDPOINT GET /api/admin/me
    // -------------------------------------------------------------------------
    console.log("\n--- 4. CONTROLLER & ENDPOINT GET /api/admin/me ---");

    await itAsync("GET /api/admin/me trả về đúng thông tin Admin làm sạch (Sanitized)", async () => {
        const req = {
            adminUser: {
                uid: "admin-777",
                username: "super_admin",
                character: "red",
                role: "admin"
            }
        };

        let statusCode = 200;
        let responseJson = null;
        const res = {
            status(c) { statusCode = c; return this; },
            json(d) { responseJson = d; return this; }
        };

        firebaseConfig.getFirestore = () => ({
            collection: () => ({
                doc: () => ({
                    get: async () => ({
                        exists: true,
                        data: () => ({
                            username: "super_admin",
                            character: "red",
                            createdAt: "2026-11-19T00:00:00.000Z"
                        })
                    })
                })
            })
        });

        await getMe(req, res);

        assert.strictEqual(statusCode, 200);
        assert.strictEqual(responseJson.success, true);
        assert.strictEqual(responseJson.data.uid, "admin-777");
        assert.strictEqual(responseJson.data.username, "super_admin");
        assert.strictEqual(responseJson.data.character, "red");
        assert.strictEqual(responseJson.data.role, "admin");
        // Không chứa token hay cookie
        assert.strictEqual(responseJson.data.token, undefined);
        assert.strictEqual(responseJson.data.cookie, undefined);
    });

    // -------------------------------------------------------------------------
    // NHÓM 5: CLI GRANT-ADMIN LOGIC & CLAIMS PRESERVATION
    // -------------------------------------------------------------------------
    console.log("\n--- 5. CLI GRANT-ADMIN LOGIC & CLAIMS PRESERVATION ---");

    await itAsync("CLI grantAdmin bảo toàn các custom claims cũ và bổ sung admin: true", async () => {
        let capturedUid = null;
        let capturedClaims = null;
        let revokeCalled = false;

        const fakeAdminAuth = {
            getUser: async (uid) => ({
                uid,
                email: "test_user@player.poke-engine.internal",
                customClaims: {
                    betaTester: true,
                    earlyAccess: true
                }
            }),
            setCustomUserClaims: async (uid, claims) => {
                capturedUid = uid;
                capturedClaims = claims;
            },
            revokeRefreshTokens: async () => {
                revokeCalled = true;
            }
        };

        const fakeFirestore = {
            collection: () => ({
                doc: () => ({
                    get: async () => ({
                        exists: true,
                        data: () => ({ username: "test_user", isActive: true })
                    })
                })
            })
        };

        const originalGetAuth = firebaseConfig.getAuth;
        firebaseConfig.getAuth = () => fakeAdminAuth;
        firebaseConfig.getFirestore = () => fakeFirestore;

        const { grantAdmin } = require("../../scripts/grant-admin");

        const result = await grantAdmin({ uid: "user-with-existing-claims" });

        assert.strictEqual(capturedUid, "user-with-existing-claims");
        assert.strictEqual(capturedClaims.admin, true);
        assert.strictEqual(capturedClaims.betaTester, true, "Bắt buộc phải giữ nguyên claim betaTester cũ");
        assert.strictEqual(capturedClaims.earlyAccess, true, "Bắt buộc phải giữ nguyên claim earlyAccess cũ");
        assert.strictEqual(revokeCalled, false, "Tuyệt đối không được gọi revokeRefreshTokens");
        assert.strictEqual(result.claims.admin, true);

        // Khôi phục getAuth
        firebaseConfig.getAuth = originalGetAuth;
    });

    // Khôi phục lại các hàm gốc của Firebase module
    firebaseAuthService.verifySessionCookie = originalVerifySessionCookie;
    firebaseConfig.getFirestore = originalGetFirestore;

    // -------------------------------------------------------------------------
    // TỔNG KẾT KẾT QUẢ TEST
    // -------------------------------------------------------------------------
    console.log("\n==================================================================");
    console.log(` KẾT QUẢ TEST ADMIN PHASE B: ${passCount} PASS / ${failCount} FAIL`);
    console.log("==================================================================");

    if (failCount > 0) {
        process.exit(1);
    }
}

// Chạy test suite
runTestSuite().catch((err) => {
    console.error("Lỗi thực thi test suite:", err);
    process.exit(1);
});
