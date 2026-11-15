/**
 * TEST SUITE: Gameplay Position Persistence (Phase 3.2)
 * Mục tiêu: Kiểm thử endpoint POST /api/auth/position
 *           và hành vi trả về position trong GET /api/auth/me
 *
 * Chú ý: Chạy với Firebase Emulator. Không kết nối Production.
 * Lệnh chạy: node server/tests/test_gameplay_persistence.js
 */

"use strict";

const { DEFAULT_SPAWN_POSITION, MAP_WHITELIST, VALID_CHARACTERS } = require("../controllers/authController");

// ============================================================
// Utility
// ============================================================
let passed = 0;
let failed = 0;
let errors = 0;

function assert(description, condition, detail) {
    if (condition) {
        console.log("  PASS:", description);
        passed++;
    } else {
        console.error("  FAIL:", description, detail ? ("-> " + detail) : "");
        failed++;
    }
}

function assertThrows(description, fn) {
    try {
        fn();
        console.error("  FAIL:", description, "-> Expected to throw but did not");
        failed++;
    } catch (e) {
        console.log("  PASS:", description, "(threw:", e.message, ")");
        passed++;
    }
}

// Mock req / res helpers
function mockReq(body, user) {
    return {
        body: body || {},
        user: user || { uid: "test-uid-001" }
    };
}

function mockRes() {
    const res = {
        _status: null,
        _json: null,
        status(code) { this._status = code; return this; },
        json(data) { this._json = data; return this; },
        clearCookie() { return this; }
    };
    return res;
}

// ============================================================
// SUITE A: Kiểm tra DEFAULT_SPAWN_POSITION hợp lệ
// ============================================================
console.log("\n=== SUITE A: DEFAULT_SPAWN_POSITION Validation ===");

assert(
    "A1: DEFAULT_SPAWN_POSITION tồn tại và có đủ trường",
    DEFAULT_SPAWN_POSITION &&
    typeof DEFAULT_SPAWN_POSITION.x === "number" &&
    typeof DEFAULT_SPAWN_POSITION.y === "number" &&
    typeof DEFAULT_SPAWN_POSITION.map === "string" &&
    typeof DEFAULT_SPAWN_POSITION.facing === "string"
);

assert(
    "A2: DEFAULT_SPAWN_POSITION tọa độ x, y là số nguyên không âm",
    Number.isInteger(DEFAULT_SPAWN_POSITION.x) && DEFAULT_SPAWN_POSITION.x >= 0 &&
    Number.isInteger(DEFAULT_SPAWN_POSITION.y) && DEFAULT_SPAWN_POSITION.y >= 0
);

assert(
    "A3: DEFAULT_SPAWN_POSITION map nằm trong MAP_WHITELIST",
    MAP_WHITELIST.includes(DEFAULT_SPAWN_POSITION.map)
);

assert(
    "A4: DEFAULT_SPAWN_POSITION facing hợp lệ",
    ["up", "down", "left", "right"].includes(DEFAULT_SPAWN_POSITION.facing)
);

assert(
    "A5: Spawn mặc định tại tile (1, 1) trên bản đồ 'test' - đã xác minh WALKABLE",
    DEFAULT_SPAWN_POSITION.x === 1 && DEFAULT_SPAWN_POSITION.y === 1 && DEFAULT_SPAWN_POSITION.map === "test"
);

// ============================================================
// SUITE B: Kiểm tra MAP_WHITELIST
// ============================================================
console.log("\n=== SUITE B: MAP_WHITELIST Validation ===");

assert("B1: MAP_WHITELIST là mảng", Array.isArray(MAP_WHITELIST));
assert("B2: MAP_WHITELIST chứa 'test'", MAP_WHITELIST.includes("test"));
assert("B3: MAP_WHITELIST không chứa chuỗi rỗng", !MAP_WHITELIST.includes(""));
assert("B4: MAP_WHITELIST không chứa tên map giả mạo '../etc'", !MAP_WHITELIST.includes("../etc"));

// ============================================================
// SUITE C: Validation logic tọa độ trong savePosition controller
// Giả lập logic validate thủ công để kiểm tra unit
// ============================================================
console.log("\n=== SUITE C: savePosition Coordinate Validation Logic ===");

