const fs = require("fs");
const path = require("path");

const PUBLIC_ROOT = path.resolve(__dirname, "../../public");
const REGISTRY_PATH = path.join(PUBLIC_ROOT, "res", "world.json");
const WORLD_REGISTRY = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));

function getMap(mapId) {
    if (typeof mapId !== "string" || !WORLD_REGISTRY.maps ||
        !Object.prototype.hasOwnProperty.call(WORLD_REGISTRY.maps, mapId)) return null;
    return WORLD_REGISTRY.maps[mapId];
}

function getMapIds() {
    return Object.keys(WORLD_REGISTRY.maps || {});
}

function resolvePublicResource(publicPath) {
    if (typeof publicPath !== "string" || !publicPath.startsWith("/res/") ||
        publicPath.indexOf("..") !== -1 || publicPath.indexOf("\\") !== -1 ||
        publicPath.indexOf("?") !== -1 || publicPath.indexOf("#") !== -1) {
        throw new Error("World Registry contains an invalid public resource path.");
    }
    const fullPath = path.resolve(PUBLIC_ROOT, publicPath.slice(1));
    if (!fullPath.startsWith(PUBLIC_ROOT + path.sep)) {
        throw new Error("World Registry resource escaped the public directory.");
    }
    return fullPath;
}

function readMapData(mapId) {
    const map = getMap(mapId);
    if (!map) return null;
    return JSON.parse(fs.readFileSync(resolvePublicResource(map.data), "utf8"));
}

function getCollisionLayer(mapId) {
    const data = readMapData(mapId);
    if (!data || !Number.isInteger(data.width) || !Number.isInteger(data.height) || !Array.isArray(data.layers)) return null;
    const layer = data.layers.find(item => item && item.name === "collision");
    if (!layer || layer.width !== data.width || layer.height !== data.height ||
        !Array.isArray(layer.data) || layer.data.length !== data.width * data.height) return null;
    return { width: data.width, height: data.height, data: layer.data };
}

function isWalkable(mapId, x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return false;
    const layer = getCollisionLayer(mapId);
    if (!layer || x >= layer.width || y >= layer.height) return false;
    const value = layer.data[y * layer.width + x];
    return value === 2 || value === 3;
}

function getSpawn(mapId, spawnId) {
    const map = getMap(mapId);
    const spawn = map && map.spawnPoints && map.spawnPoints[spawnId];
    if (!spawn || !isWalkable(mapId, spawn.x, spawn.y) ||
        !["up", "down", "left", "right"].includes(spawn.facing)) return null;
    return { x: spawn.x, y: spawn.y, map: mapId, facing: spawn.facing };
}

function getDefaultPosition() {
    const mapId = WORLD_REGISTRY.defaultMapId;
    const position = getSpawn(mapId, "default");
    if (!position) throw new Error("World Registry default spawn is invalid.");
    return position;
}

function normalizeSavedPosition(position) {
    if (!position || typeof position !== "object") return getDefaultPosition();
    const normalized = {
        x: position.x,
        y: position.y,
        map: position.map,
        facing: position.facing
    };
    if (!getMap(normalized.map) || !isWalkable(normalized.map, normalized.x, normalized.y)) {
        return getDefaultPosition();
    }
    if (!["up", "down", "left", "right"].includes(normalized.facing)) normalized.facing = "down";
    return normalized;
}

function getTransition(mapId, transitionId) {
    const map = getMap(mapId);
    if (!map || !Array.isArray(map.transitions)) return null;
    const transition = map.transitions.find(item => item && item.id === transitionId);
    if (!transition || !transition.target || !isWalkable(mapId, transition.tile && transition.tile.x, transition.tile && transition.tile.y)) return null;
    const spawn = getSpawn(transition.target.mapId, transition.target.spawnId);
    if (!spawn) return null;
    return {
        id: transition.id,
        tile: { x: transition.tile.x, y: transition.tile.y },
        targetMapId: transition.target.mapId,
        spawnId: transition.target.spawnId,
        spawn: spawn
    };
}

module.exports = {
    WORLD_REGISTRY,
    getMap,
    getMapIds,
    getCollisionLayer,
    isWalkable,
    getSpawn,
    getDefaultPosition,
    normalizeSavedPosition,
    getTransition
};
