#!/usr/bin/env node
require("dotenv").config();

const readline = require("readline");
const firebaseConfig = require("../server/config/firebase");
const firebaseAuthService = require("../server/services/firebaseAuthService");
const { VALID_CHARACTERS } = require("../server/services/registrationSagaService");

/**
 * Phân tích tham số dòng lệnh CLI
 * @param {string[]} args
 * @returns {Object}
 */
function parseArgs(args) {
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--username" || arg === "-u") {
            parsed.username = args[++i];
        } else if (arg === "--password" || arg === "-p") {
            parsed.password = args[++i];
        } else if (arg === "--character" || arg === "-c") {
            parsed.character = args[++i];
        } else if (arg === "--yes" || arg === "-y") {
            parsed.autoConfirm = true;
        }
    }
    return parsed;
}

/**
 * Hỏi xác nhận từ người dùng qua terminal
 * @param {string} question
 * @returns {Promise<boolean>}
 */
function askConfirmation(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            const clean = answer.trim().toLowerCase();
            resolve(clean === "y" || clean === "yes");
        });
    });
}

/**
 * Kiểm tra tính hợp lệ của username theo đúng quy tắc game
 * @param {string} rawUsername
 * @returns {string} cleanUsername
 */
function validateUsername(rawUsername) {
    if (!rawUsername || typeof rawUsername !== "string") {
        throw new Error("Username không được để trống.");
    }

    const cleanUsername = firebaseAuthService.normalizeUsername(rawUsername);

    if (cleanUsername.length < 3 || cleanUsername.length > 20) {
        throw new Error("Username phải có độ dài từ 3 đến 20 ký tự.");
    }

    const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
    if (!USERNAME_REGEX.test(cleanUsername)) {
        throw new Error("Username chỉ được chứa chữ cái tiếng Anh, chữ số và dấu gạch dưới (_).");
    }

    return cleanUsername;
}

/**
 * Kiểm tra tính hợp lệ của mật khẩu
 * @param {string} password
 */
function validatePassword(password) {
    if (!password || typeof password !== "string") {
        throw new Error("Mật khẩu không được để trống.");
    }

    if (password.length < 6) {
        throw new Error("Mật khẩu phải có độ dài tối thiểu 6 ký tự theo tiêu chuẩn Firebase Authentication.");
    }
}

/**
 * Khởi tạo tài khoản Quản trị viên đầu tiên
 */
