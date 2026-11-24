/**
 * Comprehensive Automated Test Suite for Modern Pokémon RPG HUD, Inventory & Equipment
 * Tests domain logic, state management, anti-spam safeguards, and equipment validation.
 * 
 * Run with: node server/tests/test_hud_inventory_system.js
 */
"use strict";

const ItemCatalog = require("../../public/js/engine/ui/itemCatalog");
const ItemEffectRegistry = require("../../public/js/engine/ui/itemEffectRegistry");
const InventoryService = require("../../public/js/engine/ui/inventoryService");
const ModernHUD = require("../../public/js/engine/ui/hud");
const ShopUI = require("../../public/js/engine/ui/shopUI");
const ModalManager = require("../../public/js/engine/ui/modalManager");
const economyService = require("../services/economyService");
const economyController = require("../controllers/economyController");
const ItemEncyclopediaUI = require("../../public/js/engine/ui/itemEncyclopediaUI");

let passed = 0;
let failed = 0;

function assert(description, condition, detail) {
    if (condition) {
        console.log("  PASS:", description);
        passed++;
    } else {
        console.error("  FAIL:", description, detail ? ("-> " + detail) : "");
        failed++;
    }
}

// Mock DOM & Storage environment for Node.js test runner
global.document = {
    addEventListener: () => {},
    createElement: (tag) => ({
        id: "",
        className: "",
        style: {},
        innerHTML: "",
        setAttribute: () => {},
        getAttribute: () => null,
        addEventListener: () => {},
        classList: {
            add: () => {},
            remove: () => {},
            contains: () => false
        },
        appendChild: () => {},
        querySelector: () => null,
        querySelectorAll: () => []
    }),
    getElementById: () => null,
    querySelectorAll: () => []
};

global.localStorage = {
    _store: {},
    getItem(key) { return this._store[key] || null; },
    setItem(key, val) { this._store[key] = String(val); },
    removeItem(key) { delete this._store[key]; },
    clear() { this._store = {}; }
};
global.sessionStorage = {
    _store: {},
    getItem(key) { return this._store[key] || null; },
    setItem(key, value) { this._store[key] = String(value); },
    removeItem(key) { delete this._store[key]; }
};

