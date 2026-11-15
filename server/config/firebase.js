const admin = require("firebase-admin");
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const { getFirestore: getAdminFirestore, FieldValue } = require("firebase-admin/firestore");
const path = require("path");
const fs = require("fs");

/**
 * MODULE QUẢN LÝ VÒNG ĐỜI FIREBASE ADMIN SDK (SINGLETON & HARDENED ISOLATION)
 * 
 * Tuân thủ nghiêm ngặt các nguyên tắc bảo mật của Task 1.4.2A-R:
 * 1. Tách biệt hoàn toàn giữa Emulator và Production: Không có fallback ngầm.
 * 2. Cấu hình Emulator bắt buộc phải có CẢ HAI endpoint (Auth & Firestore) và phải là host nội bộ (loopback).
 * 3. Chặn đứng nguy cơ âm thầm dùng Application Default Credentials (ADC) trong môi trường Development/Test.
 * 4. Không cho phép cắm Emulator endpoints vào môi trường Production.
 * 5. Xác minh khớp Project ID giữa biến môi trường và Service Account credentials.
 * 6. Singleton chuẩn xác theo app name được module quản lý (MANAGED_APP_NAME); cleanup chỉ giải phóng app của module.
 * 7. Không hardcode secrets, private keys, passwords.
 */

const MANAGED_APP_NAME = "[DEFAULT]";
const FORBIDDEN_PROD_PROJECT_IDS = new Set([
    "poke-engine-local",
    "poke-engine-test",
    "poke-engine-emulator",
    "demo-poke-engine",
    "test"
]);

// Danh sách các host loopback hợp lệ cho Local Emulator
const ALLOWED_LOOPBACK_HOSTS = new Set([
    "localhost",
    "127.0.0.1",
    "::1",
    "0.0.0.0"
]);

let managedApp = null;

/**
 * Kiểm tra tính hợp lệ của endpoint Emulator (phải là host nội bộ loopback)
 * @param {string} endpoint - Chuỗi định dạng "host:port"
 * @param {string} serviceName - Tên service (Auth hoặc Firestore)
 * @returns {string} - Endpoint đã được chuẩn hóa
 */
function validateEmulatorEndpoint(endpoint, serviceName) {
    if (!endpoint || typeof endpoint !== "string" || endpoint.trim() === "") {
        throw new Error(`[Firebase Config Error] ${serviceName} Emulator endpoint không được để trống.`);
    }

    const trimmed = endpoint.trim();
    const lastColon = trimmed.lastIndexOf(":");
    if (lastColon <= 0 || lastColon === trimmed.length - 1) {
        throw new Error(`[Firebase Config Error] ${serviceName} Emulator endpoint không đúng định dạng "host:port": "${trimmed}".`);
    }

    const host = trimmed.substring(0, lastColon).replace(/^\[|\]$/g, "");
    const portStr = trimmed.substring(lastColon + 1);
    const port = parseInt(portStr, 10);

    if (isNaN(port) || port <= 0 || port > 65535) {
        throw new Error(`[Firebase Config Error] Cổng của ${serviceName} Emulator không hợp lệ: "${portStr}".`);
    }

    if (!ALLOWED_LOOPBACK_HOSTS.has(host.toLowerCase())) {
        throw new Error(
            `[Firebase Config Error] ${serviceName} Emulator endpoint chỉ cho phép địa chỉ loopback cục bộ (127.0.0.1, localhost, ::1). Không cho phép host: "${host}".`
        );
    }

    return trimmed;
}

/**
 * Xác định chế độ môi trường Firebase một cách tường minh và an toàn
 * @param {Object} [customOptions]
 * @returns {Object} Thông tin cấu hình môi trường đã kiểm tra tính nhất quán
 */
