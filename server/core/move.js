const EVENTS = require("./events.json");

const Move = function (socket) {
    this.socket = socket;
};

/**
 * Xử lý sự kiện di chuyển an toàn từ client
 * @param {Object} input - Dữ liệu di chuyển nhận từ client
 */
Move.prototype.walk = function (input) {
    // 1. Xác thực Socket: Chỉ xử lý khi socket có đầy đủ danh tính server cấp
    if (!this.socket || !this.socket.userId || !this.socket.character || !this.socket.playerUid) {
        return;
    }

    // 2. Kiểm tra tính hợp lệ của Payload
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return;
    }

    const { x, y, direction } = input;

    // 3. Kiểm tra tọa độ: Số nguyên hữu hạn, không âm
    // Lưu ý: Giới hạn biên bản đồ phía server chưa được xác minh (server hiện tại là relay, chưa nạp dữ liệu map)
    if (!Number.isInteger(x) || !Number.isFinite(x) || x < 0) {
        return;
    }

    if (!Number.isInteger(y) || !Number.isFinite(y) || y < 0) {
        return;
    }

    // 4. Kiểm tra hướng di chuyển
    if (typeof direction !== "string" || !["up", "down", "left", "right"].includes(direction)) {
        return;
    }

    // 5. Tạo Safe Payload: Tuyệt đối không tin tưởng input.character hay input.uid từ client
    const safePayload = {
        x: x,
        y: y,
        direction: direction,
        character: this.socket.character,
        uid: this.socket.playerUid
    };

    // 6. Broadcast dữ liệu đã xác thực cho các người chơi khác
    this.socket.broadcast.emit(EVENTS.PLAYER_MOVE, safePayload);
};

module.exports = Move;
