const crypto = require("crypto");
const { FieldValue, getFirestore } = require("../config/firebase");
const pokemonCatalogService = require("./pokemonCatalogService");

const PARTY_SCHEMA_VERSION = 1;
const MAX_PARTY_SIZE = 6;
const MAX_LEVEL = 100;
const PARTY_FIELDS = ["operationId", "expectedRevision", "pokemon", "activePokemonId", "starterChosen"];
const MIGRATION_FIELDS = ["pokemon", "activePokemonId", "starterChosen"];
const POKEMON_FIELDS = [
    "instanceId", "speciesId", "nationalDex", "name", "level", "exp", "types", "baseStats",
    "maxHp", "currentHp", "faintedAt", "stats", "sprite", "caughtAt"
];
const BASE_STAT_FIELDS = ["attack", "defense", "hp", "special", "speed"];
const STAT_FIELDS = ["attack", "defense", "speed", "special"];

function createPartyError(message, code, statusCode, extra) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    if (extra) Object.assign(error, extra);
    return error;
}

function getPartyDocumentRef(db, uid) {
    if (typeof uid !== "string" || !uid.trim()) {
        throw createPartyError("Authenticated user UID is required.", "INVALID_UID", 400);
    }
    return db.collection("users").doc(uid).collection("gameState").doc("pokemonParty");
}

function createInitialPartyData() {
    return {
        schemaVersion: PARTY_SCHEMA_VERSION,
        pokemon: [],
        activePokemonId: null,
        starterChosen: false,
        migration: { status: "pending", result: null },
        revision: 0,
        updatedAt: FieldValue.serverTimestamp()
    };
}

function toPublicSnapshot(data) {
    if (!data || data.schemaVersion !== PARTY_SCHEMA_VERSION || !Array.isArray(data.pokemon) ||
        !["pending", "completed"].includes(data.migration && data.migration.status) ||
        !Number.isSafeInteger(data.revision) || data.revision < 0 || typeof data.starterChosen !== "boolean" ||
        !(data.activePokemonId === null || typeof data.activePokemonId === "string")) {
        throw createPartyError("Party data is invalid.", "PARTY_DATA_INVALID", 500);
    }
    const snapshot = {
        schemaVersion: data.schemaVersion,
        pokemon: data.pokemon,
        activePokemonId: data.activePokemonId,
        starterChosen: data.starterChosen,
        migration: {
            status: data.migration.status,
            result: data.migration.result || null
        },
        revision: data.revision,
        updatedAt: data.updatedAt && typeof data.updatedAt.toMillis === "function" ? data.updatedAt.toMillis() : null
    };
    if (snapshot.pokemon.length > MAX_PARTY_SIZE) {
        throw createPartyError("Party exceeds the maximum size.", "PARTY_DATA_INVALID", 500);
    }
    return snapshot;
}

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
    return isPlainObject(value) && Object.keys(value).sort().join(",") === keys.slice().sort().join(",");
}

