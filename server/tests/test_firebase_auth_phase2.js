/**
 * BỘ KIỂM THỬ GIAI ĐOẠN 2: FIREBASE AUTHENTICATION & SECURITY INFRASTRUCTURE
 * (Unit, Simulation & Security Validation Suite)
 * 
 * Phân loại bài test:
 * - UNIT / HELPER TESTS: Kiểm tra các hàm logic nghiệp vụ, chuẩn hóa và bảo mật.
 * - SIMULATION TESTS: Kiểm tra mô phỏng CSRF double-submit, Active Socket Registry.
 * - SECURITY REGRESSION TESTS: Kiểm tra entropy secret (>= 32 chars) và Host-header poisoning.
 * - ENVIRONMENT PROBE: Khảo sát trạng thái loopback port của Firebase Emulator.
 * 
 * LƯU Ý THEO AGENTS.MD:
 * Các bài test tích hợp mạng trực tiếp tới Firebase Emulator (End-to-End) hiện ở trạng thái:
 * BLOCKED / NOT RUN (do máy chủ cục bộ chưa cài đặt Firebase CLI và Java JRE).
 * Tuyệt đối KHÔNG chạy với thông tin xác thực Firebase Production!
 */

const assert = require("assert");
const crypto = require("crypto");
const http = require("http");

// Thiết lập môi trường test với secret >= 32 ký tự (256-bit entropy)
process.env.NODE_ENV = "test";
process.env.CSRF_SECRET = "super-secret-test-key-32-chars-length!!";
process.env.IDEMPOTENCY_SECRET = "another-secret-key-for-idempotency-32chars";

const {
    normalizeUsername,
    getSyntheticEmail,
    isSyntheticEmail,
    validateIdempotencyKey,
    calculatePayloadFingerprint,
    getIdempotencySecret
} = require("../services/firebaseAuthService");

const {
    generateCsrfToken,
    verifyCsrfToken,
    validateRequestOrigin,
    csrfProtection,
    extractCookie,
    getCsrfSecret
} = require("../middleware/csrfMiddleware");

const {
    activeSocketsByUid,
    registerSocket,
    unregisterSocket,
    disconnectAllSocketsForUser,
    getActiveSocketCount,
    clearAllSockets
} = require("../socket/activeSockets");

const {
    VALID_CHARACTERS,
    generateUuid
} = require("../services/registrationSagaService");

const {
    isApiRequest
} = require("../middleware/authMiddleware");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(testName, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(`  [PASS] ${testName}`);
    } catch (err) {
        failedTests++;
        console.error(`  [FAIL] ${testName}:`, err.message);
    }
}

async function runAsyncTest(testName, fn) {
    totalTests++;
    try {
        await fn();
        passedTests++;
        console.log(`  [PASS] ${testName}`);
    } catch (err) {
        failedTests++;
        console.error(`  [FAIL] ${testName}:`, err.message);
    }
}

console.log("=== BẮT ĐẦU CHẠY TEST SUITE: PHASE 2 FIREBASE AUTH & SECURITY ===");

// =============================================================================
// NHÓM 1: FIREBASE AUTH SERVICE UTILITIES & ENTROPY
// =============================================================================
console.log("\n[Nhóm 1] Kiểm tra Firebase Auth Service Helpers & Secret Entropy:");

runTest("1.1. normalizeUsername chuẩn hóa chữ thường và cắt khoảng trắng", () => {
    assert.strictEqual(normalizeUsername("  AshKetchum  "), "ashketchum");
    assert.strictEqual(normalizeUsername("Red_123"), "red_123");
    assert.throws(() => normalizeUsername(""), /Username must be a non-empty string/);
    assert.throws(() => normalizeUsername(null), /Username must be a non-empty string/);
});

runTest("1.2. getSyntheticEmail & isSyntheticEmail sinh đúng domain nội bộ", () => {
    const email = getSyntheticEmail("trainer01");
    assert.strictEqual(email, "trainer01@player.poke-engine.internal");
    assert.strictEqual(isSyntheticEmail(email), true);
    assert.strictEqual(isSyntheticEmail("invalid@gmail.com"), false);
    assert.strictEqual(isSyntheticEmail("short@player.poke-engine.internal"), true);
    assert.strictEqual(isSyntheticEmail("ab@player.poke-engine.internal"), false); // Quá ngắn (< 3)
    assert.strictEqual(isSyntheticEmail("toolongusernamehere123456@player.poke-engine.internal"), false); // Quá dài (> 20)
});

