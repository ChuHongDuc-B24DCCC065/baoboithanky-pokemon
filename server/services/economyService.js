const { FieldValue, getFirestore } = require("../config/firebase");
const crypto = require("crypto");
const ItemCatalog = require("../../public/js/engine/ui/itemCatalog");
const itemCatalogService = require("./itemCatalogService");

const ECONOMY_SCHEMA_VERSION = 1;
const EQUIPMENT_SLOTS = ["armor", "shoes", "accessory", "held_item"];
const MAX_MIGRATION_ITEM_TYPES = 13;
const MAX_MIGRATION_ITEM_QUANTITY = 999;
const MAX_MIGRATION_TOTAL_QUANTITY = 5000;
const MAX_ECONOMY_ITEM_QUANTITY = 999;
const BATTLE_REWARD_ITEM_POOLS = {
    common: ["potion_standard", "antidote", "repel", "poke_ball"],
    uncommon: ["super_potion", "great_ball"],
    rare: ["ultra_ball", "lucky_egg"]
};

function calculateBattleReward(wildLevel, randomInt = crypto.randomInt) {
    if (!Number.isSafeInteger(wildLevel) || wildLevel < 1 || wildLevel > 100) {
        throw createEconomyError("Wild Pokémon level must be an integer from 1 to 100.", "INVALID_WILD_LEVEL", 400);
    }

    const gold = wildLevel * 10 + randomInt(wildLevel * 5 + 1);
    const dropChancePercent = 20 + (wildLevel - 1) * 0.5;
    const rareChancePercent = Math.min(18, 3 + Math.floor((wildLevel - 1) * 0.16));
    const uncommonChancePercent = 20;
    let itemId = null;
    let rarity = null;

    if (randomInt(100) < dropChancePercent) {
        const rarityRoll = randomInt(100);
        if (rarityRoll < rareChancePercent) rarity = "rare";
        else if (rarityRoll < rareChancePercent + uncommonChancePercent) rarity = "uncommon";
        else rarity = "common";
        const pool = BATTLE_REWARD_ITEM_POOLS[rarity];
        itemId = pool[randomInt(pool.length)];
    }

    return { wildLevel, gold, itemId, rarity, dropChancePercent, rareChancePercent, uncommonChancePercent };
}

function createInitialEconomyData() {
    return {
        schemaVersion: ECONOMY_SCHEMA_VERSION,
        balance: 0,
        items: {},
        equipment: {
            armor: null,
            shoes: null,
            accessory: null,
            held_item: null
        },
        migration: { status: "pending" },
        updatedAt: FieldValue.serverTimestamp()
    };
}

function getEconomyDocumentRef(db, uid) {
    if (typeof uid !== "string" || !uid.trim()) {
        const error = new Error("Authenticated user UID is required.");
        error.code = "INVALID_UID";
        error.statusCode = 400;
        throw error;
    }
    return db.collection("users").doc(uid).collection("gameState").doc("economy");
}

function createEconomyError(message, code, statusCode) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function toPublicSnapshot(data) {
    if (!data || data.schemaVersion !== ECONOMY_SCHEMA_VERSION ||
        !Number.isSafeInteger(data.balance) || data.balance < 0 ||
        !data.items || typeof data.items !== "object" || Array.isArray(data.items) ||
        !data.equipment || typeof data.equipment !== "object" || Array.isArray(data.equipment) ||
        !data.migration || !["pending", "completed"].includes(data.migration.status)) {
        throw createEconomyError("Economy data is invalid.", "ECONOMY_DATA_INVALID", 500);
    }

    const items = {};
    for (const [itemId, quantity] of Object.entries(data.items)) {
        if (!itemId || !Number.isSafeInteger(quantity) || quantity < 0) {
            throw createEconomyError("Economy item data is invalid.", "ECONOMY_DATA_INVALID", 500);
        }
        if (quantity > 0) items[itemId] = quantity;
    }

    const equipment = {};
    for (const slot of EQUIPMENT_SLOTS) {
        const itemId = data.equipment[slot];
        if (itemId !== null && typeof itemId !== "string") {
            throw createEconomyError("Economy equipment data is invalid.", "ECONOMY_DATA_INVALID", 500);
        }
        equipment[slot] = itemId;
    }

    return {
        balance: data.balance,
        items,
        equipment,
        migration: {
            status: data.migration.status,
            result: data.migration.result || null
        }
    };
}