function resolveFirebaseEnvironment(customOptions = {}) {
    const nodeEnv = (process.env.NODE_ENV || "development").toLowerCase();
    const explicitEnv = (process.env.FIREBASE_ENV || "").toLowerCase();
    const isProdMode = explicitEnv === "production" || nodeEnv === "production";

    const authHostRaw = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    const firestoreHostRaw = process.env.FIRESTORE_EMULATOR_HOST;

    const hasAuthHost = Boolean(authHostRaw && authHostRaw.trim().length > 0);
    const hasFirestoreHost = Boolean(firestoreHostRaw && firestoreHostRaw.trim().length > 0);

    // 1. Kiểm tra môi trường Production
    if (isProdMode) {
        // CẤM: Không bao giờ được phép có emulator host trong Production
        if (hasAuthHost || hasFirestoreHost) {
            throw new Error(
                "[Firebase Security Error] Phát hiện cấu hình Emulator host trong môi trường Production. Từ chối khởi động để ngăn chặn rủi ro an ninh."
            );
        }

        const explicitProjectId = customOptions.projectId || process.env.FIREBASE_PROJECT_ID;
        if (!explicitProjectId || explicitProjectId.trim() === "") {
            throw new Error(
                "[Firebase Config Error] Môi trường Production bắt buộc phải cấu hình FIREBASE_PROJECT_ID hợp lệ."
            );
        }

        if (FORBIDDEN_PROD_PROJECT_IDS.has(explicitProjectId.trim().toLowerCase())) {
            throw new Error(
                `[Firebase Security Error] Project ID "${explicitProjectId}" là định danh thử nghiệm/emulator, không được phép dùng trong Production.`
            );
        }

        return {
            mode: "production",
            projectId: explicitProjectId.trim(),
            isEmulator: false
        };
    }

    // 2. Kiểm tra môi trường Emulator
    const isExplicitEmulator = explicitEnv === "emulator";

    if (isExplicitEmulator || hasAuthHost || hasFirestoreHost) {
        // Bắt buộc cả 2 service Auth và Firestore phải được cấu hình đầy đủ
        if (!hasAuthHost || !hasFirestoreHost) {
            throw new Error(
                "[Firebase Config Error] Cấu hình Emulator không nhất quán: Cả FIREBASE_AUTH_EMULATOR_HOST và FIRESTORE_EMULATOR_HOST đều bắt buộc phải được khai báo."
            );
        }

        const authHost = validateEmulatorEndpoint(authHostRaw, "Auth");
        const firestoreHost = validateEmulatorEndpoint(firestoreHostRaw, "Firestore");

        const emulatorProjectId = customOptions.projectId || process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "poke-engine-emulator";

        return {
            mode: "emulator",
            projectId: emulatorProjectId.trim(),
            isEmulator: true,
            authHost,
            firestoreHost
        };
    }

    // 3. Môi trường Development/Test nhưng KHÔNG có cấu hình Emulator: FAIL-CLOSED
    throw new Error(
        `[Firebase Config Error] Môi trường ${nodeEnv} chưa được cấu hình Firebase Emulator hợp lệ. ` +
        `Để tránh rò rỉ kết nối ngầm lên Google Cloud Production thông qua Application Default Credentials (ADC), ` +
        `bắt buộc phải khai báo đầy đủ FIREBASE_AUTH_EMULATOR_HOST và FIRESTORE_EMULATOR_HOST (hoặc đặt FIREBASE_ENV=production với credentials hợp lệ).`
    );
}

/**
 * Nạp credentials cho Production và xác minh tính nhất quán Project ID
 * @param {Object} envConfig
 * @returns {admin.credential.Credential}
 */
function loadProductionCredentials(envConfig) {
    const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    if (serviceAccountEnv && serviceAccountEnv.trim().length > 0) {
        let serviceAccount;
        try {
            if (serviceAccountEnv.trim().startsWith("{")) {
                serviceAccount = JSON.parse(serviceAccountEnv);
            } else {
                const resolvedPath = path.resolve(process.cwd(), serviceAccountEnv.trim());
                if (!fs.existsSync(resolvedPath)) {
                    throw new Error(`Tệp Service Account không tồn tại tại: ${resolvedPath}`);
                }
                serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
            }
        } catch (parseErr) {
            throw new Error(`[Firebase Config Error] Không thể đọc Service Account Key: ${parseErr.message}`);
        }

        if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
            throw new Error("[Firebase Security Error] Service Account Key thiếu các trường bắt buộc (project_id, client_email, private_key).");
        }

        if (serviceAccount.project_id !== envConfig.projectId) {
            throw new Error(
                `[Firebase Security Error] Xung đột Project ID: Service Account thuộc project "${serviceAccount.project_id}" ` +
                `nhưng cấu hình yêu cầu project "${envConfig.projectId}".`
            );
        }

        return admin.cert(serviceAccount);
    }

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return admin.applicationDefault();
    }

    throw new Error(
        "[Firebase Security Error] Môi trường Production yêu cầu FIREBASE_SERVICE_ACCOUNT_KEY hoặc GOOGLE_APPLICATION_CREDENTIALS."
    );
}

