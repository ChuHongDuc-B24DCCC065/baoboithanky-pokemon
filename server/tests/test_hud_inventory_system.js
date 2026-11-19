/**
 * Comprehensive Automated Test Suite for Modern Pokémon RPG HUD, Inventory & Equipment
 * Tests domain logic, state management, anti-spam safeguards, and equipment validation.
 * 
 * Run with: node server/tests/test_hud_inventory_system.js
 */
"use strict";

const ItemCatalog = require("../../public/js/engine/ui/itemCatalog");
const InventoryService = require("../../public/js/engine/ui/inventoryService");
const ModalManager = require("../../public/js/engine/ui/modalManager");

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
}

console.log("\n=== SUITE 2: Inventory Service & Anti-Spam Safeguards ===");
{
    global.localStorage.clear();
    const service1 = new InventoryService("test_user_123");

    assert("2.1: Namespace LocalStorage chứa đúng UID người chơi",
        service1.storagePrefix === "poke_proto_test_user_123_"
    );

    const recoveryItems = service1.getItems(ItemCatalog.CATEGORIES.RECOVERY);
    assert("2.2: Lọc danh mục Hồi phục chính xác",
        recoveryItems.length > 0 && recoveryItems.every(i => i.category === ItemCatalog.CATEGORIES.RECOVERY)
    );

    const initialPotionQty = service1.getItemQuantity("potion_standard");
    assert("2.3: Số lượng Potion ban đầu hợp lệ (> 0)", initialPotionQty > 0);

    // Test item usage
    let healedAmount = 0;
    const mockContext = {
        healHp: (amount) => {
            healedAmount = amount;
            return amount;
        }
    };

    const useResult = service1.useItem("potion_standard", mockContext);
    assert("2.4: Sử dụng Potion thành công và giảm số lượng",
        useResult.success === true &&
        service1.getItemQuantity("potion_standard") === initialPotionQty - 1 &&
        healedAmount === 20
    );

    // Test unusable item rejection
    const useBallResult = service1.useItem("poke_ball", mockContext);
    assert("2.5: Từ chối sử dụng vật phẩm không hợp lệ (Poké Ball) ngoài trận đấu",
        useBallResult.success === false && typeof useBallResult.message === "string"
    );

    // Test no negative quantities
    service1.removeItem("potion_standard", 9999);
    assert("2.6: Không bao giờ cho phép số lượng âm sau khi tiêu thụ",
        service1.getItemQuantity("potion_standard") === 0
    );

    const useEmptyResult = service1.useItem("potion_standard", mockContext);
    assert("2.7: Từ chối sử dụng khi số lượng vật phẩm = 0",
        useEmptyResult.success === false
    );

    // Test anti-double-click / concurrency lock
    service1._isBusy = true;
    const busyResult = service1.useItem("super_potion", mockContext);
    assert("2.8: Khóa chống click đúp (Concurrency Lock) chặn tiêu thụ trùng lặp",
        busyResult.success === false && busyResult.message.includes("Đang xử lý")
    );
    service1._isBusy = false;

    // Test Key items are NOT consumed
    const mapQtyBefore = service1.getItemQuantity("town_map");
    const useMapResult = service1.useItem("town_map", { openMap: () => {} });
    assert("2.9: Vật phẩm chính (Key Item: Town Map) không bị mất đi sau khi dùng",
        useMapResult.success === true && service1.getItemQuantity("town_map") === mapQtyBefore
    );
}

console.log("\n=== SUITE 3: Equipment System & Slot Validation ===");
{
    const service = new InventoryService("test_user_equip");

    // Test invalid slot assignment
    const invalidSlotResult = service.equipItem("armor", "running_shoes");
    assert("3.1: Từ chối trang bị vật phẩm sai vị trí slot (Giày vào slot Áo giáp)",
        invalidSlotResult.success === false && invalidSlotResult.message.includes("Không thể trang bị")
    );

    // Test valid slot assignment
    const validArmorResult = service.equipItem("armor", "leather_jacket");
    assert("3.2: Trang bị áo giáp hợp lệ vào slot ARMOR",
        validArmorResult.success === true && service.equipment.armor === "leather_jacket"
    );

    // Test equipping shoes
    const validShoesResult = service.equipItem("shoes", "running_shoes");
    assert("3.3: Trang bị giày hợp lệ vào slot SHOES",
        validShoesResult.success === true && service.equipment.shoes === "running_shoes"
    );

    // Test stat calculation
    const totalStats = service.calculateEquipmentStats();
    assert("3.4: Tính toán tổng chỉ số trang bị chính xác",
        totalStats.defense > 0 && totalStats.speed > 0
    );

    // Test unequip
    const unequipResult = service.unequipItem("armor");
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

if (failed > 0) {
    process.exit(1);
}
