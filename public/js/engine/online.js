Game.prototype.socketListener = function () {
    this.socket.on(
        Game.EVENTS.PLAYER_MOVE,
        data => this.dispatchOnlinePlayer(data)
    );

    this.socket.on(
        Game.EVENTS.PLAYER_LEAVE,
        data => this.removeOnlinePlayer(data)
    );
};

// When a online player moves
Game.prototype.dispatchOnlinePlayer = function (data) {
    if (!data || !data.uid) return;

    if ( !(data.uid in this.onlinePlayers) ) {
        this.onlinePlayers[data.uid] = new Character(
            this, 
            data.x, 
            data.y, 
            data.direction, 
            {
                character: data.character,
                type: 1
            }
        );

        this.onlinePlayers[data.uid].addToScene();
        return;
    };

    this.onlinePlayers[data.uid].walk(data.direction);
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
