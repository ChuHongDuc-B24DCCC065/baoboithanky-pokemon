const crypto = require("crypto");
const { FieldValue, getFirestore } = require("../config/firebase");
const { createInitialEconomyData, getEconomyDocumentRef } = require("./economyService");
const {
    normalizeUsername,
    getSyntheticEmail,
    validateIdempotencyKey,
    calculatePayloadFingerprint,
    createUser,
    deleteUser,
    getUserByEmail
} = require("./firebaseAuthService");

const VALID_CHARACTERS = [
    "red",
    "leaf",
    "brendan",
    "ethan",
    "kris",
    "lucas",
    "dawn",
    "blue",
    "silver"
];

/**
 * Sinh UUID v4 chuỗi ngẫu nhiên
 * @returns {string}
 */
function generateUuid() {
    if (typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    const bytes = crypto.randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // RFC4122 version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC4122 variant
    return bytes.toString("hex").match(/(.{8})(.{4})(.{4})(.{4})(.{12})/).slice(1).join("-");
}

/**
 * Điều phối toàn bộ quy trình đăng ký tài khoản theo kiến trúc Durable Saga State Machine
 * @param {Object} params
 * @param {string} params.username
 * @param {string} params.password
 * @param {string} [params.character="red"]
 * @param {string} [params.idempotencyKey]
 * @returns {Promise<{ isExisting?: boolean, uid: string, username: string, character: string, createdAt?: any }>}
 */
async function executeRegistration({ username, password, character = "red", idempotencyKey }) {
    // 1. Kiểm tra username cơ bản
    if (!username || typeof username !== "string") {
        const err = new Error("Tên đăng nhập không được để trống và phải là chuỗi ký tự.");
        err.code = "INVALID_USERNAME";
        err.statusCode = 400;
        throw err;
    }

    const cleanUsername = normalizeUsername(username);

    if (cleanUsername.length < 3 || cleanUsername.length > 20) {
        const err = new Error("Tên đăng nhập phải có độ dài từ 3 đến 20 ký tự.");
        err.code = "INVALID_USERNAME_LENGTH";
        err.statusCode = 400;
        throw err;
    }

    const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
    if (!USERNAME_REGEX.test(cleanUsername)) {
        const err = new Error("Tên đăng nhập chỉ được chứa chữ cái tiếng Anh, chữ số và dấu gạch dưới (_).");
        err.code = "INVALID_USERNAME_FORMAT";
        err.statusCode = 400;
        throw err;
    }

    // 2. Kiểm tra password
    if (!password || typeof password !== "string") {
        const err = new Error("Mật khẩu không được để trống và phải là chuỗi ký tự.");
        err.code = "INVALID_PASSWORD";
        err.statusCode = 400;
        throw err;
    }

    if (password.length < 6) {
        const err = new Error("Mật khẩu phải có ít nhất 6 ký tự.");
        err.code = "PASSWORD_TOO_SHORT";
        err.statusCode = 400;
        throw err;
    }

    // 3. Kiểm tra character
    let selectedCharacter = "red";
    if (character !== undefined && character !== null && character !== "") {
        const trimmedChar = character.toString().trim().toLowerCase();
        if (!VALID_CHARACTERS.includes(trimmedChar)) {
            const err = new Error("Nhân vật đã chọn không hợp lệ trong danh mục trò chơi.");
            err.code = "INVALID_CHARACTER";
            err.statusCode = 400;
            throw err;
        }
        selectedCharacter = trimmedChar;
    }

    // 4. Chuẩn hóa & kiểm tra Idempotency Key
    let key = idempotencyKey;
    if (!key || typeof key !== "string" || key.trim() === "") {
        key = generateUuid();
    } else {
        key = key.trim();
        if (!validateIdempotencyKey(key)) {
            const err = new Error("Idempotency key không hợp lệ (yêu cầu UUID v4 hoặc chuỗi URL-safe 16-64 ký tự).");
            err.code = "INVALID_IDEMPOTENCY_KEY";
            err.statusCode = 400;
            throw err;
        }
    }

    // 5. Tính toán Payload Fingerprint (HMAC-SHA256 với fail-closed secret)
    const payloadFingerprint = calculatePayloadFingerprint(cleanUsername, password, selectedCharacter);
    const syntheticEmail = getSyntheticEmail(cleanUsername);

    const db = getFirestore();
    const opRef = db.collection("registrationOperations").doc(key);
    const usernameRef = db.collection("usernames").doc(cleanUsername);

    const ownerToken = generateUuid();
    const leaseEpoch = 1;
    const now = Date.now();
    const leaseExpiresAt = now + 60000; // 60 giây lease

    // =========================================================================
    // BƯỚC 1: TRANSACTION FIRESTORE - KIỂM TRA IDEMPOTENCY VÀ GIỮ CHỖ USERNAME (PENDING)
    // =========================================================================
    const step1Result = await db.runTransaction(async (transaction) => {
        const opDoc = await transaction.get(opRef);

        if (opDoc.exists) {
            const opData = opDoc.data() || {};
            // Kiểm tra Payload Fingerprint
            if (opData.payloadFingerprint !== payloadFingerprint) {
                const err = new Error("Idempotency key này đã được sử dụng với thông tin đăng ký khác.");
                err.code = "IDEMPOTENCY_KEY_REUSED";
                err.statusCode = 409;
                throw err;
            }

            // Fingerprint trùng khớp: Xử lý theo trạng thái hiện thời
            if (opData.status === "ACTIVE") {
                // Đăng ký đã thành công hoàn tất trước đó: Đọc profile và Idempotent Replay
                const userRef = db.collection("users").doc(opData.firebaseUid);
                const userDoc = await transaction.get(userRef);
                const userData = userDoc.exists ? userDoc.data() : {
                    uid: opData.firebaseUid,
                    username: cleanUsername,
                    character: selectedCharacter
                };
                return {
                    isExisting: true,
                    uid: opData.firebaseUid,
                    username: userData.username || cleanUsername,
                    character: userData.character || selectedCharacter,
                    createdAt: userData.createdAt || null
                };
            }

            if (opData.status === "RECONCILIATION_REQUIRED") {
                const err = new Error("Yêu cầu đăng ký đang ở trạng thái cần đối soát bảo mật. Vui lòng liên hệ quản trị viên.");
                err.code = "USERNAME_RESERVATION_LOCKED";
                err.statusCode = 409;
                throw err;
            }

            if (opData.status === "FAILED") {
                const err = new Error(opData.lastError || "Yêu cầu đăng ký trước đó đã thất bại.");
                err.code = "REGISTRATION_FAILED";
                err.statusCode = 400;
                throw err;
            }

            // PENDING, AUTH_SUBMITTED, AUTH_CREATED: Request đang được xử lý song song
            const err = new Error("Yêu cầu đăng ký đang được xử lý, vui lòng chờ.");
            err.code = "OPERATION_IN_PROGRESS";
            err.statusCode = 409;
            throw err;
        }

        // Nếu Operation chưa tồn tại: Đọc document username để kiểm tra quyền sở hữu
        const usernameDoc = await transaction.get(usernameRef);
        if (usernameDoc.exists) {
            const uData = usernameDoc.data() || {};

            // BẤT BIẾN: ACTIVE là vĩnh viễn không bao giờ được phép ghi đè
            if (uData.status === "ACTIVE") {
                const err = new Error("Tên đăng nhập đã được sử dụng. Vui lòng chọn tên khác.");
                err.code = "USERNAME_ALREADY_EXISTS";
                err.statusCode = 409;
                throw err;
            }

            if (uData.status === "RESERVATION_LOCKED") {
                const err = new Error("Tên đăng nhập đang bị tạm khóa để đối soát bảo mật. Vui lòng chọn tên khác.");
                err.code = "USERNAME_RESERVATION_LOCKED";
                err.statusCode = 409;
                throw err;
            }

            // PENDING từ một request khác: kiểm tra lease
            if (uData.status === "PENDING") {
                const exp = uData.leaseExpiresAt || 0;
                if (exp > Date.now()) {
                    const err = new Error("Tên đăng nhập đang được giữ chỗ xử lý bởi yêu cầu khác. Vui lòng thử lại sau.");
                    err.code = "OPERATION_IN_PROGRESS";
                    err.statusCode = 409;
                    throw err;
                }
                // Nếu lease hết hạn nhưng request cũ ở trạng thái AUTH_SUBMITTED -> Fail-closed!
                const err = new Error("Tên đăng nhập đang được đối soát bảo mật. Vui lòng chọn tên khác.");
                err.code = "USERNAME_RESERVATION_LOCKED";
                err.statusCode = 409;
                throw err;
            }
        }

        // Tạo mới Operation Document ở trạng thái PENDING
        transaction.set(opRef, {
            ownerToken: ownerToken,
            leaseEpoch: leaseEpoch,
            status: "PENDING",
            normalizedUsername: cleanUsername,
            payloadFingerprint: payloadFingerprint,
            character: selectedCharacter,
            leaseExpiresAt: leaseExpiresAt,
            createdAt: FieldValue.serverTimestamp()
        });

        // Tạo / Cập nhật Username Document ở trạng thái PENDING
        transaction.set(usernameRef, {
            status: "PENDING",
            ownerToken: ownerToken,
            leaseEpoch: leaseEpoch,
            idempotencyKey: key,
            leaseExpiresAt: leaseExpiresAt
        });

        return {
            isExisting: false,
            ownerToken,
            leaseEpoch
        };
    });

    if (step1Result.isExisting) {
        return step1Result;
    }

    // =========================================================================
    // BƯỚC 2: TRANSACTION FIRESTORE - CHUYỂN TRẠNG THÁI SANG AUTH_SUBMITTED
    // =========================================================================
    await db.runTransaction(async (transaction) => {
        const opDoc = await transaction.get(opRef);
        if (!opDoc.exists) {
            throw new Error("[Saga Step 2] Operation doc disappeared.");
        }
        const data = opDoc.data() || {};
        if (data.ownerToken !== ownerToken || data.leaseEpoch !== leaseEpoch || data.status !== "PENDING") {
            const err = new Error("Mất quyền sở hữu lease trong quá trình chuyển sang AUTH_SUBMITTED.");
            err.code = "LEASE_LOST";
            err.statusCode = 409;
            throw err;
        }

        transaction.update(opRef, {
            status: "AUTH_SUBMITTED",
            authRequestedAt: FieldValue.serverTimestamp()
        });
    });

    // =========================================================================
    // BƯỚC 3: GỌI FIREBASE AUTH CREATUSER() (NGOÀI TRANSACTION)
    // =========================================================================
    let userRecord = null;
    try {
        userRecord = await createUser(syntheticEmail, password, cleanUsername);
    } catch (authErr) {
        // Nếu Firebase Auth báo email/username đã tồn tại
        if (authErr.code === "auth/email-already-exists") {
            try {
                await db.runTransaction(async (t) => {
                    t.update(opRef, {
                        status: "FAILED",
                        lastError: "USERNAME_ALREADY_EXISTS"
                    });
                    t.delete(usernameRef);
                });
            } catch (cleanupErr) {
                console.error("[Saga Cleanup Error]:", cleanupErr.message);
            }
            const err = new Error("Tên đăng nhập đã được sử dụng. Vui lòng chọn tên khác.");
            err.code = "USERNAME_ALREADY_EXISTS";
            err.statusCode = 409;
            throw err;
        }

        // Nếu lỗi mạng, timeout hoặc lỗi chưa xác định:
        // NGUYÊN TẮC BẢO MẬT: KHÔNG coi lỗi mạng là Auth chưa tạo user!
        // Chuyển sang RECONCILIATION_REQUIRED và khóa reservation (Fail-Closed)
        try {
            await db.runTransaction(async (t) => {
                t.update(opRef, {
                    status: "RECONCILIATION_REQUIRED",
                    lastError: authErr.message
                });
                t.update(usernameRef, {
                    status: "RESERVATION_LOCKED",
                    reason: "RECONCILIATION_REQUIRED"
                });
            });
        } catch (lockErr) {
            console.error("[Saga Lock Error]:", lockErr.message);
        }

        const err = new Error("Không thể kết nối đến máy chủ xác thực. Yêu cầu đã được khóa để đối soát.");
        err.code = "RECONCILIATION_REQUIRED";
        err.statusCode = 500;
        throw err;
    }

    // =========================================================================
    // BƯỚC 4: TRANSACTION FIRESTORE - CHUYỂN SANG AUTH_CREATED (KÈM FENCING CHECK)
    // =========================================================================
    try {
        await db.runTransaction(async (transaction) => {
            const opDoc = await transaction.get(opRef);
            if (!opDoc.exists) {
                throw new Error("[Saga Step 4] Operation doc disappeared.");
            }
            const data = opDoc.data() || {};
            // Fencing Check: Bắt buộc phải trùng ownerToken, leaseEpoch và status
            if (data.ownerToken !== ownerToken || data.leaseEpoch !== leaseEpoch || data.status !== "AUTH_SUBMITTED") {
                const err = new Error("Mất quyền sở hữu lease trước khi chuyển sang AUTH_CREATED.");
                err.code = "LEASE_LOST";
                err.statusCode = 409;
                throw err;
            }

            transaction.update(opRef, {
                status: "AUTH_CREATED",
                firebaseUid: userRecord.uid,
                leaseExpiresAt: Date.now() + 30000
            });
        });
    } catch (fencingErr) {
        // Late Response / Stale Worker Protection:
        // Tiến trình cũ bị tước quyền sở hữu -> Chỉ được phép tự tiêu hủy userRecord.uid vừa nhận
        console.error("[Saga Fencing Conflict] Lost lease at Step 4. Compensating targetUid:", userRecord.uid);
        try {
            await deleteUser(userRecord.uid);
        } catch (delErr) {
            console.error("[Saga Delete Orphan Auth User Error]:", delErr.message);
        }
        throw fencingErr;
    }

    // =========================================================================
    // BƯỚC 5: TRANSACTION FIRESTORE - KÍCH HOẠT HỒ SƠ VÀ HOÀN TẤT (ACTIVE)
    // =========================================================================
    const userRef = db.collection("users").doc(userRecord.uid);
    const economyRef = getEconomyDocumentRef(db, userRecord.uid);
    try {
        await db.runTransaction(async (transaction) => {
            const opDoc = await transaction.get(opRef);
            if (!opDoc.exists) {
                throw new Error("[Saga Step 5] Operation doc disappeared.");
            }
            const data = opDoc.data() || {};
            if (data.ownerToken !== ownerToken || data.leaseEpoch !== leaseEpoch || data.status !== "AUTH_CREATED") {
                const err = new Error("Mất quyền sở hữu lease trước khi kích hoạt ACTIVE.");
                err.code = "LEASE_LOST";
                err.statusCode = 409;
                throw err;
            }

            // Ghi nhận Profile người chơi tại users/{uid}
            // Vị trí spawn mặc định hợp lệ trên bản đồ "test" tại tile (1, 1) - đã xác minh WALKABLE
            transaction.set(userRef, {
                uid: userRecord.uid,
                username: cleanUsername,
                character: selectedCharacter,
                isActive: true,
                position: {
                    x: 1,
                    y: 1,
                    map: "test",
                    facing: "down"
                },
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            // Khởi tạo economy cùng profile trong transaction đăng ký.
            transaction.create(economyRef, createInitialEconomyData());

            // Chốt quyền sở hữu username vĩnh viễn (xóa toàn bộ trường lease tạm)
            transaction.set(usernameRef, {
                status: "ACTIVE",
                uid: userRecord.uid,
                idempotencyKey: key
            });

            // Đánh dấu Operation hoàn tất thành công
            transaction.update(opRef, {
                status: "ACTIVE",
                completedAt: FieldValue.serverTimestamp()
            });
        });

        return {
            isExisting: false,
            uid: userRecord.uid,
            username: cleanUsername,
            character: selectedCharacter,
            createdAt: new Date().toISOString()
        };
    } catch (step5Err) {
        // =====================================================================
        // BƯỚC 6: BỒI HOÀN KHI GHI FIRESTORE THẤT BẠI (COMPENSATION)
        // =====================================================================
        console.error("[Saga Step 5 Error] Failed activating profile. Starting compensation:", step5Err.message);
        try {
            await db.runTransaction(async (t) => {
                t.update(opRef, { status: "COMPENSATION_REQUIRED" });
            });
        } catch (markCompErr) {
            console.error("[Saga Mark Compensation Error]:", markCompErr.message);
        }

        // Tiêu hủy chính xác targetUid độc nhất
        try {
            await deleteUser(userRecord.uid);
            console.log(`[Saga Compensation] Successfully deleted orphan user ${userRecord.uid}`);

            // Giải phóng username sau khi đã xóa sạch Firebase Auth
            await db.runTransaction(async (t) => {
                t.delete(usernameRef);
                t.update(opRef, {
                    status: "FAILED",
                    lastError: step5Err.message
                });
            });
        } catch (compDeleteErr) {
            console.error("[Saga Compensation Delete Failed]:", compDeleteErr.message);
            // Giữ khóa fail-closed nếu không thể xóa sạch
            try {
                await db.runTransaction(async (t) => {
                    t.update(opRef, { status: "RECONCILIATION_REQUIRED" });
                    t.update(usernameRef, { status: "RESERVATION_LOCKED", reason: "COMPENSATION_FAILED" });
                });
            } catch {}
        }

        const err = new Error("Đã xảy ra lỗi hệ thống khi kích hoạt tài khoản.");
        err.code = "INTERNAL_ERROR";
        err.statusCode = 500;
        throw err;
    }
}

module.exports = {
    VALID_CHARACTERS,
    generateUuid,
    executeRegistration
};