function createEconomyApiHarness(items, equipment) {
    const state = {
        balance: 73,
        items: { ...items },
        equipment: { ...equipment },
        migration: { status: "completed", result: "imported" }
    };
    const operations = new Map();
    const calls = [];
    let failAfterCommitCount = 0;
    let failSnapshotOnce = false;
    return {
        state,
        operations,
        calls,
        setFailAfterCommitOnce() { failAfterCommitCount = 2; },
        setFailSnapshotOnce() { failSnapshotOnce = true; },
        fetch: async (url, options) => {
            calls.push({ url, options });
            if (url === "/api/auth/csrf-token") {
                return { ok: true, status: 200, json: async () => ({ success: true, data: { csrfToken: "test-csrf" } }) };
            }
            if (url === "/api/economy") {
                if (failSnapshotOnce) {
                    failSnapshotOnce = false;
                    return { ok: false, status: 503, json: async () => ({ success: false }) };
                }
                return { ok: true, status: 200, json: async () => ({ success: true, data: {
                    balance: state.balance, items: { ...state.items }, equipment: { ...state.equipment }, migration: { ...state.migration }
                } }) };
            }
            const body = JSON.parse(options.body);
            const serverOperationKey = url.endsWith("/battle-reward")
                ? "battle-reward:" + body.battleToken
                : (url.endsWith("/capture-ball") ? "capture:" + body.captureId + ":" + body.action : body.operationId);
            let result = operations.get(serverOperationKey);
            const alreadyProcessed = Boolean(result);
            if (!result) {
                let battleReward = null;
                if (url.endsWith("/use-item")) {
                    if (!state.items[body.itemId]) return { ok: false, status: 409, json: async () => ({ success: false, message: "Item not owned" }) };
                    state.items[body.itemId]--;
                    if (!state.items[body.itemId]) delete state.items[body.itemId];
                } else if (url.endsWith("/buy-item")) {
                    if (JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(["itemId", "operationId", "quantity"]) ||
                        !Number.isSafeInteger(body.quantity) || body.quantity < 1) {
                        throw new Error("Shop client must send item ID and quantity, without price, balance, or UID");
                    }
                    const item = ItemCatalog.getItem(body.itemId);
                    if (!item || !item.shop || item.shop.buyable !== true) {
                        return { ok: false, status: 400, json: async () => ({ success: false, message: "Item cannot be purchased" }) };
                    }
                    if (state.balance < item.shop.buyPrice * body.quantity) {
                        return { ok: true, status: 200, json: async () => ({
                            success: false,
                            message: "Bạn không đủ vàng để mua vật phẩm này.",
                            code: "INSUFFICIENT_FUNDS"
                        }) };
                    }
                    state.balance -= item.shop.buyPrice * body.quantity;
                    state.items[body.itemId] = (state.items[body.itemId] || 0) + body.quantity;
                } else if (url.endsWith("/battle-reward")) {
                    if (JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(["battleToken", "operationId", "wildLevel"])) {
                        throw new Error("Client may send only battle token, wild level, and operation ID");
                    }
                    if (!Number.isSafeInteger(body.wildLevel)) throw new Error("Wild level must be an integer");
                    battleReward = { wildLevel: body.wildLevel, gold: body.wildLevel * 10, itemId: "antidote", rarity: "common", dropChancePercent: 20 };
                    state.balance += battleReward.gold;
                    state.items.antidote = (state.items.antidote || 0) + 1;
                } else if (url.endsWith("/capture-ball")) {
                    if (body.action === "consume") {
                        if (!state.items.poke_ball) return { ok: false, status: 409, json: async () => ({ success: false, message: "Poké Ball not owned" }) };
                        state.items.poke_ball--;
                        if (!state.items.poke_ball) delete state.items.poke_ball;
                    } else {
                        state.items.poke_ball = (state.items.poke_ball || 0) + 1;
                    }
                } else if (url.endsWith("/equip")) {
                    state.equipment[body.slot] = body.itemId;
                } else if (url.endsWith("/unequip")) {
                    state.equipment[body.slot] = null;
                }
                result = {
                    balance: state.balance,
                    items: { ...state.items },
                    equipment: { ...state.equipment },
                    migration: { ...state.migration },
                    ...(battleReward ? { battleReward } : {})
                };
                operations.set(serverOperationKey, result);
            }
            if (failAfterCommitCount > 0) {
                failAfterCommitCount--;
                return { ok: false, status: 503, json: async () => ({ success: false, message: "simulated lost response" }) };
            }
            return { ok: true, status: 200, json: async () => ({ success: true, data: { ...result, alreadyProcessed } }) };
        }
    };
}