function createMigrationError(message, code = "INVALID_MIGRATION_PAYLOAD", statusCode = 400) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function validateLegacyInventoryPayload(payload) {
    if (!isPlainObject(payload) || Object.keys(payload).length !== 2 ||
        !Object.prototype.hasOwnProperty.call(payload, "items") ||
        !Object.prototype.hasOwnProperty.call(payload, "equipment")) {
        throw createMigrationError("Payload migration must contain only items and equipment.");
    }

    const { items, equipment } = payload;
    if (!isPlainObject(items) || !isPlainObject(equipment)) {
        throw createMigrationError("Items and equipment must be plain objects.");
    }

    const itemIds = Object.keys(items);
    if (itemIds.length > MAX_MIGRATION_ITEM_TYPES || itemIds.length > Object.keys(ItemCatalog.ITEMS).length) {
        throw createMigrationError("Too many distinct item types in migration payload.");
    }

    const normalizedItems = {};
    let totalQuantity = 0;
    for (const itemId of itemIds) {
        if (!Object.prototype.hasOwnProperty.call(ItemCatalog.ITEMS, itemId)) {
            throw createMigrationError(`Unknown item ID: ${itemId}.`, "UNKNOWN_ITEM_ID");
        }
        const quantity = items[itemId];
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_MIGRATION_ITEM_QUANTITY) {
            throw createMigrationError(`Invalid quantity for item: ${itemId}.`, "INVALID_ITEM_QUANTITY");
        }
        totalQuantity += quantity;
        if (totalQuantity > MAX_MIGRATION_TOTAL_QUANTITY) {
            throw createMigrationError("Total item quantity exceeds the migration limit.", "MIGRATION_QUANTITY_LIMIT");
        }
        normalizedItems[itemId] = quantity;
    }

    const expectedSlots = [...EQUIPMENT_SLOTS].sort();
    const suppliedSlots = Object.keys(equipment).sort();
    if (suppliedSlots.length !== expectedSlots.length ||
        suppliedSlots.some((slot, index) => slot !== expectedSlots[index])) {
        throw createMigrationError("Equipment must contain exactly the supported slots.");
    }

    const normalizedEquipment = {};
    for (const slot of EQUIPMENT_SLOTS) {
        const itemId = equipment[slot];
        if (itemId === null) {
            normalizedEquipment[slot] = null;
            continue;
        }
        if (typeof itemId !== "string" ||
            !Object.prototype.hasOwnProperty.call(ItemCatalog.ITEMS, itemId)) {
            throw createMigrationError(`Invalid equipment item for slot: ${slot}.`, "INVALID_EQUIPMENT");
        }
        const item = ItemCatalog.ITEMS[itemId];
        if (!item.isEquipment || item.equipmentSlot !== slot || !normalizedItems[itemId]) {
            throw createMigrationError(`Equipment does not match slot or owned inventory: ${slot}.`, "INVALID_EQUIPMENT");
        }
        normalizedEquipment[slot] = itemId;
    }

    return { items: normalizedItems, equipment: normalizedEquipment };
}

function hasAuthoritativeEconomyData(data) {
    return data.balance > 0 || Object.keys(data.items || {}).length > 0 ||
        EQUIPMENT_SLOTS.some((slot) => data.equipment && data.equipment[slot] !== null);
}

function migrationResult(data, alreadyProcessed) {
    return {
        ...toPublicSnapshot(data),
        migration: {
            status: data.migration.status,
            result: data.migration.result || null
        },
        alreadyProcessed
    };
}

