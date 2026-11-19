/**
 * Portal & World Registry Transition Audit Script
 * Validates map displayNames, portal coordinates, walkable tiles, and spawn targets.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const worldRegistryService = require("../server/services/worldRegistryService");

const REGISTRY_PATH = path.resolve(__dirname, "../public/res/world.json");
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));

let totalTransitions = 0;
let errors = 0;

for (const [mapId, map] of Object.entries(registry.maps)) {
    if (!map.displayName) {
        console.error("FAIL: map", mapId, "thiếu displayName");
        errors++;
    } else {
        console.log("ok  : map", mapId, "có displayName");
    }

    const transitions = map.transitions || [];
    for (const transition of transitions) {
        totalTransitions++;

        if (!transition.displayName) {
            console.error(`FAIL: ${mapId}/${transition.id} thiếu displayName`);
            errors++;
        } else {
            console.log(`ok  : ${mapId}/${transition.id} có displayName`);
        }

        if (!worldRegistryService.isWalkable(mapId, transition.tile.x, transition.tile.y)) {
            console.error(`FAIL: ${mapId}/${transition.id} tile (${transition.tile.x},${transition.tile.y}) không walkable`);
            errors++;
        } else {
            console.log(`ok  : ${mapId}/${transition.id} tile (${transition.tile.x},${transition.tile.y}) walkable`);
        }

        const targetMap = registry.maps[transition.target.mapId];
        if (!targetMap) {
            console.error(`FAIL: ${mapId}/${transition.id} target map ${transition.target.mapId} không tồn tại`);
            errors++;
        } else {
            console.log(`ok  : ${mapId}/${transition.id} target map ${transition.target.mapId} tồn tại`);
        }

        const spawn = targetMap && targetMap.spawnPoints && targetMap.spawnPoints[transition.target.spawnId];
        if (!spawn) {
            console.error(`FAIL: ${mapId}/${transition.id} target spawn ${transition.target.spawnId} không tồn tại`);
            errors++;
        } else {
            console.log(`ok  : ${mapId}/${transition.id} target spawn ${transition.target.spawnId} tồn tại`);
        }

        if (spawn && !worldRegistryService.isWalkable(transition.target.mapId, spawn.x, spawn.y)) {
            console.error(`FAIL: ${mapId}/${transition.id} spawn đích (${spawn.x},${spawn.y}) không walkable`);
            errors++;
        } else if (spawn) {
            console.log(`ok  : ${mapId}/${transition.id} spawn đích (${spawn.x},${spawn.y}) walkable`);
        }
    }
}

console.log(`\nTổng transition: ${totalTransitions}`);
if (errors > 0) {
    console.error(`CÓ ${errors} LỖI PHÁT HIỆN TRONG WORLD REGISTRY`);
    process.exit(1);
} else {
    console.log("ALL PASS");
    process.exit(0);
}
