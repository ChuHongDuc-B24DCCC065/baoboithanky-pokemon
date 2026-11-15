/**
 * ACTIVE SOCKET REGISTRY (IN-MEMORY)
 * 
 * Quản lý và theo dõi các kết nối Socket.IO đang hoạt động theo Firebase UID.
 * Phục vụ ngắt kết nối cưỡng chế (Physical Disconnection) khi người chơi thực hiện logout-all.
 */

// Map ánh xạ từ Firebase UID sang tập hợp các Socket instances đang kết nối
// Map<string, Set<Socket>>
const activeSocketsByUid = new Map();

/**
 * Đăng ký một socket instance vào danh sách hoạt động của user
 * @param {string} uid - Firebase User ID
 * @param {import("socket.io").Socket} socket - Socket instance
 */
function registerSocket(uid, socket) {
    if (!uid || !socket) return;

    if (!activeSocketsByUid.has(uid)) {
        activeSocketsByUid.set(uid, new Set());
    }

    const userSockets = activeSocketsByUid.get(uid);
    userSockets.add(socket);

    // Tự động lắng nghe sự kiện disconnect nếu chưa được đăng ký trước đó
    if (!socket._hasActiveSocketDisconnectListener) {
        socket._hasActiveSocketDisconnectListener = true;
        socket.once("disconnect", () => {
            unregisterSocket(uid, socket);
        });
    }
}

/**
 * Hủy đăng ký một socket instance khi socket đóng kết nối
 * @param {string} uid - Firebase User ID
 * @param {import("socket.io").Socket} socket - Socket instance
 */
function unregisterSocket(uid, socket) {
    if (!uid || !socket) return;

    const userSockets = activeSocketsByUid.get(uid);
    if (userSockets) {
        userSockets.delete(socket);
        if (userSockets.size === 0) {
            activeSocketsByUid.delete(uid);
        }
    }
}

/**
 * Cưỡng chế ngắt toàn bộ kết nối Socket.IO của một người chơi (cho sự kiện logout-all)
 * @param {string} uid - Firebase User ID
 * @returns {number} Số lượng socket đã bị ngắt
 */
function disconnectAllSocketsForUser(uid) {
    if (!uid) return 0;

    const userSockets = activeSocketsByUid.get(uid);
    if (!userSockets || userSockets.size === 0) {
        activeSocketsByUid.delete(uid);
        return 0;
    }

    let disconnectedCount = 0;
    // Tạo bản sao mảng để lặp an toàn khi các socket trigger disconnect handler
    const socketsToDisconnect = Array.from(userSockets);

    for (const socket of socketsToDisconnect) {
        try {
            if (typeof socket.emit === "function") {
                socket.emit("AUTH_REVOKED", {
                    message: "Phiên đăng nhập đã bị thu hồi từ xa. Vui lòng đăng nhập lại."
                });
            }
            if (typeof socket.disconnect === "function") {
                socket.disconnect(true);
            }
            disconnectedCount++;
        } catch (err) {
            console.error(`[ActiveSockets] Error disconnecting socket for uid ${uid}:`, err.message);
        }
    }

    activeSocketsByUid.delete(uid);
    return disconnectedCount;
}

/**
 * Lấy số lượng socket đang kết nối của một user
 * @param {string} uid - Firebase User ID
 * @returns {number}
 */
function getActiveSocketCount(uid) {
    if (!uid) return 0;
    const userSockets = activeSocketsByUid.get(uid);
    return userSockets ? userSockets.size : 0;
}

/**
 * Xóa sạch registry (dùng cho test suite cleanup)
 */
function clearAllSockets() {
    activeSocketsByUid.clear();
}

module.exports = {
    activeSocketsByUid,
    registerSocket,
    unregisterSocket,
    disconnectAllSocketsForUser,
    getActiveSocketCount,
    clearAllSockets
};