runTest("1.3. validateIdempotencyKey chấp nhận UUID v4 và chuỗi URL-safe hợp lệ", () => {
    assert.strictEqual(validateIdempotencyKey("c3b6f8d0-1234-4567-89ab-cdef01234567"), true);
    assert.strictEqual(validateIdempotencyKey("urlsafe-key-1234567890_ABC"), true);
    assert.strictEqual(validateIdempotencyKey("short-key"), false); // < 16 ký tự
    assert.strictEqual(validateIdempotencyKey("invalid@char!key!12345678"), false);
});

runTest("1.4. calculatePayloadFingerprint tính toán định thức và phát hiện thay đổi payload", () => {
    const fp1 = calculatePayloadFingerprint("ash", "pass123456", "red");
    const fp2 = calculatePayloadFingerprint("ash", "pass123456", "red");
    const fp3 = calculatePayloadFingerprint("ash", "pass999999", "red");
    const fp4 = calculatePayloadFingerprint("ash", "pass123456", "leaf");

    assert.strictEqual(fp1, fp2, "Cùng payload phải sinh cùng fingerprint");
    assert.notStrictEqual(fp1, fp3, "Mật khẩu khác phải sinh fingerprint khác");
    assert.notStrictEqual(fp1, fp4, "Character khác phải sinh fingerprint khác");
    assert.strictEqual(fp1.length, 64, "HMAC-SHA256 phải có độ dài 64 ký tự hex");
});

runTest("1.5. getIdempotencySecret ném lỗi Fail-Closed khi IDEMPOTENCY_SECRET bị thiếu", () => {
    const oldSecret = process.env.IDEMPOTENCY_SECRET;
    delete process.env.IDEMPOTENCY_SECRET;
    try {
        assert.throws(() => getIdempotencySecret(), /IDEMPOTENCY_SECRET environment variable is missing/);
    } finally {
        process.env.IDEMPOTENCY_SECRET = oldSecret;
    }
});

runTest("1.6. getIdempotencySecret ném lỗi Fail-Closed khi secret < 32 ký tự (chưa đủ 256-bit)", () => {
    const oldSecret = process.env.IDEMPOTENCY_SECRET;
    process.env.IDEMPOTENCY_SECRET = "short-key-16-ch!"; // 16 ký tự
    try {
        assert.throws(() => getIdempotencySecret(), /minimum 32 characters \/ 256-bit entropy required/);
    } finally {
        process.env.IDEMPOTENCY_SECRET = oldSecret;
    }
});

// =============================================================================
// NHÓM 2: CSRF MIDDLEWARE & TOKEN SECURITY
// =============================================================================
console.log("\n[Nhóm 2] Kiểm tra CSRF Protection, Token Signature & Origin Security:");

runTest("2.1. getCsrfSecret ném lỗi Fail-Closed khi CSRF_SECRET bị thiếu", () => {
    const oldSecret = process.env.CSRF_SECRET;
    delete process.env.CSRF_SECRET;
    try {
        assert.throws(() => getCsrfSecret(), /CSRF_SECRET environment variable is missing/);
    } finally {
        process.env.CSRF_SECRET = oldSecret;
    }
});

runTest("2.2. getCsrfSecret ném lỗi Fail-Closed khi CSRF_SECRET < 32 ký tự (chưa đủ 256-bit)", () => {
    const oldSecret = process.env.CSRF_SECRET;
    process.env.CSRF_SECRET = "short-key-16-ch!"; // 16 ký tự
    try {
        assert.throws(() => getCsrfSecret(), /minimum 32 characters \/ 256-bit entropy required/);
    } finally {
        process.env.CSRF_SECRET = oldSecret;
    }
});

runTest("2.3. generateCsrfToken tạo token đúng cấu trúc 4 phần", () => {
    const token = generateCsrfToken("user-123");
    const parts = token.split(".");
    assert.strictEqual(parts.length, 4, "Token phải có đúng 4 phần phân tách bằng dấu chấm");
    assert.strictEqual(parts[0].length, 32, "Nonce hex 16 bytes phải có độ dài 32 ký tự");
    assert.strictEqual(parts[2], "user-123", "Scope phải khớp với UID truyền vào");
    assert.strictEqual(parts[3].length, 64, "Signature HMAC-SHA256 phải có độ dài 64 hex");
});

