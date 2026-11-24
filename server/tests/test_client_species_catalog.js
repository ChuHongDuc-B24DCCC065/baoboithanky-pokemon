const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const PokemonInstance = require("../../public/js/engine/pokemon/pokemonInstance");
const PokemonPartyService = require("../../public/js/engine/pokemon/pokemonPartyService");

function makeResponse(payload, status) {
    const code = status || 200;
    return { ok: code >= 200 && code < 300, status: code, json: () => Promise.resolve(payload) };
}

async function run() {
    const baseSpecies = JSON.parse(fs.readFileSync(path.join(__dirname, "../../public/res/pokemon/species.json"), "utf8"));
    const editedSpecies = baseSpecies.map((entry) => ({ ...entry }));
    editedSpecies[0] = { ...editedSpecies[0], name: "Bulbasaur Remote", baseStats: { ...editedSpecies[0].baseStats, attack: 88 } };
    const requests = [];
    const context = vm.createContext({
        console,
        Promise,
        Object,
        Array,
        Number,
        JSON,
        AbortController,
        setTimeout,
        clearTimeout,
        window: { location: { href: "" } },
        fetch(url, options) {
            requests.push({ url, options });
            return Promise.resolve(makeResponse({ success: true, data: { pokemon: editedSpecies } }));
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../public/js/engine/index.js"), "utf8"), context);
    const game = vm.runInContext("Object.create(Game.prototype)", context);
    game.speciesCatalog = [];
    await game.loadSpeciesCatalog();
    assert.strictEqual(requests[0].url, "/api/economy/pokemon-catalog");
    assert.strictEqual(requests[0].options.credentials, "same-origin");
    assert.strictEqual(game.speciesCatalog[0].name, "Bulbasaur Remote");
    assert.strictEqual(game.speciesCatalog[0].baseStats.attack, 88);

    const loadEvents = [];
    let releaseCatalogRequest;
    const loadContext = vm.createContext({
        console,
        Promise,
        Object,
        Array,
        Number,
        JSON,
        AbortController,
        setTimeout,
        clearTimeout,
        window: { location: { href: "" } },
        fetch(url) {
            loadEvents.push("request:" + url);
            return new Promise((resolve) => { releaseCatalogRequest = resolve; });
        }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../public/js/engine/index.js"), "utf8"), loadContext);
    const loadingGame = vm.runInContext("Object.create(Game.prototype)", loadContext);
    loadingGame.speciesCatalog = [];
    loadingGame.fetchSavedData = () => { loadEvents.push("auth"); return Promise.resolve(); };
    loadingGame.loadItemCatalog = () => { loadEvents.push("item-catalog"); return Promise.resolve(); };
    loadingGame.migrateLegacyInventory = () => { loadEvents.push("migration"); return Promise.resolve(); };
    loadingGame.fetchMapData = () => {
        assert.strictEqual(loadingGame.speciesCatalog[0].name, "Bulbasaur Remote");
        loadEvents.push("map");
        return Promise.resolve();
    };
    const loadingPromise = loadingGame.load();
    await Promise.resolve();
    await Promise.resolve();
    assert(loadEvents.includes("auth"));
    assert(loadEvents.includes("request:/api/economy/pokemon-catalog"));
    assert(!loadEvents.includes("map"), "Map/release setup must wait for the server catalog");
    releaseCatalogRequest(makeResponse({ success: true, data: { pokemon: editedSpecies } }));
    await loadingPromise;
    assert(loadEvents.indexOf("map") > loadEvents.indexOf("request:/api/economy/pokemon-catalog"));

    const pokemon = new PokemonInstance(baseSpecies[0], 5);
    pokemon.currentHp -= 7;
    const hpBeforeMetadataUpdate = pokemon.currentHp;
    pokemon.exp = 23;
    const oldLevel = pokemon.level;
    const oldExp = pokemon.exp;
    const party = Object.create(PokemonPartyService.prototype);
    party.party = [pokemon];
    party.speciesCatalog = editedSpecies;
    let saves = 0;
    party.saveToStorage = () => { saves++; };
    assert.strictEqual(party.applySpeciesMetadata(), true);
    assert.strictEqual(pokemon.name, "Bulbasaur Remote");
    assert.strictEqual(pokemon.stats.attack, Math.floor(88 * Math.pow(1.2, oldLevel - 1)));
    assert.strictEqual(pokemon.currentHp, hpBeforeMetadataUpdate, "Current HP must not be healed when Max HP grows");
    assert.strictEqual(pokemon.level, oldLevel);
    assert.strictEqual(pokemon.exp, oldExp);
    assert.strictEqual(saves, 1);

    const failedContext = vm.createContext({
        console,
        Promise,
        Object,
        Array,
        Number,
        JSON,
        AbortController,
        setTimeout,
        clearTimeout,
        window: { location: { href: "" } },
        fetch: () => Promise.resolve(makeResponse({ success: false }, 503))
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../../public/js/engine/index.js"), "utf8"), failedContext);
    const failedGame = vm.runInContext("Object.create(Game.prototype)", failedContext);
    failedGame.speciesCatalog = [];
    await assert.rejects(failedGame.loadSpeciesCatalog(), (error) => error.type === "POKEMON_CATALOG_LOAD_ERROR");
    assert.deepStrictEqual(failedGame.speciesCatalog, [], "Catalog load failure must not fall back to the static catalog");
    console.log("Client species catalog tests: 4 PASS, 0 FAIL");
}

run().catch((error) => {
    console.error("Client species catalog tests failed:", error);
    process.exitCode = 1;
});