async function migrateLegacyInventory(uid, payload, db = getFirestore()) {
    const economyRef = getEconomyDocumentRef(db, uid);
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(economyRef);
        const current = snapshot.exists ? snapshot.data() : createInitialEconomyData();
        if (!current.migration || typeof current.migration.status !== "string") {
            throw createMigrationError("Economy migration state is invalid.", "MIGRATION_STATE_INVALID", 409);
        }

        if (current.migration.status !== "pending") {
            if (current.migration.status !== "completed") {
                throw createMigrationError("Economy migration is not in a migratable state.", "MIGRATION_STATE_INVALID", 409);
            }
            return migrationResult(current, true);
        }

        const normalizedPayload = validateLegacyInventoryPayload(payload);
        // Validate the existing server record before making any decision or write.
        toPublicSnapshot(current);

        if (hasAuthoritativeEconomyData(current)) {
            const migration = {
                status: "completed",
                result: "skipped_existing_data",
                completedAt: FieldValue.serverTimestamp()
            };
            if (snapshot.exists) {
                transaction.update(economyRef, { migration, updatedAt: FieldValue.serverTimestamp() });
            } else {
                transaction.create(economyRef, {
                    ...current,
                    migration,
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
            return migrationResult({ ...current, migration }, false);
        }

        const migration = {
            status: "completed",
            result: "imported",
            completedAt: FieldValue.serverTimestamp()
        };
        const updatedAt = FieldValue.serverTimestamp();
        if (snapshot.exists) {
            transaction.update(economyRef, {
                items: normalizedPayload.items,
                equipment: normalizedPayload.equipment,
                migration,
                updatedAt
            });
        } else {
            transaction.create(economyRef, {
                ...current,
                items: normalizedPayload.items,
                equipment: normalizedPayload.equipment,
                migration,
                updatedAt
            });
        }

        return migrationResult({
            ...current,
            ...normalizedPayload,
            migration
        }, false);
    });
}

async function getEconomySnapshot(uid, db = getFirestore()) {
    const economyRef = getEconomyDocumentRef(db, uid);
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(economyRef);
        if (!snapshot.exists) {
            const initialData = createInitialEconomyData();
            transaction.create(economyRef, initialData);
            return toPublicSnapshot({
                ...initialData,
                updatedAt: null
            });
        }
        return toPublicSnapshot(snapshot.data());
    });
}

function validateOperationPayload(payload, allowedKeys) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        Object.keys(payload).sort().join(",") !== [...allowedKeys].sort().join(",")) {
        throw createEconomyError("Economy operation payload is invalid.", "INVALID_ECONOMY_OPERATION", 400);
    }
    if (typeof payload.operationId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(payload.operationId)) {
        throw createEconomyError("Operation ID is invalid.", "INVALID_OPERATION_ID", 400);
    }
}

function validateMutationState(data) {
    const snapshot = toPublicSnapshot(data);
    if (snapshot.migration.status !== "completed") {
        throw createEconomyError("Inventory migration must complete before changes are allowed.", "ECONOMY_MIGRATION_PENDING", 409);
    }
    const quantities = Object.entries(snapshot.items);
    const totalQuantity = quantities.reduce((total, [, quantity]) => total + quantity, 0);
    if (quantities.some(([itemId, quantity]) => !ItemCatalog.getItem(itemId) || quantity > MAX_ECONOMY_ITEM_QUANTITY) ||
        quantities.length > Object.keys(ItemCatalog.ITEMS).length || totalQuantity > MAX_MIGRATION_TOTAL_QUANTITY) {
        throw createEconomyError("Authoritative inventory data exceeds supported limits.", "ECONOMY_DATA_INVALID", 409);
    }
    for (const slot of EQUIPMENT_SLOTS) {
        const itemId = snapshot.equipment[slot];
        if (itemId === null) continue;
        const item = ItemCatalog.getItem(itemId);
        if (!item || !item.isEquipment || item.equipmentSlot !== slot || (snapshot.items[itemId] || 0) < 1) {
            throw createEconomyError("Authoritative equipment data is invalid.", "ECONOMY_DATA_INVALID", 409);
        }
    }
    return snapshot;
}

