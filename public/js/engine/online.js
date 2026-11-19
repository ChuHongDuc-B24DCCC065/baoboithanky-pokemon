Game.prototype.socketListener = function () {
    this.socket.on(
        Game.EVENTS.PLAYER_MOVE,
        data => this.dispatchOnlinePlayer(data)
    );

    this.socket.on(
        Game.EVENTS.PLAYER_LEAVE,
        data => this.removeOnlinePlayer(data)
    );

    this.socket.on(
        Game.EVENTS.PLAYER_JOIN,
        data => this.addOnlinePlayer(data)
    );

    this.socket.on("connect", () => this.requestMapSnapshot());

    if (this.socket.connected) this.requestMapSnapshot();
};

Game.prototype.clearOnlinePlayers = function () {
    if (!this.onlinePlayers) this.onlinePlayers = {};
    Object.keys(this.onlinePlayers).forEach(uid => {
        const player = this.onlinePlayers[uid];
        if (player && player.$el && player.$el.parentNode) {
            player.$el.parentNode.removeChild(player.$el);
        }
        delete this.onlinePlayers[uid];
    });
};

Game.prototype.addOnlinePlayer = function (data) {
    if (!data || !data.uid || data.mapId !== this.savedData.map) return;
    if (this.onlinePlayers[data.uid]) this.removeOnlinePlayer({ uid: data.uid });

    this.onlinePlayers[data.uid] = new Character(
        this,
        data.x,
        data.y,
        data.direction || data.facing || "down",
        { character: data.character, type: 1 }
    );
    this.onlinePlayers[data.uid].addToScene();
};

Game.prototype.addOnlinePlayerSnapshot = function (players) {
    if (!Array.isArray(players)) return;
    players.forEach(player => this.addOnlinePlayer(player));
};

Game.prototype.requestMapSnapshot = function () {
    if (!this.socket || !this.socket.connected) return;
    this.socket.emit(Game.EVENTS.MAP_SYNC, function (result) {
        if (!result || !result.ok || result.mapId !== this.savedData.map) return;
        this.clearOnlinePlayers();
        this.addOnlinePlayerSnapshot(result.players);
    }.bind(this));
};

Game.prototype.requestServerMapTransition = function (transitionId) {
    const self = this;
    if (!this.socket || !this.socket.connected) {
        return Promise.reject(new Error("Socket.IO is disconnected; map transition was not applied."));
    }

    return new Promise(function (resolve, reject) {
        const timeout = setTimeout(function () {
            reject(new Error("Socket.IO map transition acknowledgement timed out."));
        }, 5000);

        self.socket.emit(Game.EVENTS.MAP_TRANSITION, { transitionId: transitionId }, function (result) {
            clearTimeout(timeout);
            if (!result || !result.ok) {
                reject(new Error((result && result.message) || "Server rejected map transition."));
                return;
            }
            resolve(result);
        });
    });
};

// When a online player moves
Game.prototype.dispatchOnlinePlayer = function (data) {
    if (!data || !data.uid || data.mapId !== this.savedData.map) return;

    if ( !(data.uid in this.onlinePlayers) ) {
        this.addOnlinePlayer(data);
        return;
    };

    this.onlinePlayers[data.uid].walk(data.direction);
    this.onlinePlayers[data.uid].position.x = data.x;
    this.onlinePlayers[data.uid].position.y = data.y;
    this.onlinePlayers[data.uid].position.facing = data.direction;
};

// When an online player disconnects / leaves
Game.prototype.removeOnlinePlayer = function (data) {
    if (!data || !data.uid) {
        return;
    }

    const uid = data.uid;
    const targetPlayer = this.onlinePlayers[uid];

    if (!targetPlayer) {
        return;
    }

    // Xóa phần tử DOM khỏi scene an toàn
    if (targetPlayer.$el) {
        if (typeof targetPlayer.$el.remove === "function") {
            targetPlayer.$el.remove();
        } else if (targetPlayer.$el.parentNode) {
            targetPlayer.$el.parentNode.removeChild(targetPlayer.$el);
        }
    }

    // Xóa khỏi danh sách theo dõi
    delete this.onlinePlayers[uid];
};
