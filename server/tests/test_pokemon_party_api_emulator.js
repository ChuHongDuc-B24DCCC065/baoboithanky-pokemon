"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

process.env.NODE_ENV = "test";
process.env.FIREBASE_ENV = "emulator";
process.env.FIREBASE_PROJECT_ID = "demo-poke-engine";
process.env.GCLOUD_PROJECT = "demo-poke-engine";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

const firebase = require("../config/firebase");
const partyService = require("../services/pokemonPartyService");
const partyController = require("../controllers/pokemonPartyController");
const partyRoutes = require("../routes/pokemonPartyRoutes");
const { requireAuth } = require("../middleware/authMiddleware");
const { csrfProtection } = require("../middleware/csrfMiddleware");
const PokemonInstance = require("../../public/js/engine/pokemon/pokemonInstance");
const pokemonCatalogService = require("../services/pokemonCatalogService");

function mockResponse() {
    return {
        statusCode: 200,
        payload: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; }
    };
}

function makePartyPayload(speciesList, count, options = {}) {
    const pokemon = [];
    for (let index = 0; index < count; index++) {
        const instance = new PokemonInstance(speciesList[index % speciesList.length], 5);
        instance.instanceId = `party_instance_${index}`;
        instance.exp = 0;
        pokemon.push(instance.toJSON());
    }
    return {
        operationId: options.operationId || `party_op_${crypto.randomUUID().replace(/-/g, "")}`,
        expectedRevision: options.expectedRevision || 0,
        pokemon,
        activePokemonId: count > 0 ? pokemon[0].instanceId : null,
        starterChosen: count > 0,
        ...(options.extra || {})
    };
}

function makeMigrationPayload(speciesList, count, options = {}) {
    const mutation = makePartyPayload(speciesList, count, options);
    return {
        pokemon: mutation.pokemon,
        activePokemonId: mutation.activePokemonId,
        starterChosen: mutation.starterChosen,
        ...(options.extra || {})
    };
}

