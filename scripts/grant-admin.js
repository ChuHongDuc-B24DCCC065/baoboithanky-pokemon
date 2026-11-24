#!/usr/bin/env node
require("dotenv").config();

const firebaseConfig = require("../server/config/firebase");
const firebaseAuthService = require("../server/services/firebaseAuthService");

/**
 * Phân tích tham số dòng lệnh CLI
 * Hỗ trợ:
 *   --username <tên> hoặc -u <tên>
 *   --uid <uid>
 *   Tham số trực tiếp: <username_or_uid>
 * @param {string[]} args
 * @returns {{ username?: string, uid?: string }}
 */
function parseArgs(args) {
    const parsed = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--username" || arg === "-u") {
            parsed.username = args[++i];
        } else if (arg === "--uid") {
            parsed.uid = args[++i];
        } else if (!arg.startsWith("-") && !parsed.username && !parsed.uid) {
            // Nếu không dùng flag, ưu tiên coi là username
            parsed.username = arg;
        }
    }
    return parsed;
}

/**
 * Tra cứu Firebase UID từ Username thông qua Firestore usernames/{cleanUsername} hoặc synthetic email
 * @param {string} rawUsername
 * @returns {Promise<string>} Firebase Auth UID
 */
async function resolveUidFromUsername(rawUsername) {
    const cleanUsername = firebaseAuthService.normalizeUsername(rawUsername);
    const db = firebaseConfig.getFirestore();
    const adminAuth = firebaseConfig.getAuth();

    // 1. Tra cứu trực tiếp từ Firestore collection "usernames"
    const usernameDoc = await db.collection("usernames").doc(cleanUsername).get();
    if (usernameDoc.exists && usernameDoc.data()?.uid) {
        return usernameDoc.data().uid;
    }

    // 2. Tra cứu dự phòng từ Firebase Auth bằng Synthetic Email chuẩn của hệ thống
    const syntheticEmail = firebaseAuthService.getSyntheticEmail(cleanUsername);
    try {
        const authUser = await adminAuth.getUserByEmail(syntheticEmail);
        if (authUser && authUser.uid) {
            return authUser.uid;
        }
    } catch (err) {
        if (err.code !== "auth/user-not-found") {
            throw err;
        }
    }

    throw new Error(`Không tìm thấy người dùng với username: "${rawUsername}"`);
}

/**
 * Thực thi cấp quyền admin: true vào Custom Claims của Firebase Auth
 * @param {Object} options
 * @param {string} [options.username]
 * @param {string} [options.uid]
 */
async function grantAdmin({ username, uid }) {
    const adminAuth = firebaseConfig.getAuth();
    const db = firebaseConfig.getFirestore();

    let targetUid = uid;
    let targetUsername = username;

    if (!targetUid && !targetUsername) {
        console.error("Lỗi: Vui lòng cung cấp username hoặc UID.");
        console.error("Cách dùng:");
        console.error("  node scripts/grant-admin.js --username <tên_người_dùng>");
        console.error("  node scripts/grant-admin.js --uid <firebase_uid>");
        process.exit(1);
    }

    // 1. Ánh xạ username sang UID nếu cần
    if (!targetUid && targetUsername) {
        console.log(`[Grant Admin] Đang tra cứu tài khoản với username: "${targetUsername}"...`);
        targetUid = await resolveUidFromUsername(targetUsername);
    }

    // 2. Lấy thông tin người dùng từ Firebase Auth
    const userRecord = await adminAuth.getUser(targetUid);
    if (!userRecord) {
        throw new Error(`Không tìm thấy Firebase Auth record cho UID: "${targetUid}"`);
    }

    // Lấy username thực tế từ Firestore nếu trước đó chỉ có UID
    if (!targetUsername) {
        const userDoc = await db.collection("users").doc(targetUid).get();
        if (userDoc.exists) {
            targetUsername = userDoc.data()?.username || targetUid;
        } else {
            targetUsername = userRecord.displayName || targetUid;
        }
    }

    // 3. Bảo toàn Custom Claims cũ và bổ sung admin: true
    const currentClaims = userRecord.customClaims || {};
    const updatedClaims = {
        ...currentClaims,
        admin: true
    };

    // 4. Cập nhật Custom Claims trên Firebase Auth
    await adminAuth.setCustomUserClaims(targetUid, updatedClaims);

    // NGUYÊN TẮC BẢO MẬT: KHÔNG gọi revokeRefreshTokens(targetUid) trong flow thông thường
    // Tránh làm đứt phiên chơi hiện tại của người dùng.

    console.log("==================================================================");
    console.log(" CẤP QUYỀN ADMIN THÀNH CÔNG");
    console.log("==================================================================");
    console.log(`- Username: ${targetUsername}`);
    console.log(`- UID: ${targetUid}`);
    console.log(`- Email: ${userRecord.email || "(không có)"}`);
    console.log(`- Custom Claims hiện tại:`, JSON.stringify(updatedClaims, null, 2));
    console.log("------------------------------------------------------------------");
    console.log(" LƯU Ý BẮT BUỘC ĐỂ KÍCH HOẠT QUYỀN:");
    console.log(" Người dùng cần ĐĂNG XUẤT và ĐĂNG NHẬP LẠI trên trình duyệt web");
    console.log(" để nhận Firebase Session Cookie (poke.sid) mới chứa claim admin: true.");
    console.log("==================================================================");

    return {
        uid: targetUid,
        username: targetUsername,
        claims: updatedClaims
    };
}

// Chạy trực tiếp qua CLI
if (require.main === module) {
    const rawArgs = process.argv.slice(2);
    const parsed = parseArgs(rawArgs);

    grantAdmin(parsed)
        .then(() => process.exit(0))
        .catch((err) => {
            console.error("\n[Grant Admin Error]:", err.message);
            process.exit(1);
        });
}

module.exports = {
    parseArgs,
    resolveUidFromUsername,
    grantAdmin
};
