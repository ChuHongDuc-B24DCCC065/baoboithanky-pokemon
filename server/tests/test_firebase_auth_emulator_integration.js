/**
 * BỘ KIỂM THỬ TÍCH HỢP TOÀN DIỆN: FIREBASE AUTH + FIRESTORE TRÊN LOCAL EMULATOR
 * (Authentication, Saga Registration, Idempotency, Session & CSRF Integration Suite)
 * 
 * MỤC TIÊU NGHIÊM NGẶT:
 * 1. Gọi trực tiếp API trên Firebase Auth Emulator (127.0.0.1:9099) và Firestore Emulator (127.0.0.1:8080).
 * 2. Sử dụng Project ID an toàn: "demo-poke-engine".
 * 3. Tuyệt đối KHÔNG import app.js hay server/db.js; không kết nối MongoDB Atlas hay Firebase Production.
 * 4. Dữ liệu thử nghiệm mang định danh ngẫu nhiên (UUID / timestamp) và được dọn dẹp sạch sẽ 100% sau kiểm thử.
 */

const assert = require("assert");
const crypto = require("crypto");

// 1. Thiết lập biến môi trường cô lập cho Local Emulator
process.env.NODE_ENV = "test";
process.env.FIREBASE_ENV = "emulator";
process.env.FIREBASE_PROJECT_ID = "demo-poke-engine";
process.env.GCLOUD_PROJECT = "demo-poke-engine";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.CSRF_SECRET = "super-secret-csrf-key-for-test-32chars!!";
process.env.IDEMPOTENCY_SECRET = "super-secret-idempotency-key-for-test-32chars!!";
process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// 2. Import các module dịch vụ Firebase (Cách ly hoàn toàn khỏi app.js và MongoDB)
const firebaseModule = require("../config/firebase");
const authService = require("../services/firebaseAuthService");
const sagaService = require("../services/registrationSagaService");
const csrfMiddleware = require("../middleware/csrfMiddleware");
const authMiddleware = require("../middleware/authMiddleware");
const activeSockets = require("../socket/activeSockets");
const authController = require("../controllers/authController");

// Helper tạo Mock Response cho Express controller / middleware
function createMockRes() {
    return {
        _status: 200,
        _json: null,
        _cookies: {},
        _clearedCookies: [],
        _redirectUrl: null,
        status(code) {
            this._status = code;
            return this;
        },
        json(data) {
            this._json = data;
            return this;
        },
        cookie(name, val, opts) {
            this._cookies[name] = { val, opts };
            return this;
        },
        clearCookie(name, opts) {
            this._clearedCookies.push({ name, opts });
            return this;
        },
        redirect(url) {
            this._redirectUrl = url;
            return this;
        }
    };
}

// Danh sách tài nguyên thử nghiệm cần dọn dẹp
const cleanupRegistry = {
    uids: new Set(),
    usernames: new Set(),
    operationKeys: new Set()
};

