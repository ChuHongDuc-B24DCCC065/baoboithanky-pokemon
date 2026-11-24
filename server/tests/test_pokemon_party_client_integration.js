"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const PokemonInstance = require("../../public/js/engine/pokemon/pokemonInstance");
const PokemonPartyService = require("../../public/js/engine/pokemon/pokemonPartyService");
const MiniBattleUI = require("../../public/js/engine/ui/miniBattleUI");
const speciesCatalog = JSON.parse(fs.readFileSync(path.join(__dirname, "../../public/res/pokemon/species.json"), "utf8"));

global.Game = function () {};
global.window = { location: { href: "" } };
require("../../public/js/engine/load.js");

function makeResponse(data, options = {}) {
    return {
        ok: options.ok !== false,
        status: options.status || 200,
        json: async () => data
    };
}

function pendingSnapshot() {
    return {
        schemaVersion: 1,
        pokemon: [],
        activePokemonId: null,
        starterChosen: false,
        migration: { status: "pending", result: null },
        revision: 0,
        updatedAt: null
    };
}

function completedSnapshot(pokemon) {
    return {
        ...pendingSnapshot(),
        pokemon: pokemon || [],
        activePokemonId: pokemon && pokemon[0] ? pokemon[0].instanceId : null,
        starterChosen: Boolean(pokemon && pokemon.length),
        migration: { status: "completed", result: "imported" },
        revision: 1
    };
}

