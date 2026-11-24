const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// This suite is hard-pinned to the local Firebase Emulator and a demo project.
process.env.NODE_ENV = "test";
process.env.FIREBASE_ENV = "emulator";
process.env.FIREBASE_PROJECT_ID = "demo-poke-engine";
process.env.GCLOUD_PROJECT = "demo-poke-engine";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

const firebase = require("../config/firebase");
const economyService = require("../services/economyService");
const economyController = require("../controllers/economyController");
const economyRoutes = require("../routes/economyRoutes");
const { requireAuth } = require("../middleware/authMiddleware");
const { csrfProtection } = require("../middleware/csrfMiddleware");
const ItemCatalog = require("../../public/js/engine/ui/itemCatalog");

{
    const randomSequence = [0, 0, 99, 0];
    const levelOne = economyService.calculateBattleReward(1, (maxExclusive) => {
        const value = randomSequence.shift();
        assert(value < maxExclusive);
        return value;
    });
    assert.strictEqual(levelOne.gold, 10);
    assert.strictEqual(levelOne.dropChancePercent, 20);
    assert.strictEqual(levelOne.rareChancePercent, 3);
    assert.strictEqual(levelOne.rarity, "common");
    assert(ItemCatalog.getItem(levelOne.itemId));

    const highLevelSequence = [500, 0, 0, 0];
    const levelOneHundred = economyService.calculateBattleReward(100, (maxExclusive) => {
        const value = highLevelSequence.shift();
        assert(value < maxExclusive);
        return value;
    });
    assert.strictEqual(levelOneHundred.gold, 1500);
    assert.strictEqual(levelOneHundred.dropChancePercent, 69.5);
    assert.strictEqual(levelOneHundred.rareChancePercent, 18);
    assert.strictEqual(levelOneHundred.itemId, "ultra_ball");
    assert(ItemCatalog.getItem(levelOneHundred.itemId));
    assert.throws(() => economyService.calculateBattleReward(0), /level/i);
}

function createMockResponse() {
    return {
        statusCode: 200,
        payload: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.payload = payload;
            return this;
        }
    };
}

