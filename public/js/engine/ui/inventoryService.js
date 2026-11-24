/**
 * Inventory & Equipment Service for Poké-Engine
 * Reads authoritative inventory state from the Economy API and dispatches mutations to the server.
 * Contract: getters are synchronous snapshot reads; useItem/equipItem/unequipItem return Promises.
 * addItem/removeItem fail closed until gameplay callers move to specific server-approved operations.
 */
(function (global) {
    "use strict";

    const Catalog = (typeof require !== "undefined")
        ? require("./itemCatalog")
        : (global.PokeItemCatalog || {});
    const EffectRegistry = (typeof require !== "undefined")
        ? require("./itemEffectRegistry")
        : (global.PokeItemEffectRegistry || {});

    const DEFAULT_EQUIPMENT = { armor: null, shoes: null, accessory: null, held_item: null };
    const InventoryService = function (userId, economySnapshot, options) {
        this.userId = userId || null;
        this.items = {};
        this.equipment = { ...DEFAULT_EQUIPMENT };
        this.balance = 0;
        this.migration = null;
        this.isReady = false;
        this._isBusy = false;
        this._listeners = [];
        this._pendingOperations = Object.create(null);
        this._completedBattleRewardTokens = new Map();
        this._fetch = options && options.fetch ? options.fetch : (typeof fetch === "function" ? fetch.bind(global) : null);
        this.loadFromSnapshot(economySnapshot);
    };

    InventoryService.prototype.loadFromSnapshot = function (snapshot) {
        if (!snapshot || !Number.isSafeInteger(snapshot.balance) || snapshot.balance < 0 ||
            !snapshot.items || typeof snapshot.items !== "object" || Array.isArray(snapshot.items) ||
            !snapshot.equipment || typeof snapshot.equipment !== "object" ||
            !snapshot.migration || snapshot.migration.status !== "completed") {
            this.isReady = false;
            return false;
        }
        const items = {};
        for (const [itemId, quantity] of Object.entries(snapshot.items)) {
            if (Catalog.getItem(itemId) && Number.isSafeInteger(quantity) && quantity > 0) items[itemId] = quantity;
        }
        const equipment = { ...DEFAULT_EQUIPMENT };
        for (const slot of Object.keys(equipment)) {
            const itemId = snapshot.equipment[slot];
            const item = itemId && Catalog.getItem(itemId);
            if (item && item.isEquipment && item.equipmentSlot === slot && items[itemId] > 0) equipment[slot] = itemId;
        }
        this.balance = snapshot.balance;
        this.items = items;
        this.equipment = equipment;
        this.migration = snapshot.migration ? { ...snapshot.migration } : null;
        this.isReady = true;
        return true;
    };

    InventoryService.prototype.onChange = function (callback) {
        if (typeof callback === "function" && !this._listeners.includes(callback)) this._listeners.push(callback);
        return () => { this._listeners = this._listeners.filter((listener) => listener !== callback); };
    };

    InventoryService.prototype.notifyChange = function () {
        const state = { items: { ...this.items }, equipment: { ...this.equipment }, balance: this.balance };
        this._listeners.slice().forEach((listener) => {
            try { listener(state); } catch (error) { console.error("[InventoryService] Listener error:", error); }
        });
    };

    InventoryService.prototype.getItems = function (category) {
        if (!this.isReady) return [];
        return Object.entries(this.items).filter(([, quantity]) => quantity > 0).reduce((result, [id, quantity]) => {
            const item = Catalog.getItem(id);
            if (item && (!category || item.category === category)) {
                result.push({ ...item, quantity, isEquipped: this.isEquipped(id) });
            }
            return result;
        }, []);
    };

    InventoryService.prototype.getItemQuantity = function (itemId) {
        return this.isReady ? (this.items[itemId] || 0) : 0;
    };

    InventoryService.prototype.getEquipment = function () {
        const result = {};
        for (const [slot, itemId] of Object.entries(this.equipment)) result[slot] = itemId ? Catalog.getItem(itemId) : null;
        return result;
    };

    InventoryService.prototype.isEquipped = function (itemId) {
        return Object.values(this.equipment).includes(itemId);
    };

    InventoryService.prototype.calculateEquipmentStats = function () {
        const total = { defense: 0, speed: 0, maxHp: 0, luck: 0, expBonus: 0 };
        Object.values(this.equipment).forEach((itemId) => {
            const item = itemId && Catalog.getItem(itemId);
            if (item && item.stats) Object.entries(item.stats).forEach(([stat, value]) => {
                if (typeof value === "number") total[stat] = (total[stat] || 0) + value;
            });
        });
        return total;
    };

    InventoryService.prototype.addItem = function () {
        return false;
    };

    InventoryService.prototype.removeItem = function () {
        return false;
    };

    InventoryService.prototype.buyItem = async function (itemId, quantity) {
        const item = Catalog.getItem(itemId);
        const purchaseQuantity = quantity === undefined ? 1 : quantity;
        if (!this.isReady) return { success: false, message: "Economy chưa sẵn sàng." };
        if (!item || !item.shop || item.shop.buyable !== true) {
            return { success: false, message: "Vật phẩm này không thể mua." };
        }
        if (!Number.isSafeInteger(purchaseQuantity) || purchaseQuantity < 1 || purchaseQuantity > 999) {
            return { success: false, message: "Số lượng mua không hợp lệ." };
        }
        if (this._isBusy) return { success: false, message: "Đang xử lý thao tác khác, vui lòng thử lại." };

        this._isBusy = true;
        try {
            const result = await this._requestMutation("buy-item", { itemId: item.id, quantity: purchaseQuantity }, "buy-item:" + item.id + ":" + purchaseQuantity);
            return result.success
                ? { ...result, message: result.alreadyProcessed ? "Giao dịch mua đã được xác nhận." : `Đã mua ${item.name}.` }
                : result;
        } finally {
            this._isBusy = false;
        }
    };

    InventoryService.prototype.awardBattleReward = async function (battleToken, wildLevel) {
        if (typeof battleToken !== "string" || !battleToken || !Number.isSafeInteger(wildLevel) || wildLevel < 1 || wildLevel > 100) {
            return { success: false, message: "Không xác định được trận đấu để nhận phần thưởng." };
        }
        if (this._completedBattleRewardTokens.has(battleToken)) {
            return { ...this._completedBattleRewardTokens.get(battleToken), alreadyProcessed: true };
        }
        const result = await this._requestMutation("battle-reward", { battleToken, wildLevel }, "battle-reward:" + battleToken);
        if (result.success) this._completedBattleRewardTokens.set(battleToken, result);
        return result.success
            ? { ...result, message: result.alreadyProcessed ? "Phần thưởng trận đấu đã được ghi nhận." : "Đã nhận phần thưởng trận đấu." }
            : result;
    };

    InventoryService.prototype.consumeCaptureBall = async function (captureId) {
        if (typeof captureId !== "string" || !captureId) {
            return { success: false, message: "Không xác định được lượt ném Poké Ball." };
        }
        if (this.getItemQuantity("poke_ball") <= 0) {
            return { success: false, message: "Túi đồ của bạn đã hết Poké Ball." };
        }
        return this._requestMutation("capture-ball", { captureId, action: "consume" }, "capture-consume:" + captureId);
    };

    InventoryService.prototype.refundCaptureBall = async function (captureId) {
        if (typeof captureId !== "string" || !captureId) {
            return { success: false, message: "Không xác định được lượt ném cần hoàn Poké Ball." };
        }
        return this._requestMutation("capture-ball", { captureId, action: "refund" }, "capture-refund:" + captureId);
    };

    InventoryService.prototype._newOperationId = function () {
        if (global.crypto && typeof global.crypto.randomUUID === "function") return global.crypto.randomUUID();
        return "op_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
    };

    InventoryService.prototype._operationStorageKey = function (key) {
        return "poke_proto_" + this.userId + "_economy_pending_" + encodeURIComponent(key);
    };

    InventoryService.prototype._getPendingOperationId = function (key) {
        if (this._pendingOperations[key]) return this._pendingOperations[key];
        try {
            if (typeof sessionStorage !== "undefined") {
                this._pendingOperations[key] = sessionStorage.getItem(this._operationStorageKey(key)) || null;
            }
        } catch (error) {
            // In-memory idempotency still works when browser storage is unavailable.
        }
        return this._pendingOperations[key];
    };

    InventoryService.prototype._setPendingOperationId = function (key, operationId) {
        this._pendingOperations[key] = operationId;
        try {
            if (typeof sessionStorage !== "undefined") sessionStorage.setItem(this._operationStorageKey(key), operationId);
        } catch (error) {
            // The server mutation remains authoritative; storage only helps retries survive a reload.
        }
    };

    InventoryService.prototype._clearPendingOperationId = function (key) {
        delete this._pendingOperations[key];
        try {
            if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(this._operationStorageKey(key));
        } catch (error) {
            // Ignore unavailable browser storage.
        }
    };

    InventoryService.prototype._fetchWithTimeout = async function (url, options) {
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 10000) : null;
        try {
            return await this._fetch(url, { ...(options || {}), credentials: "same-origin", signal: controller ? controller.signal : undefined });
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    };

    InventoryService.prototype._requestMutation = async function (path, payload, operationKey) {
        if (!this.isReady || !this.userId || !this._fetch) {
            return { success: false, message: "Không thể kết nối Inventory với Economy server." };
        }
        const key = operationKey;
        const operationId = this._getPendingOperationId(key) || this._newOperationId();
        const body = { ...payload, operationId };
        let csrfToken = null;
        try {
            const csrfResponse = await this._fetchWithTimeout("/api/auth/csrf-token");
            const csrfPayload = await csrfResponse.json();
            csrfToken = csrfPayload && csrfPayload.data && csrfPayload.data.csrfToken;
            if (!csrfResponse.ok || !csrfToken) {
                const csrfError = new Error("Không lấy được CSRF token.");
                csrfError.status = csrfResponse.status;
                throw csrfError;
            }
            const requestOptions = {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
                body: JSON.stringify(body)
            };
            const post = async () => {
                const response = await this._fetchWithTimeout("/api/economy/" + path, requestOptions);
                const result = await response.json();
                if (!response.ok || !result || result.success !== true || !result.data) {
                    if (path === "buy-item" && result && result.code === "INSUFFICIENT_FUNDS") {
                        return {
                            businessFailure: true,
                            code: result.code,
                            message: result.message || "Bạn không đủ vàng để mua vật phẩm này."
                        };
                    }
                    const error = new Error(result && result.message ? result.message : "Economy server từ chối thao tác.");
                    error.status = response.status;
                    error.code = result && result.code;
                    if (response.ok && (!result || result.success !== true || !result.data)) {
                        error.code = "INVALID_ECONOMY_RESPONSE";
                    }
                    throw error;
                }
                return result.data;
            };
            let result;
            try {
                result = await post();
            } catch (firstError) {
                // Retry only ambiguous transport/server failures, using the same idempotency key.
                if (!csrfToken || (firstError.status && firstError.status < 500)) throw firstError;
                result = await post();
            }
            if (result && result.businessFailure === true) {
                this._clearPendingOperationId(key);
                return {
                    success: false,
                    businessError: true,
                    code: result.code,
                    message: result.message
                };
            }
            if (!this.loadFromSnapshot(result)) throw new Error("Snapshot Economy trả về không hợp lệ.");
            this._clearPendingOperationId(key);
            this.notifyChange();
            return { success: true, snapshot: result, battleReward: result.battleReward || null, alreadyProcessed: result.alreadyProcessed === true };
        } catch (error) {
            // Keep the same operation ID so a user retry after a lost response is idempotent.
            this._setPendingOperationId(key, operationId);
            if (!error.status || error.status >= 500 || error.code === "INVALID_ECONOMY_RESPONSE") {
                console.error("[InventoryService] Economy mutation failed:", error);
            }
            try {
                const refreshResponse = await this._fetchWithTimeout("/api/economy");
                const refreshResult = await refreshResponse.json();
                if (refreshResponse.ok && refreshResult && refreshResult.success && refreshResult.data && this.loadFromSnapshot(refreshResult.data)) {
                    this.notifyChange();
                }
            } catch (refreshError) {
                // Preserve the last server-confirmed in-memory state if reconciliation also fails.
            }
            return { success: false, code: error.code || null, message: error.message || "Không thể cập nhật Inventory với máy chủ." };
        }
    };

    InventoryService.prototype.useItem = async function (itemId, targetContext) {
        if (this._isBusy) return { success: false, message: "Đang xử lý vật phẩm, vui lòng thử lại sau giây lát." };
        const item = Catalog.getItem(itemId);
        if (!this.isReady) return { success: false, message: "Inventory chưa được tải từ máy chủ." };
        if (!item) return { success: false, message: "Vật phẩm không tồn tại trong từ điển hệ thống." };
        if (this.getItemQuantity(itemId) <= 0) return { success: false, message: "Số lượng vật phẩm trong túi đã hết." };
        if (!item.isUsable) return { success: false, message: item.unusableReason || "Vật phẩm này không thể sử dụng ở màn hình hiện tại." };
        if (!EffectRegistry || typeof EffectRegistry.execute !== "function") {
            return { success: false, message: "Không tìm thấy hệ thống xử lý hiệu ứng vật phẩm." };
        }

        // OPEN_MAP is a local, non-consuming effect and never mutates Economy.
        if (item.effect && item.effect.type === "OPEN_MAP") {
            const mapResult = await EffectRegistry.execute(item.effect, item, targetContext);
            return { ...mapResult, success: mapResult.success, remainingQuantity: this.getItemQuantity(itemId) };
        }
        if (item.effect && item.effect.type === "HEAL_HP" && targetContext &&
            typeof targetContext.canHealPokemon === "function" && !targetContext.canHealPokemon(item.effect.amount)) {
            return { success: false, message: "Pokémon đang xuất chiến không thể hồi HP bằng vật phẩm này." };
        }

        this._isBusy = true;
        try {
            let effectResult = null;
            if (!item.effect || item.effect.type !== "HEAL_HP") {
                effectResult = await EffectRegistry.execute(item.effect, item, targetContext);
                if (!effectResult.success) return { success: false, message: effectResult.message || "Không thể áp dụng hiệu ứng vật phẩm." };
            }
            const mutation = await this._requestMutation("use-item", { itemId }, "use-item:" + itemId);
            if (!mutation.success) return mutation;
            if (!effectResult) effectResult = await EffectRegistry.execute(item.effect, item, targetContext);
            if (!effectResult.success) return { success: false, message: effectResult.message || "Hiệu ứng vật phẩm phía game thất bại sau khi server xác nhận tiêu thụ." };
            return {
                success: true,
                message: effectResult.message || `Đã sử dụng ${item.name}.`,
                remainingQuantity: this.getItemQuantity(itemId),
                alreadyProcessed: mutation.alreadyProcessed
            };
        } catch (error) {
            return { success: false, message: error && error.message ? error.message : "Không thể áp dụng hiệu ứng vật phẩm." };
        } finally {
            this._isBusy = false;
        }
    };

    InventoryService.prototype.equipItem = async function (slot, itemId) {
        if (!Object.prototype.hasOwnProperty.call(this.equipment, slot)) return { success: false, message: `Vị trí trang bị '${slot}' không hợp lệ.` };
        const item = Catalog.getItem(itemId);
        if (!item || !item.isEquipment) return { success: false, message: "Vật phẩm này không thể dùng làm trang bị." };
        if (item.equipmentSlot !== slot) {
            const slotName = Catalog.EQUIPMENT_SLOT_NAMES[item.equipmentSlot] || item.equipmentSlot;
            return { success: false, message: `Không thể trang bị vào ô này. Vật phẩm này thuộc slot: ${slotName}.` };
        }
        if (this.getItemQuantity(itemId) <= 0) return { success: false, message: "Bạn không sở hữu vật phẩm này trong túi." };
        const result = await this._requestMutation("equip", { slot, itemId }, "equip:" + slot + ":" + itemId);
        return result.success ? { success: true, message: `Đã trang bị ${item.name} vào ô ${Catalog.EQUIPMENT_SLOT_NAMES[slot]}.` } : result;
    };

    InventoryService.prototype.unequipItem = async function (slot) {
        if (!Object.prototype.hasOwnProperty.call(this.equipment, slot)) return { success: false, message: `Vị trí trang bị '${slot}' không hợp lệ.` };
        const itemId = this.equipment[slot];
        if (!itemId) return { success: false, message: "Vị trí này hiện đang trống." };
        const item = Catalog.getItem(itemId);
        const result = await this._requestMutation("unequip", { slot }, "unequip:" + slot);
        return result.success ? { success: true, message: `Đã tháo ${item ? item.name : "trang bị"} khỏi ô ${Catalog.EQUIPMENT_SLOT_NAMES[slot]}.` } : result;
    };

    if (typeof module !== "undefined" && module.exports) module.exports = InventoryService;
    else global.PokeInventoryService = InventoryService;
})(typeof window !== "undefined" ? window : global);