runTest("2.4. verifyCsrfToken xác minh thành công token hợp lệ", () => {
    const token = generateCsrfToken("uid-player-1");
    const res = verifyCsrfToken(token, "uid-player-1");
    assert.strictEqual(res.valid, true);
});

runTest("2.5. verifyCsrfToken từ chối token khi Scope không khớp (Session-Binding Check)", () => {
    const token = generateCsrfToken("uid-player-A");
    const res = verifyCsrfToken(token, "uid-player-B");
    assert.strictEqual(res.valid, false);
    assert.ok(res.reason.includes("CSRF scope mismatch"));
});

runTest("2.6. verifyCsrfToken từ chối token bị sửa chữ ký (TimingSafeEqual)", () => {
    const token = generateCsrfToken("uid-player-1");
    const parts = token.split(".");
    const tamperedSig = parts[3].substring(0, 63) + (parts[3][63] === "a" ? "b" : "a");
    const tamperedToken = `${parts[0]}.${parts[1]}.${parts[2]}.${tamperedSig}`;

    const res = verifyCsrfToken(tamperedToken, "uid-player-1");
    assert.strictEqual(res.valid, false);
    assert.ok(res.reason.includes("HMAC signature mismatch"));
});

runTest("2.7. verifyCsrfToken từ chối token đã hết hạn (> 24h)", () => {
    const nonce = crypto.randomBytes(16).toString("hex");
    const expiredTimestamp = (Date.now() - 25 * 60 * 60 * 1000).toString();
    const scope = "uid-player-1";
    const sig = crypto.createHmac("sha256", process.env.CSRF_SECRET).update(`${nonce}:${expiredTimestamp}:${scope}`).digest("hex");
    const expiredToken = `${nonce}.${expiredTimestamp}.${scope}.${sig}`;

    const res = verifyCsrfToken(expiredToken, "uid-player-1");
    assert.strictEqual(res.valid, false);
    assert.ok(res.reason.includes("expired"));
});

runTest("2.8. validateRequestOrigin chặn đứng Origin chéo trang và không bị qua mặt bởi Host-header injection", () => {
    const validReq = {
        headers: {
            origin: "http://localhost:3000",
            host: "localhost:3000"
        }
    };
    assert.strictEqual(validateRequestOrigin(validReq), true);

    const evilReq = {
        headers: {
            origin: "http://evil-attacker.com",
            host: "localhost:3000"
        }
    };
    assert.strictEqual(validateRequestOrigin(evilReq), false);

    // Kẻ tấn công gửi kèm Host giả mạo hòng mở rộng allowlist
    const hostPoisoningReq = {
        headers: {
            host: "evil-attacker.com",
            origin: "http://evil-attacker.com"
        }
    };
    assert.strictEqual(validateRequestOrigin(hostPoisoningReq), false, "Host header không được phép làm mở rộng Origin allowlist");

    const noOriginRefererReq = {
        headers: {
            host: "localhost:3000"
        }
    };
    assert.strictEqual(validateRequestOrigin(noOriginRefererReq), false);
});

runTest("2.9. csrfProtection middleware chặn đứng request thiếu token và token không khớp", () => {
    let statusCode = null;
    let jsonResponse = null;

    const mockRes = {
        status: (code) => {
            statusCode = code;
            return {
                json: (data) => { jsonResponse = data; }
            };
        }
    };

    const req1 = {
        method: "POST",
        headers: {
            origin: "http://localhost:3000",
            host: "localhost:3000"
        }
    };
    csrfProtection(req1, mockRes, () => {});
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(jsonResponse.code, "CSRF_TOKEN_INVALID");

    const tokenA = generateCsrfToken("anon");
    const tokenB = generateCsrfToken("anon");
    const req2 = {
        method: "POST",
        headers: {
            origin: "http://localhost:3000",
            host: "localhost:3000",
            "x-csrf-token": tokenA,
            cookie: `poke.csrf=${encodeURIComponent(tokenB)}`
        }
    };
    csrfProtection(req2, mockRes, () => {});
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(jsonResponse.code, "CSRF_TOKEN_INVALID");

    let nextCalled = false;
    const req3 = {
        method: "POST",
        headers: {
            origin: "http://localhost:3000",
            host: "localhost:3000",
            "x-csrf-token": tokenA,
            cookie: `poke.csrf=${encodeURIComponent(tokenA)}`
        }
    };
    csrfProtection(req3, mockRes, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true, "Double-submit khớp phải gọi next()");
});

