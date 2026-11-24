/**
 * Overworld Pokémon spawn lifecycle for Poké-Engine.
 *
 * Wild Pokémon are kept in game.overworldPokemon, separate from game.npcs.
 * Spawn species, levels, limits and reset timing come from
 * /res/pokemon/wildPokemon.json. Setup clears and rebuilds the current map's
 * DOM and owns at most one reset timer, so map changes cannot keep old spawns.
 * Invalid map/species entries are logged and skipped without stopping map load.
 */
(function (global) {
    "use strict";

    const SPRITE_BASE = "/res/pokemon/sprites/animated/";
    const MAX_CONFIGURED_ACTIVE = 50;
    const DEFAULT_RESET_SECONDS = 30;
    const TIMER_RETRY_MS = 250;

    // The JSON may set a lower per-map limit; this guard bounds malformed or
    // accidentally oversized configurations.

    function keyOf(x, y) {
        return x + "," + y;
    }

    function reserveWithNeighbors(set, tile) {
        if (!tile || !Number.isInteger(tile.x) || !Number.isInteger(tile.y)) return;
        set.add(keyOf(tile.x, tile.y));
        set.add(keyOf(tile.x + 1, tile.y));
        set.add(keyOf(tile.x - 1, tile.y));
        set.add(keyOf(tile.x, tile.y + 1));
        set.add(keyOf(tile.x, tile.y - 1));
    }

    function resolveSpriteUrl(game, speciesId) {
        const catalog = game.speciesCatalog;
        if (Array.isArray(catalog)) {
            const species = catalog.find(function (entry) { return entry && entry.id === speciesId; });
            const front = species && species.assets && species.assets.front;
            if (typeof front === "string" && front.indexOf("/res/pokemon/sprites/") === 0 &&
                /\.gif$/.test(front) && front.indexOf("..") === -1) return front;
        }
        return SPRITE_BASE + speciesId + ".gif";
    }

    function loadWildPokemonConfig(game) {
        if (game._wildPokemonConfig) return Promise.resolve(game._wildPokemonConfig);
        if (!game._wildPokemonConfigPromise) {
            game._wildPokemonConfigPromise = fetch("/res/pokemon/wildPokemon.json")
                .then(function (response) {
                    if (!response.ok) throw new Error("HTTP " + response.status);
                    return response.json();
                })
                .then(function (config) {
                    game._wildPokemonConfig = config;
                    return config;
                })
                .catch(function (error) {
                    console.warn("[Overworld Pokémon] Không tải được wildPokemon.json:", error && (error.message || error));
                    game._wildPokemonConfig = { version: 1, defaultResetSeconds: DEFAULT_RESET_SECONDS, maps: {} };
                    return game._wildPokemonConfig;
                });
        }
        return game._wildPokemonConfigPromise;
    }

    function findSpeciesConfig(mapConfig, speciesId) {
        return mapConfig.species.find(function (entry) { return entry.speciesId === speciesId; }) || null;
    }

    function randomInt(min, max) {
        return min + Math.floor(Math.random() * (max - min + 1));
    }

    function chooseLevel(speciesConfig) {
        const high = Math.random() * 100 < speciesConfig.highLevelChancePercent;
        const range = high ? speciesConfig.highLevelRange : speciesConfig.levelRange;
        return randomInt(range.min, range.max);
    }

    function chooseSpecies(mapConfig) {
        const totalWeight = mapConfig.species.reduce(function (total, entry) { return total + entry.weight; }, 0);
        if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
        let roll = Math.random() * totalWeight;
        for (let i = 0; i < mapConfig.species.length; i++) {
            roll -= mapConfig.species[i].weight;
            if (roll < 0) return mapConfig.species[i];
        }
        return mapConfig.species[mapConfig.species.length - 1] || null;
    }

    function getPlacementContext(game, prepared) {
        // Reserve NPCs, spawn points, portals and the player's current tile.
        const reserved = new Set();
        const npcs = Array.isArray(prepared.npcs) ? prepared.npcs : [];
        for (let i = 0; i < npcs.length; i++) {
            if (npcs[i] && npcs[i].position) reserveWithNeighbors(reserved, npcs[i].position);
        }

        const entry = game.worldRegistry && game.worldRegistry.maps && game.worldRegistry.maps[prepared.mapId];
        if (entry && entry.spawnPoints && typeof entry.spawnPoints === "object") {
            Object.keys(entry.spawnPoints).forEach(function (key) {
                reserveWithNeighbors(reserved, entry.spawnPoints[key]);
            });
        }
        const transitions = Array.isArray(prepared.transitions) ? prepared.transitions : [];
        for (let i = 0; i < transitions.length; i++) {
            reserveWithNeighbors(reserved, transitions[i] && transitions[i].tile);
        }
        if (game.player && game.player.position) {
            reserved.add(keyOf(game.player.position.x, game.player.position.y));
        } else if (game.savedData && game.savedData.map === prepared.mapId) {
            reserved.add(keyOf(game.savedData.x, game.savedData.y));
        }

        const candidates = [];
        const rows = prepared.mapTiles;
        for (let y = 0; y < rows.length; y++) {
            const row = rows[y];
            if (!Array.isArray(row)) continue;
            for (let x = 0; x < row.length; x++) {
                const tileType = game.tileTypes && game.tileTypes[row[x]];
                const key = keyOf(x, y);
                if (tileType && !tileType.block && !tileType.teleport && !reserved.has(key)) {
                    candidates.push({ x: x, y: y });
                }
            }
        }
        return { reserved: reserved, candidates: candidates };
    }

    function nextInstanceId(game) {
        game._overworldPokemonSequence = (game._overworldPokemonSequence || 0) + 1;
        return "owpkmn_" + Date.now() + "_" + game._overworldPokemonSequence;
    }

    function removeSpawnRecord(game, index) {
        const record = game.overworldPokemon[index];
        const element = record && record.element;
        if (element && element.parentNode) element.parentNode.removeChild(element);
        game.overworldPokemon.splice(index, 1);
    }

    function clearSpawnElements(game) {
        if (!Array.isArray(game.overworldPokemon)) game.overworldPokemon = [];
        for (let i = game.overworldPokemon.length - 1; i >= 0; i--) removeSpawnRecord(game, i);
    }

    function addSpawn(game, prepared, speciesConfig, position, facing, spawnId) {
        const PokemonInstance = global.PokePokemonInstance;
        const species = (game.speciesCatalog || []).find(function (entry) {
            return entry && entry.id === speciesConfig.speciesId;
        });
        if (!species || typeof PokemonInstance !== "function") return false;

        const instanceId = nextInstanceId(game);
        const element = document.createElement("img");
        element.className = "overworld-pokemon";
        element.src = resolveSpriteUrl(game, speciesConfig.speciesId);
        element.alt = "";
        element.draggable = false;
        element.setAttribute("data-overworld-pokemon-id", spawnId || instanceId);
        element.setAttribute("data-species-id", speciesConfig.speciesId);
        element.setAttribute("data-facing", facing || "down");
        element.style.left = position.x * game.tileSize + "px";
        element.style.top = position.y * game.tileSize + "px";

        const record = {
            id: spawnId || instanceId,
            instanceId: instanceId,
            mapId: prepared.mapId,
            speciesId: speciesConfig.speciesId,
            level: chooseLevel(speciesConfig),
            x: position.x,
            y: position.y,
            facing: facing || "down",
            element: element
        };
        // A broken sprite must not leave an invisible blocking interaction target.
        element.onerror = function () {
            console.warn("[Overworld Pokémon] Không tải được sprite cho species " + speciesConfig.speciesId + ".");
            const index = Array.isArray(game.overworldPokemon) ? game.overworldPokemon.indexOf(record) : -1;
            if (index !== -1) removeSpawnRecord(game, index);
        };

        game.$world.append(element);
        game.overworldPokemon.push(record);
        return true;
    }

    function validLevelRange(range) {
        return range && Number.isInteger(range.min) && Number.isInteger(range.max) &&
            range.min >= 1 && range.max >= range.min && range.max <= 100;
    }

    function validateMapConfig(game, mapId, rawMapConfig) {
        const fail = function (message) {
            console.warn("[Overworld Pokémon] Map '" + mapId + "': " + message);
        };
        if (!game.worldRegistry || !game.worldRegistry.maps || !game.worldRegistry.maps[mapId]) {
            fail("mapId không có trong world registry, bỏ qua map.");
            return null;
        }
        if (!rawMapConfig || !Number.isInteger(rawMapConfig.maxActive) ||
            rawMapConfig.maxActive < 0 || rawMapConfig.maxActive > MAX_CONFIGURED_ACTIVE) {
            fail("maxActive không hợp lệ (cho phép 0-" + MAX_CONFIGURED_ACTIVE + "), bỏ qua map.");
            return null;
        }

        const catalog = Array.isArray(game.speciesCatalog) ? game.speciesCatalog : [];
        const catalogIds = new Set(catalog.map(function (entry) { return entry && entry.id; }));
        const species = [];
        const rawSpecies = Array.isArray(rawMapConfig.species) ? rawMapConfig.species : [];
        for (let i = 0; i < rawSpecies.length; i++) {
            const entry = rawSpecies[i];
            if (!entry || typeof entry.speciesId !== "string" || !/^\d{3}$/.test(entry.speciesId) ||
                !catalogIds.has(entry.speciesId)) {
                fail("species entry #" + i + " có speciesId không hợp lệ/không tồn tại trong species.json; đã bỏ qua.");
                continue;
            }
            if (!Number.isFinite(entry.weight) || entry.weight <= 0 ||
                !validLevelRange(entry.levelRange) || !validLevelRange(entry.highLevelRange) ||
                !Number.isFinite(entry.highLevelChancePercent) || entry.highLevelChancePercent < 0 ||
                entry.highLevelChancePercent > 100) {
                fail("species entry #" + i + " có weight/level/chance không hợp lệ; đã bỏ qua.");
                continue;
            }
            species.push(entry);
        }

        const resetSeconds = Number.isFinite(rawMapConfig.resetSeconds) && rawMapConfig.resetSeconds > 0
            ? rawMapConfig.resetSeconds
            : (Number.isFinite(game._wildPokemonConfig.defaultResetSeconds) && game._wildPokemonConfig.defaultResetSeconds > 0
                ? game._wildPokemonConfig.defaultResetSeconds : DEFAULT_RESET_SECONDS);
        return {
            maxActive: rawMapConfig.maxActive,
            resetSeconds: resetSeconds,
            species: species,
            initialSpawns: Array.isArray(rawMapConfig.initialSpawns) ? rawMapConfig.initialSpawns : []
        };
    }

    function placeInitialSpawns(game, prepared, mapConfig, context) {
        const usedTiles = new Set();
        for (let i = 0; i < mapConfig.initialSpawns.length && game.overworldPokemon.length < mapConfig.maxActive; i++) {
            const spawn = mapConfig.initialSpawns[i];
            const speciesConfig = spawn && findSpeciesConfig(mapConfig, spawn.speciesId);
            const position = spawn && spawn.position;
            const facing = spawn && spawn.facing;
            const type = position && context ? (prepared.mapTiles[position.y] && game.tileTypes &&
                game.tileTypes[prepared.mapTiles[position.y][position.x]]) : null;
            const key = position && keyOf(position.x, position.y);
            if (!spawn || typeof spawn.id !== "string" || !speciesConfig ||
                !position || !Number.isInteger(position.x) || !Number.isInteger(position.y) ||
                !type || type.block || type.teleport || !key || context.reserved.has(key) || usedTiles.has(key)) {
                console.warn("[Overworld Pokémon] Map '" + prepared.mapId + "': initial spawn #" + i + " không hợp lệ, đã bỏ qua.");
                continue;
            }
            if (addSpawn(game, prepared, speciesConfig, position, facing, spawn.id)) {
                usedTiles.add(key);
            }
        }
        return usedTiles;
    }

    function fillRandomSpawns(game, prepared, mapConfig, context, usedTiles) {
        if (!mapConfig.species.length) return;
        const available = context.candidates.filter(function (position) {
            return !usedTiles.has(keyOf(position.x, position.y));
        });
        while (game.overworldPokemon.length < mapConfig.maxActive && available.length > 0) {
            const speciesConfig = chooseSpecies(mapConfig);
            if (!speciesConfig) break;
            const positionIndex = Math.floor(Math.random() * available.length);
            const position = available.splice(positionIndex, 1)[0];
            if (addSpawn(game, prepared, speciesConfig, position, "down")) {
                usedTiles.add(keyOf(position.x, position.y));
            }
        }
    }

    function spawnConfiguredSet(game, prepared, mapConfig, preserveInitialPositions) {
        clearSpawnElements(game);
        const context = getPlacementContext(game, prepared);
        const usedTiles = preserveInitialPositions
            ? placeInitialSpawns(game, prepared, mapConfig, context)
            : new Set();
        fillRandomSpawns(game, prepared, mapConfig, context, usedTiles);
    }

    function scheduleReset(game, prepared, mapConfig) {
        if (game._overworldPokemonTimer) clearTimeout(game._overworldPokemonTimer);
        game._overworldPokemonTimer = setTimeout(function checkReset() {
            game._overworldPokemonTimer = null;
            if (game._overworldPokemonMapId !== prepared.mapId ||
                !game.savedData || game.savedData.map !== prepared.mapId) return;
            // Keep the same cycle pending during battle/transition; never touch
            // the overworld record that the active battle references.
            if (game.state !== "NORMAL") {
                game._wildPokemonResetPending = true;
                game._overworldPokemonTimer = setTimeout(checkReset, TIMER_RETRY_MS);
                return;
            }
            resetSpawnCycle(game, prepared, mapConfig);
        }, mapConfig.resetSeconds * 1000);
    }

    function resetSpawnCycle(game, prepared, mapConfig) {
        if (game._overworldPokemonTimer) {
            clearTimeout(game._overworldPokemonTimer);
            game._overworldPokemonTimer = null;
        }
        if (game.state !== "NORMAL" || !game.savedData || game.savedData.map !== prepared.mapId) {
            game._wildPokemonResetPending = true;
            return;
        }
        game._wildPokemonResetPending = false;
        spawnConfiguredSet(game, prepared, mapConfig, false);
        scheduleReset(game, prepared, mapConfig);
    }

    function install(Game) {
        const proto = Game.prototype;

        proto.getOverworldPokemonAt = function (x, y) {
            const list = this.overworldPokemon;
            if (!Array.isArray(list)) return null;
            for (let i = 0; i < list.length; i++) {
                const pokemon = list[i];
                if (pokemon && pokemon.x === x && pokemon.y === y) return pokemon;
            }
            return null;
        };

        if (typeof proto.handleInteraction === "function" && !proto._overworldPokemonInteractionInstalled) {
            const handleInteraction = proto.handleInteraction;
            proto.handleInteraction = function () {
                // Preserve existing portal/NPC interaction priority.
                const wasNormal = this.state === "NORMAL";
                handleInteraction.apply(this, arguments);
                if (!wasNormal || this.state !== "NORMAL" || !this.player || this.player.walkInProgress) return;
                if (!this.pokemonPartyService || !this.pokemonPartyService.hasStarter || !this.pokemonPartyService.hasStarter()) return;
                if (!this.miniBattleUI || typeof this.miniBattleUI.startBattle !== "function") return;

                const position = this.player.position;
                if (!position) return;
                const target = { x: position.x, y: position.y };
                switch (position.facing) {
                    case "up": target.y--; break;
                    case "down": target.y++; break;
                    case "left": target.x--; break;
                    case "right": target.x++; break;
                    default: return;
                }

                const record = this.getOverworldPokemonAt(target.x, target.y);
                if (!record) return;
                const species = (this.speciesCatalog || []).find(function (entry) {
                    return entry && entry.id === record.speciesId;
                });
                const mapConfig = this._wildPokemonRuntimeConfig;
                const speciesConfig = mapConfig && findSpeciesConfig(mapConfig, record.speciesId);
                const PokemonInstance = global.PokePokemonInstance;
                if (!species || !speciesConfig || typeof PokemonInstance !== "function") {
                    console.warn("[Overworld Pokémon] Không thể bắt đầu battle: thiếu species/config/PokemonInstance cho " + record.speciesId);
                    return;
                }

                const wildPokemon = new PokemonInstance(species, record.level);
                wildPokemon.overworldSpawnInstanceId = record.instanceId;
                wildPokemon.overworldSpawnMapId = record.mapId;
                this.miniBattleUI.startBattle(wildPokemon);
            };
            proto._overworldPokemonInteractionInstalled = true;
        }

        proto.clearOverworldPokemon = function () {
            if (this._overworldPokemonTimer) clearTimeout(this._overworldPokemonTimer);
            this._overworldPokemonTimer = null;
            this._wildPokemonResetPending = false;
            this._overworldPokemonSetupToken = (this._overworldPokemonSetupToken || 0) + 1;
            this._overworldPokemonMapId = null;
            this._wildPokemonRuntimeConfig = null;
            this._overworldPokemonPrepared = null;
            clearSpawnElements(this);
        };

        proto.setupOverworldPokemon = function (prepared) {
            this.clearOverworldPokemon();
            if (!prepared || typeof prepared.mapId !== "string" || !Array.isArray(prepared.mapTiles)) return;
            const game = this;
            const mapId = prepared.mapId;
            const setupToken = this._overworldPokemonSetupToken;
            this._overworldPokemonMapId = mapId;
            this._overworldPokemonPrepared = prepared;

            let speciesPromise = this.speciesCatalogPromise && typeof this.speciesCatalogPromise.then === "function"
                ? this.speciesCatalogPromise : null;
            if (!speciesPromise && typeof this.loadSpeciesCatalog === "function") {
                if (!Array.isArray(this.speciesCatalog)) this.speciesCatalog = [];
                speciesPromise = this.speciesCatalogPromise = this.loadSpeciesCatalog();
            }
            if (!speciesPromise) speciesPromise = Promise.resolve();
            Promise.all([loadWildPokemonConfig(this), speciesPromise]).then(function () {
                if (setupToken !== game._overworldPokemonSetupToken ||
                    game._overworldPokemonMapId !== mapId || !game.savedData || game.savedData.map !== mapId) return;
                const config = game._wildPokemonConfig;
                const rawMaps = config && config.maps && typeof config.maps === "object" ? config.maps : null;
                if (rawMaps) {
                    Object.keys(rawMaps).forEach(function (configuredMapId) {
                        if (!game.worldRegistry || !game.worldRegistry.maps || !game.worldRegistry.maps[configuredMapId]) {
                            console.warn("[Overworld Pokémon] Cấu hình có mapId '" + configuredMapId + "' không tồn tại trong world registry.");
                        }
                    });
                }
                if (!rawMaps || !Object.prototype.hasOwnProperty.call(rawMaps, mapId)) {
                    console.warn("[Overworld Pokémon] Không có cấu hình spawn cho map '" + mapId + "'.");
                    return;
                }
                const mapConfig = validateMapConfig(game, mapId, rawMaps[mapId]);
                if (!mapConfig) return;
                game._wildPokemonRuntimeConfig = mapConfig;
                spawnConfiguredSet(game, prepared, mapConfig, true);
                if (mapConfig.maxActive > 0 && mapConfig.species.length > 0) {
                    scheduleReset(game, prepared, mapConfig);
                }
            }).catch(function (error) {
                console.warn("[Overworld Pokémon] Không thể thiết lập map '" + mapId + "':", error && (error.message || error));
            });
        };

        proto.resolveOverworldPokemonBattle = function (result, wildPokemon) {
            // Match the concrete spawn instance, never just its species ID.
            if (result === "WIN" || result === "CAUGHT") {
                const spawnId = wildPokemon && wildPokemon.overworldSpawnInstanceId;
                const mapId = wildPokemon && wildPokemon.overworldSpawnMapId;
                if (spawnId && mapId === this._overworldPokemonMapId && Array.isArray(this.overworldPokemon)) {
                    const index = this.overworldPokemon.findIndex(function (record) {
                        return record && record.instanceId === spawnId && record.mapId === mapId;
                    });
                    if (index !== -1) removeSpawnRecord(this, index);
                }
            }

            if (this._wildPokemonResetPending && this._wildPokemonRuntimeConfig &&
                this._overworldPokemonPrepared && this.state === "NORMAL") {
                resetSpawnCycle(this, this._overworldPokemonPrepared, this._wildPokemonRuntimeConfig);
            }
        };
    }

    const api = { install: install };
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    } else {
        global.PokeOverworldPokemon = api;
        if (typeof Game !== "undefined") install(Game);
    }
})(typeof window !== "undefined" ? window : global);
