Game.prototype.tileTypes = {
    0: null,
    1: {
        block: true
    },
    2: {
        block: false
    },
    3: {
        teleport: true
    }
};

Game.prototype.worldRegistry = null;

// Populated from /res/world.json before the selected map is loaded.
Game.prototype.maps = {};

Game.prototype.stepTime = 90;

Game.prototype.objs = {};

Game.prototype.onlinePlayers = {};

Game.prototype.mapTiles = [];

Game.prototype.tileSize = 16;

Game.prototype.mapData = {
    width: 0,
    height: 0
};

Game.EVENTS = {
    PLAYER_MOVE: 1,
    PLAYER_LEAVE: 2,
    PLAYER_JOIN: 3,
    MAP_TRANSITION: 4,
    MAP_SYNC: 5
};

Game.prototype.level = {};
