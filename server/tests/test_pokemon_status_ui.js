const assert = require("assert");
const fs = require("fs");
const path = require("path");
const PokemonInstance = require("../../public/js/engine/pokemon/pokemonInstance");
const PokemonUI = require("../../public/js/engine/ui/pokemonUI");

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName;
        this.children = [];
        this.attributes = {};
        this.listeners = {};
        this.style = { cssText: "" };
        this.textContent = "";
    }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
}

function walk(element, callback) {
    callback(element);
    element.children.forEach((child) => walk(child, callback));
}

function run() {
    const sourceSpecies = JSON.parse(fs.readFileSync(path.join(__dirname, "../../public/res/pokemon/species.json"), "utf8"));
    const pokemon = new PokemonInstance(sourceSpecies[0], 7);
    pokemon.exp = 42;
    pokemon.takeDamage(13);
    const before = JSON.stringify(pokemon.toJSON());
    const party = [pokemon];
    const modalCalls = [];
    const ui = Object.create(PokemonUI.prototype);
    ui.game = { pokemonPartyService: { getParty: () => party } };
    ui.modalManager = { openModal: (id) => modalCalls.push(id) };
    ui.selectedPokemonInstanceId = pokemon.instanceId;

    const previousDocument = global.document;
    global.document = { createElement: (tagName) => new FakeElement(tagName) };
    try {
        let closeCalls = 0;
        const rendered = ui.renderStatus(() => { closeCalls++; });
        const fields = {};
        const stats = {};
        const baseStats = {};
        let expTrack = null;
        let expFill = null;
        let backButton = null;
        let closeButton = null;
        walk(rendered, (element) => {
            if (element.attributes["data-status-field"]) fields[element.attributes["data-status-field"]] = element.textContent;
            if (element.attributes["data-status-stat"]) stats[element.attributes["data-status-stat"]] = element.textContent;
            if (element.attributes["data-status-base-stat"]) baseStats[element.attributes["data-status-base-stat"]] = element.textContent;
            if (element.className === "pokemon-status-exp-track") expTrack = element;
            if (element.className === "pokemon-status-exp-fill") expFill = element;
            if (element.className === "pokemon-status-back") backButton = element;
            if (element.className === "rpg-modal-close-btn") closeButton = element;
        });

        assert.strictEqual(fields.name, pokemon.name);
        assert.strictEqual(fields.level, "Level: " + pokemon.level);
        assert.strictEqual(fields.exp, "EXP: 42 / 350");
        assert.strictEqual(expTrack.attributes["aria-valuemax"], "350");
        assert.strictEqual(expTrack.attributes["aria-valuenow"], "42");
        assert.strictEqual(expFill.style.cssText.includes("width: 12%"), true);
        assert.strictEqual(fields.hp, "HP: " + pokemon.currentHp + " / " + pokemon.maxHp);
        assert.strictEqual(stats.attack, String(pokemon.stats.attack));
        assert.strictEqual(stats.defense, String(pokemon.stats.defense));
        assert.strictEqual(stats.special, String(pokemon.stats.special));
        assert.strictEqual(stats.speed, String(pokemon.stats.speed));
        assert.strictEqual(stats.hp, String(pokemon.maxHp));
        assert.strictEqual(baseStats.hp, String(pokemon.baseStats.hp));
        assert.strictEqual(baseStats.attack, String(pokemon.baseStats.attack));
        assert.strictEqual(baseStats.defense, String(pokemon.baseStats.defense));
        assert.strictEqual(baseStats.special, String(pokemon.baseStats.special));
        assert.strictEqual(baseStats.speed, String(pokemon.baseStats.speed));
        assert.strictEqual(JSON.stringify(pokemon.toJSON()), before, "Opening status must not mutate Pokémon data");
        assert.strictEqual(party[0], pokemon, "Party instance identity must remain unchanged");
        assert(backButton && closeButton);
        backButton.listeners.click();
        closeButton.listeners.click();
        assert.deepStrictEqual(modalCalls, ["pokemon"]);
        assert.strictEqual(closeCalls, 1);
        assert.strictEqual(JSON.stringify(pokemon.toJSON()), before, "Status navigation must remain read-only");

        pokemon.level = 100;
        pokemon.exp = 0;
        const maxLevelSnapshot = JSON.stringify(pokemon.toJSON());
        const maxLevelRendered = ui.renderStatus(() => {});
        let maxExpLabel = "";
        let maxExpTrack = null;
        let maxExpFill = null;
        walk(maxLevelRendered, (element) => {
            if (element.attributes["data-status-field"] === "exp") maxExpLabel = element.textContent;
            if (element.className === "pokemon-status-exp-track") maxExpTrack = element;
            if (element.className === "pokemon-status-exp-fill") maxExpFill = element;
        });
        assert.strictEqual(maxExpLabel, "EXP: MAX");
        assert.strictEqual(maxExpTrack.attributes["aria-valuemax"], "100");
        assert.strictEqual(maxExpTrack.attributes["aria-valuenow"], "100");
        assert.strictEqual(maxExpFill.style.cssText.includes("width: 100%"), true);
        assert.strictEqual(JSON.stringify(pokemon.toJSON()), maxLevelSnapshot, "MAX rendering must remain read-only");

        const source = fs.readFileSync(path.join(__dirname, "../../public/js/engine/ui/pokemonUI.js"), "utf8");
        assert.match(source, /data-pokemon-status-index/);
        assert.match(source, /openModal\("pokemon_status"\)/);
        console.log("Pokémon Status UI tests: 1 PASS, 0 FAIL");
    } finally {
        if (previousDocument === undefined) delete global.document;
        else global.document = previousDocument;
    }
}

try {
    run();
} catch (error) {
    console.error("Pokémon Status UI tests failed:", error);
    process.exitCode = 1;
}
