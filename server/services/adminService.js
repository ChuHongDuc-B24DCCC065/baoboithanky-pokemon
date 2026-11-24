const firebaseConfig = require("../config/firebase");
const { normalizeUsername } = require("./firebaseAuthService");
const { disconnectAllSocketsForUser } = require("../socket/activeSockets");
const ItemCatalog = require("../../public/js/engine/ui/itemCatalog");
const itemCatalogService = require("./itemCatalogService");
const pokemonCatalogService = require("./pokemonCatalogService");

/**
 * Chuẩn hóa và làm sạch dữ liệu hồ sơ người chơi (Sanitization)
 * Tuyệt đối không trả về synthetic email, password, token, session hoặc dữ liệu nhạy cảm.
 * @param {Object} data - Dữ liệu thô từ Firestore doc
 * @param {string} docId - UID của document
 * @returns {Object} Hồ sơ người chơi đã làm sạch
 */
function sanitizePlayer(data = {}, docId = "") {
    const rawPos = data.position || {};
    return {
        uid: docId || data.uid || "",
        username: data.username || "",
        character: data.character || "red",
        isActive: data.isActive !== false,
        position: {
            map: typeof rawPos.map === "string" ? rawPos.map : "test",
            x: Number.isInteger(rawPos.x) ? rawPos.x : 1,
            y: Number.isInteger(rawPos.y) ? rawPos.y : 1,
            facing: typeof rawPos.facing === "string" ? rawPos.facing : "down"
        },
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null
    };
}

/**
 * Lấy thông tin hồ sơ Quản trị viên đã được chuẩn hóa và làm sạch (Sanitized)
 * @param {string} uid - Firebase UID của quản trị viên
 * @returns {Promise<{ uid: string, username: string, character: string, role: string, createdAt: any }>}
 */
async function getAdminProfile(uid) {
    if (!uid || typeof uid !== "string") {
        throw new Error("[Admin Service] UID must be a valid non-empty string.");
    }

    const db = firebaseConfig.getFirestore();
    const userDoc = await db.collection("users").doc(uid.trim()).get();

    if (!userDoc.exists) {
        const err = new Error("Hồ sơ quản trị viên không tồn tại.");
        err.code = "ADMIN_NOT_FOUND";
        err.statusCode = 404;
        throw err;
    }

    const userData = userDoc.data() || {};

    return {
        uid: uid.trim(),
        username: userData.username || "",
        character: userData.character || "red",
        role: "admin",
        createdAt: userData.createdAt || null
    };
}

/**
 * Đọc danh mục Pokémon hiện có và chỉ trả về các trường phục vụ tra cứu Admin.
 * Dữ liệu gốc vẫn được lấy trực tiếp từ public/res/pokemon/species.json.
 */
async function getPokemonCatalog() {
    const species = await pokemonCatalogService.getEffectiveSpecies();
    return species.map((pokemon) => ({
        id: String(pokemon.id),
        nationalDex: Number(pokemon.nationalDex),
        name: String(pokemon.name || ""),
        generation: Number(pokemon.generation),
        types: Array.isArray(pokemon.types) ? pokemon.types.map(String) : [],
        heightM: Number(pokemon.heightM),
        weightKg: Number(pokemon.weightKg),
        dexEntry: String(pokemon.dexEntry || ""),
        baseStats: pokemon.baseStats && typeof pokemon.baseStats === "object"
            ? {
                hp: Number(pokemon.baseStats.hp),
                attack: Number(pokemon.baseStats.attack),
                defense: Number(pokemon.baseStats.defense),
                speed: Number(pokemon.baseStats.speed),
                special: Number(pokemon.baseStats.special)
            }
            : null
    }));
}

async function updatePokemonCatalogEntry(speciesId, metadata) {
    return pokemonCatalogService.updateSpeciesMetadata(speciesId, metadata);
}

