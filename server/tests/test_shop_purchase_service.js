"use strict";

const assert = require("assert");
const economyService = require("../services/economyService");
const itemCatalogService = require("../services/itemCatalogService");

class FakeFirestore {
    constructor() {
        this.documents = new Map();
    }

    collection(name) {
        return new FakeReference(this, name);
    }

    async runTransaction(callback) {
        const writes = [];
        const transaction = {
            get: async (reference) => {
                const value = this.documents.get(reference.path);
                return { exists: value !== undefined, data: () => value };
            },
            update: (reference, value) => writes.push({ type: "update", reference, value }),
            create: (reference, value) => writes.push({ type: "create", reference, value })
        };
        const result = await callback(transaction);
        writes.forEach((write) => {
            if (write.type === "create" && this.documents.has(write.reference.path)) {
                throw new Error("Fake transaction create would overwrite a document.");
            }
            if (write.type === "update") {
                this.documents.set(write.reference.path, {
                    ...(this.documents.get(write.reference.path) || {}),
                    ...write.value
                });
            } else {
                this.documents.set(write.reference.path, write.value);
            }
        });
        return result;
    }
}

class FakeReference {
    constructor(db, path) {
        this.db = db;
        this.path = path;
    }

    collection(name) {
        return new FakeReference(this.db, this.path + "/" + name);
    }

    doc(id) {
        return new FakeReference(this.db, this.path + "/" + id);
    }
}

async function run() {
    const db = new FakeFirestore();
    const uid = "shop_test_user";
    const economyRef = economyService.getEconomyDocumentRef(db, uid);
    db.documents.set(economyRef.path, {
        schemaVersion: 1,
        balance: 1000,
        items: {},
        equipment: { armor: null, shoes: null, accessory: null, held_item: null },
        migration: { status: "completed", result: "imported" },
        updatedAt: null
    });

    const catalogRef = itemCatalogService.getCatalogDocumentRef(db);
    db.documents.set(catalogRef.path, {
        schemaVersion: 1,
        items: {
            potion_standard: {
                name: "Potion Admin",
                description: "Metadata từ Firestore",
                shop: { buyable: true, buyPrice: 125, sellable: true, sellPrice: 50 }
            }
        }
    });

    const request = { operationId: "shop_purchase_1", itemId: "potion_standard", quantity: 2 };
    const price = 125;
    const first = await economyService.buyShopItem(uid, request, db);
    assert.strictEqual(first.balance, 1000 - price * 2);
    assert.strictEqual(first.items.potion_standard, 2);
    assert.strictEqual(first.alreadyProcessed, false);

    const retry = await economyService.buyShopItem(uid, request, db);
    assert.strictEqual(retry.alreadyProcessed, true);
    assert.strictEqual((await economyService.getEconomySnapshot(uid, db)).balance, 1000 - price * 2);
    assert.strictEqual((await economyService.getEconomySnapshot(uid, db)).items.potion_standard, 2);

    await assert.rejects(
        economyService.buyShopItem(uid, { ...request, itemId: "poke_ball" }, db),
        (error) => error.code === "OPERATION_ID_CONFLICT"
    );
    await assert.rejects(
        economyService.buyShopItem(uid, { operationId: "shop_unbuyable_1", itemId: "town_map", quantity: 1 }, db),
        (error) => error.code === "ITEM_NOT_BUYABLE"
    );
    await assert.rejects(
        economyService.buyShopItem(uid, { operationId: "shop_clientprice_1", itemId: "potion_standard", quantity: 1, buyPrice: 0 }, db),
        (error) => error.code === "INVALID_ECONOMY_OPERATION"
    );

    const beforePoorPurchase = await economyService.getEconomySnapshot(uid, db);
    const economyData = db.documents.get(economyRef.path);
    db.documents.set(economyRef.path, { ...economyData, balance: 0 });
    await assert.rejects(
        economyService.buyShopItem(uid, { operationId: "shop_poorbuy_1", itemId: "potion_standard", quantity: 1 }, db),
        (error) => error.code === "INSUFFICIENT_FUNDS"
    );
    const afterPoorPurchase = await economyService.getEconomySnapshot(uid, db);
    assert.deepStrictEqual(afterPoorPurchase.items, beforePoorPurchase.items);
    assert.strictEqual(afterPoorPurchase.balance, 0);

    console.log("Shop purchase service tests: PASS (Firestore catalog price, quantity, atomic snapshot, idempotency, validation, insufficient funds)");
}

run().catch((error) => {
    console.error("Shop purchase service tests: FAIL", error);
    process.exitCode = 1;
});
