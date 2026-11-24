"use strict";

const fs = require("fs");
const path = require("path");
const firebaseConfig = require("../config/firebase");

const CATALOG_SCHEMA_VERSION = 1;
const DOCUMENT_PATH = "pokemonSpecies";
const EDITABLE_FIELDS = ["name", "types", "generation", "heightM", "weightKg", "baseStats", "dexEntry"];
const STAT_FIELDS = ["attack", "defense", "hp", "special", "speed"];
const TYPE_NAMES = new Set(["BUG", "DARK", "DRAGON", "ELECTRIC", "FAIRY", "FIGHTING", "FIRE", "FLYING", "GHOST", "GRASS", "GROUND", "ICE", "NORMAL", "POISON", "PSYCHIC", "ROCK", "STEEL", "WATER"]);
const SPECIES_PATH = path.join(__dirname, "../../public/res/pokemon/species.json");

function getCatalogDocumentRef(db = firebaseConfig.getFirestore()) {
    return db.collection("systemCatalogs").doc(DOCUMENT_PATH);
}

function readBaseSpecies() {
    const species = JSON.parse(fs.readFileSync(SPECIES_PATH, "utf8"));
    if (!Array.isArray(species)) throw new Error("Pokemon species catalog must be an array.");
    return species;
}

function validateEditableMetadata(speciesId, metadata, baseSpecies = readBaseSpecies()) {
    const id = String(speciesId || "");
    const base = baseSpecies.find((entry) => entry && String(entry.id) === id);
    if (!base) {
        const error = new Error("Không tìm thấy Pokémon ID trong species catalog gốc.");
        error.code = "SPECIES_NOT_FOUND";
        error.statusCode = 404;
        throw error;
    }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
        Object.keys(metadata).sort().join(",") !== EDITABLE_FIELDS.slice().sort().join(",")) {
        const error = new Error("Payload chỉ được chứa name, types, generation, heightM, weightKg, baseStats và dexEntry.");
        error.code = "INVALID_SPECIES_METADATA";
        error.statusCode = 400;
        throw error;
    }

    const name = typeof metadata.name === "string" ? metadata.name.trim() : "";
    const dexEntry = typeof metadata.dexEntry === "string" ? metadata.dexEntry.trim() : "";
    if (!name || name.length > 80 || dexEntry.length > 1000) {
        throw invalidMetadata("Tên hoặc mô tả Pokémon không hợp lệ.");
    }
    if (!Number.isInteger(metadata.generation) || metadata.generation < 1 || metadata.generation > 9) {
        throw invalidMetadata("Generation phải là số nguyên từ 1 đến 9.");
    }
    if (!Array.isArray(metadata.types) || metadata.types.length < 1 || metadata.types.length > 2 ||
        metadata.types.some((type) => typeof type !== "string" || !TYPE_NAMES.has(type)) ||
        new Set(metadata.types).size !== metadata.types.length) {
        throw invalidMetadata("Types phải gồm một hoặc hai hệ Pokémon hợp lệ, không trùng nhau.");
    }
    if (!Number.isFinite(metadata.heightM) || metadata.heightM <= 0 || metadata.heightM > 1000 ||
        !Number.isFinite(metadata.weightKg) || metadata.weightKg <= 0 || metadata.weightKg > 100000) {
        throw invalidMetadata("Chiều cao hoặc cân nặng không hợp lệ.");
    }
    if (!metadata.baseStats || typeof metadata.baseStats !== "object" || Array.isArray(metadata.baseStats) ||
        Object.keys(metadata.baseStats).sort().join(",") !== STAT_FIELDS.join(",") ||
        STAT_FIELDS.some((stat) => !Number.isSafeInteger(metadata.baseStats[stat]) || metadata.baseStats[stat] < 1 || metadata.baseStats[stat] > 10000)) {
        throw invalidMetadata("Base stats phải có đủ HP, Attack, Defense, Speed và Special với giá trị nguyên từ 1 đến 10.000.");
    }

    return {
        name,
        types: [...metadata.types],
        generation: metadata.generation,
        heightM: metadata.heightM,
        weightKg: metadata.weightKg,
        baseStats: Object.fromEntries(STAT_FIELDS.map((stat) => [stat, metadata.baseStats[stat]])),
        dexEntry
    };
}

function invalidMetadata(message) {
    const error = new Error(message);
    error.code = "INVALID_SPECIES_METADATA";
    error.statusCode = 400;
    return error;
}

function readOverrides(data, baseSpecies = readBaseSpecies()) {
    if (!data) return {};
    if (data.schemaVersion !== CATALOG_SCHEMA_VERSION || !data.species ||
        typeof data.species !== "object" || Array.isArray(data.species)) {
        throw new Error("Firestore Pokémon Catalog override document không hợp lệ.");
    }
    const overrides = {};
    for (const [id, metadata] of Object.entries(data.species)) {
        overrides[id] = validateEditableMetadata(id, metadata, baseSpecies);
    }
    return overrides;
}

function mergeSpecies(base, override) {
    return override ? { ...base, ...override, id: base.id, nationalDex: base.nationalDex, assets: base.assets } : { ...base };
}

async function getEffectiveSpecies(db = firebaseConfig.getFirestore()) {
    const base = readBaseSpecies();
    const snapshot = await getCatalogDocumentRef(db).get();
    const overrides = snapshot.exists ? readOverrides(snapshot.data(), base) : {};
    return base.map((entry) => mergeSpecies(entry, overrides[String(entry.id)]));
}

async function updateSpeciesMetadata(speciesId, metadata, db = firebaseConfig.getFirestore()) {
    const base = readBaseSpecies();
    const normalized = validateEditableMetadata(speciesId, metadata, base);
    const catalogRef = getCatalogDocumentRef(db);
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(catalogRef);
        const overrides = snapshot.exists ? readOverrides(snapshot.data(), base) : {};
        overrides[String(speciesId)] = normalized;
        transaction.set(catalogRef, {
            schemaVersion: CATALOG_SCHEMA_VERSION,
            species: overrides,
            updatedAt: firebaseConfig.FieldValue.serverTimestamp()
        });
        return mergeSpecies(base.find((entry) => String(entry.id) === String(speciesId)), normalized);
    });
}

module.exports = {
    CATALOG_SCHEMA_VERSION,
    EDITABLE_FIELDS,
    getCatalogDocumentRef,
    readBaseSpecies,
    validateEditableMetadata,
    getEffectiveSpecies,
    updateSpeciesMetadata
};