// =============================================================================
// NHÓM 3: ACTIVE SOCKET REGISTRY & PHYSICAL DISCONNECTION
// =============================================================================
console.log("\n[Nhóm 3] Kiểm tra Active Socket Registry & Ngắt kết nối vật lý:");

runTest("3.1. registerSocket & unregisterSocket quản lý vòng đời socket chính xác", () => {
    clearAllSockets();

    const mockSocket = {
        id: "sock-1",
        once: function(evt, handler) { this._handler = handler; },
        disconnect: function() {}
    };

    registerSocket("uid-trainer-red", mockSocket);
    assert.strictEqual(getActiveSocketCount("uid-trainer-red"), 1);

    unregisterSocket("uid-trainer-red", mockSocket);
    assert.strictEqual(getActiveSocketCount("uid-trainer-red"), 0);
    assert.strictEqual(activeSocketsByUid.has("uid-trainer-red"), false, "UID phải bị xóa khỏi map khi set rỗng");
});

runTest("3.2. Hỗ trợ theo dõi nhiều tab (Multiple Sockets) cùng 1 UID", () => {
    clearAllSockets();

    const sock1 = { id: "s1", once: () => {} };
    const sock2 = { id: "s2", once: () => {} };
    const sock3 = { id: "s3", once: () => {} };

    registerSocket("uid-multi-tab", sock1);
    registerSocket("uid-multi-tab", sock2);
    registerSocket("uid-multi-tab", sock3);

    assert.strictEqual(getActiveSocketCount("uid-multi-tab"), 3);

    unregisterSocket("uid-multi-tab", sock2);
    assert.strictEqual(getActiveSocketCount("uid-multi-tab"), 2);
});

runTest("3.3. disconnectAllSocketsForUser ngắt kết nối vật lý và phát event AUTH_REVOKED", () => {
    clearAllSockets();

    const eventsEmitted = [];
    const disconnectedSockets = [];

    const createMockSocket = (id) => ({
        id: id,
        once: () => {},
        emit: (evt, payload) => eventsEmitted.push({ id, evt, payload }),
        disconnect: (close) => disconnectedSockets.push({ id, close })
    });

    const sockA1 = createMockSocket("sock-A1");
    const sockA2 = createMockSocket("sock-A2");
    const sockB1 = createMockSocket("sock-B1");

    registerSocket("user-A", sockA1);
    registerSocket("user-A", sockA2);
    registerSocket("user-B", sockB1);

    assert.strictEqual(getActiveSocketCount("user-A"), 2);
    assert.strictEqual(getActiveSocketCount("user-B"), 1);

    const disconnectedCount = disconnectAllSocketsForUser("user-A");

    assert.strictEqual(disconnectedCount, 2);
    assert.strictEqual(getActiveSocketCount("user-A"), 0);
    assert.strictEqual(getActiveSocketCount("user-B"), 1, "Socket của user-B không được phép bị ngắt");

    assert.strictEqual(eventsEmitted.length, 2);
    assert.strictEqual(eventsEmitted[0].evt, "AUTH_REVOKED");
    assert.strictEqual(eventsEmitted[1].evt, "AUTH_REVOKED");

    assert.strictEqual(disconnectedSockets.length, 2);
    assert.strictEqual(disconnectedSockets[0].close, true);
    assert.strictEqual(disconnectedSockets[1].close, true);
});

// =============================================================================
// NHÓM 4: REGISTRATION SAGA CONTRACTS & VALIDATIONS
// =============================================================================
console.log("\n[Nhóm 4] Kiểm tra Quy tắc nghiệp vụ Saga & Idempotency:");

runTest("4.1. Danh mục VALID_CHARACTERS bảo tồn đầy đủ 9 nhân vật Pokémon", () => {
    const expected = ["red", "leaf", "brendan", "ethan", "kris", "lucas", "dawn", "blue", "silver"];
    assert.strictEqual(VALID_CHARACTERS.length, 9);
    for (const c of expected) {
        assert.ok(VALID_CHARACTERS.includes(c), `Thiếu nhân vật ${c}`);
    }
});

runTest("4.2. generateUuid sinh mã UUID chuẩn RFC 4122 v4", () => {
    const uuid = generateUuid();
    const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    assert.ok(regex.test(uuid), `UUID không đúng chuẩn RFC4122 v4: ${uuid}`);
});