/**
 * Khởi tạo Firebase Admin App duy nhất cho toàn bộ module (Singleton)
 * @param {Object} [customOptions] - Tùy chọn cấu hình ghi đè (cho test harness)
 * @returns {admin.app.App}
 */
function initializeFirebaseAdmin(customOptions = {}) {
    if (managedApp) {
        return managedApp;
    }

    const existingApps = typeof admin.getApps === "function" ? admin.getApps() : (admin.apps || []);
    const foundApp = existingApps.find(app => app && app.name === MANAGED_APP_NAME);
    if (foundApp) {
        managedApp = foundApp;
        return managedApp;
    }

    const envConfig = resolveFirebaseEnvironment(customOptions);

    let appOptions = {
        projectId: envConfig.projectId,
        ...customOptions
    };

    if (envConfig.mode === "production") {
        appOptions.credential = loadProductionCredentials(envConfig);
    } else {
        process.env.FIREBASE_AUTH_EMULATOR_HOST = envConfig.authHost;
        process.env.FIRESTORE_EMULATOR_HOST = envConfig.firestoreHost;
        process.env.GCLOUD_PROJECT = envConfig.projectId;
    }

    const app = admin.initializeApp(
        appOptions,
        MANAGED_APP_NAME === "[DEFAULT]" ? undefined : MANAGED_APP_NAME
    );
    managedApp = app;
    return managedApp;
}

/**
 * Lấy đối tượng Firebase App do module quản lý
 * @returns {admin.app.App}
 */
function getFirebaseApp() {
    if (!managedApp) {
        return initializeFirebaseAdmin();
    }
    return managedApp;
}

/**
 * Lấy Firebase Auth instance gắn liền với managedApp
 * @returns {admin.auth.Auth}
 */
function getAuth() {
    const app = getFirebaseApp();
    if (typeof getAdminAuth === "function") {
        return getAdminAuth(app);
    }
    return admin.auth(app);
}

/**
 * Lấy Cloud Firestore instance gắn liền với managedApp
 * @returns {admin.firestore.Firestore}
 */
function getFirestore() {
    const app = getFirebaseApp();
    if (typeof getAdminFirestore === "function") {
        return getAdminFirestore(app);
    }
    return admin.firestore(app);
}

/**
 * Trạng thái chẩn đoán Firebase cấu hình (không để lộ secrets)
 * @returns {Object}
 */
function getFirebaseConfigStatus() {
    let envConfig = null;
    let configError = null;
    try {
        envConfig = resolveFirebaseEnvironment();
    } catch (err) {
        configError = err.message;
    }

    return {
        managedAppInitialized: Boolean(managedApp),
        appName: managedApp ? managedApp.name : null,
        mode: envConfig ? envConfig.mode : "unconfigured",
        projectId: envConfig ? envConfig.projectId : null,
        isEmulatorMode: envConfig ? envConfig.isEmulator : false,
        authEmulatorHost: envConfig ? envConfig.authHost : null,
        firestoreEmulatorHost: envConfig ? envConfig.firestoreHost : null,
        configError: configError,
        nodeEnv: process.env.NODE_ENV || "development"
    };
}

/**
 * Dọn dẹp DUY NHẤT Firebase App do module này quản lý
 * Tuyệt đối không xóa các app do module khác tạo ra.
 * @returns {Promise<void>}
 */
async function cleanupFirebase() {
    if (managedApp) {
        const appToDelete = managedApp;
        managedApp = null;
        try {
            if (typeof admin.deleteApp === "function") {
                await admin.deleteApp(appToDelete);
            } else if (typeof appToDelete.delete === "function") {
                await appToDelete.delete();
            }
        } catch (err) {
            // Đã xóa hoặc đã giải phóng
        }
    }
}

module.exports = {
    admin,
    MANAGED_APP_NAME,
    validateEmulatorEndpoint,
    resolveFirebaseEnvironment,
    initializeFirebaseAdmin,
    getFirebaseApp,
    getAuth,
    getFirestore,
    FieldValue,
    getFirebaseConfigStatus,
    cleanupFirebase
};