function normalizePokemon(raw, speciesById) {
    if (!hasExactKeys(raw, POKEMON_FIELDS)) {
        throw createPartyError("Pokémon instance contains missing or unsupported fields.", "INVALID_POKEMON_INSTANCE", 400);
    }
    const speciesId = typeof raw.speciesId === "string" ? raw.speciesId : "";
    const species = speciesById.get(speciesId);
    if (!species) throw createPartyError("Species ID does not exist.", "UNKNOWN_SPECIES_ID", 400);

    if (typeof raw.instanceId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(raw.instanceId) ||
        !Number.isSafeInteger(raw.level) || raw.level < 1 || raw.level > MAX_LEVEL ||
        !Number.isSafeInteger(raw.exp) || raw.exp < 0 ||
        !Number.isSafeInteger(raw.nationalDex) || raw.nationalDex < 1 ||
        !Number.isSafeInteger(raw.currentHp) || !Number.isSafeInteger(raw.maxHp) ||
        !Number.isSafeInteger(raw.caughtAt) || raw.caughtAt <= 0 ||
        !(raw.faintedAt === null || (Number.isSafeInteger(raw.faintedAt) && raw.faintedAt > 0)) ||
        typeof raw.name !== "string" || raw.name.length > 80 || !Array.isArray(raw.types) ||
        raw.types.length < 1 || raw.types.length > 2 || raw.types.some((type) => typeof type !== "string") ||
        !hasExactKeys(raw.baseStats, BASE_STAT_FIELDS) ||
        BASE_STAT_FIELDS.some((field) => !Number.isSafeInteger(raw.baseStats[field]) || raw.baseStats[field] < 1) ||
        !hasExactKeys(raw.stats, STAT_FIELDS) || typeof raw.sprite !== "string" || raw.sprite.length > 500) {
        throw createPartyError("Pokémon instance fields are invalid.", "INVALID_POKEMON_INSTANCE", 400);
    }
    if (raw.exp >= raw.level * 50 && raw.level < MAX_LEVEL || (raw.level === MAX_LEVEL && raw.exp !== 0)) {
        throw createPartyError("Pokémon EXP is outside the current level range.", "INVALID_POKEMON_INSTANCE", 400);
    }

    const baseStats = species.baseStats;
    if (raw.nationalDex !== species.nationalDex ||
        BASE_STAT_FIELDS.some((field) => raw.baseStats[field] !== baseStats[field])) {
        throw createPartyError("Pokémon species metadata does not match the catalog.", "INVALID_POKEMON_SPECIES_DATA", 400);
    }
    const scale = Math.pow(1.2, raw.level - 1);
    const scaled = (key) => Math.floor((Number(baseStats[key]) || 0) * scale);
    const calculated = {
        hp: scaled("hp"),
        stats: {
            attack: scaled("attack"),
            defense: scaled("defense"),
            speed: scaled("speed"),
            special: scaled("special")
        }
    };
    if (raw.maxHp !== calculated.hp || raw.currentHp < 0 || raw.currentHp > calculated.hp ||
        STAT_FIELDS.some((field) => raw.stats[field] !== calculated.stats[field]) ||
        Object.keys(raw.stats).some((field) => !STAT_FIELDS.includes(field))) {
        throw createPartyError("Pokémon stats or HP do not match species and level.", "INVALID_POKEMON_STATS", 400);
    }
    if (raw.faintedAt !== null && raw.currentHp > 0) {
        throw createPartyError("A living Pokémon cannot have a faint timestamp.", "INVALID_POKEMON_INSTANCE", 400);
    }

    return {
        instanceId: raw.instanceId,
        speciesId,
        nationalDex: species.nationalDex,
        name: species.name,
        level: raw.level,
        exp: raw.exp,
        types: Array.isArray(species.types) ? [...species.types] : [],
        baseStats: { ...baseStats },
        maxHp: calculated.hp,
        currentHp: raw.currentHp,
        faintedAt: raw.faintedAt,
        stats: calculated.stats,
        sprite: species.assets && species.assets.front ? species.assets.front : `/res/pokemon/sprites/animated/${speciesId}.gif`,
        caughtAt: raw.caughtAt
    };
}

function normalizeMutationPayload(payload, species) {
    if (!hasExactKeys(payload, PARTY_FIELDS)) {
        throw createPartyError("Party mutation contains missing or unsupported fields.", "INVALID_PARTY_PAYLOAD", 400);
    }
    if (typeof payload.operationId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(payload.operationId)) {
        throw createPartyError("Operation ID is invalid.", "INVALID_OPERATION_ID", 400);
    }
    if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0 ||
        !Array.isArray(payload.pokemon) || payload.pokemon.length > MAX_PARTY_SIZE ||
        typeof payload.starterChosen !== "boolean" ||
        !(payload.activePokemonId === null || typeof payload.activePokemonId === "string")) {
        throw createPartyError("Party mutation data is invalid.", "INVALID_PARTY_PAYLOAD", 400);
    }

    const speciesById = new Map(species.map((entry) => [String(entry.id).padStart(3, "0"), entry]));
    const pokemon = payload.pokemon.map((entry) => normalizePokemon(entry, speciesById));
    const instanceIds = pokemon.map((entry) => entry.instanceId);
    if (new Set(instanceIds).size !== instanceIds.length) {
        throw createPartyError("Pokémon instance IDs must be unique.", "DUPLICATE_INSTANCE_ID", 400);
    }
    if (pokemon.length === 0 && payload.activePokemonId !== null) {
        throw createPartyError("An empty Party must have no active Pokémon.", "INVALID_ACTIVE_POKEMON", 400);
    }
    if (payload.activePokemonId !== null) {
        const active = pokemon.find((entry) => entry.instanceId === payload.activePokemonId);
        if (!active || active.currentHp <= 0) {
            throw createPartyError("Active Pokémon must be alive and belong to the Party.", "INVALID_ACTIVE_POKEMON", 400);
        }
    }

    const normalized = {
        expectedRevision: payload.expectedRevision,
        pokemon,
        activePokemonId: payload.activePokemonId,
        starterChosen: payload.starterChosen
    };
    return {
        operationId: payload.operationId,
        normalized,
        payloadHash: crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex")
    };
}

function normalizeMigrationPayload(payload, species) {
    if (!hasExactKeys(payload, MIGRATION_FIELDS)) {
        throw createPartyError("Party migration contains missing or unsupported fields.", "INVALID_PARTY_MIGRATION_PAYLOAD", 400);
    }
    // Reuse the complete G3A Party and Pokémon validator without trusting client-managed revisions.
    return normalizeMutationPayload({
        operationId: "party_migration",
        expectedRevision: 0,
        pokemon: payload.pokemon,
        activePokemonId: payload.activePokemonId,
        starterChosen: payload.starterChosen
    }, species).normalized;
}

