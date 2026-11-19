/**
 * Inventory & Equipment Service for Poké-Engine
 * Manages item counts, equipment slots, usability validation, anti-spam locks,
 * and scoped client persistence (Prototype Sandbox).
 * 
 * ARCHITECTURE NOTICE:
 * - This service acts as the client-side domain layer for Inventory & Equipment.
 * - Current persistence uses LocalStorage namespaced by Firebase UID as a client prototype cache.
 * - This data is NOT yet persisted on Cloud Firestore (awaiting future backend schema approval).
 */
(function (global) {
    "use strict";

    const Catalog = (typeof require !== "undefined")
        ? require("./itemCatalog")
        : (global.PokeItemCatalog || {});

    const DEFAULT_STARTING_ITEMS = {
        "potion_standard": 5,
        "super_potion": 2,
        "poke_ball": 10,
        "great_ball": 3,
        "town_map": 1,
        "running_shoes": 1,
        "leather_jacket": 1,
        "silver_pendant": 1,
        "repel": 2
    };

    const DEFAULT_EQUIPMENT = {
        "armor": null,
        "shoes": null,
        "accessory": null,
        "held_item": null
    };

    const InventoryService = function (userId) {
        this.userId = userId || "guest";
        this.storagePrefix = `poke_proto_${this.userId}_`;
        this.items = {}; // { itemId: quantity }
        this.equipment = { ...DEFAULT_EQUIPMENT };
        this._isBusy = false; // Concurrency lock for actions
        this._listeners = [];

        this.init();
    };

    InventoryService.prototype.init = function () {
        this.loadFromStorage();
    };

    InventoryService.prototype.getStorageKey = function (type) {
        return `${this.storagePrefix}${type}`;
    };

    InventoryService.prototype.loadFromStorage = function () {
        if (typeof localStorage === "undefined") {
            this.items = { ...DEFAULT_STARTING_ITEMS };
            this.equipment = { ...DEFAULT_EQUIPMENT };
            return;
        }

        try {
            const rawItems = localStorage.getItem(this.getStorageKey("inventory"));
            if (rawItems) {
                const parsed = JSON.parse(rawItems);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    // Sanitize quantities
                    this.items = {};
                    for (const [id, qty] of Object.entries(parsed)) {
                        if (Catalog.getItem(id) && typeof qty === "number" && qty > 0) {
                            this.items[id] = Math.floor(qty);
                        }
                    }
                } else {
                    this.items = { ...DEFAULT_STARTING_ITEMS };
                }
            } else {
                this.items = { ...DEFAULT_STARTING_ITEMS };
                this.saveToStorage();
            }

            const rawEquip = localStorage.getItem(this.getStorageKey("equipment"));
            if (rawEquip) {
                const parsedEquip = JSON.parse(rawEquip);
                if (parsedEquip && typeof parsedEquip === "object") {
                    this.equipment = { ...DEFAULT_EQUIPMENT };
                    for (const slot of Object.keys(DEFAULT_EQUIPMENT)) {
                        const itemId = parsedEquip[slot];
                        if (itemId && Catalog.getItem(itemId)) {
                            const itemDef = Catalog.getItem(itemId);
                            if (itemDef.isEquipment && itemDef.equipmentSlot === slot) {
                                this.equipment[slot] = itemId;
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.warn("[InventoryService] Failed to load prototype data, falling back to defaults:", err);
            this.items = { ...DEFAULT_STARTING_ITEMS };
            this.equipment = { ...DEFAULT_EQUIPMENT };
        }
    };

    InventoryService.prototype.saveToStorage = function () {
        if (typeof localStorage === "undefined") return;
        try {
            localStorage.setItem(this.getStorageKey("inventory"), JSON.stringify(this.items));
            localStorage.setItem(this.getStorageKey("equipment"), JSON.stringify(this.equipment));
        } catch (err) {
            console.warn("[InventoryService] Failed to save prototype data to localStorage:", err);
        }
    };

    InventoryService.prototype.onChange = function (callback) {
        if (typeof callback === "function") {
            this._listeners.push(callback);
        }
    };

    InventoryService.prototype.notifyChange = function () {
        this.saveToStorage();
        for (let i = 0; i < this._listeners.length; i++) {
            try {
                this._listeners[i]({
                    items: { ...this.items },
                    equipment: { ...this.equipment }
                });
            } catch (e) {
                console.error("[InventoryService] Listener error:", e);
            }
        }
    };

    // --- Inventory Operations ---

    InventoryService.prototype.getItems = function (category) {
        const result = [];
        for (const [id, qty] of Object.entries(this.items)) {
            if (qty <= 0) continue;
            const def = Catalog.getItem(id);
            if (!def) continue;
            if (!category || def.category === category) {
                result.push({
                    ...def,
                    quantity: qty,
                    isEquipped: this.isEquipped(id)
                });
            }
        }
        return result;
    };

    InventoryService.prototype.getItemQuantity = function (itemId) {
        return this.items[itemId] || 0;
    };

    InventoryService.prototype.addItem = function (itemId, count) {
        const qty = count !== undefined ? Math.floor(count) : 1;
        if (qty <= 0) return false;
        if (!Catalog.getItem(itemId)) return false;

        this.items[itemId] = (this.items[itemId] || 0) + qty;
        this.notifyChange();
        return true;
    };

    InventoryService.prototype.removeItem = function (itemId, count) {
        const qty = count !== undefined ? Math.floor(count) : 1;
        if (qty <= 0) return false;
        const current = this.items[itemId] || 0;
        if (current <= 0) return false;

        const newQty = Math.max(0, current - qty);
        if (newQty === 0) {
            delete this.items[itemId];
        } else {
            this.items[itemId] = newQty;
        }
        this.notifyChange();
        return true;
    };

    /**
     * Use an item with concurrency lock and validation
     */
    InventoryService.prototype.useItem = function (itemId, targetContext) {
        if (this._isBusy) {
            return { success: false, message: "Đang xử lý vật phẩm, vui lòng thử lại sau giây lát." };
        }

        const itemDef = Catalog.getItem(itemId);
        if (!itemDef) {
            return { success: false, message: "Vật phẩm không tồn tại trong từ điển hệ thống." };
        }

        const currentQty = this.getItemQuantity(itemId);
        if (currentQty <= 0) {
            return { success: false, message: "Số lượng vật phẩm trong túi đã hết." };
        }

        if (!itemDef.isUsable) {
            return {
                success: false,
                message: itemDef.unusableReason || "Vật phẩm này không thể sử dụng ở màn hình hiện tại."
            };
        }

        this._isBusy = true;
        try {
            let effectMsg = "";
            let consumeItem = true;

            switch (itemDef.effect && itemDef.effect.type) {
                case "HEAL_HP": {
                    const healAmount = itemDef.effect.amount || 20;
                    if (targetContext && typeof targetContext.healHp === "function") {
                        const actualHealed = targetContext.healHp(healAmount);
                        effectMsg = `Đã sử dụng ${itemDef.name}, hồi phục ${actualHealed} HP!`;
                    } else {
                        effectMsg = `Đã sử dụng ${itemDef.name}, hồi phục ${healAmount} HP cho Trainer!`;
                    }
                    break;
                }
                case "CURE_STATUS": {
                    effectMsg = `Đã sử dụng ${itemDef.name}, giải trừ trạng thái ${itemDef.effect.status || "bất thường"}!`;
                    break;
                }
                case "OPEN_MAP": {
                    consumeItem = false; // Key items are not consumed!
                    effectMsg = "Đã mở bản đồ du hành!";
                    if (targetContext && typeof targetContext.openMap === "function") {
                        targetContext.openMap();
                    }
                    break;
                }
                case "REPEL": {
                    effectMsg = `Đã xịt ${itemDef.name}! Xua đuổi quái vật trong ${itemDef.effect.steps} bước chân.`;
                    break;
                }
                default: {
                    consumeItem = false;
                    effectMsg = `Vật phẩm ${itemDef.name} chưa có hiệu ứng gameplay được hỗ trợ.`;
                    return { success: false, message: effectMsg };
                }
            }

            if (consumeItem) {
                this.removeItem(itemId, 1);
            }

            return {
                success: true,
                message: effectMsg,
                remainingQuantity: this.getItemQuantity(itemId)
            };
        } finally {
            this._isBusy = false;
        }
    };

    // --- Equipment Operations ---

    InventoryService.prototype.getEquipment = function () {
        const result = {};
        for (const [slot, itemId] of Object.entries(this.equipment)) {
            result[slot] = itemId ? Catalog.getItem(itemId) : null;
        }
        return result;
    };

    InventoryService.prototype.isEquipped = function (itemId) {
        return Object.values(this.equipment).includes(itemId);
    };

    InventoryService.prototype.equipItem = function (slot, itemId) {
        if (!Object.prototype.hasOwnProperty.call(this.equipment, slot)) {
            return { success: false, message: `Vị trí trang bị '${slot}' không hợp lệ.` };
        }

        const itemDef = Catalog.getItem(itemId);
        if (!itemDef || !itemDef.isEquipment) {
            return { success: false, message: "Vật phẩm này không thể dùng làm trang bị." };
        }

        if (itemDef.equipmentSlot !== slot) {
            const requiredSlotName = Catalog.EQUIPMENT_SLOT_NAMES[itemDef.equipmentSlot] || itemDef.equipmentSlot;
            return {
                success: false,
                message: `Không thể trang bị vào ô này. Vật phẩm này thuộc slot: ${requiredSlotName}.`
            };
        }

        if (this.getItemQuantity(itemId) <= 0) {
            return { success: false, message: "Bạn không sở hữu vật phẩm này trong túi." };
        }

        // Apply equipment
        this.equipment[slot] = itemId;
        this.notifyChange();

        return {
            success: true,
            message: `Đã trang bị ${itemDef.name} vào ô ${Catalog.EQUIPMENT_SLOT_NAMES[slot]}.`
        };
    };

    InventoryService.prototype.unequipItem = function (slot) {
        if (!Object.prototype.hasOwnProperty.call(this.equipment, slot)) {
            return { success: false, message: `Vị trí trang bị '${slot}' không hợp lệ.` };
        }

        const currentItemId = this.equipment[slot];
        if (!currentItemId) {
            return { success: false, message: "Vị trí này hiện đang trống." };
        }

        const itemDef = Catalog.getItem(currentItemId);
        this.equipment[slot] = null;
        this.notifyChange();

        return {
            success: true,
            message: `Đã tháo ${itemDef ? itemDef.name : "trang bị"} khỏi ô ${Catalog.EQUIPMENT_SLOT_NAMES[slot]}.`
        };
    };

    InventoryService.prototype.calculateEquipmentStats = function () {
        const total = {
            defense: 0,
            speed: 0,
            maxHp: 0,
            luck: 0,
            expBonus: 0
        };

        for (const itemId of Object.values(this.equipment)) {
            if (!itemId) continue;
            const def = Catalog.getItem(itemId);
            if (def && def.stats) {
                for (const [stat, val] of Object.entries(def.stats)) {
                    if (typeof val === "number") {
                        total[stat] = (total[stat] || 0) + val;
                    }
                }
            }
        }
        return total;
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = InventoryService;
    } else {
        global.PokeInventoryService = InventoryService;
    }
})(typeof window !== "undefined" ? window : global);