async function bootstrapAdmin(options = {}) {
    console.log("==================================================================");
    console.log(" POKÉ-ENGINE — KHỞI TẠO TÀI KHOẢN ADMIN ĐẦU TIÊN (BOOTSTRAP)");
    console.log("==================================================================");

    // 1. Đọc cấu hình từ CLI hoặc file .env
    const rawUsername = options.username || process.env.ADMIN_BOOTSTRAP_USERNAME;
    const rawPassword = options.password || process.env.ADMIN_BOOTSTRAP_PASSWORD;
    const rawCharacter = options.character || process.env.ADMIN_BOOTSTRAP_CHARACTER || "red";

    if (!rawUsername) {
        throw new Error(
            "Chưa cấu hình username. Vui lòng thiết lập biến môi trường ADMIN_BOOTSTRAP_USERNAME trong .env hoặc dùng flag --username <tên>."
        );
    }

    if (!rawPassword) {
        throw new Error(
            "Chưa cấu hình mật khẩu. Vui lòng thiết lập biến môi trường ADMIN_BOOTSTRAP_PASSWORD trong .env hoặc dùng flag --password <mật_khẩu>."
        );
    }

    const cleanUsername = validateUsername(rawUsername);
    validatePassword(rawPassword);

    const selectedCharacter = VALID_CHARACTERS.includes(rawCharacter.toLowerCase())
        ? rawCharacter.toLowerCase()
        : "red";

    const syntheticEmail = firebaseAuthService.getSyntheticEmail(cleanUsername);

    // 2. Hiển thị thông tin môi trường và Project ID
    const configStatus = firebaseConfig.getFirebaseConfigStatus();
    console.log("\n[Bước 1/5] Kiểm tra cấu hình môi trường Firebase:");
    console.log(`  - Firebase Project ID: ${configStatus.projectId || "(Chưa xác định)"}`);
    console.log(`  - Chế độ hoạt động:    ${configStatus.isEmulatorMode ? "LOCAL EMULATOR" : "PRODUCTION"}`);
    console.log(`  - Môi trường Node:     ${configStatus.nodeEnv}`);
    console.log(`  - Username dự kiến:    ${cleanUsername}`);
    console.log(`  - Synthetic Email:     ${syntheticEmail}`);
    console.log(`  - Nhân vật:            ${selectedCharacter}`);
    console.log("------------------------------------------------------------------");

    // 3. Yêu cầu xác nhận nếu không có cờ tự động --yes / -y
    if (!options.autoConfirm) {
        const confirmed = await askConfirmation(
            "Bạn có chắc chắn muốn tạo tài khoản Admin trên Firebase Project này? (yes/no): "
        );
        if (!confirmed) {
            console.log("\n[Hủy bỏ] Đã dừng thao tác khởi tạo theo yêu cầu.");
            return null;
        }
    }

    const adminAuth = firebaseConfig.getAuth();
    const db = firebaseConfig.getFirestore();
    const FieldValue = firebaseConfig.FieldValue;

    // 4. KIỂM TRA TRÙNG LẶP (NGĂN CHẶN GHI ĐÈ BẢO TOÀN DỮ LIỆU HIỆN CÓ)
    console.log("\n[Bước 2/5] Kiểm tra trùng lặp trên cả Firestore và Firebase Auth...");

    // 4.1. Kiểm tra trong Firestore usernames/{cleanUsername}
    const existingUsernameDoc = await db.collection("usernames").doc(cleanUsername).get();
    if (existingUsernameDoc.exists) {
        const existingUid = existingUsernameDoc.data()?.uid || "N/A";
        throw new Error(
            `Username "${cleanUsername}" ĐÃ TỒN TẠI trong Firestore (UID sở hữu: ${existingUid}). ` +
            `Dừng lại ngay lập tức để bảo vệ dữ liệu hiện có. Gợi ý: Nếu muốn cấp quyền Admin cho tài khoản này, hãy dùng: node scripts/grant-admin.js --username ${cleanUsername}`
        );
    }

    // 4.2. Kiểm tra trong Firebase Authentication theo Synthetic Email
    try {
        const existingAuthUser = await adminAuth.getUserByEmail(syntheticEmail);
        if (existingAuthUser) {
            throw new Error(
                `Tài khoản Firebase Auth với email "${syntheticEmail}" ĐÃ TỒN TẠI (UID: ${existingAuthUser.uid}). ` +
                `Dừng lại ngay lập tức để bảo vệ dữ liệu hiện có.`
            );
        }
    } catch (authLookupErr) {
        if (authLookupErr.code !== "auth/user-not-found") {
            throw authLookupErr;
        }
        // User not found là trạng thái an toàn để tiếp tục tạo mới
    }

    console.log("  -> Xác nhận: Username chưa tồn tại, an toàn để tạo mới.");

    // 5. TẠO TÀI KHOẢN TRÊN FIREBASE AUTHENTICATION
    console.log("\n[Bước 3/5] Đang tạo tài khoản trên Firebase Authentication...");
    const userRecord = await adminAuth.createUser({
        email: syntheticEmail,
        password: rawPassword,
        displayName: cleanUsername
    });
    console.log(`  -> Tạo Firebase Auth thành công. UID: ${userRecord.uid}`);

    // 6. GÁN CUSTOM CLAIMS ADMIN: TRUE
    console.log("\n[Bước 4/5] Đang gán Custom Claims { admin: true }...");
    await adminAuth.setCustomUserClaims(userRecord.uid, {
        admin: true
    });
    console.log("  -> Gán quyền Admin thành công.");

    // 7. GHI HỒ SƠ NGƯỜI DÙNG VÀ MAPPING USERNAME VÀO FIRESTORE
    console.log("\n[Bước 5/5] Đang ghi hồ sơ người chơi vào Cloud Firestore...");
    try {
        const userRef = db.collection("users").doc(userRecord.uid);
        const usernameRef = db.collection("usernames").doc(cleanUsername);

        // Sử dụng Firestore batch write hoặc transaction theo đúng schema của registrationSagaService.js
        const batch = db.batch();

        // 7.1. Schema users/{uid} (chuẩn hóa đúng registrationSagaService)
        batch.set(userRef, {
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

        // 7.2. Schema usernames/{cleanUsername} (chuẩn hóa mapping)
        batch.set(usernameRef, {
            status: "ACTIVE",
            uid: userRecord.uid,
            bootstrappedAt: FieldValue.serverTimestamp()
        });

        await batch.commit();
        console.log("  -> Ghi Firestore thành công (users/{uid} và usernames/{username}).");
    } catch (firestoreErr) {
        // NGUYÊN TẮC AN TOÀN: Báo rõ trạng thái từng bước, không tự ý xóa nếu chưa xác minh
        console.error("\n[CẢNH BÁO BẢO MẬT] Ghi Firestore thất bại sau khi đã tạo Firebase Auth!");
        console.error(`- Lỗi Firestore: ${firestoreErr.message}`);
        console.error(`- Tài khoản Auth UID: ${userRecord.uid} đã được tạo.`);
        console.error("- Hệ thống GIỮ NGUYÊN tài khoản Auth để tránh xóa nhầm dữ liệu. Quản trị viên vui lòng kiểm tra kết nối Firestore.");
        throw firestoreErr;
    }

    console.log("\n==================================================================");
    console.log(" KHỞI TẠO TÀI KHOẢN ADMIN THÀNH CÔNG RỰC RỠ!");
    console.log("==================================================================");
    console.log(`- Username:      ${cleanUsername}`);
    console.log(`- Firebase UID:  ${userRecord.uid}`);
    console.log(`- Quyền hạn:     Quản trị viên (admin: true)`);
    console.log(`- Trạng thái:    isActive = true`);
    console.log(`- Vị trí spawn:  Bản đồ "test", tọa độ (1, 1), hướng "down"`);
    console.log("------------------------------------------------------------------");
    console.log(" HƯỚNG DẪN ĐĂNG NHẬP:");
    console.log(" 1. Khởi động server game: npm start");
    console.log(" 2. Mở trình duyệt truy cập: http://localhost:3000/login");
    console.log(` 3. Đăng nhập bằng username: "${cleanUsername}" và mật khẩu bạn đã cấu hình.`);
    console.log(" 4. Truy cập Cổng Quản Trị: http://localhost:3000/admin");
    console.log("==================================================================\n");

    return {
        uid: userRecord.uid,
        username: cleanUsername,
        character: selectedCharacter,
        isAdmin: true
    };
}

// Chạy trực tiếp qua dòng lệnh CLI
if (require.main === module) {
    const rawArgs = process.argv.slice(2);
    const parsedArgs = parseArgs(rawArgs);

    bootstrapAdmin(parsedArgs)
        .then(() => process.exit(0))
        .catch((err) => {
            console.error("\n[Lỗi Khởi Tạo Admin]:", err.message);
            process.exit(1);
        });
}

module.exports = {
    parseArgs,
    validateUsername,
    validatePassword,
    bootstrapAdmin
};
