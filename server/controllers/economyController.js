const economyService = require("../services/economyService");
const itemCatalogService = require("../services/itemCatalogService");
const pokemonCatalogService = require("../services/pokemonCatalogService");

async function getItemCatalog(req, res) {
    try {
        const items = await itemCatalogService.getClientMetadata();
        return res.status(200).json({ success: true, data: { items } });
    } catch (error) {
        console.error("[Economy Item Catalog Error]:", error.message);
        return res.status(500).json({
            success: false,
            message: "Không thể tải dữ liệu vật phẩm mới nhất.",
            code: "ITEM_CATALOG_UNAVAILABLE"
        });
    }
}

async function getPokemonCatalog(req, res) {
    try {
        const pokemon = await pokemonCatalogService.getEffectiveSpecies();
        return res.status(200).json({ success: true, data: { pokemon } });
    } catch (error) {
        console.error("[Economy Pokémon Catalog Error]:", error.message);
        return res.status(500).json({
            success: false,
            message: "Không thể tải dữ liệu Pokémon mới nhất.",
            code: "POKEMON_CATALOG_UNAVAILABLE"
        });
    }
}

async function getSnapshot(req, res) {
    const uid = req.user && (req.user.uid || req.user.id);
    if (typeof uid !== "string" || !uid.trim()) {
        return res.status(401).json({
            success: false,
            message: "Authenticated session is required.",
            code: "UNAUTHORIZED"
        });
    }

    try {
        const snapshot = await economyService.getEconomySnapshot(uid);
        return res.status(200).json({ success: true, data: snapshot });
    } catch (error) {
        console.error("[Economy Snapshot Error]:", error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode && error.statusCode < 500 ? error.message : "Unable to load economy data.",
            code: error.code || "INTERNAL_ERROR"
        });
    }
}

async function migrateLegacyInventory(req, res) {
    const uid = req.user && req.user.uid;
    if (typeof uid !== "string" || !uid.trim()) {
        return res.status(401).json({
            success: false,
            message: "Authenticated session is required.",
            code: "UNAUTHORIZED"
        });
    }

    try {
        const result = await economyService.migrateLegacyInventory(uid, req.body);
        return res.status(200).json({ success: true, data: result });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        if (statusCode >= 500) {
            console.error("[Economy Migration Error]:", error.message);
        }
        return res.status(statusCode).json({
            success: false,
            message: statusCode < 500 ? error.message : "Unable to migrate legacy inventory.",
            code: error.code || "INTERNAL_ERROR"
        });
    }
}

async function runInventoryOperation(req, res, operation, options) {
    const uid = req.user && (req.user.uid || req.user.id);
    if (typeof uid !== "string" || !uid.trim()) {
        return res.status(401).json({ success: false, message: "Authenticated session is required.", code: "UNAUTHORIZED" });
    }
    try {
        const snapshot = await operation(uid, req.body);
        return res.status(200).json({ success: true, data: snapshot });
    } catch (error) {
        if (options && options.businessErrorsAsOk === true && error.code === "INSUFFICIENT_FUNDS") {
            return res.status(200).json({
                success: false,
                message: error.message,
                code: error.code
            });
        }
        const statusCode = error.statusCode || 500;
        if (statusCode >= 500) console.error("[Economy Inventory Mutation Error]:", error.message);
        return res.status(statusCode).json({
            success: false,
            message: statusCode < 500 ? error.message : "Unable to update inventory.",
            code: error.code || "INTERNAL_ERROR"
        });
    }
}

function useItem(req, res) {
    return runInventoryOperation(req, res, economyService.useInventoryItem);
}

function equipItem(req, res) {
    return runInventoryOperation(req, res, economyService.equipInventoryItem);
}

function unequipItem(req, res) {
    return runInventoryOperation(req, res, economyService.unequipInventoryItem);
}

function buyShopItem(req, res) {
    return runInventoryOperation(req, res, economyService.buyShopItem, { businessErrorsAsOk: true });
}

function awardBattleReward(req, res) {
    return runInventoryOperation(req, res, economyService.awardBattleReward);
}

function resolveCaptureBall(req, res) {
    return runInventoryOperation(req, res, economyService.resolveCaptureBall);
}

module.exports = {
    getItemCatalog,
    getPokemonCatalog,
    getSnapshot,
    migrateLegacyInventory,
    useItem,
    equipItem,
    unequipItem,
    buyShopItem,
    awardBattleReward,
    resolveCaptureBall
};