async function run() {
    const firebaseEnvironment = firebase.resolveFirebaseEnvironment();
    assert.strictEqual(firebaseEnvironment.mode, "emulator", "Party tests must use Firebase Emulator");
    assert.strictEqual(firebaseEnvironment.projectId, "demo-poke-engine");
    firebase.initializeFirebaseAdmin();
    const db = firebase.getFirestore();
    const suffix = crypto.randomUUID().replace(/-/g, "");
    const uid = `party_test_${suffix}`;
    const attackerUid = `party_attacker_${suffix}`;
    const migrationUid = `party_migration_${suffix}`;
    const existingUid = `party_existing_${suffix}`;
    const partyRef = partyService.getPartyDocumentRef(db, uid);
    const attackerPartyRef = partyService.getPartyDocumentRef(db, attackerUid);
    const migrationPartyRef = partyService.getPartyDocumentRef(db, migrationUid);
    const existingPartyRef = partyService.getPartyDocumentRef(db, existingUid);
    const economyRef = db.collection("users").doc(uid).collection("gameState").doc("economy");
    const userRefs = [uid, attackerUid, migrationUid, existingUid].map((userUid) => db.collection("users").doc(userUid));

    try {
        const species = await pokemonCatalogService.getEffectiveSpecies(db);
        assert(species.length > 6, "Species catalog should provide real species for Party validation tests");
        const speciesOne = species[0];

        const initial = await partyService.getPartySnapshot(uid, db);
        assert.deepStrictEqual(initial.pokemon, []);
        assert.strictEqual(initial.activePokemonId, null);
        assert.strictEqual(initial.revision, 0);
        assert.deepStrictEqual(initial.migration, { status: "pending", result: null });
        assert.strictEqual((await partyRef.get()).data().schemaVersion, 1);

        // GET identity is taken from req.user; forged payload/query UIDs have no effect.
        await attackerPartyRef.set({ ...partyService.createInitialPartyData(), migration: { status: "completed", result: "imported" } });
        const snapshotResponse = mockResponse();
        await partyController.getSnapshot({
            user: { uid },
            params: { uid: attackerUid },
            query: { uid: attackerUid },
            body: { uid: attackerUid }
        }, snapshotResponse);
        assert.strictEqual(snapshotResponse.statusCode, 200);
        assert.strictEqual(snapshotResponse.payload.data.migration.status, "pending");
        assert.strictEqual((await attackerPartyRef.get()).data().migration.status, "completed");

        // Router guards auth and CSRF in the expected order.
        const getLayer = partyRoutes.stack.find((layer) => layer.route && layer.route.path === "/");
        const mutationLayer = partyRoutes.stack.find((layer) => layer.route && layer.route.path === "/mutation");
        const migrationLayer = partyRoutes.stack.find((layer) => layer.route && layer.route.path === "/migration");
        assert(getLayer && getLayer.route.methods.get);
        assert.strictEqual(getLayer.route.stack[0].handle, requireAuth);
        assert(mutationLayer && mutationLayer.route.methods.post);
        assert.strictEqual(mutationLayer.route.stack[0].handle, requireAuth);
        assert.strictEqual(mutationLayer.route.stack[1].handle, csrfProtection);
        assert(migrationLayer && migrationLayer.route.methods.post);
        assert.strictEqual(migrationLayer.route.stack[0].handle, requireAuth);
        assert.strictEqual(migrationLayer.route.stack[1].handle, csrfProtection);
        const appSource = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
        assert.match(appSource, /app\.use\(["']\/api\/party["'],\s*pokemonPartyRoutes\)/);

        const unauthResponse = mockResponse();
        let authNextCalled = false;
        await requireAuth({ method: "POST", path: "/api/party/mutation", originalUrl: "/api/party/mutation", headers: {} }, unauthResponse, () => {
            authNextCalled = true;
        });
        assert.strictEqual(authNextCalled, false);
        assert.strictEqual(unauthResponse.statusCode, 401);

        const csrfResponse = mockResponse();
        let csrfNextCalled = false;
        csrfProtection({ method: "POST", headers: { origin: "http://localhost:3000" } }, csrfResponse, () => {
            csrfNextCalled = true;
        });
        assert.strictEqual(csrfNextCalled, false);
        assert.strictEqual(csrfResponse.statusCode, 403);

        // Migration imports a valid legacy Party atomically and takes identity only from req.user.
        const migrationPayload = makeMigrationPayload(species, 2);
        const migrationResponse = mockResponse();
        await partyController.migrate({
            user: { uid: migrationUid },
            body: { ...migrationPayload, uid: attackerUid, balance: 999999 }
        }, migrationResponse);
        assert.strictEqual(migrationResponse.statusCode, 400, "Unsupported UID/Economy fields must be rejected");
        assert.strictEqual((await migrationPartyRef.get()).exists, false, "Invalid payload must not create a Party document");

        const validMigrationResponse = mockResponse();
        await partyController.migrate({ user: { uid: migrationUid }, body: migrationPayload }, validMigrationResponse);
        assert.strictEqual(validMigrationResponse.statusCode, 200);
        assert.strictEqual(validMigrationResponse.payload.migrationOutcome, "imported");
        assert.strictEqual(validMigrationResponse.payload.data.pokemon.length, 2);
        assert.strictEqual(validMigrationResponse.payload.data.revision, 1);
        assert.deepStrictEqual(validMigrationResponse.payload.data.migration, { status: "completed", result: "imported" });
        const importedBeforeRetry = (await migrationPartyRef.get()).data();

        const retryResponse = mockResponse();
        await partyController.migrate({ user: { uid: migrationUid }, body: makeMigrationPayload(species, 1) }, retryResponse);
        assert.strictEqual(retryResponse.statusCode, 200);
        assert.strictEqual(retryResponse.payload.migrationOutcome, "already_completed");
        assert.deepStrictEqual(retryResponse.payload.data.pokemon, importedBeforeRetry.pokemon);
        assert.strictEqual(retryResponse.payload.data.revision, importedBeforeRetry.revision);
        assert.deepStrictEqual((await migrationPartyRef.get()).data().pokemon, importedBeforeRetry.pokemon,
            "Retry after completion must not import or overwrite Party");

        // Empty legacy Party is a valid one-time migration.
        const emptyUid = `party_empty_migration_${suffix}`;
        const emptyPartyRef = partyService.getPartyDocumentRef(db, emptyUid);
        userRefs.push(db.collection("users").doc(emptyUid));
        const emptyResult = await partyService.migrateParty(emptyUid, makeMigrationPayload(species, 0), db);
        assert.strictEqual(emptyResult.migrationOutcome, "imported");
        assert.deepStrictEqual(emptyResult.snapshot.pokemon, []);
        assert.strictEqual(emptyResult.snapshot.activePokemonId, null);
        assert.strictEqual((await emptyPartyRef.get()).data().revision, 1);

        // Concurrent retries are serialized by the transaction; only one imports.
        const concurrentUid = `party_concurrent_migration_${suffix}`;
        const concurrentRef = partyService.getPartyDocumentRef(db, concurrentUid);
        userRefs.push(db.collection("users").doc(concurrentUid));
        const concurrentResults = await Promise.all([
            partyService.migrateParty(concurrentUid, makeMigrationPayload(species, 1), db),
            partyService.migrateParty(concurrentUid, makeMigrationPayload(species, 2), db)
        ]);
        assert.deepStrictEqual(
            concurrentResults.map((result) => result.migrationOutcome).sort(),
            ["already_completed", "imported"],
            "Concurrent migration requests must produce one import and one completed retry"
        );
        assert.strictEqual((await concurrentRef.get()).data().revision, 1);

        // A pending document with actual Party data is preserved, including its revision.
        const existingPokemon = makePartyPayload(species, 1).pokemon;
        await existingPartyRef.set({
            ...partyService.createInitialPartyData(),
            pokemon: existingPokemon,
            activePokemonId: existingPokemon[0].instanceId,
            starterChosen: true,
            revision: 12
        });
        const existingResult = await partyService.migrateParty(existingUid, makeMigrationPayload(species, 0), db);
        assert.strictEqual(existingResult.migrationOutcome, "skipped_existing_data");
        assert.strictEqual(existingResult.snapshot.revision, 12);
        assert.deepStrictEqual(existingResult.snapshot.pokemon, existingPokemon);
        assert.deepStrictEqual(existingResult.snapshot.migration, { status: "completed", result: "skipped_existing_data" });

        // Rejected migration leaves pending state unchanged; malformed input uses G3A validation.
        const invalidMigrationUid = `party_invalid_migration_${suffix}`;
        const invalidMigrationRef = partyService.getPartyDocumentRef(db, invalidMigrationUid);
        userRefs.push(db.collection("users").doc(invalidMigrationUid));
        await partyService.getPartySnapshot(invalidMigrationUid, db);
        const wrongSpeciesMigration = makeMigrationPayload(species, 1);
        wrongSpeciesMigration.pokemon[0].speciesId = "999";
        await assert.rejects(
            partyService.migrateParty(invalidMigrationUid, wrongSpeciesMigration, db),
            (error) => error.code === "UNKNOWN_SPECIES_ID"
        );
        assert.deepStrictEqual((await invalidMigrationRef.get()).data().migration, { status: "pending", result: null });
        const badShapeResponse = mockResponse();
        await partyController.migrate({ user: { uid: invalidMigrationUid }, body: { ...makeMigrationPayload(species, 0), operationId: "client_controlled" } }, badShapeResponse);
        assert.strictEqual(badShapeResponse.statusCode, 400);

        const noSessionMigrationResponse = mockResponse();
        await partyController.migrate({ body: makeMigrationPayload(species, 0) }, noSessionMigrationResponse);
        assert.strictEqual(noSessionMigrationResponse.statusCode, 401);

        const pendingMutation = makePartyPayload(species, 0);
        await assert.rejects(
            partyService.mutateParty(uid, pendingMutation, db),
            (error) => error.code === "PARTY_MIGRATION_PENDING" && error.statusCode === 409
        );
        assert.strictEqual((await partyRef.get()).data().revision, 0, "Pending migration must not write Party state");

        // Prepare a completed migration fixture; migration itself is deliberately out of scope.
        await partyRef.update({ migration: { status: "completed", result: "imported" } });
        await economyRef.set({ schemaVersion: 1, balance: 77, items: { potion_standard: 3 }, equipment: { armor: null, shoes: null, accessory: null, held_item: null } });
        const economyBefore = (await economyRef.get()).data();

        // Party sizes 0 through 6 are accepted, with server-assigned revision increments.
        let acceptedSnapshot = null;
        for (let count = 0; count <= 6; count++) {
            const payload = makePartyPayload(species, count, {
                operationId: `size_test_${count}_${suffix}`,
                expectedRevision: count
            });
            acceptedSnapshot = await partyService.mutateParty(uid, payload, db);
            assert.strictEqual(acceptedSnapshot.pokemon.length, count);
            assert.strictEqual(acceptedSnapshot.revision, count + 1);
            assert.strictEqual(acceptedSnapshot.activePokemonId, count ? "party_instance_0" : null);
        }
        assert.strictEqual(acceptedSnapshot.revision, 7);

        const basePayload = makePartyPayload(species, 1, { expectedRevision: 7, operationId: `validation_${suffix}` });
        const badSpeciesPayload = structuredClone(basePayload);
        badSpeciesPayload.pokemon[0].speciesId = "999";
        await assert.rejects(partyService.mutateParty(uid, badSpeciesPayload, db), (error) => error.code === "UNKNOWN_SPECIES_ID");

        const duplicatePayload = makePartyPayload(species, 2, { expectedRevision: 7, operationId: `duplicate_${suffix}` });
        duplicatePayload.pokemon[1].instanceId = duplicatePayload.pokemon[0].instanceId;
        await assert.rejects(partyService.mutateParty(uid, duplicatePayload, db), (error) => error.code === "DUPLICATE_INSTANCE_ID");

        const invalidActivePayload = makePartyPayload(species, 1, { expectedRevision: 7, operationId: `active_${suffix}` });
        invalidActivePayload.activePokemonId = "not_in_party";
        await assert.rejects(partyService.mutateParty(uid, invalidActivePayload, db), (error) => error.code === "INVALID_ACTIVE_POKEMON");

        const faintedActivePayload = makePartyPayload(species, 1, { expectedRevision: 7, operationId: `fainted_${suffix}` });
        faintedActivePayload.pokemon[0].currentHp = 0;
        faintedActivePayload.pokemon[0].faintedAt = Date.now();
        await assert.rejects(partyService.mutateParty(uid, faintedActivePayload, db), (error) => error.code === "INVALID_ACTIVE_POKEMON");

        const emptyWithActive = makePartyPayload(species, 0, { expectedRevision: 7, operationId: `empty_active_${suffix}` });
        emptyWithActive.activePokemonId = "party_instance_0";
        await assert.rejects(partyService.mutateParty(uid, emptyWithActive, db), (error) => error.code === "INVALID_ACTIVE_POKEMON");

        const tooManyPayload = makePartyPayload(species, 7, { expectedRevision: 7, operationId: `too_many_${suffix}` });
        await assert.rejects(partyService.mutateParty(uid, tooManyPayload, db), (error) => error.code === "INVALID_PARTY_PAYLOAD");

        const extraFieldPayload = makePartyPayload(species, 1, { expectedRevision: 7, operationId: `extra_${suffix}`, extra: { uid: attackerUid } });
        await assert.rejects(partyService.mutateParty(uid, extraFieldPayload, db), (error) => error.code === "INVALID_PARTY_PAYLOAD");
        const serverFieldsPayload = makePartyPayload(species, 1, {
            expectedRevision: 7,
            operationId: `server_fields_${suffix}`,
            extra: { revision: 999, schemaVersion: 88, migration: { status: "completed" }, updatedAt: "forged" }
        });
        await assert.rejects(partyService.mutateParty(uid, serverFieldsPayload, db), (error) => error.code === "INVALID_PARTY_PAYLOAD");

        const forgedStatsPayload = makePartyPayload(species, 1, { expectedRevision: 7, operationId: `stats_${suffix}` });
        forgedStatsPayload.pokemon[0].stats.attack += 1;
        await assert.rejects(partyService.mutateParty(uid, forgedStatsPayload, db), (error) => error.code === "INVALID_POKEMON_STATS");

        // Revision conflict returns the latest snapshot and leaves Firestore untouched.
        const conflictPayload = makePartyPayload(species, 1, { expectedRevision: 0, operationId: `conflict_${suffix}` });
        await assert.rejects(partyService.mutateParty(uid, conflictPayload, db), (error) => {
            assert.strictEqual(error.code, "REVISION_CONFLICT");
            assert.strictEqual(error.statusCode, 409);
            assert.strictEqual(error.snapshot.revision, 7);
            return true;
        });

        // First operation applies once; identical retry is acknowledged; reused ID with altered content is rejected.
        const opPayload = makePartyPayload(species, 2, { expectedRevision: 7, operationId: `retry_op_${suffix}` });
        const applied = await partyService.mutateParty(uid, opPayload, db);
        const retry = await partyService.mutateParty(uid, opPayload, db);
        assert.strictEqual(applied.revision, 8);
        assert.strictEqual(retry.revision, 8);
        assert.strictEqual(retry.alreadyProcessed, true);
        const alteredRetry = { ...opPayload, starterChosen: false };
        await assert.rejects(partyService.mutateParty(uid, alteredRetry, db), (error) => error.code === "OPERATION_ID_REUSED");
        assert.strictEqual((await partyRef.get()).data().revision, 8, "Retries and operation ID reuse must not apply another update");

        // Controller does not accept UID or Economy fields from client payload.
        const uidPayload = makePartyPayload(species, 1, {
            expectedRevision: 8,
            operationId: `uid_payload_${suffix}`,
            extra: { uid: attackerUid }
        });
        const uidResponse = mockResponse();
        await partyController.mutate({ user: { uid }, body: uidPayload }, uidResponse);
        assert.strictEqual(uidResponse.statusCode, 400);
        const economyPayload = makePartyPayload(species, 1, {
            expectedRevision: 8,
            operationId: `economy_payload_${suffix}`,
            extra: { balance: 999999, items: { potion_standard: 99 } }
        });
        const economyResponse = mockResponse();
        await partyController.mutate({ user: { uid }, body: economyPayload }, economyResponse);
        assert.strictEqual(economyResponse.statusCode, 400);
        assert.deepStrictEqual((await economyRef.get()).data(), economyBefore, "Party API must not alter Economy document");

        const conflictResponse = mockResponse();
        await partyController.mutate({
            user: { uid },
            body: makePartyPayload(species, 1, { expectedRevision: 1, operationId: `http_conflict_${suffix}` })
        }, conflictResponse);
        assert.strictEqual(conflictResponse.statusCode, 409);
        assert.strictEqual(conflictResponse.payload.code, "REVISION_CONFLICT");
        assert.strictEqual(conflictResponse.payload.data.revision, 8);
        assert.strictEqual((await attackerPartyRef.get()).data().revision, 0, "Client UID cannot choose another Party document");
        assert.deepStrictEqual((await economyRef.get()).data(), economyBefore);

        const migrationEconomy = await economyRef.get();
        assert.deepStrictEqual(migrationEconomy.data(), economyBefore, "Party migration must not alter Economy document");
        console.log("Party API Emulator tests: PASS (auth/CSRF, UID isolation, schema, validation, revision, idempotency, migration import/retry/skip, Economy isolation)");
    } finally {
        for (const userRef of userRefs) {
            try { await db.recursiveDelete(userRef); } catch (_) { /* Emulator cleanup only. */ }
        }
        await firebase.cleanupFirebase();
    }
}

run().catch((error) => {
    console.error("Party API Emulator tests: FAIL", error);
    process.exitCode = 1;
});