async function runTests() {
console.log("\n=== SUITE 1: Item Catalog & Metadata Dictionary ===");
{
    assert("1.1: 4 danh mục item chuẩn tồn tại đầy đủ",
        ItemCatalog.CATEGORIES.RECOVERY === "recovery" &&
        ItemCatalog.CATEGORIES.POKEBALL === "pokeball" &&
        ItemCatalog.CATEGORIES.KEY_ITEM === "key_item" &&
        ItemCatalog.CATEGORIES.OTHER === "other"
    );

    assert("1.2: 4 slot trang bị chuẩn tồn tại",
        ItemCatalog.EQUIPMENT_SLOTS.ARMOR === "armor" &&
        ItemCatalog.EQUIPMENT_SLOTS.SHOES === "shoes" &&
        ItemCatalog.EQUIPMENT_SLOTS.ACCESSORY === "accessory" &&
        ItemCatalog.EQUIPMENT_SLOTS.HELD_ITEM === "held_item"
    );

    const potion = ItemCatalog.getItem("potion_standard");
    assert("1.3: Potion có metadata hợp lệ và isUsable = true",
        potion && potion.isUsable === true && potion.effect && potion.effect.type === "HEAL_HP"
    );

    const pokeball = ItemCatalog.getItem("poke_ball");
    assert("1.4: Poké Ball có isUsable = false khi ngoài trận đấu và có unusableReason rõ ràng",
        pokeball && pokeball.isUsable === false && typeof pokeball.unusableReason === "string" && pokeball.unusableReason.length > 0
    );

    const shoes = ItemCatalog.getItem("running_shoes");
    assert("1.5: Giày thám hiểm là trang bị hợp lệ cho slot SHOES và có chỉ số",
        shoes && shoes.isEquipment === true && shoes.equipmentSlot === ItemCatalog.EQUIPMENT_SLOTS.SHOES && shoes.stats && shoes.stats.speed > 0
    );

    const jacket = ItemCatalog.getItem("leather_jacket");
    assert("1.6: Áo khoác thám hiểm là trang bị cho slot ARMOR",
        jacket && jacket.isEquipment === true && jacket.equipmentSlot === ItemCatalog.EQUIPMENT_SLOTS.ARMOR
    );

    const allItems = Object.entries(ItemCatalog.ITEMS);
    assert("1.7: Mọi item có schema metadata chuẩn và ID khớp key catalog",
        allItems.length > 0 && allItems.every(([id, item]) =>
            item.id === id && typeof item.name === "string" && typeof item.category === "string" &&
            typeof item.icon === "string" && typeof item.description === "string" &&
            typeof item.isUsable === "boolean" && typeof item.isEquipment === "boolean" &&
            (item.effect === null || typeof item.effect === "object") &&
            (item.sprite === null || typeof item.sprite === "string")
        )
    );
    assert("1.8: Sprite hiện có được giữ và item chưa có sprite dùng placeholder icon",
        potion.sprite === "/res/items/medicine/potion.png" && ItemCatalog.getItem("pokedex_prototype").sprite === null &&
        typeof ItemCatalog.getItem("pokedex_prototype").icon === "string"
    );

    const expectedShopItems = [
        "potion_standard", "super_potion", "antidote", "poke_ball", "great_ball", "ultra_ball",
        "town_map", "pokedex_prototype", "running_shoes", "leather_jacket", "lucky_egg", "silver_pendant", "repel"
    ];
    const expectedTradeableItems = new Set([
        "potion_standard", "super_potion", "antidote", "poke_ball", "great_ball", "ultra_ball",
        "leather_jacket", "lucky_egg", "repel"
    ]);
    const shopItems = Object.entries(ItemCatalog.ITEMS);
    assert("1.9: Đủ 13 item hiện có và mỗi item dùng cùng schema Shop",
        shopItems.length === 13 && expectedShopItems.every(id => {
            const item = ItemCatalog.getItem(id);
            return item && item.shop && Object.keys(item.shop).sort().join(",") === "buyPrice,buyable,sellPrice,sellable" &&
                typeof item.shop.buyable === "boolean" && typeof item.shop.sellable === "boolean";
        })
    );
    assert("1.10: Item giao dịch được có giá nguyên dương và giá bán bằng nửa giá mua làm tròn xuống",
        shopItems.every(([id, item]) => expectedTradeableItems.has(id)
            ? item.shop.buyable && item.shop.sellable && Number.isInteger(item.shop.buyPrice) && item.shop.buyPrice > 0 &&
                Number.isInteger(item.shop.sellPrice) && item.shop.sellPrice > 0 &&
                item.shop.sellPrice === Math.floor(item.shop.buyPrice * 0.5)
            : !item.shop.buyable && !item.shop.sellable && item.shop.buyPrice === null && item.shop.sellPrice === null)
    );

    const expectedEffects = {
        potion_standard: { type: "HEAL_HP", amount: 20, description: "Hồi 20 HP" },
        super_potion: { type: "HEAL_HP", amount: 50, description: "Hồi 50 HP" },
        antidote: { type: "CURE_STATUS", status: "POISON", description: "Giải độc" },
        town_map: { type: "OPEN_MAP", description: "Xem bản đồ" },
        repel: { type: "REPEL", steps: 100, description: "Xua đuổi quái trong 100 bước" }
    };
    const expectedSprites = {
        potion_standard: "/res/items/medicine/potion.png",
        super_potion: "/res/items/medicine/super-potion.png",
        antidote: "/res/items/medicine/antidote.png",
        poke_ball: "/res/items/ball/poke.png",
        great_ball: "/res/items/ball/great.png",
        ultra_ball: "/res/items/ball/ultra.png",
        town_map: "/res/items/key-item/town-map.png",
        lucky_egg: "/res/items/hold-item/lucky-egg.png",
        repel: "/res/items/other-item/repel.png"
    };
    assert("1.11: ID, effect và sprite giữ nguyên",
        shopItems.every(([id, item]) => expectedShopItems.includes(id) && item.id === id &&
            JSON.stringify(item.effect) === JSON.stringify(expectedEffects[id] || null) &&
            item.sprite === (expectedSprites[id] || null))
    );
}

console.log("\n=== SUITE 2: Inventory Service & Anti-Spam Safeguards ===");
{
    const initialItems = { potion_standard: 3, super_potion: 2, town_map: 1, repel: 1, antidote: 1,
        leather_jacket: 1, running_shoes: 1, poke_ball: 1 };
    const emptyEquipment = { armor: null, shoes: null, accessory: null, held_item: null };
    global.localStorage.clear();
    global.localStorage.setItem("poke_proto_test_user_123_inventory", JSON.stringify({ potion_standard: 999 }));
    const api = createEconomyApiHarness(initialItems, emptyEquipment);
    const service1 = new InventoryService("test_user_123", api.state, { fetch: api.fetch });
    let inventoryChanges = 0;
    service1.onChange(() => { inventoryChanges++; });
    assert("2.1: Inventory khởi tạo từ snapshot Economy authoritative, không lấy cache cũ",
        service1.isReady && service1.getItemQuantity("potion_standard") === 3 && service1.balance === 73);
    const pendingService = new InventoryService("pending_user", {
        balance: 0, items: { potion_standard: 5 }, equipment: emptyEquipment, migration: { status: "pending" }
    }, { fetch: api.fetch });
    assert("2.1a: Snapshot pending không cho phép InventoryService sẵn sàng hoặc dùng legacy/default data",
        !pendingService.isReady && pendingService.getItemQuantity("potion_standard") === 0);
    assert("2.2: Lọc category dựa trên snapshot server", service1.getItems(ItemCatalog.CATEGORIES.RECOVERY).length === 3);
    assert("2.3: Không ghi dữ liệu authoritative trở lại localStorage", global.localStorage.getItem("poke_proto_test_user_123_inventory").includes("999"));

    let healedAmount = 0;
    const potionUse = await service1.useItem("potion_standard", {
        canHealPokemon: () => true,
        healPokemon: (amount) => { healedAmount = amount; return { success: true, healed: amount, pokemon: { name: "Testmon" } }; }
    });
    assert("2.4: Dùng Potion gửi mutation server và cập nhật state từ response", potionUse.success && healedAmount === 20 && service1.getItemQuantity("potion_standard") === 2);
    assert("2.4a: Mutation thành công thông báo để UI render lại snapshot", inventoryChanges === 1);
    assert("2.5: Mutation gửi CSRF và không gửi UID hoặc balance client", api.calls.some((call) => call.url.endsWith("/use-item") &&
        call.options.headers["X-CSRF-Token"] === "test-csrf" && !("uid" in JSON.parse(call.options.body)) && !("balance" in JSON.parse(call.options.body))));

    let asyncPartyHealCompleted = false;
    const asyncPotionUse = await service1.useItem("potion_standard", {
        canHealPokemon: () => true,
        healPokemon: async (amount) => {
            await Promise.resolve();
            asyncPartyHealCompleted = true;
            return { success: true, healed: amount, pokemon: { name: "Server Party Test" } };
        }
    });
    assert("2.5b: Inventory chờ Party API heal bất đồng bộ trước khi báo dùng Potion thành công",
        asyncPotionUse.success && asyncPartyHealCompleted);

    const authService = new InventoryService("auth_error_user", api.state, { fetch: async (url) => ({
        ok: false, status: 401, json: async () => ({ success: false, message: "Session expired" })
    }) });
    const authBefore = authService.getItemQuantity("antidote");
    const authFailure = await authService.useItem("antidote", {});
    assert("2.5a: Session hết hạn được báo lỗi và không giả cập nhật Inventory", !authFailure.success && authService.getItemQuantity("antidote") === authBefore);

    const beforeFailedMutation = service1.getItemQuantity("antidote");
    api.setFailAfterCommitOnce();
    api.setFailSnapshotOnce();
    const lostResponse = await service1.useItem("antidote", {});
    assert("2.6: Lỗi response không giả cập nhật state Inventory", !lostResponse.success && service1.getItemQuantity("antidote") === beforeFailedMutation);
    const reloadedService = new InventoryService("test_user_123", {
        balance: 73, items: { ...initialItems }, equipment: emptyEquipment, migration: { status: "completed" }
    }, { fetch: api.fetch });
    const retrySameOperation = await reloadedService.useItem("antidote", {});
    assert("2.7: Retry sau reload dùng lại operation ID và không tiêu thụ trùng", retrySameOperation.success && retrySameOperation.alreadyProcessed && reloadedService.getItemQuantity("antidote") === 0);

    const failedEffectName = "TEST_REGISTRY_FAILURE";
    ItemEffectRegistry.register(failedEffectName, () => ({ success: false, consumeItem: true, message: "Effect failed." }));
    const originalRepelEffect = ItemCatalog.getItem("repel").effect;
    ItemCatalog.getItem("repel").effect = { type: failedEffectName };
    const repelBefore = service1.getItemQuantity("repel");
    const failedEffect = await service1.useItem("repel");
    ItemCatalog.getItem("repel").effect = originalRepelEffect;
    assert("2.8: Effect thất bại không gọi mutation và không tiêu thụ item", !failedEffect.success && service1.getItemQuantity("repel") === repelBefore);

    const mapQty = service1.getItemQuantity("town_map");
    let mapOpened = false;
    const mapResult = await service1.useItem("town_map", { openMap: () => { mapOpened = true; } });
    assert("2.9: OPEN_MAP vẫn chạy cục bộ và không tiêu thụ item", mapResult.success && mapOpened && service1.getItemQuantity("town_map") === mapQty);

    const noHealQty = service1.getItemQuantity("super_potion");
    const noHeal = await service1.useItem("super_potion", { canHealPokemon: () => false });
    assert("2.10: Heal preflight thất bại không gửi mutation", !noHeal.success && service1.getItemQuantity("super_potion") === noHealQty);
    const unusableBall = await service1.useItem("poke_ball", {});
    assert("2.11: Item không dùng được ngoài Battle bị từ chối", !unusableBall.success && service1.getItemQuantity("poke_ball") === 1);
    assert("2.12: addItem/removeItem không sửa Inventory local", service1.addItem("repel", 1) === false && service1.removeItem("poke_ball", 1) === false);

    const encyclopedia = Object.create(ItemEncyclopediaUI.prototype);
    encyclopedia.inventoryService = service1;
    const itemsBeforeEncyclopedia = JSON.stringify(service1.items);
    assert("2.13: Encyclopedia đọc-only không làm thay đổi snapshot", encyclopedia.getFilteredItems().length === Object.keys(ItemCatalog.ITEMS).length &&
        encyclopedia.getOwnedQuantity("potion_standard") === service1.getItemQuantity("potion_standard") && JSON.stringify(service1.items) === itemsBeforeEncyclopedia);
    assert("2.14: Registry vẫn từ chối handler không hợp lệ hoặc effect chưa đăng ký",
        ItemEffectRegistry.register("", () => ({})) === false && ItemEffectRegistry.execute({ type: "UNREGISTERED_TEST" }, {}, null).success === false);

    const battleApi = createEconomyApiHarness({ poke_ball: 2 }, emptyEquipment);
    const battleService = new InventoryService("battle_economy_user", battleApi.state, { fetch: battleApi.fetch });
    const battleReward = await battleService.awardBattleReward("battle_token_123", 5);
    const duplicateBattleReward = await battleService.awardBattleReward("battle_token_123", 5);
    assert("2.15: Battle Reward nhận snapshot vàng/vật phẩm từ server và token trùng không cộng thêm",
        battleReward.success && battleReward.battleReward.gold === 50 && battleService.balance === 123 &&
        battleService.getItemQuantity("antidote") === 1 && duplicateBattleReward.alreadyProcessed,
        JSON.stringify({ battleReward, duplicateBattleReward, balance: battleService.balance, antidote: battleService.getItemQuantity("antidote") }));

    const originalGetElementById = global.document.getElementById;
    const originalHudInit = ModernHUD.prototype.init;
    const balanceNode = { textContent: "" };
    global.document.getElementById = (id) => id === "rpg-currency-balance" ? balanceNode : null;
    ModernHUD.prototype.init = function () {};
    let battleHud;
    try {
        battleHud = new ModernHUD(null, null, battleService);
        assert("2.15a: HUD render số dư mới nhất từ snapshot sau Battle Reward",
            balanceNode.textContent === "₽ 123", balanceNode.textContent);
        battleService.loadFromSnapshot({
            balance: 456, items: { ...battleService.items }, equipment: { ...battleService.equipment },
            migration: { status: "completed", result: "imported" }
        });
        battleService.notifyChange();
        assert("2.15b: HUD cập nhật balance khi InventoryService thông báo snapshot mới",
            balanceNode.textContent === "₽ 456", balanceNode.textContent);

        const reloadedService = new InventoryService("battle_economy_user", {
            balance: 456, items: { ...battleService.items }, equipment: { ...battleService.equipment },
            migration: { status: "completed", result: "imported" }
        }, { fetch: battleApi.fetch });
        const reloadedHud = new ModernHUD(null, null, reloadedService);
        assert("2.15c: HUD sau reload hiển thị balance từ snapshot authoritative",
            balanceNode.textContent === "₽ 456", balanceNode.textContent);
        reloadedHud._removeInventoryListener();
    } finally {
        if (battleHud && battleHud._removeInventoryListener) battleHud._removeInventoryListener();
        ModernHUD.prototype.init = originalHudInit;
        global.document.getElementById = originalGetElementById;
    }

    const shopApi = createEconomyApiHarness({}, emptyEquipment);
    shopApi.state.balance = 1000;
    const shopService = new InventoryService("shop_economy_user", shopApi.state, { fetch: shopApi.fetch });
    let shopModalId = null;
    const shop = new ShopUI({ registerModal: (id) => { shopModalId = id; } }, shopService);
    assert("2.16: Shop modal lấy toàn bộ vật phẩm có thể mua từ Catalog",
        shopModalId === "shop" && shop.getBuyableItems().length === Object.values(ItemCatalog.ITEMS).filter((item) => item.shop.buyable).length);
    const purchase = await shopService.buyItem("potion_standard");
    const purchaseBody = JSON.parse(shopApi.calls.find((call) => call.url.endsWith("/buy-item")).options.body);
    assert("2.17: Mua vật phẩm cập nhật balance và quantity từ snapshot server",
        purchase.success && shopService.balance === 700 && shopService.getItemQuantity("potion_standard") === 1 &&
        purchaseBody.itemId === "potion_standard" && purchaseBody.quantity === 1 && purchaseBody.buyPrice === undefined);
    shopApi.setFailAfterCommitOnce();
    const ambiguousPurchase = await shopService.buyItem("poke_ball");
    const retriedPurchase = await shopService.buyItem("poke_ball");
    const pokeBallPurchases = shopApi.calls.filter((call) => call.url.endsWith("/buy-item") && JSON.parse(call.options.body).itemId === "poke_ball");
    const pokeBallOperationIds = pokeBallPurchases.map((call) => JSON.parse(call.options.body).operationId);
    assert("2.18: Retry mua sau response lỗi dùng lại operation ID, không trừ vàng/cộng item lần hai",
        !ambiguousPurchase.success && retriedPurchase.success && retriedPurchase.alreadyProcessed &&
        pokeBallOperationIds.every((operationId) => operationId === pokeBallOperationIds[0]) &&
        shopService.balance === 400 && shopService.getItemQuantity("poke_ball") === 1);
    const callsBeforeInvalidBuy = shopApi.calls.length;
    const invalidBuy = await shopService.buyItem("town_map");
    assert("2.19: Vật phẩm không thể giao dịch bị từ chối ở client",
        !invalidBuy.success && shopApi.calls.length === callsBeforeInvalidBuy);

    const poorApi = createEconomyApiHarness({}, emptyEquipment);
    const poorService = new InventoryService("poor_shop_user", poorApi.state, { fetch: poorApi.fetch });
    const loggedErrors = [];
    const originalConsoleError = console.error;
    console.error = (...args) => loggedErrors.push(args);
    let poorPurchase;
    try {
        poorPurchase = await poorService.buyItem("potion_standard");
    } finally {
        console.error = originalConsoleError;
    }
    const shopMessage = shop.getPurchaseFailureMessage(poorPurchase);
    assert("2.20: Thiếu vàng là kết quả nghiệp vụ bình thường, giữ nguyên state và không log console.error",
        !poorPurchase.success && poorPurchase.businessError && poorPurchase.code === "INSUFFICIENT_FUNDS" &&
        poorService.balance === 73 && poorService.getItemQuantity("potion_standard") === 0 && loggedErrors.length === 0);
    assert("2.20a: Shop hiển thị thông báo Không đủ vàng",
        shopMessage === "Không đủ vàng để mua vật phẩm này.");

    const originalBuyShopItem = economyService.buyShopItem;
    const controllerResponse = () => ({
        statusCode: 200,
        payload: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.payload = payload; return this; }
    });
    try {
        economyService.buyShopItem = async () => {
            const error = new Error("Bạn không đủ vàng để mua vật phẩm này.");
            error.code = "INSUFFICIENT_FUNDS";
            error.statusCode = 409;
            throw error;
        };
        const insufficientResponse = controllerResponse();
        await economyController.buyShopItem({ user: { uid: "controller_shop_user" }, body: {} }, insufficientResponse);
        assert("2.20aa: Controller giữ code nghiệp vụ nhưng trả HTTP 200 cho thiếu vàng",
            insufficientResponse.statusCode === 200 && insufficientResponse.payload.success === false &&
            insufficientResponse.payload.code === "INSUFFICIENT_FUNDS");

        economyService.buyShopItem = async () => {
            const error = new Error("Operation conflict");
            error.code = "OPERATION_ID_CONFLICT";
            error.statusCode = 409;
            throw error;
        };
        const conflictResponse = controllerResponse();
        await economyController.buyShopItem({ user: { uid: "controller_shop_user" }, body: {} }, conflictResponse);
        assert("2.20ab: Các lỗi 409 khác vẫn giữ nguyên HTTP status",
            conflictResponse.statusCode === 409 && conflictResponse.payload.code === "OPERATION_ID_CONFLICT");
    } finally {
        economyService.buyShopItem = originalBuyShopItem;
    }

    const systemFailureState = {
        balance: 1000,
        items: {},
        equipment: { ...emptyEquipment },
        migration: { status: "completed", result: "imported" }
    };
    const systemFailureFetch = async (url) => {
        if (url === "/api/auth/csrf-token") {
            return { ok: true, status: 200, json: async () => ({ success: true, data: { csrfToken: "test-csrf" } }) };
        }
        if (url.endsWith("/buy-item")) {
            return { ok: false, status: 500, json: async () => ({ success: false, message: "Server unavailable", code: "INTERNAL_ERROR" }) };
        }
        return { ok: true, status: 200, json: async () => ({ success: true, data: systemFailureState }) };
    };
    const systemFailureService = new InventoryService("shop_system_failure_user", systemFailureState, { fetch: systemFailureFetch });
    const systemLoggedErrors = [];
    console.error = (...args) => systemLoggedErrors.push(args);
    let systemFailure;
    try {
        systemFailure = await systemFailureService.buyItem("potion_standard");
    } finally {
        console.error = originalConsoleError;
    }
    assert("2.20b: Lỗi hệ thống vẫn được ghi log và không giả cập nhật state",
        !systemFailure.success && systemLoggedErrors.length === 1 && systemFailureService.balance === 1000 &&
        systemFailureService.getItemQuantity("potion_standard") === 0);

    const captureConsume = await battleService.consumeCaptureBall("capture_token_123");
    const duplicateCaptureConsume = await battleService.consumeCaptureBall("capture_token_123");
    assert("2.16: Capture tiêu thụ Poké Ball qua API và retry không trừ lần hai",
        captureConsume.success && battleService.getItemQuantity("poke_ball") === 1 && duplicateCaptureConsume.alreadyProcessed);
    const captureRefund = await battleService.refundCaptureBall("capture_token_123");
    const duplicateCaptureRefund = await battleService.refundCaptureBall("capture_token_123");
    assert("2.17: Hoàn bóng có xác nhận server và retry không cộng lần hai",
        captureRefund.success && battleService.getItemQuantity("poke_ball") === 2 && duplicateCaptureRefund.alreadyProcessed);
}