async function runInventoryMutation(uid, operationId, operationType, operationData, mutate, db) {
    const economyRef = getEconomyDocumentRef(db, uid);
    const operationRef = economyRef.collection("operations").doc(operationId);
    return db.runTransaction(async (transaction) => {
        const [operationSnapshot, economySnapshot] = await Promise.all([
            transaction.get(operationRef),
            transaction.get(economyRef)
        ]);
        if (!economySnapshot.exists) {
            throw createEconomyError("Economy data is not initialized.", "ECONOMY_NOT_INITIALIZED", 409);
        }
        const current = economySnapshot.data();
        const currentSnapshot = validateMutationState(current);
        const operationFingerprint = JSON.stringify({ type: operationType, ...operationData });
        if (operationSnapshot.exists) {
            const priorOperation = operationSnapshot.data();
            if (priorOperation.fingerprint !== operationFingerprint) {
                throw createEconomyError("Operation ID was already used for another request.", "OPERATION_ID_CONFLICT", 409);
            }
            return { ...currentSnapshot, alreadyProcessed: true };
        }

        const next = mutate(currentSnapshot);
        const normalized = toPublicSnapshot({ ...current, ...next, updatedAt: null });
        const itemTypes = Object.keys(normalized.items);
        const totalQuantity = Object.values(normalized.items).reduce((total, quantity) => total + quantity, 0);
        if (itemTypes.length > Object.keys(ItemCatalog.ITEMS).length || totalQuantity > MAX_MIGRATION_TOTAL_QUANTITY ||
            Object.values(normalized.items).some((quantity) => quantity > MAX_ECONOMY_ITEM_QUANTITY)) {
            throw createEconomyError("Inventory quantity limit exceeded.", "INVENTORY_LIMIT_EXCEEDED", 409);
        }

        transaction.update(economyRef, {
            items: normalized.items,
            equipment: normalized.equipment,
            updatedAt: FieldValue.serverTimestamp()
        });
        transaction.create(operationRef, {
            type: operationType,
            fingerprint: operationFingerprint,
            createdAt: FieldValue.serverTimestamp()
        });
        return { ...normalized, migration: currentSnapshot.migration, alreadyProcessed: false };
    });
}

async function useInventoryItem(uid, payload, db = getFirestore()) {
    validateOperationPayload(payload, ["operationId", "itemId"]);
    const item = ItemCatalog.getItem(payload.itemId);
    if (!item || !item.isUsable || !item.effect || item.effect.type === "OPEN_MAP") {
        throw createEconomyError("Item cannot be consumed through this operation.", "ITEM_NOT_USABLE", 400);
    }
    return runInventoryMutation(uid, payload.operationId, "use-item", { itemId: item.id }, (current) => {
        const quantity = current.items[item.id] || 0;
        if (quantity < 1) throw createEconomyError("Item quantity is insufficient.", "ITEM_NOT_OWNED", 409);
        const items = { ...current.items };
        if (quantity === 1) delete items[item.id];
        else items[item.id] = quantity - 1;
        return { items };
    }, db);
}

async function equipInventoryItem(uid, payload, db = getFirestore()) {
    validateOperationPayload(payload, ["operationId", "slot", "itemId"]);
    if (!EQUIPMENT_SLOTS.includes(payload.slot)) {
        throw createEconomyError("Equipment slot is invalid.", "INVALID_EQUIPMENT_SLOT", 400);
    }
    const item = ItemCatalog.getItem(payload.itemId);
    if (!item || !item.isEquipment || item.equipmentSlot !== payload.slot) {
        throw createEconomyError("Item does not match the equipment slot.", "INVALID_EQUIPMENT", 400);
    }
    return runInventoryMutation(uid, payload.operationId, "equip", { slot: payload.slot, itemId: item.id }, (current) => {
        if ((current.items[item.id] || 0) < 1) {
            throw createEconomyError("Equipment item is not owned.", "ITEM_NOT_OWNED", 409);
        }
        return { equipment: { ...current.equipment, [payload.slot]: item.id } };
    }, db);
}