async function run() {
    const originalStorage = global.localStorage;
    const originalFetch = global.fetch;
    try {
        const values = new Map();
        const reads = [];
        global.localStorage = {
            getItem(key) { reads.push(key); return values.has(key) ? values.get(key) : null; },
            setItem(key, value) { values.set(key, String(value)); },
            removeItem(key) { values.delete(key); }
        };

        const legacyUid = "legacy_party_user";
        const legacyParty = [{ instanceId: "legacy_one", speciesId: "001", currentHp: 10 }];
        values.set(`poke_proto_${legacyUid}_party`, JSON.stringify(legacyParty));
        values.set(`poke_proto_${legacyUid}_active_pokemon_id`, "legacy_one");
        values.set(`poke_proto_${legacyUid}_starter_chosen`, "true");
        values.set("items", "must-not-be-read");
        let getCount = 0;
        let migrationBody = null;
        global.fetch = async (url, options = {}) => {
            if (url === "/api/party/") {
                getCount++;
                return makeResponse({ success: true, data: getCount === 1 ? pendingSnapshot() : completedSnapshot(legacyParty) });
            }
            if (url === "/api/auth/csrf-token") return makeResponse({ success: true, data: { csrfToken: "csrf-test" } });
            if (url === "/api/party/migration") {
                assert.strictEqual(options.headers["X-CSRF-Token"], "csrf-test");
                migrationBody = JSON.parse(options.body);
                return makeResponse({
                    success: true,
                    migrationOutcome: "imported",
                    data: completedSnapshot(legacyParty)
                });
            }
            throw new Error("Unexpected request: " + url);
        };
        const legacyGame = { savedData: { userId: legacyUid }, partySnapshot: null };
        await global.Game.prototype.migrateLegacyParty.call(legacyGame);
        assert.deepStrictEqual(migrationBody, {
            pokemon: legacyParty,
            activePokemonId: "legacy_one",
            starterChosen: true
        });
        assert.strictEqual(legacyGame.partySnapshot.migration.status, "completed");
        assert.strictEqual(getCount, 2, "Boot reads the authoritative snapshot again after migration");
        assert(!reads.includes("items"), "Migration must not access global items key");
        assert(values.has(`poke_proto_${legacyUid}_party`), "Legacy Party is retained after server confirmation");

        const completedUid = "already_migrated_user";
        values.set(`poke_proto_${completedUid}_party`, "not valid and must not be parsed");
        const completedReads = [];
        global.localStorage = {
            getItem(key) { completedReads.push(key); throw new Error("Legacy key should not be read"); },
            setItem() { throw new Error("Migration must not write client storage"); },
            removeItem() { throw new Error("Migration must not delete client storage"); }
        };
        global.fetch = async (url) => {
            assert.strictEqual(url, "/api/party/");
            return makeResponse({ success: true, data: completedSnapshot([]) });
        };
        const completedGame = { savedData: { userId: completedUid }, partySnapshot: null };
        await global.Game.prototype.migrateLegacyParty.call(completedGame);
        assert.strictEqual(completedGame.partySnapshot.migration.status, "completed");
        assert.deepStrictEqual(completedReads, [], "Completed migration must skip all legacy reads");

        const emptyUid = "empty_legacy_user";
        let emptyRequest = null;
        let emptyGets = 0;
        global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
        global.fetch = async (url, options = {}) => {
            if (url === "/api/party/") {
                emptyGets++;
                return makeResponse({ success: true, data: emptyGets === 1 ? pendingSnapshot() : completedSnapshot([]) });
            }
            if (url === "/api/auth/csrf-token") return makeResponse({ success: true, data: { csrfToken: "csrf-test" } });
            if (url === "/api/party/migration") {
                emptyRequest = JSON.parse(options.body);
                return makeResponse({ success: true, migrationOutcome: "imported", data: completedSnapshot([]) });
            }
            throw new Error("Unexpected request: " + url);
        };
        await global.Game.prototype.migrateLegacyParty.call({ savedData: { userId: emptyUid } });
        assert.deepStrictEqual(emptyRequest, { pokemon: [], activePokemonId: null, starterChosen: false });

        const failureUid = "migration_failure_user";
        const untouchedLegacy = JSON.stringify([{ preserved: true }]);
        global.localStorage = { getItem: () => untouchedLegacy, setItem() {}, removeItem() {} };
        global.fetch = async (url) => {
            if (url === "/api/party/") return makeResponse({ success: true, data: pendingSnapshot() });
            return makeResponse({ success: false, code: "NETWORK_FAILURE" }, { ok: false, status: 503 });
        };
        await assert.rejects(
            global.Game.prototype.migrateLegacyParty.call({ savedData: { userId: failureUid } }),
            (error) => error.type === "PARTY_SYNC_ERROR"
        );
        assert.strictEqual(untouchedLegacy, JSON.stringify([{ preserved: true }]));

        // Party mutations are serialized, revisioned, and retried with the same operation ID and payload.
        const first = new PokemonInstance(speciesCatalog[0], 5);
        first.instanceId = "client_party_first";
        const second = new PokemonInstance(speciesCatalog[1], 5);
        second.instanceId = "client_party_second";
        const state = {
            schemaVersion: 1,
            pokemon: [first.toJSON(), second.toJSON()],
            activePokemonId: first.instanceId,
            starterChosen: true,
            migration: { status: "completed", result: "imported" },
            revision: 10,
            updatedAt: Date.now() - 5000
        };
        state.pokemon[0].currentHp -= 10;
        const calls = [];
        const serverOperations = new Map();
        let failAfterCommitOnce = true;
        let externalRevision = 10;
        let externalSnapshot = null;
        const fakeFetch = async (url, options = {}) => {
            if (url === "/api/auth/csrf-token") return makeResponse({ success: true, data: { csrfToken: "csrf-test" } });
            if (url !== "/api/party/mutation") throw new Error("Unexpected Party mutation URL: " + url);
            const payload = JSON.parse(options.body);
            calls.push(payload);
            if (externalSnapshot) return makeResponse({ success: false, code: "REVISION_CONFLICT", data: externalSnapshot }, { ok: false, status: 409 });
            if (serverOperations.has(payload.operationId)) {
                return makeResponse({ success: true, data: serverOperations.get(payload.operationId) });
            }
            if (payload.expectedRevision !== externalRevision) {
                return makeResponse({ success: false, code: "REVISION_CONFLICT", data: { ...state, revision: externalRevision } }, { ok: false, status: 409 });
            }
            const saved = {
                ...state,
                pokemon: payload.pokemon,
                activePokemonId: payload.activePokemonId,
                starterChosen: payload.starterChosen,
                revision: externalRevision + 1,
                updatedAt: Date.now()
            };
            externalRevision = saved.revision;
            serverOperations.set(payload.operationId, saved);
            if (failAfterCommitOnce) {
                failAfterCommitOnce = false;
                return makeResponse({ success: false, code: "TEMPORARY_ERROR" }, { ok: false, status: 503 });
            }
            return makeResponse({ success: true, data: saved });
        };
        const oldSetInterval = global.setInterval;
        const oldClearInterval = global.clearInterval;
        global.setInterval = () => 1;
        global.clearInterval = () => {};
        try {
            const clientParty = new PokemonPartyService({ state: "NORMAL" }, null, "client_user", speciesCatalog, state, { fetch: fakeFetch });
            const recoveredAtBoot = clientParty.getParty()[0].currentHp;
            assert(recoveredAtBoot > state.pokemon[0].currentHp, "Snapshot updatedAt is used to calculate offline HP recovery");
            assert.strictEqual(calls.length, 0, "Passive recovery does not POST every second during boot");

            const activeChange = clientParty.selectActivePokemon(1);
            const releaseAfterChange = clientParty.releasePokemon(second.instanceId);
            const [activeResult, releaseResult] = await Promise.all([activeChange, releaseAfterChange]);
            assert(activeResult.success && releaseResult.success, "Queued active selection and release both commit");
            assert.strictEqual(calls[0].expectedRevision, 10);
            assert.strictEqual(calls[2].expectedRevision, 11, "Serialized mutations use the revision returned by the prior mutation");
            assert.strictEqual(calls[0].operationId, calls[1].operationId,
                "Ambiguous response retry repeats the same operation before applying the next mutation");
            assert.deepStrictEqual(calls[0], calls[1], "Retry preserves the exact original request payload");
            assert.strictEqual(clientParty.revision, 12);
            assert.deepStrictEqual(clientParty.getParty().map((pokemon) => pokemon.instanceId), [first.instanceId]);

            const battleMember = clientParty.getActivePokemon();
            const hpBeforeBattleSave = battleMember.currentHp;
            battleMember.takeDamage(5);
            battleMember.gainExp(50);
            const battleSave = await clientParty.onBattleEnd(Date.now());
            assert(battleSave.success, "Battle HP and EXP sync when Battle ends");
            assert.strictEqual(clientParty.getParty()[0].currentHp, hpBeforeBattleSave - 5);
            assert.strictEqual(clientParty.getParty()[0].exp, 50);
            assert.strictEqual(calls[3].expectedRevision, 12);

            const healResult = await clientParty.healActivePokemon(10);
            assert(healResult.success && healResult.healed > 0, "Party heal waits for server mutation success");
            assert.strictEqual(clientParty.revision, 14);
            assert.strictEqual(calls[4].expectedRevision, 13);

            const captured = new PokemonInstance(speciesCatalog[2], 4);
            captured.instanceId = "captured_party_member";
            let caughtSpeciesMarked = null;
            clientParty.progressService = { markCaught(speciesId) { caughtSpeciesMarked = speciesId; } };
            const captureResult = await clientParty.addPokemon(captured, { isNewCapture: true });
            assert(captureResult.success, "Capture adds the Pokémon only after Party API confirmation");
            assert.strictEqual(clientParty.getParty().length, 2);
            assert.strictEqual(clientParty.getParty()[1].instanceId, captured.instanceId);
            assert.strictEqual(caughtSpeciesMarked, captured.speciesId, "Pokédex CAUGHT follows confirmed Party capture");
            assert.strictEqual(calls[5].expectedRevision, 14);
            assert.strictEqual(clientParty.revision, 15);

        let finishPartySync;
        let overworldBattleResolved = 0;
        const battleGame = {
            state: "BATTLE",
            lastBattleResult: null,
            player: { stop: true, walkInProgress: false },
            key: { _pressed: { Space: true } },
            encounterCooldown: 0,
            resolveOverworldPokemonBattle() { overworldBattleResolved++; }
        };
        const battleUI = Object.create(MiniBattleUI.prototype);
        battleUI.game = battleGame;
        battleUI.partyService = {
            onBattleEnd() { return new Promise((resolve) => { finishPartySync = resolve; }); }
        };
        battleUI.containerEl = null;
        battleUI._activeBattleId = 42;
        battleUI._activeBattleToken = "battle_test_token";
        battleUI._battleResolved = false;
        battleUI._pendingBattleEnd = null;
        battleUI._partyEndSyncPending = false;
        battleUI._throwTimer = null;
        battleUI._runTimer = null;
        battleUI._turnTimer = null;
        battleUI.wildPokemon = { speciesId: "016" };
        battleUI.pendingResult = "WIN";
        battleUI.removeKeyboard = () => {};
        assert.strictEqual(battleUI.endBattle("WIN", 42), true);
        assert.strictEqual(battleGame.state, "PARTY_SYNC", "Battle holds overworld control while Party save is pending");
        assert.strictEqual(battleGame.player.stop, true);
        assert.strictEqual(overworldBattleResolved, 0);
        finishPartySync({ success: true });
        await new Promise((resolve) => setImmediate(resolve));
        assert.strictEqual(battleGame.state, "NORMAL", "Battle restores game state only after Party save succeeds");
        assert.strictEqual(battleGame.player.stop, false);
        assert.strictEqual(overworldBattleResolved, 1, "Overworld battle reference is resolved after Party confirmation");

        const failedSyncGame = {
            state: "BATTLE",
            player: { stop: true, walkInProgress: false },
            key: { _pressed: {} },
            encounterCooldown: 0
        };
        const failedSyncBattle = Object.create(MiniBattleUI.prototype);
        failedSyncBattle.game = failedSyncGame;
        failedSyncBattle.partyService = { onBattleEnd: async () => ({ success: false, reason: "PARTY_SYNC_FAILED" }) };
        failedSyncBattle.containerEl = null;
        failedSyncBattle._activeBattleId = 43;
        failedSyncBattle._battleResolved = false;
        failedSyncBattle._pendingBattleEnd = null;
        failedSyncBattle._partyEndSyncPending = false;
        failedSyncBattle._throwTimer = null;
        failedSyncBattle._runTimer = null;
        failedSyncBattle._turnTimer = null;
        failedSyncBattle.wildPokemon = { speciesId: "016" };
        failedSyncBattle.pendingResult = null;
        failedSyncBattle.removeKeyboard = () => {};
        let syncFailureShown = false;
        failedSyncBattle._showPartySyncRetry = () => { syncFailureShown = true; };
        failedSyncBattle.endBattle("RUN", 43);
        await new Promise((resolve) => setImmediate(resolve));
        assert(syncFailureShown, "Failed Party save presents retry state");
        assert.strictEqual(failedSyncGame.state, "PARTY_SYNC", "Failed Party save must keep gameplay locked");
        assert.strictEqual(failedSyncGame.player.stop, true);

            externalSnapshot = {
                ...clientParty._serverSnapshot,
                pokemon: [first.toJSON(), second.toJSON()],
                activePokemonId: first.instanceId,
                revision: 20,
                updatedAt: Date.now()
            };
            const conflict = await clientParty.releasePokemon(first.instanceId);
            assert.strictEqual(conflict.success, false);
            assert.strictEqual(conflict.reason, "REVISION_CONFLICT");
            assert.strictEqual(clientParty.revision, 20, "Revision conflict replaces stale state with server snapshot");
            assert.deepStrictEqual(clientParty.getParty().map((pokemon) => pokemon.instanceId), [first.instanceId, second.instanceId]);
            clientParty.destroy();
        } finally {
            global.setInterval = oldSetInterval;
            global.clearInterval = oldClearInterval;
        }

        console.log("Party client integration tests: PASS (migration, capture, completed skip, server mutation, revision/idempotent retry, conflict snapshot, recovery timing, battle-end save lock/failure)");
    } finally {
        if (originalStorage === undefined) delete global.localStorage;
        else global.localStorage = originalStorage;
        if (originalFetch === undefined) delete global.fetch;
        else global.fetch = originalFetch;
        delete global.Game;
        delete global.window;
    }
}

run().catch((error) => {
    console.error("Party client migration tests: FAIL", error);
    process.exitCode = 1;
});