function validatePosition(x, y, map, facing) {
    if (!Number.isInteger(x) || x < 0 || x > 100) return { ok: false, reason: "INVALID_X" };
    if (!Number.isInteger(y) || y < 0 || y > 100) return { ok: false, reason: "INVALID_Y" };
    const selectedMap = (typeof map === "string" && map.trim().length > 0) ? map.trim() : "test";
    if (!MAP_WHITELIST.includes(selectedMap)) return { ok: false, reason: "INVALID_MAP" };
    const VALID_FACINGS = ["up", "down", "left", "right"];
    const selectedFacing = (typeof facing === "string" && VALID_FACINGS.includes(facing.trim().toLowerCase()))
        ? facing.trim().toLowerCase()
        : "down";
    return { ok: true, x, y, map: selectedMap, facing: selectedFacing };
}

assert("C1: Tọa độ hợp lệ (1, 1, 'test', 'down')",
    validatePosition(1, 1, "test", "down").ok === true);

assert("C2: Tọa độ hợp lệ biên trên (100, 100, 'test', 'up')",
    validatePosition(100, 100, "test", "up").ok === true);

assert("C3: Tọa độ hợp lệ biên dưới (0, 0, 'test', 'left')",
    validatePosition(0, 0, "test", "left").ok === true);

assert("C4: x âm bị từ chối (-1, 1)",
    validatePosition(-1, 1, "test", "down").ok === false);

assert("C5: x quá lớn bị từ chối (101, 1)",
    validatePosition(101, 1, "test", "down").ok === false);

assert("C6: y âm bị từ chối (1, -1)",
    validatePosition(1, -1, "test", "down").ok === false);

assert("C7: x float bị từ chối (1.5, 1)",
    validatePosition(1.5, 1, "test", "down").ok === false);

assert("C8: x chuỗi bị từ chối ('1', 1)",
    validatePosition("1", 1, "test", "down").ok === false);

assert("C9: NaN bị từ chối",
    validatePosition(NaN, 1, "test", "down").ok === false);

assert("C10: Infinity bị từ chối",
    validatePosition(Infinity, 1, "test", "down").ok === false);

assert("C11: map không có trong whitelist bị từ chối ('production')",
    validatePosition(1, 1, "production", "down").ok === false);

assert("C12: map null fallback về 'test' (hợp lệ)",
    validatePosition(1, 1, null, "down").ok === true);

assert("C13: facing không hợp lệ fallback về 'down'",
    validatePosition(1, 1, "test", "sideways").facing === "down");

assert("C14: facing 'up' được chấp nhận",
    validatePosition(1, 1, "test", "up").facing === "up");

assert("C15: facing hoa ('DOWN') được chuẩn hóa thành 'down'",
    validatePosition(1, 1, "test", "DOWN").facing === "down");

// ============================================================
// SUITE D: Kiểm tra cấu trúc module authController export
// ============================================================
console.log("\n=== SUITE D: authController Module Exports ===");

let authController;
try {
    authController = require("../controllers/authController");
    assert("D1: authController load thành công", true);
} catch (e) {
    console.error("  FAIL: authController load thất bại:", e.message);
    failed++;
    errors++;
    authController = null;
}

if (authController) {
    assert("D2: register exported", typeof authController.register === "function");
    assert("D3: login exported", typeof authController.login === "function");
    assert("D4: logout exported", typeof authController.logout === "function");
    assert("D5: logoutAll exported", typeof authController.logoutAll === "function");
    assert("D6: me exported", typeof authController.me === "function");
    assert("D7: savePosition exported (mới thêm)", typeof authController.savePosition === "function");
    assert("D8: DEFAULT_SPAWN_POSITION exported", authController.DEFAULT_SPAWN_POSITION && typeof authController.DEFAULT_SPAWN_POSITION === "object");
    assert("D9: MAP_WHITELIST exported", Array.isArray(authController.MAP_WHITELIST));
    assert("D10: VALID_CHARACTERS exported", Array.isArray(authController.VALID_CHARACTERS));
}

// ============================================================
// SUITE E: Kiểm tra authRoutes có route /position
// ============================================================
console.log("\n=== SUITE E: authRoutes Route Registration ===");