async function unequipInventoryItem(uid, payload, db = getFirestore()) {
    validateOperationPayload(payload, ["operationId", "slot"]);
    if (!EQUIPMENT_SLOTS.includes(payload.slot)) {
        throw createEconomyError("Equipment slot is invalid.", "INVALID_EQUIPMENT_SLOT", 400);
    }
    return runInventoryMutation(uid, payload.operationId, "unequip", { slot: payload.slot }, (current) => {
        if (!current.equipment[payload.slot]) {
            throw createEconomyError("Equipment slot is already empty.", "EQUIPMENT_SLOT_EMPTY", 409);
        }
        return { equipment: { ...current.equipment, [payload.slot]: null } };
    }, db);
}

async function buyShopItem(uid, payload, db = getFirestore()) {
    validateOperationPayload(payload, ["operationId", "itemId", "quantity"]);
    const baseItem = ItemCatalog.getItem(payload.itemId);
    if (!baseItem) {
        throw createEconomyError("This item cannot be purchased.", "ITEM_NOT_BUYABLE", 400);
    }
    if (!Number.isSafeInteger(payload.quantity) || payload.quantity < 1 || payload.quantity > MAX_ECONOMY_ITEM_QUANTITY) {
        throw createEconomyError("Purchase quantity is invalid.", "INVALID_QUANTITY", 400);
    }

    const economyRef = getEconomyDocumentRef(db, uid);
    const operationRef = economyRef.collection("operations").doc(payload.operationId);
    const catalogRef = itemCatalogService.getCatalogDocumentRef(db);
    return db.runTransaction(async (transaction) => {
        const [operationSnapshot, economySnapshot, catalogSnapshot] = await Promise.all([
            transaction.get(operationRef),
            transaction.get(economyRef),
            transaction.get(catalogRef)
        ]);
        if (!economySnapshot.exists) {
            throw createEconomyError("Economy data is not initialized.", "ECONOMY_NOT_INITIALIZED", 409);
        }
        const current = economySnapshot.data();
        const currentSnapshot = validateMutationState(current);
        const operationFingerprint = JSON.stringify({ type: "shop-buy", itemId: baseItem.id, quantity: payload.quantity });
        if (operationSnapshot.exists) {
            const prior = operationSnapshot.data();
            if (prior.fingerprint !== operationFingerprint) {
                throw createEconomyError("Operation ID was already used for another purchase.", "OPERATION_ID_CONFLICT", 409);
            }
            return { ...currentSnapshot, alreadyProcessed: true };
        }
        let item;
        try {
            item = itemCatalogService.getEffectiveItemFromDocument(baseItem.id, catalogSnapshot);
        } catch (catalogError) {
            throw createEconomyError("Item Catalog metadata is unavailable.", "ITEM_CATALOG_UNAVAILABLE", 503);
        }
        if (!item || !item.shop || item.shop.buyable !== true ||
            !Number.isSafeInteger(item.shop.buyPrice) || item.shop.buyPrice <= 0) {
            throw createEconomyError("This item cannot be purchased.", "ITEM_NOT_BUYABLE", 400);
        }
        const totalPrice = item.shop.buyPrice * payload.quantity;
        if (!Number.isSafeInteger(totalPrice)) {
            throw createEconomyError("Purchase total is invalid.", "INVALID_QUANTITY", 400);
        }
        if (currentSnapshot.balance < totalPrice) {
            throw createEconomyError("Bạn không đủ vàng để mua vật phẩm này.", "INSUFFICIENT_FUNDS", 409);
        }

        const quantity = (currentSnapshot.items[item.id] || 0) + payload.quantity;
        if (quantity > MAX_ECONOMY_ITEM_QUANTITY) {
            throw createEconomyError("Số lượng vật phẩm đã đạt giới hạn.", "INVENTORY_LIMIT_EXCEEDED", 409);
        }
        const items = { ...currentSnapshot.items, [item.id]: quantity };
        const totalQuantity = Object.values(items).reduce((total, count) => total + count, 0);
        if (totalQuantity > MAX_MIGRATION_TOTAL_QUANTITY) {
            throw createEconomyError("Túi đồ đã đạt giới hạn tổng số vật phẩm.", "INVENTORY_LIMIT_EXCEEDED", 409);
        }
        const balance = currentSnapshot.balance - totalPrice;
        const normalized = toPublicSnapshot({ ...current, balance, items, updatedAt: null });

        transaction.update(economyRef, {
            balance: normalized.balance,
            items: normalized.items,
            updatedAt: FieldValue.serverTimestamp()
        });
        transaction.create(operationRef, {
            type: "shop-buy",
            fingerprint: operationFingerprint,
            itemId: item.id,
            quantity: payload.quantity,
            unitPrice: item.shop.buyPrice,
            totalPrice,
            createdAt: FieldValue.serverTimestamp()
        });
        return { ...normalized, migration: currentSnapshot.migration, alreadyProcessed: false };
    });
}