console.log("\n=== SUITE 3: Equipment System & Slot Validation ===");
{
    const equipment = { armor: null, shoes: null, accessory: null, held_item: null };
    const api = createEconomyApiHarness({ leather_jacket: 1, running_shoes: 1 }, equipment);
    const service = new InventoryService("test_user_equip", api.state, { fetch: api.fetch });

    // Test invalid slot assignment
    const invalidSlotResult = await service.equipItem("armor", "running_shoes");
    assert("3.1: Từ chối trang bị vật phẩm sai vị trí slot (Giày vào slot Áo giáp)",
        invalidSlotResult.success === false && invalidSlotResult.message.includes("Không thể trang bị")
    );

    // Test valid slot assignment
    const validArmorResult = await service.equipItem("armor", "leather_jacket");
    assert("3.2: Trang bị áo giáp hợp lệ vào slot ARMOR",
        validArmorResult.success === true && service.equipment.armor === "leather_jacket"
    );

    // Test equipping shoes
    const validShoesResult = await service.equipItem("shoes", "running_shoes");
    assert("3.3: Trang bị giày hợp lệ vào slot SHOES",
        validShoesResult.success === true && service.equipment.shoes === "running_shoes"
    );

    // Test stat calculation
    const totalStats = service.calculateEquipmentStats();
    assert("3.4: Tính toán tổng chỉ số trang bị chính xác",
        totalStats.defense > 0 && totalStats.speed > 0
    );

    // Test unequip
    const unequipResult = await service.unequipItem("armor");
    assert("3.5: Tháo trang bị thành công",
        unequipResult.success === true && service.equipment.armor === null
    );

    assert("3.6: Chỉ số tự động giảm sau khi tháo trang bị",
        service.calculateEquipmentStats().defense < totalStats.defense
    );
}