/** Đọc Item Catalog hiện tại, không trả tham chiếu mutable tới catalog gốc. */
async function getItemCatalog() {
    const effectiveItems = await itemCatalogService.getEffectiveItems();
    return effectiveItems.map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        icon: item.icon || "",
        sprite: item.sprite || null,
        description: item.description || "",
        effect: item.effect ? { ...item.effect } : null,
        shop: item.shop ? { ...item.shop } : null,
        isEquipment: item.isEquipment === true,
        equipmentSlot: item.equipmentSlot || null,
        stats: item.stats ? { ...item.stats } : null
    }));
}

async function updateItemCatalogEntry(itemId, metadata) {
    return itemCatalogService.updateItemMetadata(itemId, metadata);
}

/**
 * Lấy danh sách người chơi thực từ Firestore có phân trang và tìm kiếm phía server
 * Phân trang được thực hiện trực tiếp tại Firestore (không tải toàn bộ collection về memory).
 * Sử dụng single-field index trên trường "username".
 * @param {Object} options
 * @param {number} [options.page=1]
 * @param {number} [options.limit=10]
 * @param {string} [options.search=""]
 * @returns {Promise<{ players: Array, pagination: { page: number, limit: number, total: number, totalPages: number } }>}
 */
async function getPlayersList({ page = 1, limit = 10, search = "" } = {}) {
    const sanitizedPage = Math.max(1, parseInt(page, 10) || 1);
    const sanitizedLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
    const offset = (sanitizedPage - 1) * sanitizedLimit;

    const db = firebaseConfig.getFirestore();
    let query = db.collection("users");
    let countQuery = db.collection("users");

    // Xử lý tìm kiếm theo tiền tố username nếu có
    const hasSearch = typeof search === "string" && search.trim() !== "";
    if (hasSearch) {
        const cleanSearch = normalizeUsername(search);
        // Range query tiền tố trên username (sử dụng single-field index mặc định của Firestore)
        query = query
            .where("username", ">=", cleanSearch)
            .where("username", "<=", cleanSearch + "\uf8ff")
            .orderBy("username", "asc");

        countQuery = countQuery
            .where("username", ">=", cleanSearch)
            .where("username", "<=", cleanSearch + "\uf8ff");
    } else {
        query = query.orderBy("username", "asc");
    }

    // Đếm tổng số bản ghi bằng server aggregation count() của Firestore
    let total = 0;
    try {
        if (typeof countQuery.count === "function") {
            const countSnap = await countQuery.count().get();
            total = countSnap.data() ? countSnap.data().count : 0;
        } else {
            // Fallback phòng khi môi trường mock test không cài đặt .count()
            const allSnap = await countQuery.get();
            total = allSnap.size || (allSnap.docs ? allSnap.docs.length : 0);
        }
    } catch (countErr) {
        console.warn("[Admin Service] count() query warning:", countErr.message);
        // Fallback an toàn
        const allSnap = await countQuery.get();
        total = allSnap.size || (allSnap.docs ? allSnap.docs.length : 0);
    }

    // Truy vấn phân trang thực tế tại Firestore với limit & offset
    const snapshot = await query.limit(sanitizedLimit).offset(offset).get();
    const players = [];

    if (snapshot && typeof snapshot.forEach === "function") {
        snapshot.forEach((doc) => {
            players.push(sanitizePlayer(doc.data(), doc.id));
        });
    }

    const totalPages = Math.ceil(total / sanitizedLimit) || 1;

    return {
        players,
        pagination: {
            page: sanitizedPage,
            limit: sanitizedLimit,
            total,
            totalPages
        }
    };
}

/**
 * Lấy chi tiết hồ sơ người chơi theo UID
 * @param {string} targetUid - UID của người chơi cần xem
 * @returns {Promise<Object>} Hồ sơ người chơi đã làm sạch
 */