async function run() {
    const config = firebase.resolveFirebaseEnvironment();
    assert.strictEqual(config.mode, "emulator", "Tests must not connect to Production Firebase");
    assert.strictEqual(config.projectId, "demo-poke-engine");
    firebase.initializeFirebaseAdmin();
    const db = firebase.getFirestore();
    const suffix = crypto.randomUUID();
    const uid = `economy_test_${suffix}`;
    const attackerUid = `economy_attacker_${suffix}`;
    const migrationUid = `economy_migration_${suffix}`;
    const existingDataUid = `economy_existing_${suffix}`;
    const allTypesUid = `economy_all_types_${suffix}`;
    const concurrentUid = `economy_concurrent_${suffix}`;
    const mutationUid = `economy_mutation_${suffix}`;
    const battleUid = `economy_battle_${suffix}`;
    const userRef = db.collection("users").doc(uid);
    const attackerEconomyRef = economyService.getEconomyDocumentRef(db, attackerUid);
    const economyRef = economyService.getEconomyDocumentRef(db, uid);
    const migrationRef = economyService.getEconomyDocumentRef(db, migrationUid);
    const existingDataRef = economyService.getEconomyDocumentRef(db, existingDataUid);
    const allTypesRef = economyService.getEconomyDocumentRef(db, allTypesUid);
    const concurrentRef = economyService.getEconomyDocumentRef(db, concurrentUid);
    const mutationRef = economyService.getEconomyDocumentRef(db, mutationUid);
    const battleRef = economyService.getEconomyDocumentRef(db, battleUid);
    const testUids = [uid, attackerUid, migrationUid, existingDataUid, allTypesUid, concurrentUid, mutationUid, battleUid];

    const emptyEquipment = { armor: null, shoes: null, accessory: null, held_item: null };
    const pendingEconomy = () => ({
        schemaVersion: 1,
        balance: 0,
        items: {},
        equipment: { ...emptyEquipment },
        migration: { status: "pending" },
        updatedAt: firebase.FieldValue.serverTimestamp()
    });
    const assertRejectedWithoutMutation = async (payload, expectedCode) => {
        const before = (await migrationRef.get()).data();
        let caught = null;
        try {
            await economyService.migrateLegacyInventory(migrationUid, payload, db);
        } catch (error) {
            caught = error;
        }
        assert(caught, `Expected migration rejection (${expectedCode})`);
        assert.strictEqual(caught.code, expectedCode);
        const after = (await migrationRef.get()).data();
        assert.deepStrictEqual(after.items, before.items);
        assert.deepStrictEqual(after.equipment, before.equipment);
        assert.deepStrictEqual(after.migration, before.migration);
        assert.strictEqual(after.balance, before.balance);
    };

    try {
        await userRef.set({ username: "economy_test", character: "red", isActive: true });
        await attackerEconomyRef.set({
            schemaVersion: 1,
            balance: 991,
            items: { potion_standard: 8 },
            equipment: { armor: null, shoes: null, accessory: null, held_item: null }
        });

        // Missing economy docs initialize once with the approved schema.
        const firstSnapshot = await economyService.getEconomySnapshot(uid, db);
        assert.deepStrictEqual(firstSnapshot, {
            balance: 0,
            items: {},
            equipment: { armor: null, shoes: null, accessory: null, held_item: null },
            migration: { status: "pending", result: null }
        });
        const rawEconomy = (await economyRef.get()).data();
        assert.strictEqual(rawEconomy.schemaVersion, 1);
        assert.strictEqual(rawEconomy.balance, 0);
        assert.deepStrictEqual(rawEconomy.items, {});
        assert.deepStrictEqual(rawEconomy.equipment, firstSnapshot.equipment);
        assert.strictEqual(rawEconomy.migration.status, "pending");
        assert(rawEconomy.updatedAt, "Initialization must persist a Firestore timestamp");

        // Controller gets identity only from the authenticated req.user object.
        const response = createMockResponse();
        await economyController.getSnapshot({
            user: { uid },
            params: { uid: attackerUid },
            query: { uid: attackerUid },
            body: { uid: attackerUid, balance: 999999 }
        }, response);
        assert.strictEqual(response.statusCode, 200);
        assert.deepStrictEqual(response.payload.data, firstSnapshot);
        assert.strictEqual((await attackerEconomyRef.get()).data().balance, 991);

        // Existing server-side data remains unchanged on subsequent reads.
        await economyRef.update({ balance: 45, items: { potion_standard: 2 } });
        const repeatSnapshot = await economyService.getEconomySnapshot(uid, db);
        assert.strictEqual(repeatSnapshot.balance, 45);
        assert.deepStrictEqual(repeatSnapshot.items, { potion_standard: 2 });

        // Auth and CSRF middleware guard mutation route in the expected order.
        const authLayer = economyRoutes.stack.find((layer) => layer.route && layer.route.path === "/");
        assert(authLayer, "Economy snapshot route must be registered");
        assert.strictEqual(authLayer.route.methods.get, true, "Economy root route must serve GET snapshots");
        assert.strictEqual(authLayer.route.stack[0].handle, requireAuth);
        const catalogLayer = economyRoutes.stack.find((layer) => layer.route && layer.route.path === "/item-catalog");
        assert(catalogLayer, "Economy item catalog route must be registered");
        assert.strictEqual(catalogLayer.route.stack[0].handle, requireAuth);
        const appSource = fs.readFileSync(path.join(__dirname, "../../app.js"), "utf8");
        assert.match(appSource, /app\.use\(["']\/api\/economy["'],\s*economyRoutes\)/,
            "app.js must mount economyRoutes at the client snapshot prefix /api/economy");
        const migrationLayer = economyRoutes.stack.find((layer) => layer.route && layer.route.path === "/migrate-inventory");
        assert(migrationLayer, "Inventory migration route must be registered");
        assert.strictEqual(migrationLayer.route.stack[0].handle, requireAuth);
        assert.strictEqual(migrationLayer.route.stack[1].handle, csrfProtection);
        for (const path of ["/use-item", "/equip", "/unequip", "/buy-item", "/battle-reward", "/capture-ball"]) {
            const layer = economyRoutes.stack.find((entry) => entry.route && entry.route.path === path);
            assert(layer, `Economy mutation route ${path} must be registered`);
            assert.strictEqual(layer.route.stack[0].handle, requireAuth);
            assert.strictEqual(layer.route.stack[1].handle, csrfProtection);
        }
        const unauthResponse = createMockResponse();
        let nextCalled = false;
        await requireAuth({ method: "POST", path: "/api/economy/migrate-inventory", originalUrl: "/api/economy/migrate-inventory", headers: {} }, unauthResponse, () => {
            nextCalled = true;
        });
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(unauthResponse.statusCode, 401);

        const csrfResponse = createMockResponse();
        let csrfNextCalled = false;
        csrfProtection({ method: "POST", headers: { origin: "http://localhost:3000" } }, csrfResponse, () => {
            csrfNextCalled = true;
        });
        assert.strictEqual(csrfNextCalled, false);
        assert.strictEqual(csrfResponse.statusCode, 403);
        assert.strictEqual(csrfResponse.payload.code, "CSRF_TOKEN_INVALID");

        // Economy initialization/read must not modify the existing user profile.
        const profile = (await userRef.get()).data();
        assert.deepStrictEqual(profile, { username: "economy_test", character: "red", isActive: true });

        // Migration request validation rejects the whole payload without partial writes.
        await migrationRef.set(pendingEconomy());
        const defaultPayload = { items: {}, equipment: { ...emptyEquipment } };
        const malformedPayloads = [
            [{ ...defaultPayload, uid }, "INVALID_MIGRATION_PAYLOAD"],
            [{ ...defaultPayload, balance: 99 }, "INVALID_MIGRATION_PAYLOAD"],
            [{ items: [], equipment: { ...emptyEquipment } }, "INVALID_MIGRATION_PAYLOAD"],
            [{ items: { not_a_species_or_item: 1 }, equipment: { ...emptyEquipment } }, "UNKNOWN_ITEM_ID"],
            ...[-1, 0, 1.5, NaN, Infinity, 1000].map((quantity) => [
                { items: { potion_standard: quantity }, equipment: { ...emptyEquipment } },
                "INVALID_ITEM_QUANTITY"
            ]),
            [{
                items: {
                    potion_standard: 999,
                    super_potion: 999,
                    antidote: 999,
                    poke_ball: 999,
                    great_ball: 999,
                    ultra_ball: 6
                },
                equipment: { ...emptyEquipment }
            }, "MIGRATION_QUANTITY_LIMIT"],
            [{ items: { running_shoes: 1 }, equipment: { ...emptyEquipment, armor: "running_shoes" } }, "INVALID_EQUIPMENT"],
            [{ items: {}, equipment: { ...emptyEquipment, shoes: "running_shoes" } }, "INVALID_EQUIPMENT"]
        ];
        for (const [payload, code] of malformedPayloads) {
            await assertRejectedWithoutMutation(payload, code);
        }

        assert.strictEqual(
            economyService.validateLegacyInventoryPayload({ items: { potion_standard: 999 }, equipment: { ...emptyEquipment } }).items.potion_standard,
            999,
            "Quantity 999 is the allowed per-item boundary"
        );
        const maximumTotalItems = {
            potion_standard: 999,
            super_potion: 999,
            antidote: 999,
            poke_ball: 999,
            great_ball: 999,
            ultra_ball: 5
        };
        assert.strictEqual(
            Object.values(economyService.validateLegacyInventoryPayload({
                items: maximumTotalItems,
                equipment: { ...emptyEquipment }
            }).items).reduce((sum, quantity) => sum + quantity, 0),
            5000,
            "Total quantity 5000 is the allowed boundary"
        );

        // All 13 catalog item types are allowed when each remains within the total cap.
        await allTypesRef.set(pendingEconomy());
        const allCatalogItems = Object.fromEntries(Object.keys(ItemCatalog.ITEMS).map((itemId) => [itemId, 1]));
        const allTypesPayload = { items: allCatalogItems, equipment: { ...emptyEquipment } };
        assert.strictEqual(Object.keys(allCatalogItems).length, 13);
        const allTypesResult = await economyService.migrateLegacyInventory(allTypesUid, allTypesPayload, db);
        assert.strictEqual(allTypesResult.migration.result, "imported");
        assert.deepStrictEqual((await allTypesRef.get()).data().items, allCatalogItems);

        // Concurrent first requests still import exactly once through the document transaction.
        await concurrentRef.set(pendingEconomy());
        const concurrentPayload = { items: { potion_standard: 10 }, equipment: { ...emptyEquipment } };
        const concurrentResults = await Promise.all([
            economyService.migrateLegacyInventory(concurrentUid, concurrentPayload, db),
            economyService.migrateLegacyInventory(concurrentUid, concurrentPayload, db)
        ]);
        assert.strictEqual(concurrentResults.length, 2);
        assert.deepStrictEqual((await concurrentRef.get()).data().items, concurrentPayload.items);
        assert.strictEqual((await concurrentRef.get()).data().migration.result, "imported");

        // Controller uses req.user UID; extra client identity/currency fields are rejected.
        const invalidClientFieldsRes = createMockResponse();
        await economyController.migrateLegacyInventory({
            user: { uid: migrationUid },
            query: { uid: attackerUid },
            body: { ...defaultPayload, uid: attackerUid, balance: 1000000 }
        }, invalidClientFieldsRes);
        assert.strictEqual(invalidClientFieldsRes.statusCode, 400);
        assert.strictEqual((await migrationRef.get()).data().migration.status, "pending");

        const validPayload = {
            items: { potion_standard: 5, leather_jacket: 1, running_shoes: 1 },
            equipment: { armor: "leather_jacket", shoes: "running_shoes", accessory: null, held_item: null }
        };
        const successResponse = createMockResponse();
        await economyController.migrateLegacyInventory({
            user: { uid: migrationUid },
            query: { uid: attackerUid },
            body: validPayload
        }, successResponse);
        assert.strictEqual(successResponse.statusCode, 200);
        assert.strictEqual(successResponse.payload.data.migration.result, "imported");
        assert.deepStrictEqual(successResponse.payload.data.items, validPayload.items);
        assert.deepStrictEqual(successResponse.payload.data.equipment, validPayload.equipment);
        const importedRaw = (await migrationRef.get()).data();
        assert.strictEqual(importedRaw.migration.status, "completed");
        assert.strictEqual(importedRaw.migration.result, "imported");
        assert.deepStrictEqual(importedRaw.items, validPayload.items);
        assert.deepStrictEqual(importedRaw.equipment, validPayload.equipment);

        // Retry (including a competing request) is idempotent and returns authoritative data.
        const retryPayload = { items: { potion_standard: 70 }, equipment: { ...emptyEquipment } };
        const retryResults = await Promise.all([
            economyService.migrateLegacyInventory(migrationUid, retryPayload, db),
            economyService.migrateLegacyInventory(migrationUid, retryPayload, db)
        ]);
        assert(retryResults.every((result) => result.alreadyProcessed));
        assert.deepStrictEqual((await migrationRef.get()).data().items, validPayload.items);

        // Pending migration never overwrites already-authoritative Firestore economy data.
        await existingDataRef.set({
            schemaVersion: 1,
            balance: 42,
            items: { potion_standard: 4 },
            equipment: { ...emptyEquipment },
            migration: { status: "pending" },
            updatedAt: firebase.FieldValue.serverTimestamp()
        });
        const skippedResult = await economyService.migrateLegacyInventory(existingDataUid, defaultPayload, db);
        const skippedRaw = (await existingDataRef.get()).data();
        assert.strictEqual(skippedResult.migration.result, "skipped_existing_data");
        assert.strictEqual(skippedRaw.balance, 42);
        assert.deepStrictEqual(skippedRaw.items, { potion_standard: 4 });
        assert.strictEqual(skippedRaw.migration.status, "completed");
        assert.strictEqual(skippedRaw.migration.result, "skipped_existing_data");

        // Inventory operations are catalog-validated, authoritative, transactional and idempotent.
        await mutationRef.set({
            ...pendingEconomy(),
            items: { potion_standard: 2, leather_jacket: 1 },
            migration: { status: "completed", result: "imported" }
        });
        const usePayload = { operationId: `use_${suffix}`, itemId: "potion_standard" };
        const useResponse = createMockResponse();
        await economyController.useItem({ user: { uid: mutationUid }, params: { uid: attackerUid }, body: usePayload }, useResponse);
        assert.strictEqual(useResponse.statusCode, 200);
        assert.deepStrictEqual(useResponse.payload.data.items, { potion_standard: 1, leather_jacket: 1 });
        assert.strictEqual((await attackerEconomyRef.get()).data().balance, 991, "Client UID cannot select the target document");
        const retryResult = await economyService.useInventoryItem(mutationUid, usePayload, db);
        assert.strictEqual(retryResult.alreadyProcessed, true);
        assert.strictEqual((await mutationRef.get()).data().items.potion_standard, 1, "Retry must not consume a second item");

        const equipped = await economyService.equipInventoryItem(mutationUid, {
            operationId: `equip_${suffix}`, slot: "armor", itemId: "leather_jacket"
        }, db);
        assert.strictEqual(equipped.equipment.armor, "leather_jacket");
        const unequipped = await economyService.unequipInventoryItem(mutationUid, {
            operationId: `unequip_${suffix}`, slot: "armor"
        }, db);
        assert.strictEqual(unequipped.equipment.armor, null);

        for (const [payload, code] of [
            [{ operationId: `badqty_${suffix}`, itemId: "potion_standard", quantity: 999 }, "INVALID_ECONOMY_OPERATION"],
            [{ operationId: `baduid_${suffix}`, itemId: "potion_standard", uid: attackerUid }, "INVALID_ECONOMY_OPERATION"],
            [{ operationId: `badbal_${suffix}`, itemId: "potion_standard", balance: 999 }, "INVALID_ECONOMY_OPERATION"],
            [{ operationId: `badid_${suffix}`, itemId: "unknown_item" }, "ITEM_NOT_USABLE"]
        ]) {
            let caught = null;
            try { await economyService.useInventoryItem(mutationUid, payload, db); } catch (error) { caught = error; }
            assert(caught && caught.code === code, `Invalid mutation is rejected with ${code}`);
        }
        for (const [payload, code] of [
            [{ operationId: `wrongslot_${suffix}`, slot: "armor", itemId: "running_shoes" }, "INVALID_EQUIPMENT"],
            [{ operationId: `notowned_${suffix}`, slot: "shoes", itemId: "running_shoes" }, "ITEM_NOT_OWNED"]
        ]) {
            let caught = null;
            try { await economyService.equipInventoryItem(mutationUid, payload, db); } catch (error) { caught = error; }
            assert(caught && caught.code === code, `Invalid equip is rejected with ${code}`);
        }
        let pendingMutationError = null;
        try {
            await economyService.useInventoryItem(uid, { operationId: `pending_${suffix}`, itemId: "potion_standard" }, db);
        } catch (error) { pendingMutationError = error; }
        assert(pendingMutationError && pendingMutationError.code === "ECONOMY_MIGRATION_PENDING");
        assert.deepStrictEqual((await mutationRef.get()).data().items, { potion_standard: 1, leather_jacket: 1 });

        // Shop purchase uses catalog price and atomically updates balance and inventory.
        await mutationRef.set({
            ...pendingEconomy(),
            balance: 1000,
            migration: { status: "completed", result: "imported" }
        });
        const purchaseOperationId = `purchase_${suffix}`;
        const purchaseResponse = createMockResponse();
        await economyController.buyShopItem({
            user: { uid: mutationUid },
            body: { operationId: purchaseOperationId, itemId: "potion_standard", quantity: 1 }
        }, purchaseResponse);
        assert.strictEqual(purchaseResponse.statusCode, 200);
        assert.strictEqual(purchaseResponse.payload.data.balance, 1000 - ItemCatalog.getItem("potion_standard").shop.buyPrice);
        assert.strictEqual(purchaseResponse.payload.data.items.potion_standard, 1);
        const purchaseRetry = await economyService.buyShopItem(mutationUid, {
            operationId: purchaseOperationId, itemId: "potion_standard", quantity: 1
        }, db);
        assert.strictEqual(purchaseRetry.alreadyProcessed, true);
        assert.strictEqual((await mutationRef.get()).data().balance, 700, "Retry must not charge twice");
        assert.strictEqual((await mutationRef.get()).data().items.potion_standard, 1, "Retry must not grant a duplicate item");

        let purchaseConflict = null;
        try {
            await economyService.buyShopItem(mutationUid, {
                operationId: purchaseOperationId, itemId: "poke_ball", quantity: 1
            }, db);
        } catch (error) { purchaseConflict = error; }
        assert(purchaseConflict && purchaseConflict.code === "OPERATION_ID_CONFLICT");
        const purchaseConflictResponse = createMockResponse();
        await economyController.buyShopItem({
            user: { uid: mutationUid },
            body: { operationId: purchaseOperationId, itemId: "poke_ball", quantity: 1 }
        }, purchaseConflictResponse);
        assert.strictEqual(purchaseConflictResponse.statusCode, 409, "Other purchase conflicts keep their HTTP status");
        assert.strictEqual(purchaseConflictResponse.payload.code, "OPERATION_ID_CONFLICT");

        let unbuyableItemError = null;
        try {
            await economyService.buyShopItem(mutationUid, {
                operationId: `unbuyable_${suffix}`, itemId: "town_map", quantity: 1
            }, db);
        } catch (error) { unbuyableItemError = error; }
        assert(unbuyableItemError && unbuyableItemError.code === "ITEM_NOT_BUYABLE");

        let clientPriceError = null;
        try {
            await economyService.buyShopItem(mutationUid, {
                operationId: `clientprice_${suffix}`, itemId: "potion_standard", quantity: 1, buyPrice: 0, balance: 999999
            }, db);
        } catch (error) { clientPriceError = error; }
        assert(clientPriceError && clientPriceError.code === "INVALID_ECONOMY_OPERATION");

        await mutationRef.update({ balance: 0 });
        let insufficientFundsError = null;
        try {
            await economyService.buyShopItem(mutationUid, {
                operationId: `poorbuy_${suffix}`, itemId: "potion_standard", quantity: 1
            }, db);
        } catch (error) { insufficientFundsError = error; }
        assert(insufficientFundsError && insufficientFundsError.code === "INSUFFICIENT_FUNDS");
        const insufficientFundsResponse = createMockResponse();
        await economyController.buyShopItem({
            user: { uid: mutationUid },
            body: { operationId: `poorbuy_api_${suffix}`, itemId: "potion_standard", quantity: 1 }
        }, insufficientFundsResponse);
        assert.strictEqual(insufficientFundsResponse.statusCode, 200);
        assert.deepStrictEqual(insufficientFundsResponse.payload, {
            success: false,
            message: "Bạn không đủ vàng để mua vật phẩm này.",
            code: "INSUFFICIENT_FUNDS"
        });
        assert.strictEqual((await mutationRef.get()).data().balance, 0);
        assert.strictEqual((await mutationRef.get()).data().items.potion_standard, 1);

        // Battle reward is server-calculated, atomic and idempotent by battle token.
        await battleRef.set({
            ...pendingEconomy(),
            items: { poke_ball: 2 },
            migration: { status: "completed", result: "imported" }
        });
        const battleToken = `battle_${suffix}`;
        const rewardResponse = createMockResponse();
        await economyController.awardBattleReward({
            user: { uid: battleUid }, body: { operationId: `reward_${suffix}`, battleToken, wildLevel: 5 }
        }, rewardResponse);
        assert.strictEqual(rewardResponse.statusCode, 200);
        const firstReward = rewardResponse.payload.data.battleReward;
        assert.strictEqual(firstReward.wildLevel, 5);
        assert(firstReward.gold >= 50 && firstReward.gold <= 75);
        assert.strictEqual(rewardResponse.payload.data.balance, firstReward.gold);
        assert.deepStrictEqual(rewardResponse.payload.data.items, firstReward.itemId
            ? { poke_ball: 2, [firstReward.itemId]: 1 }
            : { poke_ball: 2 });
        const duplicateReward = await economyService.awardBattleReward(battleUid, {
            operationId: `reward_retry_${suffix}`, battleToken, wildLevel: 5
        }, db);
        assert.strictEqual(duplicateReward.alreadyProcessed, true);
        assert.deepStrictEqual(duplicateReward.battleReward, firstReward);
        assert.strictEqual((await battleRef.get()).data().balance, firstReward.gold, "Retry must not add gold again");
        assert.deepStrictEqual((await battleRef.get()).data().items, rewardResponse.payload.data.items, "Retry must not duplicate item drops");
        let rewardConflict = null;
        try {
            await economyService.awardBattleReward(battleUid, {
                operationId: `reward_conflict_${suffix}`, battleToken, wildLevel: 6
            }, db);
        } catch (error) { rewardConflict = error; }
        assert(rewardConflict && rewardConflict.code === "BATTLE_REWARD_CONFLICT");
        let arbitraryRewardError = null;
        try {
            await economyService.awardBattleReward(battleUid, {
                operationId: `reward_bad_${suffix}`, battleToken: `battle_bad_${suffix}`, wildLevel: 5, itemId: "ultra_ball", quantity: 50, gold: 100000
            }, db);
        } catch (error) { arbitraryRewardError = error; }
        assert(arbitraryRewardError && arbitraryRewardError.code === "INVALID_ECONOMY_OPERATION");
        let invalidWildLevel = null;
        try {
            await economyService.awardBattleReward(battleUid, {
                operationId: `reward_level_${suffix}`, battleToken: `battle_level_${suffix}`, wildLevel: 101
            }, db);
        } catch (error) { invalidWildLevel = error; }
        assert(invalidWildLevel && invalidWildLevel.code === "INVALID_WILD_LEVEL");

        // A capture attempt consumes one fixed Poké Ball; retry and refund are each idempotent.
        const captureId = `capture_${suffix}_one`;
        const capturePayload = { operationId: `capture_consume_${suffix}`, captureId, action: "consume" };
        const consumed = await economyService.resolveCaptureBall(battleUid, capturePayload, db);
        assert.strictEqual(consumed.items.poke_ball, 1);
        const duplicateConsume = await economyService.resolveCaptureBall(battleUid, {
            ...capturePayload, operationId: `capture_retry_${suffix}`
        }, db);
        assert.strictEqual(duplicateConsume.alreadyProcessed, true);
        assert.strictEqual((await battleRef.get()).data().items.poke_ball, 1);
        const refunded = await economyService.resolveCaptureBall(battleUid, {
            operationId: `capture_refund_${suffix}`, captureId, action: "refund"
        }, db);
        assert.strictEqual(refunded.items.poke_ball, 2);
        const duplicateRefund = await economyService.resolveCaptureBall(battleUid, {
            operationId: `capture_refund_retry_${suffix}`, captureId, action: "refund"
        }, db);
        assert.strictEqual(duplicateRefund.alreadyProcessed, true);
        assert.strictEqual((await battleRef.get()).data().items.poke_ball, 2);

        let refundWithoutConsumeError = null;
        try {
            await economyService.resolveCaptureBall(battleUid, {
                operationId: `capture_refund_invalid_${suffix}`, captureId: `capture_${suffix}_missing`, action: "refund"
            }, db);
        } catch (error) { refundWithoutConsumeError = error; }
        assert(refundWithoutConsumeError && refundWithoutConsumeError.code === "CAPTURE_NOT_REFUNDABLE");

        const failedCaptureId = `capture_${suffix}_failed`;
        const failedCapture = await economyService.resolveCaptureBall(battleUid, {
            operationId: `capture_failed_${suffix}`, captureId: failedCaptureId, action: "consume"
        }, db);
        assert.strictEqual(failedCapture.items.poke_ball, 1, "A failed capture attempt keeps the consumed ball spent");

        console.log("Economy Emulator tests: PASS (migration, authoritative inventory operations, idempotency, validation, auth/CSRF, schema, profile)");
    } finally {
        for (const testUid of testUids) {
            const economyDoc = economyService.getEconomyDocumentRef(db, testUid);
            const operationDocs = await economyDoc.collection("operations").get().catch(() => ({ docs: [] }));
            if (operationDocs.docs.length) {
                const cleanupBatch = db.batch();
                operationDocs.docs.forEach((doc) => cleanupBatch.delete(doc.ref));
                await cleanupBatch.commit().catch(() => {});
            }
            const captureDocs = await economyDoc.collection("captureAttempts").get().catch(() => ({ docs: [] }));
            if (captureDocs.docs.length) {
                const cleanupBatch = db.batch();
                captureDocs.docs.forEach((doc) => cleanupBatch.delete(doc.ref));
                await cleanupBatch.commit().catch(() => {});
            }
            await economyDoc.delete().catch(() => {});
            await db.collection("users").doc(testUid).delete().catch(() => {});
        }
        await firebase.cleanupFirebase();
    }
}

run().catch((error) => {
    console.error("Economy Emulator tests: FAIL", error);
    process.exitCode = 1;
});