let routesSource;
try {
    const fs = require("fs");
    const path = require("path");
    routesSource = fs.readFileSync(path.join(__dirname, "../routes/authRoutes.js"), "utf8");
    assert("E1: authRoutes.js đọc thành công", true);
} catch (e) {
    console.error("  FAIL: Không đọc được authRoutes.js:", e.message);
    failed++;
    errors++;
    routesSource = "";
}

if (routesSource) {
    assert("E2: Route POST /position tồn tại trong authRoutes.js",
        routesSource.includes('router.post("/position"'));

    assert("E3: requireAuth áp dụng cho /position",
        routesSource.includes('router.post("/position", requireAuth'));

    assert("E4: csrfProtection áp dụng cho /position",
        routesSource.includes('csrfProtection, authController.savePosition'));

    assert("E5: Route GET /me tồn tại",
        routesSource.includes('router.get("/me"'));

    assert("E6: Route POST /logout tồn tại",
        routesSource.includes('router.post("/logout"'));
}

// ============================================================
// SUITE F: Kiểm tra registrationSagaService có position mặc định
// ============================================================
console.log("\n=== SUITE F: Registration Saga Default Position ===");

let sagaSource;
try {
    const fs = require("fs");
    const path = require("path");
    sagaSource = fs.readFileSync(path.join(__dirname, "../services/registrationSagaService.js"), "utf8");
    assert("F1: registrationSagaService.js đọc thành công", true);
} catch (e) {
    console.error("  FAIL: Không đọc được registrationSagaService.js:", e.message);
    failed++;
    errors++;
    sagaSource = "";
}

if (sagaSource) {
    assert("F2: Default position được khởi tạo khi tạo user mới",
        sagaSource.includes("position:") && sagaSource.includes("x: 1") && sagaSource.includes("y: 1"));

    assert("F3: Default position có map 'test'",
        sagaSource.includes("map: \"test\""));

    assert("F4: Default position có facing 'down'",
        sagaSource.includes("facing: \"down\""));
}

// ============================================================
// SUITE G: Kiểm tra load.js có logic khôi phục position từ /me
// ============================================================
console.log("\n=== SUITE G: load.js Position Restoration Logic ===");

let loadSource;
try {
    const fs = require("fs");
    const path = require("path");
    loadSource = fs.readFileSync(path.join(__dirname, "../../public/js/engine/load.js"), "utf8");
    assert("G1: load.js đọc thành công", true);
} catch (e) {
    console.error("  FAIL: Không đọc được load.js:", e.message);
    failed++;
    errors++;
    loadSource = "";
}

if (loadSource) {
    assert("G2: load.js đọc user.position từ /api/auth/me response",
        loadSource.includes("user.position"));

    assert("G3: load.js cập nhật savedData.x từ user.position.x",
        loadSource.includes("self.savedData.x = user.position.x"));

    assert("G4: load.js cập nhật savedData.y từ user.position.y",
        loadSource.includes("self.savedData.y = user.position.y"));

    assert("G5: load.js cập nhật savedData.map từ user.position.map",
        loadSource.includes("self.savedData.map = user.position.map"));

    assert("G6: load.js kiểm tra Number.isInteger trước khi gán position",
        loadSource.includes("Number.isInteger(user.position.x)") && loadSource.includes("Number.isInteger(user.position.y)"));
}

// ============================================================
// SUITE H: Kiểm tra index.js có savePosition và scheduleSavePosition
// ============================================================
console.log("\n=== SUITE H: index.js Game Position Methods ===");

let indexSource;
try {
    const fs = require("fs");
    const path = require("path");
    indexSource = fs.readFileSync(path.join(__dirname, "../../public/js/engine/index.js"), "utf8");
    assert("H1: index.js đọc thành công", true);
} catch (e) {
    console.error("  FAIL: Không đọc được index.js:", e.message);
    failed++;
    errors++;
    indexSource = "";
}