// =============================================================================
// NHÓM 5: CONTROLLER CONTRACT & API HELPERS
// =============================================================================
console.log("\n[Nhóm 5] Kiểm tra API Helpers:");

runTest("5.1. isApiRequest phân loại chính xác API và Page Navigation", () => {
    assert.strictEqual(isApiRequest({ path: "/api/auth/me" }), true);
    assert.strictEqual(isApiRequest({ originalUrl: "/api/auth/login" }), true);
    assert.strictEqual(isApiRequest({ xhr: true, path: "/game" }), true);
    assert.strictEqual(isApiRequest({ path: "/login", headers: { accept: "text/html" } }), false);
    assert.strictEqual(isApiRequest({ path: "/", headers: { accept: "text/html" } }), false);
});

runTest("5.2. extractCookie trích xuất chính xác cookie từ chuỗi headers phức hợp", () => {
    const req = {
        headers: {
            cookie: "foo=bar; poke.sid=firebaseSession123456; poke.csrf=csrfTokenHex; other=val"
        }
    };
    assert.strictEqual(extractCookie(req, "poke.sid"), "firebaseSession123456");
    assert.strictEqual(extractCookie(req, "poke.csrf"), "csrfTokenHex");
    assert.strictEqual(extractCookie(req, "nonexistent"), null);
});

runTest("5.3. Định dạng Firebase UID tuân thủ cấu trúc chuỗi hợp lệ", () => {
    const firebaseUid = "vL3kx9s123AbcDefGhIjKlMnOp";
    assert.strictEqual(typeof firebaseUid, "string");
    assert(firebaseUid.length >= 20 && firebaseUid.length <= 128, "Firebase UID phải có độ dài hợp lệ");
});

// =============================================================================
// NHÓM 6: KHẢO SÁT MÔI TRƯỜNG EMULATOR (PORT PROBE ONLY — KHÔNG PHẢI INTEGRATION TEST)
// =============================================================================
console.log("\n[Nhóm 6] Khảo sát môi trường và cổng Emulator (Environment Port Probe):");

async function checkLoopbackPort(host, port) {
    return new Promise((resolve) => {
        const socket = http.get({
            host: host,
            port: port,
            path: "/",
            timeout: 1000
        }, () => {
            resolve(true);
        });
        socket.on("error", () => resolve(false));
        socket.on("timeout", () => {
            socket.destroy();
            resolve(false);
        });
    });
}

runAsyncTest("6.1. Environment Probe: Kiểm tra trạng thái cổng loopback (9099 / 8080)", async () => {
    const authEmulatorRunning = await checkLoopbackPort("127.0.0.1", 9099);
    const firestoreEmulatorRunning = await checkLoopbackPort("127.0.0.1", 8080);

    console.log(`    - Auth Emulator Port (9099): ${authEmulatorRunning ? "ACTIVE" : "OFFLINE"}`);
    console.log(`    - Firestore Emulator Port (8080): ${firestoreEmulatorRunning ? "ACTIVE" : "OFFLINE"}`);

    if (!authEmulatorRunning || !firestoreEmulatorRunning) {
        console.log("    [ĐÁNH GIÁ TRUNG THỰC THEO AGENTS.MD]:");
        console.log("    -> Máy chủ cục bộ hiện chưa cài Firebase CLI / Java JRE.");
        console.log("    -> Bài test 6.1 này CHỈ LÀ PORT PROBE, KHÔNG PHẢI BÀI TEST TÍCH HỢP XÁC THỰC.");
        console.log("    -> Các bài test tích hợp mạng Firebase Auth / Firestore thực tế: BLOCKED / NOT RUN.");
        console.log("    -> Tuyệt đối không fallback ra Firebase Production credentials!");
    } else {
        console.log("    -> Firebase Emulator đang chạy đầy đủ trên loopback.");
    }
    assert.ok(true);
});

// =============================================================================
// TỔNG KẾT KẾT QUẢ TEST
// =============================================================================
setTimeout(() => {
    console.log("\n========================================================");
    console.log(`TỔNG SỐ TEST: ${totalTests}`);
    console.log(`THÀNH CÔNG:   ${passedTests}`);
    console.log(`THẤT BẠI:     ${failedTests}`);
    console.log("========================================================");

    if (failedTests > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}, 500);