async function runIntegrationSuite() {
    console.log("================================================================================");
    console.log("  POKÉ-ENGINE: FIREBASE AUTH & FIRESTORE LIVE EMULATOR INTEGRATION SUITE        ");
    console.log("  Project ID: demo-poke-engine | Auth: 127.0.0.1:9099 | Firestore: 127.0.0.1:8080 ");
    console.log("================================================================================\n");

    const results = {
        A: { name: "Luồng Registration (Saga 6 bước trên Emulator)", pass: 0, fail: 0, notVerified: 0, details: [] },
        B: { name: "Luồng Idempotency & Conflict Handling", pass: 0, fail: 0, notVerified: 0, details: [] },
        C: { name: "Luồng Login REST, Session Cookie & Auth Verification", pass: 0, fail: 0, notVerified: 0, details: [] },
        D: { name: "Luồng Logout & Token Revocation", pass: 0, fail: 0, notVerified: 0, details: [] },
        E: { name: "Luồng CSRF Double-Submit Protection", pass: 0, fail: 0, notVerified: 0, details: [] }
    };

    // Khởi tạo Firebase Admin kết nối Emulator
    firebaseModule.initializeFirebaseAdmin();
    const db = firebaseModule.getFirestore();

    // Sinh định danh runId độc nhất cho test session (độ dài username <= 20 ký tự)
    const runSuffix = Date.now().toString(36).slice(-5) + "_" + crypto.randomBytes(2).toString("hex");
    const testUsername = `u_${runSuffix}`; // 2 + 5 + 1 + 4 = 12 ký tự (hợp lệ: 3-20)
    const testPassword = "Password123!";
    const testCharacter = "red";
    const testIdempotencyKey = `idem_${runSuffix}_key123456789`; // > 16 ký tự

    let registeredUid = null;
    let liveSessionCookie = null;

    try {
        // =====================================================================
        // NHÓM A: REGISTRATION SAGA TRÊN EMULATOR
        // =====================================================================
        console.log("[Nhóm A] Kiểm thử Luồng Đăng ký Tài khoản (Registration Saga):");

        try {
            cleanupRegistry.usernames.add(testUsername);
            cleanupRegistry.operationKeys.add(testIdempotencyKey);

            const regResult = await sagaService.executeRegistration({
                username: testUsername,
                password: testPassword,
                character: testCharacter,
                idempotencyKey: testIdempotencyKey
            });

            assert(regResult && regResult.uid, "Kết quả đăng ký phải trả về UID hợp lệ");
            registeredUid = regResult.uid;
            cleanupRegistry.uids.add(registeredUid);

            assert.strictEqual(regResult.isExisting, false, "Lần đăng ký đầu tiên isExisting phải là false");
            assert.strictEqual(regResult.username, testUsername);
            assert.strictEqual(regResult.character, testCharacter);

            // 1. Kiểm tra Firebase Auth Emulator có user tương ứng
            const authUser = await authService.getUser(registeredUid);
            assert.strictEqual(authUser.uid, registeredUid, "Auth user UID phải khớp kết quả saga");
            assert.strictEqual(authUser.email, authService.getSyntheticEmail(testUsername), "Synthetic email trong Auth phải khớp");
            assert.strictEqual(authUser.displayName, testUsername, "DisplayName phải khớp username");

            // 2. Kiểm tra Firestore: collection users/{uid}
            const userDocSnap = await db.collection("users").doc(registeredUid).get();
            assert(userDocSnap.exists, "Document users/{uid} phải tồn tại trên Firestore Emulator");
            const userData = userDocSnap.data() || {};
            assert.strictEqual(userData.username, testUsername);
            assert.strictEqual(userData.character, testCharacter);
            assert.strictEqual(userData.isActive, true, "Hồ sơ người chơi phải ở trạng thái isActive=true");

            // 3. Kiểm tra Firestore: collection usernames/{username}
            const usernameDocSnap = await db.collection("usernames").doc(testUsername).get();
            assert(usernameDocSnap.exists, "Document usernames/{username} phải tồn tại");
            const uData = usernameDocSnap.data() || {};
            assert.strictEqual(uData.status, "ACTIVE", "Username reservation status phải là ACTIVE");
            assert.strictEqual(uData.uid, registeredUid, "Username doc phải liên kết chính xác với UID");

            // 4. Kiểm tra Firestore: collection registrationOperations/{key}
            const opDocSnap = await db.collection("registrationOperations").doc(testIdempotencyKey).get();
            assert(opDocSnap.exists, "Operation doc phải tồn tại");
            const opData = opDocSnap.data() || {};
            assert.strictEqual(opData.status, "ACTIVE", "Operation status phải là ACTIVE");
            assert.strictEqual(opData.firebaseUid, registeredUid, "Operation doc phải lưu đúng firebaseUid");

            results.A.pass++;
            results.A.details.push("Đăng ký thành công và đồng bộ chính xác giữa Auth Emulator và 3 Firestore collections");
            console.log("  ✓ A.1: Đăng ký Saga thành công; hồ sơ và reservation đồng bộ hoàn hảo trên Emulator.");
        } catch (errA) {
            results.A.fail++;
            results.A.details.push(`Lỗi Nhóm A: ${errA.message}`);
            console.error("  ✗ A.1 FAILED:", errA.message);
        }

        // =====================================================================
        // NHÓM B: IDEMPOTENCY & CONFLICT HANDLING TRÊN EMULATOR
        // =====================================================================
        console.log("\n[Nhóm B] Kiểm thử Idempotency Replay & Conflict Prevention:");

        // B.1. Gửi lại cùng request (cùng key, cùng thông tin) -> Idempotent Replay
        try {
            const replayResult = await sagaService.executeRegistration({
                username: testUsername,
                password: testPassword,
                character: testCharacter,
                idempotencyKey: testIdempotencyKey
            });

            assert.strictEqual(replayResult.isExisting, true, "Replay request phải trả isExisting=true");
            assert.strictEqual(replayResult.uid, registeredUid, "Replay request phải trả đúng UID cũ");
            assert.strictEqual(replayResult.username, testUsername);

            // Kiểm tra không tạo thêm user trong Firebase Auth
            const checkUser = await authService.getUser(registeredUid);
            assert.strictEqual(checkUser.uid, registeredUid);

            results.B.pass++;
            results.B.details.push("Idempotent Replay thành công, bảo toàn tính bất biến và không tạo trùng tài khoản");
            console.log("  ✓ B.1: Idempotent Replay thành công; trả về kết quả cũ mà không tạo thêm user.");
        } catch (errB1) {
            results.B.fail++;
            results.B.details.push(`Lỗi B.1: ${errB1.message}`);
            console.error("  ✗ B.1 FAILED:", errB1.message);
        }

        // B.2. Dùng lại key với thông tin payload khác -> Bị từ chối IDEMPOTENCY_KEY_REUSED (409)
        try {
            let conflictCaught = false;
            try {
                await sagaService.executeRegistration({
                    username: testUsername,
                    password: "DifferentPassword123!",
                    character: "leaf",
                    idempotencyKey: testIdempotencyKey
                });
            } catch (confErr) {
                conflictCaught = confErr.code === "IDEMPOTENCY_KEY_REUSED" && confErr.statusCode === 409;
            }
            assert(conflictCaught, "Dùng lại idempotency key với payload khác phải bị từ chối 409 IDEMPOTENCY_KEY_REUSED");

            results.B.pass++;
            results.B.details.push("Chặn đứng tái sử dụng idempotency key với payload khác (409)");
            console.log("  ✓ B.2: Chặn đứng xung đột Idempotency Key Reused chuẩn xác.");
        } catch (errB2) {
            results.B.fail++;
            results.B.details.push(`Lỗi B.2: ${errB2.message}`);
            console.error("  ✗ B.2 FAILED:", errB2.message);
        }

        // B.3. Đăng ký username đã tồn tại với idempotency key mới -> Bị từ chối USERNAME_ALREADY_EXISTS (409)
        try {
            const newKey = `idem_${runSuffix}_different_key_12345`;
            cleanupRegistry.operationKeys.add(newKey);

            let existsCaught = false;
            try {
                await sagaService.executeRegistration({
                    username: testUsername,
                    password: "AnotherPassword123!",
                    character: "leaf",
                    idempotencyKey: newKey
                });
            } catch (existsErr) {
                existsCaught = existsErr.code === "USERNAME_ALREADY_EXISTS" && existsErr.statusCode === 409;
            }
            assert(existsCaught, "Trùng username với key mới phải bị từ chối 409 USERNAME_ALREADY_EXISTS");

            results.B.pass++;
            results.B.details.push("Chặn đứng trùng tên đăng nhập với key mới (409)");
            console.log("  ✓ B.3: Chặn đứng trùng username đã tồn tại chuẩn xác.");
        } catch (errB3) {
            results.B.fail++;
            results.B.details.push(`Lỗi B.3: ${errB3.message}`);
            console.error("  ✗ B.3 FAILED:", errB3.message);
        }

        // =====================================================================
        // NHÓM C: LOGIN REST, SESSION COOKIE & AUTH VERIFICATION
        // =====================================================================
        console.log("\n[Nhóm C] Kiểm thử Đăng nhập qua REST API & Session Cookie:");

        // C.1. Đăng nhập thành công qua REST API của Auth Emulator
        try {
            const syntheticEmail = authService.getSyntheticEmail(testUsername);
            const restAuthResult = await authService.signInWithPasswordREST(syntheticEmail, testPassword);

            assert(restAuthResult && restAuthResult.idToken, "REST API phải trả về idToken");
            assert.strictEqual(restAuthResult.localId, registeredUid, "localId từ REST API phải khớp UID đã đăng ký");

            // C.2. Cấp phát Firebase Session Cookie thời hạn 14 ngày
            const sessionCookieMaxAgeMs = 14 * 24 * 60 * 60 * 1000;
            liveSessionCookie = await authService.createSessionCookie(restAuthResult.idToken, sessionCookieMaxAgeMs);
            assert(typeof liveSessionCookie === "string" && liveSessionCookie.length > 30, "Session cookie phải là chuỗi hợp lệ");

            // C.3. Xác minh Session Cookie với checkRevoked = true
            const decodedToken = await authService.verifySessionCookie(liveSessionCookie, true);
            assert.strictEqual(decodedToken.uid, registeredUid, "UID giải mã từ session cookie phải khớp");

            // C.4. Kiểm thử requireAuth middleware với Session Cookie thực tế
            const mockReq = {
                headers: { cookie: `poke.sid=${liveSessionCookie}` },
                originalUrl: "/api/test",
                path: "/api/test"
            };
            const mockRes = createMockRes();
            let authMiddlewarePassed = false;
            await authMiddleware.requireAuth(mockReq, mockRes, () => {
                authMiddlewarePassed = true;
            });
            assert(authMiddlewarePassed, "requireAuth middleware phải chấp thuận session cookie hợp lệ");
            assert(mockReq.user && mockReq.user.uid === registeredUid, "req.user phải được gắn UID chính xác");
            assert.strictEqual(mockReq.user.username, testUsername);

            // C.5. Kiểm thử Endpoint GET /api/auth/me với Session Cookie
            const mockMeReq = {
                headers: { cookie: `poke.sid=${liveSessionCookie}` }
            };
            const mockMeRes = createMockRes();
            await authController.me(mockMeReq, mockMeRes, () => {});
            assert.strictEqual(mockMeRes._status, 200, "/api/auth/me phải trả về HTTP 200");
            assert(mockMeRes._json && mockMeRes._json.data && mockMeRes._json.data.user, "/api/auth/me phải trả thông tin user");
            assert.strictEqual(mockMeRes._json.data.user.id, registeredUid);
            assert.strictEqual(mockMeRes._json.data.user.username, testUsername);

            results.C.pass++;
            results.C.details.push("Xác thực REST API, cấp phát và thẩm định Session Cookie (poke.sid) hoạt động chuẩn xác");
            console.log("  ✓ C.1: REST API đăng nhập thành công; cấp phát Session Cookie và xác minh danh tính hoàn tất.");
        } catch (errC1) {
            results.C.fail++;
            results.C.details.push(`Lỗi C.1: ${errC1.message}`);
            console.error("  ✗ C.1 FAILED:", errC1.message);
        }

        // C.6. Đăng nhập sai mật khẩu qua REST API -> HTTP 401 INVALID_CREDENTIALS
        try {
            let invalidCredsCaught = false;
            try {
                const syntheticEmail = authService.getSyntheticEmail(testUsername);
                await authService.signInWithPasswordREST(syntheticEmail, "WrongPassword123!");
            } catch (loginErr) {
                invalidCredsCaught = loginErr.code === "INVALID_CREDENTIALS" && loginErr.statusCode === 401;
            }
            assert(invalidCredsCaught, "Đăng nhập sai mật khẩu phải trả về 401 INVALID_CREDENTIALS");

            results.C.pass++;
            results.C.details.push("Chặn đứng đăng nhập sai mật khẩu với mã lỗi 401 chuẩn xác");
            console.log("  ✓ C.2: Từ chối đăng nhập sai mật khẩu trả về HTTP 401.");
        } catch (errC2) {
            results.C.fail++;
            results.C.details.push(`Lỗi C.2: ${errC2.message}`);
            console.error("  ✗ C.2 FAILED:", errC2.message);
        }

        // =====================================================================
        // NHÓM D: LOGOUT & TOKEN REVOCATION TRÊN EMULATOR
        // =====================================================================
        console.log("\n[Nhóm D] Kiểm thử Đăng xuất Đơn thiết bị & Đăng xuất Toàn bộ thiết bị (Revoke):");

        // D.1. Đăng xuất thông thường (Single-device logout): Xóa cookie poke.sid
        try {
            const mockLogoutRes = createMockRes();
            authController.logout({}, mockLogoutRes, () => {});
            assert.strictEqual(mockLogoutRes._status, 200);
            const clearedPokeSid = mockLogoutRes._clearedCookies.some(c => c.name === "poke.sid");
            assert(clearedPokeSid, "Logout phải xóa cookie poke.sid");

            results.D.pass++;
            results.D.details.push("Đăng xuất đơn thiết bị xóa cookie poke.sid thành công");
            console.log("  ✓ D.1: Đăng xuất đơn thiết bị xóa cookie an toàn.");
        } catch (errD1) {
            results.D.fail++;
            results.D.details.push(`Lỗi D.1: ${errD1.message}`);
            console.error("  ✗ D.1 FAILED:", errD1.message);
        }

        // D.2. Đăng xuất toàn bộ thiết bị (Logout-all): Revoke tokens và ngắt kết nối vật lý Socket.IO
        try {
            // Đăng ký một socket mô phỏng vào Active Sockets registry
            let socketDisconnected = false;
            let socketAuthRevokedEmitted = false;
            const mockSocket = {
                emit: (event) => { if (event === "AUTH_REVOKED") socketAuthRevokedEmitted = true; },
                disconnect: () => { socketDisconnected = true; },
                once: (event, handler) => {}
            };
            activeSockets.registerSocket(registeredUid, mockSocket);
            assert.strictEqual(activeSockets.getActiveSocketCount(registeredUid), 1, "Socket phải được đăng ký thành công");

            // Chờ ít nhất 1100ms để đảm bảo độ phân giải 1 giây (UTC integer seconds) giữa auth_time và tokensValidAfterTime
            await new Promise(r => setTimeout(r, 1100));

            const mockLogoutAllReq = {
                user: { uid: registeredUid }
            };
            const mockLogoutAllRes = createMockRes();
            await authController.logoutAll(mockLogoutAllReq, mockLogoutAllRes, () => {});

            assert.strictEqual(mockLogoutAllRes._status, 200);
            assert(socketDisconnected, "Socket phải bị cưỡng chế ngắt kết nối vật lý");
            assert(socketAuthRevokedEmitted, "Socket phải nhận sự kiện thông báo AUTH_REVOKED");
            assert.strictEqual(activeSockets.getActiveSocketCount(registeredUid), 0, "Active socket registry phải được dọn sạch");

            // D.3. Xác minh Session Cookie cũ bị từ chối sau khi tokens bị revoke
            let tokenRevocationDetected = false;
            try {
                await authService.verifySessionCookie(liveSessionCookie, true);
            } catch (revokedErr) {
                tokenRevocationDetected = revokedErr.code === "auth/session-cookie-revoked" ||
                                          revokedErr.message.includes("revoked");
            }
            assert(tokenRevocationDetected, "verifySessionCookie với checkRevoked=true bắt buộc phải từ chối token đã bị revoke");

            results.D.pass++;
            results.D.details.push("Logout-all thu hồi refresh tokens thành công; cookie cũ bị từ chối và socket bị ngắt kết nối");
            console.log("  ✓ D.2: Logout-all thu hồi tokens thành công; session cũ bị từ chối ngay lập tức.");
        } catch (errD2) {
            results.D.fail++;
            results.D.details.push(`Lỗi D.2: ${errD2.message}`);
            console.error("  ✗ D.2 FAILED:", errD2.message);
        }

        // =====================================================================
        // NHÓM E: CSRF DOUBLE-SUBMIT PROTECTION CONTRACT
        // =====================================================================
        console.log("\n[Nhóm E] Kiểm thử Hợp đồng Bảo mật CSRF Double-Submit:");

        // E.1. Request hợp lệ có cookie và header x-csrf-token khớp nhau -> Chấp thuận
        try {
            const validToken = csrfMiddleware.generateCsrfToken("anon");
            const mockValidReq = {
                method: "POST",
                headers: {
                    origin: "http://localhost:3000",
                    cookie: `poke.csrf=${validToken}`,
                    "x-csrf-token": validToken
                }
            };
            const mockValidRes = createMockRes();
            let csrfPassed = false;
            csrfMiddleware.csrfProtection(mockValidReq, mockValidRes, () => {
                csrfPassed = true;
            });
            assert(csrfPassed, "Request có cookie và header x-csrf-token khớp nhau phải được chấp thuận");

            results.E.pass++;
            results.E.details.push("CSRF Double-Submit token hợp lệ được chấp nhận thành công");
            console.log("  ✓ E.1: CSRF Double-Submit token hợp lệ vượt qua thẩm định an toàn.");
        } catch (errE1) {
            results.E.fail++;
            results.E.details.push(`Lỗi E.1: ${errE1.message}`);
            console.error("  ✗ E.1 FAILED:", errE1.message);
        }

        // E.2. Request thiếu header x-csrf-token -> Bị từ chối 403 CSRF_TOKEN_INVALID
        try {
            const validToken = csrfMiddleware.generateCsrfToken("anon");
            const mockNoHeaderReq = {
                method: "POST",
                headers: {
                    origin: "http://localhost:3000",
                    cookie: `poke.csrf=${validToken}`
                    // Thiếu x-csrf-token
                }
            };
            const mockNoHeaderRes = createMockRes();
            let noHeaderNextCalled = false;
            csrfMiddleware.csrfProtection(mockNoHeaderReq, mockNoHeaderRes, () => {
                noHeaderNextCalled = true;
            });
            assert.strictEqual(noHeaderNextCalled, false, "Thiếu x-csrf-token header không được gọi next()");
            assert.strictEqual(mockNoHeaderRes._status, 403);
            assert.strictEqual(mockNoHeaderRes._json.code, "CSRF_TOKEN_INVALID");

            results.E.pass++;
            results.E.details.push("Chặn đứng request thiếu x-csrf-token header với HTTP 403");
            console.log("  ✓ E.2: Chặn đứng request thiếu header x-csrf-token (403).");
        } catch (errE2) {
            results.E.fail++;
            results.E.details.push(`Lỗi E.2: ${errE2.message}`);
            console.error("  ✗ E.2 FAILED:", errE2.message);
        }

        // E.3. Request có header x-csrf-token KHÔNG khớp cookie poke.csrf -> Bị từ chối 403
        try {
            const cookieToken = csrfMiddleware.generateCsrfToken("anon");
            const headerToken = csrfMiddleware.generateCsrfToken("anon"); // Token khác
            const mockMismatchReq = {
                method: "POST",
                headers: {
                    origin: "http://localhost:3000",
                    cookie: `poke.csrf=${cookieToken}`,
                    "x-csrf-token": headerToken
                }
            };
            const mockMismatchRes = createMockRes();
            let mismatchNextCalled = false;
            csrfMiddleware.csrfProtection(mockMismatchReq, mockMismatchRes, () => {
                mismatchNextCalled = true;
            });
            assert.strictEqual(mismatchNextCalled, false, "Token không khớp cookie không được gọi next()");
            assert.strictEqual(mockMismatchRes._status, 403);
            assert.strictEqual(mockMismatchRes._json.code, "CSRF_TOKEN_INVALID");

            results.E.pass++;
            results.E.details.push("Chặn đứng request có header không khớp cookie với HTTP 403");
            console.log("  ✓ E.3: Chặn đứng request có token không khớp cookie (403).");
        } catch (errE3) {
            results.E.fail++;
            results.E.details.push(`Lỗi E.3: ${errE3.message}`);
            console.error("  ✗ E.3 FAILED:", errE3.message);
        }

    } finally {
        // =====================================================================
        // DỌN DẸP DỮ LIỆU THỬ NGHIỆM TRÊN EMULATOR (CLEANUP TEARDOWN)
        // =====================================================================
        console.log("\n[Cleanup Phase] Bắt đầu dọn dẹp tài nguyên thử nghiệm trên Emulator...");
        let cleanedAuthCount = 0;
        let cleanedFirestoreCount = 0;

        // 1. Dọn dẹp Auth users
        for (const uid of cleanupRegistry.uids) {
            try {
                await authService.deleteUser(uid);
                cleanedAuthCount++;
            } catch (delAuthErr) {
                console.warn(`  - Cảnh báo dọn dẹp Auth UID ${uid}: ${delAuthErr.message}`);
            }
        }

        // 2. Dọn dẹp Firestore users/{uid}
        for (const uid of cleanupRegistry.uids) {
            try {
                await db.collection("users").doc(uid).delete();
                cleanedFirestoreCount++;
            } catch {}
        }

        // 3. Dọn dẹp Firestore usernames/{username}
        for (const uname of cleanupRegistry.usernames) {
            try {
                await db.collection("usernames").doc(uname).delete();
                cleanedFirestoreCount++;
            } catch {}
        }

        // 4. Dọn dẹp Firestore registrationOperations/{key}
        for (const opKey of cleanupRegistry.operationKeys) {
            try {
                await db.collection("registrationOperations").doc(opKey).delete();
                cleanedFirestoreCount++;
            } catch {}
        }

        console.log(`  ✓ Đã dọn dẹp: ${cleanedAuthCount} Auth User(s) và ${cleanedFirestoreCount} Firestore Document(s).`);

        // Giải phóng Firebase Admin instance duy nhất
        await firebaseModule.cleanupFirebase();
    }

    // =========================================================================
    // BÁO CÁO TỔNG KẾT
    // =========================================================================
    console.log("\n================================================================================");
    console.log("                   BẢNG TỔNG KẾT BỘ KIỂM THỬ TÍCH HỢP                           ");
    console.log("================================================================================");
    let totalPass = 0;
    let totalFail = 0;
    let totalNotVerified = 0;

    for (const [key, group] of Object.entries(results)) {
        console.log(`[Nhóm ${key}] ${group.name.padEnd(55)} : ${group.pass} PASS | ${group.fail} FAIL | ${group.notVerified} NOT VERIFIED`);
        for (const d of group.details) {
            console.log(`       └─ ${d}`);
        }
        totalPass += group.pass;
        totalFail += group.fail;
        totalNotVerified += group.notVerified;
    }

    console.log("================================================================================");
    console.log(`TỔNG KẾT: ${totalPass} PASS | ${totalFail} FAIL | ${totalNotVerified} NOT VERIFIED`);
    console.log("================================================================================\n");

    if (totalFail > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runIntegrationSuite().catch(runnerErr => {
    console.error("FATAL SUITE RUNNER ERROR:", runnerErr);
    process.exit(1);
});