async function getPlayerDetail(targetUid) {
    if (!targetUid || typeof targetUid !== "string" || targetUid.trim() === "") {
        const err = new Error("UID người chơi không hợp lệ.");
        err.code = "INVALID_UID";
        err.statusCode = 400;
        throw err;
    }

    const db = firebaseConfig.getFirestore();
    const doc = await db.collection("users").doc(targetUid.trim()).get();

    if (!doc.exists) {
        const err = new Error("Không tìm thấy hồ sơ người chơi với UID đã cung cấp.");
        err.code = "PLAYER_NOT_FOUND";
        err.statusCode = 404;
        throw err;
    }

    return sanitizePlayer(doc.data(), doc.id);
}

/**
 * Cập nhật trạng thái khóa/mở khóa tài khoản người chơi
 * Đồng bộ hai tầng: Firebase Auth (disabled + revoke tokens + ngắt socket) và Firestore (isActive).
 * @param {string} targetUid - UID người chơi cần cập nhật
 * @param {boolean} isActive - Trạng thái mới (true: mở khóa, false: khóa)
 * @param {string} adminUid - UID của Admin đang thực hiện hành động
 * @returns {Promise<{ uid: string, isActive: boolean }>}
 */
async function setPlayerStatus(targetUid, isActive, adminUid) {
    if (!targetUid || typeof targetUid !== "string" || targetUid.trim() === "") {
        const err = new Error("UID người chơi không hợp lệ.");
        err.code = "INVALID_UID";
        err.statusCode = 400;
        throw err;
    }

    if (typeof isActive !== "boolean") {
        const err = new Error("Trạng thái isActive bắt buộc phải là kiểu boolean (true hoặc false).");
        err.code = "INVALID_STATUS";
        err.statusCode = 400;
        throw err;
    }

    const cleanTargetUid = targetUid.trim();

    // 1. Chặn Admin tự khóa tài khoản của chính mình
    if (cleanTargetUid === adminUid && isActive === false) {
        const err = new Error("Bạn không thể tự khóa tài khoản Quản trị viên của chính mình.");
        err.code = "CANNOT_LOCK_SELF";
        err.statusCode = 400;
        throw err;
    }

    const db = firebaseConfig.getFirestore();
    const userRef = db.collection("users").doc(cleanTargetUid);
    const doc = await userRef.get();

    if (!doc.exists) {
        const err = new Error("Không tìm thấy hồ sơ người chơi cần cập nhật trạng thái.");
        err.code = "PLAYER_NOT_FOUND";
        err.statusCode = 404;
        throw err;
    }

    const adminAuth = firebaseConfig.getAuth();

    // 2. BƯỚC 1: Cập nhật Firebase Authentication (disabled: !isActive)
    try {
        await adminAuth.updateUser(cleanTargetUid, {
            disabled: !isActive
        });
    } catch (authErr) {
        const err = new Error(`Cập nhật trạng thái Firebase Authentication thất bại: ${authErr.message}`);
        err.code = "AUTH_UPDATE_FAILED";
        err.statusCode = 500;
        throw err;
    }

    // 3. BƯỚC 2: Nếu là KHÓA TÀI KHOẢN, cưỡng chế thu hồi refresh tokens và ngắt kết nối socket
    if (!isActive) {
        try {
            await adminAuth.revokeRefreshTokens(cleanTargetUid);
        } catch (revokeErr) {
            console.warn(`[Admin Service] revokeRefreshTokens warning for ${cleanTargetUid}:`, revokeErr.message);
        }

        try {
            disconnectAllSocketsForUser(cleanTargetUid);
        } catch (sockErr) {
            console.warn(`[Admin Service] disconnectAllSockets warning for ${cleanTargetUid}:`, sockErr.message);
        }
    }

    // 4. BƯỚC 3: Cập nhật Cloud Firestore (isActive: isActive, updatedAt)
    try {
        const FieldValue = firebaseConfig.FieldValue;
        const updatePayload = {
            isActive: isActive,
            updatedAt: FieldValue && typeof FieldValue.serverTimestamp === "function"
                ? FieldValue.serverTimestamp()
                : new Date().toISOString()
        };
        await userRef.update(updatePayload);
    } catch (dbErr) {
        // Báo rõ lỗi Firestore khi Auth đã disable để có thể thử lại an toàn (Idempotent)
        const err = new Error(`Đã cập nhật Firebase Auth nhưng cập nhật Firestore thất bại: ${dbErr.message}`);
        err.code = "FIRESTORE_UPDATE_FAILED";
        err.statusCode = 500;
        err.partialSync = true;
        throw err;
    }

    return {
        uid: cleanTargetUid,
        isActive: isActive
    };
}