async function getPartySnapshot(uid, db = getFirestore()) {
    const partyRef = getPartyDocumentRef(db, uid);
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(partyRef);
        if (!snapshot.exists) {
            const initial = createInitialPartyData();
            transaction.create(partyRef, initial);
            return toPublicSnapshot({ ...initial, updatedAt: null });
        }
        return toPublicSnapshot(snapshot.data());
    });
}

async function mutateParty(uid, payload, db = getFirestore()) {
    const species = await pokemonCatalogService.getEffectiveSpecies(db);
    const { operationId, normalized, payloadHash } = normalizeMutationPayload(payload, species);
    const partyRef = getPartyDocumentRef(db, uid);
    const operationRef = partyRef.collection("operations").doc(operationId);

    return db.runTransaction(async (transaction) => {
        const [operationSnapshot, partySnapshot] = await Promise.all([
            transaction.get(operationRef),
            transaction.get(partyRef)
        ]);
        const currentData = partySnapshot.exists ? partySnapshot.data() : createInitialPartyData();
        const current = toPublicSnapshot(currentData);

        if (operationSnapshot.exists) {
            const operation = operationSnapshot.data();
            if (operation.payloadHash !== payloadHash) {
                throw createPartyError("Operation ID was already used with a different payload.", "OPERATION_ID_REUSED", 409, { snapshot: current });
            }
            if (!operation.resultSnapshot) {
                throw createPartyError("Stored Party operation result is invalid.", "PARTY_OPERATION_INVALID", 500);
            }
            return { ...operation.resultSnapshot, alreadyProcessed: true };
        }
        if (current.migration.status !== "completed") {
            throw createPartyError("Party migration must finish before Party can be changed.", "PARTY_MIGRATION_PENDING", 409, { snapshot: current });
        }
        if (normalized.expectedRevision !== current.revision) {
            throw createPartyError("Party changed on another session. Reload the latest Party snapshot.", "REVISION_CONFLICT", 409, { snapshot: current });
        }

        const nextRevision = current.revision + 1;
        const nextData = {
            schemaVersion: PARTY_SCHEMA_VERSION,
            pokemon: normalized.pokemon,
            activePokemonId: normalized.activePokemonId,
            starterChosen: normalized.starterChosen,
            migration: currentData.migration,
            revision: nextRevision,
            updatedAt: FieldValue.serverTimestamp()
        };
        if (!partySnapshot.exists) transaction.create(partyRef, nextData);
        else transaction.update(partyRef, nextData);
        const resultSnapshot = toPublicSnapshot({ ...nextData, updatedAt: null });
        transaction.create(operationRef, {
            operationId,
            payloadHash,
            revision: nextRevision,
            resultSnapshot,
            createdAt: FieldValue.serverTimestamp()
        });
        return {
            ...resultSnapshot,
            alreadyProcessed: false
        };
    });
}

async function migrateParty(uid, payload, db = getFirestore()) {
    const species = await pokemonCatalogService.getEffectiveSpecies(db);
    const normalized = normalizeMigrationPayload(payload, species);
    const partyRef = getPartyDocumentRef(db, uid);

    return db.runTransaction(async (transaction) => {
        const partySnapshot = await transaction.get(partyRef);
        const currentData = partySnapshot.exists ? partySnapshot.data() : createInitialPartyData();
        const current = toPublicSnapshot(currentData);

        if (current.migration.status === "completed") {
            return { snapshot: current, migrationOutcome: "already_completed" };
        }

        const hasAuthoritativeData = current.pokemon.length > 0 || current.activePokemonId !== null ||
            current.starterChosen || current.revision > 0;
        if (hasAuthoritativeData) {
            const nextData = {
                ...currentData,
                migration: { status: "completed", result: "skipped_existing_data" },
                updatedAt: FieldValue.serverTimestamp()
            };
            transaction.update(partyRef, nextData);
            return {
                snapshot: toPublicSnapshot({ ...nextData, updatedAt: null }),
                migrationOutcome: "skipped_existing_data"
            };
        }

        const nextData = {
            schemaVersion: PARTY_SCHEMA_VERSION,
            pokemon: normalized.pokemon,
            activePokemonId: normalized.activePokemonId,
            starterChosen: normalized.starterChosen,
            migration: { status: "completed", result: "imported" },
            revision: current.revision + 1,
            updatedAt: FieldValue.serverTimestamp()
        };
        if (partySnapshot.exists) transaction.update(partyRef, nextData);
        else transaction.create(partyRef, nextData);
        return {
            snapshot: toPublicSnapshot({ ...nextData, updatedAt: null }),
            migrationOutcome: "imported"
        };
    });
}

module.exports = {
    PARTY_SCHEMA_VERSION,
    MAX_PARTY_SIZE,
    getPartyDocumentRef,
    createInitialPartyData,
    normalizeMutationPayload,
    getPartySnapshot,
    mutateParty,
    normalizeMigrationPayload,
    migrateParty
};
