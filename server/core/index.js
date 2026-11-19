const crypto = require("crypto");
const Move = require("./move.js");
const EVENTS = require("./events.json");
const worldRegistryService = require("../services/worldRegistryService");

const roomName = mapId => "map:" + mapId;

function playerState(socket) {
    return {
        uid: socket.playerUid,
        mapId: socket.mapId,
        x: socket.position.x,
        y: socket.position.y,
        facing: socket.position.facing || "down",
        character: socket.character
    };
}

function getRoomPlayers(socket) {
    const room = socket.nsp.adapter.rooms[roomName(socket.mapId)];
    if (!room || !room.sockets) return [];
    return Object.keys(room.sockets).map(id => socket.nsp.connected[id])
        .filter(peer => peer && peer !== socket && peer.userId && peer.playerUid && peer.mapId === socket.mapId)
        .map(playerState);
}

function isNearTransition(socket, tile) {
    if (!socket.position || !tile) return false;
    const distance = Math.abs(socket.position.x - tile.x) + Math.abs(socket.position.y - tile.y);
    return distance <= 1;
}

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

    socket.mapId = socket.mapId || worldRegistryService.getDefaultPosition().map;
    socket.position = socket.position || worldRegistryService.getDefaultPosition();
    socket.mapTransitioning = false;

    socket.join(roomName(socket.mapId), (joinError) => {
        if (joinError) return;
        socket.broadcast.to(roomName(socket.mapId)).emit(EVENTS.PLAYER_JOIN, playerState(socket));
    });

    // 2. Đăng ký xử lý di chuyển PLAYER_MOVE
    socket.on(EVENTS.PLAYER_MOVE, (input) => {
        new Move(socket).walk(input);
    });

    socket.on(EVENTS.MAP_SYNC, (ack) => {
        if (typeof ack !== "function") return;
        ack({ ok: true, mapId: socket.mapId, players: getRoomPlayers(socket) });
    });

    socket.on(EVENTS.MAP_TRANSITION, (input, ack) => {
        if (typeof ack !== "function") return;
        if (socket.mapTransitioning || !input || typeof input.transitionId !== "string") {
            ack({ ok: false, message: "Map transition request is invalid or already in progress." });
            return;
        }

        const transition = worldRegistryService.getTransition(socket.mapId, input.transitionId);
        console.log("[MAP TRANSITION DEBUG]", {
    mapId: socket.mapId,
    transitionId: input.transitionId,
    playerPosition: socket.position,
    portalTile: transition ? transition.tile : null,
    distance: transition && socket.position
        ? Math.abs(socket.position.x - transition.tile.x) +
          Math.abs(socket.position.y - transition.tile.y)
        : null
});
        if (!transition || !isNearTransition(socket, transition.tile)) {
            ack({ ok: false, message: "Player is not standing on or next to a valid portal for this map." });
            return;
        }

        socket.mapTransitioning = true;
        const oldMapId = socket.mapId;
        const oldRoom = roomName(oldMapId);
        const newRoom = roomName(transition.targetMapId);
        socket.leave(oldRoom, (leaveError) => {
            if (leaveError) {
                socket.mapTransitioning = false;
                ack({ ok: false, message: "Could not leave the current map room." });
                return;
            }

            socket.broadcast.to(oldRoom).emit(EVENTS.PLAYER_LEAVE, { uid: socket.playerUid, mapId: oldMapId });

            socket.join(newRoom, (joinError) => {
                if (joinError) {
                    socket.join(oldRoom, () => {
                        socket.broadcast.to(oldRoom).emit(EVENTS.PLAYER_JOIN, playerState(socket));
                        socket.mapTransitioning = false;
                        ack({ ok: false, message: "Could not join the destination map room." });
                    });
                    return;
                }

                socket.mapId = transition.targetMapId;
                socket.position = {
                    x: transition.spawn.x,
                    y: transition.spawn.y,
                    facing: transition.spawn.facing
                };
                const players = getRoomPlayers(socket);
                socket.broadcast.to(newRoom).emit(EVENTS.PLAYER_JOIN, playerState(socket));
                socket.mapTransitioning = false;
                ack({ ok: true, mapId: socket.mapId, players: players });
            });
        });
    });

    // 3. Đăng ký dọn dẹp khi socket ngắt kết nối (PLAYER_LEAVE)
    socket.once("disconnect", () => {
        if (socket.playerUid) {
            socket.broadcast.to(roomName(socket.mapId)).emit(EVENTS.PLAYER_LEAVE, {
                uid: socket.playerUid,
                mapId: socket.mapId
            });
        }
    });
};

module.exports = Core;