/**
 * Định dạng đối tượng Date thành chuỗi YYYY-MM-DD theo múi giờ Asia/Ho_Chi_Minh
 * @param {Date} date
 * @returns {string} Ví dụ: "2026-11-20"
 */
function getVietnamDateString(date) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    });
    return formatter.format(date);
}

/**
 * Định dạng đối tượng Date thành nhãn hiển thị DD/MM theo múi giờ Asia/Ho_Chi_Minh
 * @param {Date} date
 * @returns {string} Ví dụ: "20/11"
 */
function getVietnamDisplayLabel(date) {
    const formatter = new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        day: "2-digit",
        month: "2-digit"
    });
    return formatter.format(date);
}

/**
 * Khởi tạo 7 bucket ngày lịch liên tục kết thúc vào ngày hôm nay theo múi giờ Asia/Ho_Chi_Minh
 * @param {Date} [now=new Date()]
 * @returns {Array<{ dateKey: string, label: string, count: number }>}
 */
function get7DaysBuckets(now = new Date()) {
    const buckets = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateKey = getVietnamDateString(d);
        const label = getVietnamDisplayLabel(d);
        buckets.push({
            dateKey,
            label,
            count: 0
        });
    }
    return buckets;
}

/**
 * Lấy dữ liệu thống kê tổng quan cho Admin Dashboard:
 * - Tổng số người chơi (Total Players)
 * - Số người chơi đang hoạt động (Active Players: isActive === true)
 * - Số người chơi bị khóa (Locked Players: isActive === false)
 * - Số người chơi đăng ký mới trong 7 ngày gần nhất (Asia/Ho_Chi_Minh)
 * - Biểu đồ số lượng đăng ký theo từng ngày trong 7 ngày gần nhất
 * - Danh sách 5 người chơi mới nhất (đã làm sạch dữ liệu)
 * @returns {Promise<Object>}
 */
