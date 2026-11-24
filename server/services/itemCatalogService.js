"use strict";

const firebaseConfig = require("../config/firebase");
const ItemCatalog = require("../../public/js/engine/ui/itemCatalog");

const CATALOG_SCHEMA_VERSION = 1;
const EDITABLE_FIELDS = ["name", "description", "shop"];
const SHOP_FIELDS = ["buyable", "buyPrice", "sellable", "sellPrice"];

function getCatalogDocumentRef(db = firebaseConfig.getFirestore()) {
    return db.collection("systemCatalogs").doc("itemCatalog");
}

function validateShop(shop) {
    if (!shop || typeof shop !== "object" || Array.isArray(shop) ||
        Object.keys(shop).sort().join(",") !== SHOP_FIELDS.slice().sort().join(",")) {
        throw new Error("Thông tin Shop không đúng schema.");
    }
    for (const field of ["buyable", "sellable"]) {
        if (typeof shop[field] !== "boolean") throw new Error(`Trường shop.${field} phải là boolean.`);
    }
    for (const [enabledField, priceField] of [["buyable", "buyPrice"], ["sellable", "sellPrice"]]) {
        const price = shop[priceField];
        if (shop[enabledField]) {
            if (!Number.isSafeInteger(price) || price <= 0) throw new Error(`Trường shop.${priceField} phải là số nguyên dương.`);
        } else if (price !== null) {
            throw new Error(`Trường shop.${priceField} phải là null khi giao dịch bị tắt.`);
        }
    }
}

function validateEditableMetadata(itemId, metadata) {
    const baseItem = ItemCatalog.getItem(itemId);
    if (!baseItem) {
        const error = new Error("Không tìm thấy item ID trong catalog gốc.");
        error.code = "ITEM_NOT_FOUND";
        error.statusCode = 404;
        throw error;
    }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
        Object.keys(metadata).sort().join(",") !== EDITABLE_FIELDS.slice().sort().join(",")) {
        const error = new Error("Payload chỉ được chứa name, description và shop.");
        error.code = "INVALID_ITEM_METADATA";
        error.statusCode = 400;
        throw error;
    }

    const name = typeof metadata.name === "string" ? metadata.name.trim() : "";
    const description = typeof metadata.description === "string" ? metadata.description.trim() : null;
    if (!name || name.length > 80 || description === null || description.length > 500) {
        const error = new Error("Tên hoặc mô tả vật phẩm không hợp lệ.");
        error.code = "INVALID_ITEM_METADATA";
        error.statusCode = 400;
        throw error;
    }
    try {
        validateShop(metadata.shop);
    } catch (validationError) {
        validationError.code = "INVALID_ITEM_METADATA";
        validationError.statusCode = 400;
        throw validationError;
    }

    return {
        name,
        description,
        shop: {
            buyable: metadata.shop.buyable,
            buyPrice: metadata.shop.buyPrice,
            sellable: metadata.shop.sellable,
            sellPrice: metadata.shop.sellPrice
        }
    };
}

function readOverrides(data) {
    if (!data) return {};
    if (data.schemaVersion !== CATALOG_SCHEMA_VERSION || !data.items ||
        typeof data.items !== "object" || Array.isArray(data.items)) {
        throw new Error("Firestore Item Catalog override document không hợp lệ.");
    }
    const overrides = {};
    for (const [itemId, value] of Object.entries(data.items)) {
        overrides[itemId] = validateEditableMetadata(itemId, value);
    }
    return overrides;
}

function mergeItem(baseItem, override) {
    if (!override) return { ...baseItem, shop: { ...baseItem.shop } };
    return {
        ...baseItem,
        name: override.name,
        description: override.description,
        shop: { ...override.shop }
    };
}

async function getEffectiveItems(db = firebaseConfig.getFirestore()) {
    const snapshot = await getCatalogDocumentRef(db).get();
    const overrides = snapshot.exists ? readOverrides(snapshot.data()) : {};
    return Object.values(ItemCatalog.ITEMS).map((baseItem) => mergeItem(baseItem, overrides[baseItem.id]));
}

async function getClientMetadata(db = firebaseConfig.getFirestore()) {
    const items = await getEffectiveItems(db);
    return items.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        shop: { ...item.shop }
    }));
}

function getEffectiveItemFromDocument(itemId, snapshot) {
    const baseItem = ItemCatalog.getItem(itemId);
    if (!baseItem) return null;
    const overrides = snapshot && snapshot.exists ? readOverrides(snapshot.data()) : {};
    return mergeItem(baseItem, overrides[itemId]);
}

async function updateItemMetadata(itemId, metadata, db = firebaseConfig.getFirestore()) {
    const normalized = validateEditableMetadata(itemId, metadata);
    const catalogRef = getCatalogDocumentRef(db);
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(catalogRef);
        const overrides = snapshot.exists ? readOverrides(snapshot.data()) : {};
        overrides[itemId] = normalized;
        transaction.set(catalogRef, {
            schemaVersion: CATALOG_SCHEMA_VERSION,
            items: overrides,
            updatedAt: firebaseConfig.FieldValue.serverTimestamp()
        });
        return mergeItem(ItemCatalog.getItem(itemId), normalized);
    });
}

module.exports = {
    CATALOG_SCHEMA_VERSION,
    getCatalogDocumentRef,
    validateEditableMetadata,
    getEffectiveItems,
    getClientMetadata,
    getEffectiveItemFromDocument,
    updateItemMetadata
};