function validateBattleToken(value, codeName) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(value)) {
        throw createEconomyError("Battle operation token is invalid.", codeName, 400);
    }
}

async function awardBattleReward(uid, payload, db = getFirestore()) {
    validateOperationPayload(payload, ["operationId", "battleToken", "wildLevel"]);
    validateBattleToken(payload.battleToken, "INVALID_BATTLE_TOKEN");
    if (!Number.isSafeInteger(payload.wildLevel) || payload.wildLevel < 1 || payload.wildLevel > 100) {
        throw createEconomyError("Wild Pokémon level must be an integer from 1 to 100.", "INVALID_WILD_LEVEL", 400);
    }

    const economyRef = getEconomyDocumentRef(db, uid);
    const operationId = "battle_reward_" + payload.battleToken;
    const operationRef = economyRef.collection("operations").doc(operationId);
    return db.runTransaction(async (transaction) => {
        const [operationSnapshot, economySnapshot] = await Promise.all([
            transaction.get(operationRef),
            transaction.get(economyRef)
        ]);
        if (!economySnapshot.exists) {
            throw createEconomyError("Economy data is not initialized.", "ECONOMY_NOT_INITIALIZED", 409);
        }
        const current = economySnapshot.data();
        const currentSnapshot = validateMutationState(current);
        const operationFingerprint = JSON.stringify({ type: "battle-reward", battleToken: payload.battleToken, wildLevel: payload.wildLevel });
        if (operationSnapshot.exists) {
            const prior = operationSnapshot.data();
            if (prior.fingerprint !== operationFingerprint) {
                throw createEconomyError("Battle token was already used for a different reward request.", "BATTLE_REWARD_CONFLICT", 409);
            }
            return { ...currentSnapshot, battleReward: prior.battleReward, alreadyProcessed: true };
        }

        const battleReward = calculateBattleReward(payload.wildLevel);
        const balance = currentSnapshot.balance + battleReward.gold;
        if (!Number.isSafeInteger(balance)) {
            throw createEconomyError("Economy balance limit exceeded.", "BALANCE_LIMIT_EXCEEDED", 409);
        }
        const items = { ...currentSnapshot.items };
        if (battleReward.itemId) {
            const quantity = (items[battleReward.itemId] || 0) + 1;
            if (quantity > MAX_ECONOMY_ITEM_QUANTITY) {
                throw createEconomyError("Inventory quantity limit exceeded.", "INVENTORY_LIMIT_EXCEEDED", 409);
            }
            items[battleReward.itemId] = quantity;
        }
        const normalized = toPublicSnapshot({ ...current, balance, items, updatedAt: null });
        const totalQuantity = Object.values(normalized.items).reduce((total, quantity) => total + quantity, 0);
        if (totalQuantity > MAX_MIGRATION_TOTAL_QUANTITY) {
            throw createEconomyError("Inventory quantity limit exceeded.", "INVENTORY_LIMIT_EXCEEDED", 409);
        }

        transaction.update(economyRef, {
            balance: normalized.balance,
            items: normalized.items,
            updatedAt: FieldValue.serverTimestamp()
        });
        transaction.create(operationRef, {
            type: "battle-reward",
            fingerprint: operationFingerprint,
            battleReward,
            createdAt: FieldValue.serverTimestamp()
        });
        return { ...normalized, migration: currentSnapshot.migration, battleReward, alreadyProcessed: false };
    });
}