console.log("\n=== SUITE 4: Modal Manager & Game State Isolation ===");
{
    const mockGame = {
        state: "NORMAL",
        player: {
            stop: false,
            walkInProgress: false
        },
        key: {
            _pressed: { 38: true, 87: true } // UP, W
        }
    };

    const manager = new ModalManager(mockGame);
    manager.registerModal("inventory", {
        render: () => ({ id: "mock-inventory" }),
        onClose: () => {}
    });

    // 1. Open modal from NORMAL
    manager.openModal("inventory");
    assert("4.1: Chuyển state sang 'MENU' khi mở modal từ NORMAL",
        mockGame.state === "MENU"
    );

    assert("4.2: Khóa cờ player.stop = true khi mở modal",
        mockGame.player.stop === true
    );

    assert("4.3: Xóa sạch bộ đệm phím (key._pressed) khi mở modal",
        Object.keys(mockGame.key._pressed).length === 0
    );

    assert("4.4: Active modal được ghi nhận là 'inventory'",
        manager.activeModal === "inventory"
    );

    // 2. Close modal
    manager.closeActiveModal();
    assert("4.5: Khôi phục state về 'NORMAL' khi đóng modal",
        mockGame.state === "NORMAL"
    );

    assert("4.6: Mở khóa player.stop = false khi đóng modal",
        mockGame.player.stop === false
    );

    assert("4.7: Active modal = null sau khi đóng",
        manager.activeModal === null
    );

    // 3. Reject opening modal during DIALOGUE or TRANSITION
    mockGame.state = "DIALOGUE";
    manager.openModal("inventory");
    assert("4.8: Tuyệt đối KHÔNG cho phép mở menu khi đang trong DIALOGUE",
        mockGame.state === "DIALOGUE" && manager.activeModal === null
    );

    mockGame.state = "TRANSITION";
    manager.openModal("inventory");
    assert("4.9: Tuyệt đối KHÔNG cho phép mở menu khi đang trong TRANSITION",
        mockGame.state === "TRANSITION" && manager.activeModal === null
    );

    // 4. Reject opening modal while player is actively walking
    mockGame.state = "NORMAL";
    mockGame.player.walkInProgress = true;
    manager.openModal("inventory");
    assert("4.10: Chặn mở menu khi người chơi đang bước dở (walkInProgress = true)",
        mockGame.state === "NORMAL" && manager.activeModal === null
    );
    mockGame.player.walkInProgress = false;
}

console.log("\n============================================================");
console.log(`TỔNG KẾT: ${passed} PASS | ${failed} FAIL`);
console.log("============================================================");
if (failed > 0) process.exitCode = 1;
}

runTests().catch((error) => {
    console.error("Inventory tests: FAIL", error);
    process.exitCode = 1;
});
