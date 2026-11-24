"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const PokemonInstance = require("../../public/js/engine/pokemon/pokemonInstance");
const PokemonPartyService = require("../../public/js/engine/pokemon/pokemonPartyService");
const PokemonUI = require("../../public/js/engine/ui/pokemonUI");
const PokedexProgressService = require("../../public/js/engine/ui/pokedexProgressService");

class FakeElement {
    constructor() {
        this.children = [];
        this.attributes = {};
        this.listeners = {};
        this.queryResults = {};
        this.innerHTML = "";
    }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    getAttribute(name) { return this.attributes[name] || null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    querySelector(selector) {
        if (selector.indexOf("rpg-modal-close-btn") >= 0 || selector.indexOf("rpg-pokedex-open-btn") >= 0) return new FakeElement();
        return null;
    }
    querySelectorAll(selector) {
        if (this.queryResults[selector]) return this.queryResults[selector];
        const attribute = selector.match(/\[data-([a-z-]+)\]/);
        if (!attribute) return [];
        const key = "data-" + attribute[1];
        const indexes = [...this.innerHTML.matchAll(new RegExp(key + '="(\\d+)"', "g"))];
        this.queryResults[selector] = indexes.map((match) => {
            const button = new FakeElement();
            button.setAttribute(key, match[1]);
            return button;
        });
        return this.queryResults[selector];
    }
}

const species = JSON.parse(fs.readFileSync(path.join(__dirname, "../../public/res/pokemon/species.json"), "utf8"));
const storageValues = new Map();
const previousLocalStorage = global.localStorage;
const previousSetInterval = global.setInterval;
const previousClearInterval = global.clearInterval;
const previousDocument = global.document;
const previousWindow = global.window;
global.localStorage = {
    getItem(key) { return storageValues.has(key) ? storageValues.get(key) : null; },
    setItem(key, value) { storageValues.set(key, String(value)); }
};
global.setInterval = () => 1;
global.clearInterval = () => {};
global.document = { createElement: () => new FakeElement() };

function makePartyServer(initialSnapshot) {
    let snapshot = JSON.parse(JSON.stringify(initialSnapshot));
    const operations = new Map();
    const requests = [];
    const fetch = async (url, options = {}) => {
        requests.push({ url, options });
        if (url === "/api/auth/csrf-token") return { ok: true, status: 200, json: async () => ({ success: true, data: { csrfToken: "test-token" } }) };
        if (url !== "/api/party/mutation") throw new Error("Unexpected Party API URL: " + url);
        const payload = JSON.parse(options.body);
        if (operations.has(payload.operationId)) {
            return { ok: true, status: 200, json: async () => ({ success: true, data: operations.get(payload.operationId) }) };
        }
        if (payload.expectedRevision !== snapshot.revision) {
            return { ok: false, status: 409, json: async () => ({ success: false, code: "REVISION_CONFLICT", data: snapshot }) };
        }
        snapshot = {
            ...snapshot,
            pokemon: payload.pokemon,
            activePokemonId: payload.activePokemonId,
            starterChosen: payload.starterChosen,
            revision: snapshot.revision + 1,
            updatedAt: Date.now()
        };
        operations.set(payload.operationId, snapshot);
        return { ok: true, status: 200, json: async () => ({ success: true, data: snapshot }) };
    };
    return { fetch, requests, getSnapshot: () => snapshot };
}

function makeService(uid, count, state = "NORMAL") {
    const progress = new PokedexProgressService(uid);
    const pokemon = [];
    for (let index = 0; index < count; index++) {
        const instance = new PokemonInstance(species[index], 5);
        instance.instanceId = `${uid}_instance_${index}`;
        pokemon.push(instance.toJSON());
        progress.markCaught(instance.speciesId);
    }
    const snapshot = {
        schemaVersion: 1,
        pokemon,
        activePokemonId: count ? pokemon[0].instanceId : null,
        starterChosen: count > 0,
        migration: { status: "completed", result: "imported" },
        revision: 1,
        updatedAt: Date.now()
    };
    const server = makePartyServer(snapshot);
    const service = new PokemonPartyService({ state }, progress, uid, species, snapshot, { fetch: server.fetch });
    return { service, progress, server };
}

async function run() {
    try {
        // Releasing a non-active Pokémon leaves the selected Pokémon and Pokédex history intact.
        const nonActive = makeService("release_non_active", 2);
        const [lead, released] = nonActive.service.getParty();
        const caughtBefore = nonActive.progress.getStatus(released.speciesId);
        const nonActiveResult = await nonActive.service.releasePokemon(released.instanceId);
        assert.strictEqual(nonActiveResult.success, true);
        assert.deepStrictEqual(nonActive.service.getParty().map((pokemon) => pokemon.instanceId), [lead.instanceId]);
        assert.strictEqual(nonActive.service.getActivePokemon().instanceId, lead.instanceId);
        assert.strictEqual(caughtBefore, "CAUGHT");
        assert.strictEqual(nonActive.progress.getStatus(released.speciesId), "CAUGHT", "Release must preserve Pokédex CAUGHT history");
        assert.strictEqual(storageValues.get("poke_proto_release_non_active_pokedex").includes(released.speciesId), true,
            "Pokédex CAUGHT record remains persisted after release");
        assert.strictEqual(nonActive.server.getSnapshot().pokemon.length, 1, "Release commits the authoritative Party snapshot");
        assert.strictEqual(storageValues.has("poke_proto_release_non_active_party"), false, "Party is no longer saved to localStorage");

        // Releasing the active member chooses the first remaining able Pokémon.
        const activeCase = makeService("release_active", 3);
        const [first, second, third] = activeCase.service.getParty();
        await activeCase.service.selectActivePokemon(1);
        const activeResult = await activeCase.service.releasePokemon(second.instanceId);
        assert.strictEqual(activeResult.success, true);
        assert.deepStrictEqual(activeCase.service.getParty().map((pokemon) => pokemon.instanceId), [first.instanceId, third.instanceId]);
        assert.strictEqual(activeCase.service.getActivePokemon().instanceId, first.instanceId);

        // Releasing the final member leaves a valid empty Party and permits choosing a starter again.
        const lastCase = makeService("release_last", 1);
        const last = lastCase.service.getParty()[0];
        const lastResult = await lastCase.service.releasePokemon(last.instanceId);
        assert.strictEqual(lastResult.success, true);
        assert.deepStrictEqual(lastCase.service.getParty(), []);
        assert.strictEqual(lastCase.service.activePokemonId, null);
        assert.strictEqual(lastCase.service.isStarterChosen(), false);
        assert.strictEqual(lastCase.service.hasStarter(), false);
        assert.deepStrictEqual(lastCase.server.getSnapshot().pokemon, []);
        assert.strictEqual(lastCase.server.getSnapshot().activePokemonId, null);

        // Party limit remains six; release opens a slot that can be filled normally.
        const fullCase = makeService("release_full", 6);
        const removed = fullCase.service.getParty()[2];
        assert.strictEqual(fullCase.service.isPartyFull(), true);
        assert.strictEqual((await fullCase.service.releasePokemon(removed.instanceId)).success, true);
        assert.strictEqual(fullCase.service.isPartyFull(), false);
        assert.strictEqual((await fullCase.service.addPokemon(new PokemonInstance(species[6], 5), { isNewCapture: true })).success, true);
        assert.strictEqual(fullCase.service.getPartySize(), 6);
        assert.strictEqual(fullCase.server.getSnapshot().pokemon.length, 6);
        assert.strictEqual(fullCase.progress.getStatus("007"), "CAUGHT", "Capture history is updated only after the Party API confirms acquisition");

        // Battle, dialogue and map transition states reject release without mutation.
        for (const state of ["BATTLE", "DIALOGUE", "TRANSITION"]) {
            const locked = makeService("release_locked_" + state.toLowerCase(), 1, state);
            const member = locked.service.getParty()[0];
            const before = JSON.stringify(locked.service.getParty().map((pokemon) => pokemon.toJSON()));
            const result = await locked.service.releasePokemon(member.instanceId);
            assert.deepStrictEqual(result, { success: false, reason: "INVALID_GAME_STATE" });
            assert.strictEqual(JSON.stringify(locked.service.getParty().map((pokemon) => pokemon.toJSON())), before);
        }

        // UI confirmation cancellation preserves Party; confirmation delegates release to PartyService.
        const uiCase = makeService("release_ui", 1, "MENU");
        let confirmResult = false;
        let confirmationCount = 0;
        let renderRefreshCount = 0;
        global.window = { confirm: () => { confirmationCount++; return confirmResult; } };
        const modalManager = {
            activeModal: "pokemon",
            registerModal() {},
            showModalContent(modalName) {
                if (modalName === "pokemon") renderRefreshCount++;
            },
            openModal() {}
        };
        const ui = new PokemonUI({ state: "MENU", pokemonPartyService: uiCase.service }, modalManager);
        const renderParty = () => ui.render(() => {});
        const findReleaseButton = (rendered) => rendered.querySelectorAll("[data-pokemon-release-index]")[0];
        let releaseButton = findReleaseButton(renderParty());
        const uiMember = uiCase.service.getParty()[0];
        await releaseButton.listeners.click();
        assert.strictEqual(confirmationCount, 1);
        assert.strictEqual(uiCase.service.getPartySize(), 1, "Cancel must not mutate Party");

        confirmResult = true;
        releaseButton = findReleaseButton(renderParty());
        await releaseButton.listeners.click();
        assert.strictEqual(confirmationCount, 2);
        assert.strictEqual(uiCase.service.getPartySize(), 0, "Confirmed UI action releases the Pokémon");
        assert.strictEqual(uiCase.progress.getStatus(uiMember.speciesId), "CAUGHT", "UI release must leave caught history intact");
        assert(renderRefreshCount > 0, "Party modal refreshes from the service change notification");

        console.log("Pokémon Party Release tests: 8 PASS, 0 FAIL (Firestore API mock)");
    } finally {
        for (const uid of [
            "release_non_active", "release_active", "release_last", "release_full", "release_locked_battle",
            "release_locked_dialogue", "release_locked_transition", "release_ui"
        ]) {
            for (const key of ["party", "active_pokemon_id", "starter_chosen"]) storageValues.delete(`poke_proto_${uid}_${key}`);
            storageValues.delete(`poke_proto_${uid}_pokedex`);
        }
        if (previousLocalStorage === undefined) delete global.localStorage;
        else global.localStorage = previousLocalStorage;
        if (previousSetInterval === undefined) delete global.setInterval;
        else global.setInterval = previousSetInterval;
        if (previousClearInterval === undefined) delete global.clearInterval;
        else global.clearInterval = previousClearInterval;
        if (previousDocument === undefined) delete global.document;
        else global.document = previousDocument;
        if (previousWindow === undefined) delete global.window;
        else global.window = previousWindow;
    }
}

try {
    run().catch((error) => {
        console.error("Pokémon Party Release tests failed:", error);
        process.exitCode = 1;
    });
} catch (error) {
    console.error("Pokémon Party Release tests failed:", error);
    process.exitCode = 1;
}