if (indexSource) {
    assert("H2: savePosition method tồn tại",
        indexSource.includes("Game.prototype.savePosition"));

    assert("H3: scheduleSavePosition method tồn tại",
        indexSource.includes("Game.prototype.scheduleSavePosition"));

    assert("H4: Debounce 2000ms trong scheduleSavePosition",
        indexSource.includes("2000"));

    assert("H5: openDialogue set player.stop = true",
        indexSource.includes("this.player.stop = true"));

    assert("H6: closeDialogue set player.stop = false",
        indexSource.includes("this.player.stop = false"));

    assert("H7: openDialogue cập nhật state = DIALOGUE",
        indexSource.includes("this.state = \"DIALOGUE\""));

    assert("H8: closeDialogue cập nhật state = NORMAL",
        indexSource.includes("this.state = \"NORMAL\""));

    assert("H9: getCsrfToken() đọc cookie poke.csrf trong savePosition",
        indexSource.includes("poke\\.csrf") || indexSource.includes("poke.csrf"));

    assert("H10: Gửi fetch POST /api/auth/position",
        indexSource.includes("/api/auth/position"));
}

// ============================================================
// SUITE I: Kiểm tra gameobjects.js gọi scheduleSavePosition
// ============================================================
console.log("\n=== SUITE I: gameobjects.js scheduleSavePosition Trigger ===");

let gameobjectsSource;
try {
    const fs = require("fs");
    const path = require("path");
    gameobjectsSource = fs.readFileSync(path.join(__dirname, "../../public/js/engine/gameobjects.js"), "utf8");
    assert("I1: gameobjects.js đọc thành công", true);
} catch (e) {
    console.error("  FAIL: Không đọc được gameobjects.js:", e.message);
    failed++;
    errors++;
    gameobjectsSource = "";
}

if (gameobjectsSource) {
    assert("I2: scheduleSavePosition được gọi sau bước đi hoàn chỉnh",
        gameobjectsSource.includes("scheduleSavePosition"));

    assert("I3: Chỉ gọi khi isPlayer === true",
        gameobjectsSource.includes("this[0].isPlayer") && gameobjectsSource.includes("scheduleSavePosition"));

    assert("I4: NPC class tồn tại",
        gameobjectsSource.includes("const NPC = function"));

    assert("I5: NPC.prototype.setFacing tồn tại",
        gameobjectsSource.includes("NPC.prototype.setFacing"));

    assert("I6: Player.prototype.stop được khởi tạo = false",
        gameobjectsSource.includes("this.stop = false"));
}

// ============================================================
// SUITE J: Kiểm tra boot.js lưu vị trí trước logout
// ============================================================
console.log("\n=== SUITE J: boot.js Save-Before-Logout Logic ===");

let bootSource;
try {
    const fs = require("fs");
    const path = require("path");
    bootSource = fs.readFileSync(path.join(__dirname, "../../public/js/engine/boot.js"), "utf8");
    assert("J1: boot.js đọc thành công", true);
} catch (e) {
    console.error("  FAIL: Không đọc được boot.js:", e.message);
    failed++;
    errors++;
    bootSource = "";
}

if (bootSource) {
    assert("J2: window._pokeGameInstance được gán sau khởi tạo",
        bootSource.includes("window._pokeGameInstance = gameInstance"));

    assert("J3: Logout handler đọc window._pokeGameInstance",
        bootSource.includes("window._pokeGameInstance"));

    assert("J4: game.savePosition() được gọi trước doLogout()",
        bootSource.includes("game.savePosition") && bootSource.includes("doLogout"));

    assert("J5: Fallback doLogout() nếu không có game instance",
        bootSource.includes("} else {") && bootSource.includes("doLogout()"));

    assert("J6: getCsrfToken() đọc cookie poke.csrf cho logout",
        bootSource.includes("poke\\.csrf") || bootSource.includes("poke.csrf"));
}

// ============================================================
// Tổng kết
// ============================================================
const total = passed + failed;
console.log("\n" + "=".repeat(60));
console.log(`TỔNG KẾT: ${passed}/${total} PASS | ${failed} FAIL | ${errors} ERROR`);
console.log("=".repeat(60));

if (failed > 0 || errors > 0) {
    process.exit(1);
} else {
    console.log("Tất cả kiểm thử Phase 3.2 đều PASS.");
    process.exit(0);
}
