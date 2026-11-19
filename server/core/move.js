const EVENTS = require("./events.json");
const worldRegistryService = require("../services/worldRegistryService");

const Move = function (socket) {
    this.socket = socket;
};

/**
 * Xử lý sự kiện di chuyển an toàn từ client
 * @param {Object} input - Dữ liệu di chuyển nhận từ client
 */
Move.prototype.walk = function (input) {
    // 1. Xác thực Socket: Chỉ xử lý khi socket có đầy đủ danh tính server cấp
    if (!this.socket || !this.socket.userId || !this.socket.character || !this.socket.playerUid ||
        !this.socket.mapId || !this.socket.position || this.socket.mapTransitioning) {
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

    const expected = { x: this.socket.position.x, y: this.socket.position.y };
    if (direction === "up") expected.y--;
    else if (direction === "down") expected.y++;
    else if (direction === "left") expected.x--;
    else expected.x++;

    if (x !== expected.x || y !== expected.y || !worldRegistryService.isWalkable(this.socket.mapId, x, y)) {
        return;
    }

    // 5. Tạo Safe Payload: Tuyệt đối không tin tưởng input.character hay input.uid từ client
    const safePayload = {
        x: x,
        y: y,
        direction: direction,
        character: this.socket.character,
        uid: this.socket.playerUid,
        mapId: this.socket.mapId
    };

    this.socket.position = { x: x, y: y, facing: direction };

    // 6. Broadcast only to peers in the authenticated current-map room.
    this.socket.broadcast.to("map:" + this.socket.mapId).emit(EVENTS.PLAYER_MOVE, safePayload);
};

module.exports = Move;