async function getOverviewDashboard() {
    const db = firebaseConfig.getFirestore();
    const usersCollection = db.collection("users");

    // 1. Thống kê số lượng: Total, Active, Locked
    // Điều kiện điều chỉnh:
    // - Chỉ tính document có isActive === false cho Locked Players
    // - Không suy luận total - active
    // - Không phân loại document thiếu isActive thành Locked
    let totalPlayers = 0;
    let activePlayers = 0;
    let lockedPlayers = 0;

    try {
        if (typeof usersCollection.count === "function") {
            const [totalSnap, activeSnap, lockedSnap] = await Promise.all([
                usersCollection.count().get(),
                usersCollection.where("isActive", "==", true).count().get(),
                usersCollection.where("isActive", "==", false).count().get()
            ]);
            totalPlayers = totalSnap.data() ? totalSnap.data().count : 0;
            activePlayers = activeSnap.data() ? activeSnap.data().count : 0;
            lockedPlayers = lockedSnap.data() ? lockedSnap.data().count : 0;
        } else {
            const [totalSnap, activeSnap, lockedSnap] = await Promise.all([
                usersCollection.get(),
                usersCollection.where("isActive", "==", true).get(),
                usersCollection.where("isActive", "==", false).get()
            ]);
            totalPlayers = totalSnap.size || (totalSnap.docs ? totalSnap.docs.length : 0);
            activePlayers = activeSnap.size || (activeSnap.docs ? activeSnap.docs.length : 0);
            lockedPlayers = lockedSnap.size || (lockedSnap.docs ? lockedSnap.docs.length : 0);
        }
    } catch (countErr) {
        console.warn("[Admin Service] count() query fallback:", countErr.message);
        const [totalSnap, activeSnap, lockedSnap] = await Promise.all([
            usersCollection.get(),
            usersCollection.where("isActive", "==", true).get(),
            usersCollection.where("isActive", "==", false).get()
        ]);
        totalPlayers = totalSnap.size || (totalSnap.docs ? totalSnap.docs.length : 0);
        activePlayers = activeSnap.size || (activeSnap.docs ? activeSnap.docs.length : 0);
        lockedPlayers = lockedSnap.size || (lockedSnap.docs ? lockedSnap.docs.length : 0);
    }

    // 2. Thống kê 7 ngày lịch gần nhất (theo múi giờ Asia/Ho_Chi_Minh)
    const now = new Date();
    const buckets = get7DaysBuckets(now);
    const earliestDateKey = buckets[0].dateKey;
    const startOfPeriod = new Date(`${earliestDateKey}T00:00:00+07:00`);

    let newPlayers7Days = 0;
    try {
        const recentRegisteredSnap = await usersCollection
            .where("createdAt", ">=", startOfPeriod)
            .get();

        if (recentRegisteredSnap && typeof recentRegisteredSnap.forEach === "function") {
            recentRegisteredSnap.forEach((doc) => {
                const data = doc.data() || {};
                const createdAtRaw = data.createdAt;
                if (!createdAtRaw) return;

                let dateObj = null;
                if (typeof createdAtRaw.toDate === "function") {
                    dateObj = createdAtRaw.toDate();
                } else if (createdAtRaw instanceof Date) {
                    dateObj = createdAtRaw;
                } else if (typeof createdAtRaw === "string" || typeof createdAtRaw === "number") {
                    dateObj = new Date(createdAtRaw);
                }

                if (dateObj && !isNaN(dateObj.getTime())) {
                    const docDateKey = getVietnamDateString(dateObj);
                    const bucket = buckets.find(b => b.dateKey === docDateKey);
                    if (bucket) {
                        bucket.count++;
                        newPlayers7Days++;
                    }
                }
            });
        }
    } catch (recentErr) {
        console.warn("[Admin Service] 7-day registration query warning:", recentErr.message);
    }

    // 3. Lấy 5 người chơi mới nhất
    // Điều kiện điều chỉnh: Chỉ trả các trường cần thiết, tuyệt đối không trả email, password, token
    const recentPlayers = [];
    try {
        const recentSnap = await usersCollection
            .orderBy("createdAt", "desc")
            .limit(5)
            .get();

        if (recentSnap && typeof recentSnap.forEach === "function") {
            recentSnap.forEach((doc) => {
                const sanitized = sanitizePlayer(doc.data(), doc.id);
                recentPlayers.push({
                    uid: sanitized.uid,
                    username: sanitized.username,
                    character: sanitized.character,
                    isActive: sanitized.isActive,
                    createdAt: sanitized.createdAt
                });
            });
        }
    } catch (orderErr) {
        console.warn("[Admin Service] Recent players query warning:", orderErr.message);
    }

    return {
        stats: {
            totalPlayers,
            activePlayers,
            lockedPlayers,
            newPlayers7Days
        },
        registrationChart: buckets.map(b => ({
            date: b.label,
            dateKey: b.dateKey,
            count: b.count
        })),
        recentPlayers
    };
}

module.exports = {
    sanitizePlayer,
    getAdminProfile,
    getPokemonCatalog,
    updatePokemonCatalogEntry,
    getItemCatalog,
    updateItemCatalogEntry,
    getPlayersList,
    getPlayerDetail,
    setPlayerStatus,
    getOverviewDashboard,
    getVietnamDateString,
    getVietnamDisplayLabel,
    get7DaysBuckets
};