async function resolveCaptureBall(uid, payload, db = getFirestore()) {
    validateOperationPayload(payload, ["operationId", "captureId", "action"]);
    validateBattleToken(payload.captureId, "INVALID_CAPTURE_ID");
    if (payload.action !== "consume" && payload.action !== "refund") {
        throw createEconomyError("Capture ball action is invalid.", "INVALID_CAPTURE_ACTION", 400);
    }

    const economyRef = getEconomyDocumentRef(db, uid);
    const captureRef = economyRef.collection("captureAttempts").doc(payload.captureId);
    return db.runTransaction(async (transaction) => {
        const [captureSnapshot, economySnapshot] = await Promise.all([
            transaction.get(captureRef),
            transaction.get(economyRef)
        ]);
        if (!economySnapshot.exists) {
            throw createEconomyError("Economy data is not initialized.", "ECONOMY_NOT_INITIALIZED", 409);
        }
        const current = validateMutationState(economySnapshot.data());

        if (payload.action === "consume") {
            if (captureSnapshot.exists) {
                const prior = captureSnapshot.data();
                if (prior.status === "consumed") return { ...current, alreadyProcessed: true };
                throw createEconomyError("This capture attempt was already refunded.", "CAPTURE_ALREADY_REFUNDED", 409);
            }
            const quantity = current.items.poke_ball || 0;
            if (quantity < 1) throw createEconomyError("Poké Ball quantity is insufficient.", "ITEM_NOT_OWNED", 409);
            const items = { ...current.items };
            if (quantity === 1) delete items.poke_ball;
            else items.poke_ball = quantity - 1;
            transaction.update(economyRef, { items, updatedAt: FieldValue.serverTimestamp() });
            transaction.create(captureRef, {
                status: "consumed",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
            return { ...current, items, alreadyProcessed: false };
        }

        if (!captureSnapshot.exists) {
            throw createEconomyError("Capture attempt has no consumed Poké Ball to refund.", "CAPTURE_NOT_REFUNDABLE", 409);
        }
        const attempt = captureSnapshot.data();
        if (attempt.status === "refunded") return { ...current, alreadyProcessed: true };
        if (attempt.status !== "consumed") {
            throw createEconomyError("Capture attempt is not refundable.", "CAPTURE_NOT_REFUNDABLE", 409);
        }
        const items = { ...current.items, poke_ball: (current.items.poke_ball || 0) + 1 };
        const totalQuantity = Object.values(items).reduce((total, quantity) => total + quantity, 0);
        if (items.poke_ball > MAX_ECONOMY_ITEM_QUANTITY || totalQuantity > MAX_MIGRATION_TOTAL_QUANTITY) {
            throw createEconomyError("Inventory quantity limit exceeded.", "INVENTORY_LIMIT_EXCEEDED", 409);
        }
        transaction.update(economyRef, { items, updatedAt: FieldValue.serverTimestamp() });
        transaction.update(captureRef, { status: "refunded", updatedAt: FieldValue.serverTimestamp() });
        return { ...current, items, alreadyProcessed: false };
    });
}

module.exports = {
    ECONOMY_SCHEMA_VERSION,
    EQUIPMENT_SLOTS,
    createInitialEconomyData,
    getEconomyDocumentRef,
    getEconomySnapshot,
    toPublicSnapshot,
    MAX_MIGRATION_ITEM_TYPES,
    MAX_MIGRATION_ITEM_QUANTITY,
    MAX_MIGRATION_TOTAL_QUANTITY,
    validateLegacyInventoryPayload,
    migrateLegacyInventory,
    useInventoryItem,
    equipInventoryItem,
    unequipInventoryItem,
    buyShopItem,
    calculateBattleReward,
    awardBattleReward,
    resolveCaptureBall
};
