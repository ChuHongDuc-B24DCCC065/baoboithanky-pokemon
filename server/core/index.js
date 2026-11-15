const crypto = require("crypto");
const Move = require("./move.js");
const EVENTS = require("./events.json");

const Core = function () {};

Core.prototype.auth = function () {};

/**
 * Xử lý kết nối Socket.IO sau khi đã vượt qua Handshake Authentication
 * @param {import("socket.io").Socket} socket
 */
Core.prototype.conn = function (socket) {
    // 1. Cấp Player UID độc lập cho từng connection (mỗi tab có 1 UID riêng)
    if (!socket.playerUid) {
        socket.playerUid = crypto.randomUUID();
    }

    // 2. Đăng ký xử lý di chuyển PLAYER_MOVE
    socket.on(EVENTS.PLAYER_MOVE, (input) => {
        new Move(socket).walk(input);
    });

    // 3. Đăng ký dọn dẹp khi socket ngắt kết nối (PLAYER_LEAVE)
    socket.once("disconnect", () => {
        if (socket.playerUid) {
            socket.broadcast.emit(EVENTS.PLAYER_LEAVE, {
                uid: socket.playerUid
            });
        }
    });
};

module.exports = Core;
