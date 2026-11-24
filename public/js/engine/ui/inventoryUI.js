/**
 * Inventory UI Component for Poké-Engine
 * Renders 4-category inventory, item details, and handles item usage with anti-spam locks.
 */
(function (global) {
    "use strict";

    const Catalog = (typeof require !== "undefined")
        ? require("./itemCatalog")
        : (global.PokeItemCatalog || {});

    const createItemIconElement = function (item, className) {
        if (!item || !item.sprite) {
            const fallback = document.createElement("span");
            fallback.className = className;
            fallback.textContent = item && item.icon ? item.icon : "📦";
            return fallback;
        }

        const image = document.createElement("img");
        image.className = className;
        image.src = item.sprite;
        image.alt = item.name || "";
        image.width = 32;
        image.height = 32;
        image.style.objectFit = "contain";
        image.style.imageRendering = "pixelated";
        image.addEventListener("error", () => {
            const fallback = document.createElement("span");
            fallback.className = className;
            fallback.textContent = item.icon || "📦";
            image.replaceWith(fallback);
        }, { once: true });
        return image;
    };

    const InventoryUI = function (modalManager, inventoryService, hudInstance) {
        this.modalManager = modalManager;
        this.inventoryService = inventoryService;
        this.hud = hudInstance;

        this.selectedCategory = Catalog.CATEGORIES.RECOVERY;
        this.selectedItemId = null;
        this._isUsingItem = false;

        this.init();
    };

    InventoryUI.prototype.init = function () {
        this.modalManager.registerModal("inventory", {
            render: (onClose) => this.render(onClose),
            onClose: () => this.onClose()
        });

        // Listen for data changes to update active inventory UI reactively
        this.inventoryService.onChange(() => {
            if (this.modalManager.activeModal === "inventory") {
                this.refreshUI();
            }
        });
    };

    InventoryUI.prototype.onClose = function () {
        this.selectedItemId = null;
    };

    InventoryUI.prototype.render = function (onClose) {
        const container = document.createElement("div");
        container.className = "rpg-modal-container";
        container.id = "rpg-inventory-modal";

        container.innerHTML = `
            <div class="rpg-modal-header">
                <div class="rpg-modal-title">
                    <span class="rpg-modal-title-icon">🎒</span>
                    <span>Túi Đồ Trainer (Inventory)</span>
                </div>
                <button type="button" id="rpg-btn-open-item-encyclopedia" class="rpg-btn-primary" title="Tra cứu tất cả vật phẩm">📖 Bách khoa vật phẩm</button>
                <button type="button" class="rpg-modal-close-btn" title="Đóng (ESC)">✕</button>
            </div>
            <div class="rpg-modal-body">
                <!-- Categories Tabs -->
                <div class="rpg-tabs">
                    <button type="button" class="rpg-tab-btn ${this.selectedCategory === Catalog.CATEGORIES.RECOVERY ? "active" : ""}" data-cat="${Catalog.CATEGORIES.RECOVERY}">
                        <span>🧪</span>
                        <span>${Catalog.CATEGORY_NAMES[Catalog.CATEGORIES.RECOVERY]}</span>
                    </button>
                    <button type="button" class="rpg-tab-btn ${this.selectedCategory === Catalog.CATEGORIES.POKEBALL ? "active" : ""}" data-cat="${Catalog.CATEGORIES.POKEBALL}">
                        <span>🔴</span>
                        <span>${Catalog.CATEGORY_NAMES[Catalog.CATEGORIES.POKEBALL]}</span>
                    </button>
                    <button type="button" class="rpg-tab-btn ${this.selectedCategory === Catalog.CATEGORIES.KEY_ITEM ? "active" : ""}" data-cat="${Catalog.CATEGORIES.KEY_ITEM}">
                        <span>🗝️</span>
                        <span>${Catalog.CATEGORY_NAMES[Catalog.CATEGORIES.KEY_ITEM]}</span>
                    </button>
                    <button type="button" class="rpg-tab-btn ${this.selectedCategory === Catalog.CATEGORIES.OTHER ? "active" : ""}" data-cat="${Catalog.CATEGORIES.OTHER}">
                        <span>📦</span>
                        <span>${Catalog.CATEGORY_NAMES[Catalog.CATEGORIES.OTHER]}</span>
                    </button>
                </div>

                <!-- Main Inventory Layout -->
                <div class="rpg-inventory-layout">
                    <div class="rpg-items-grid" id="rpg-items-grid"></div>
                    <div class="rpg-item-detail" id="rpg-item-detail"></div>
                </div>
            </div>
            <div class="rpg-modal-footer">
                <span>Nhấn ESC hoặc click [✕] để đóng túi đồ</span>
                <span id="rpg-inventory-total-items" style="color: #4bcffa;">Tổng vật phẩm: 0</span>
            </div>
        `;

        // Bind Close Button
        container.querySelector(".rpg-modal-close-btn").addEventListener("click", onClose);
        const encyclopediaBtn = container.querySelector("#rpg-btn-open-item-encyclopedia");
        if (encyclopediaBtn) {
            encyclopediaBtn.addEventListener("click", () => {
                this.modalManager.openModal("item_encyclopedia");
            });
        }

        // Bind Tab Clicks
        const tabBtns = container.querySelectorAll(".rpg-tab-btn");
        tabBtns.forEach(btn => {
            btn.addEventListener("click", (e) => {
                const cat = btn.getAttribute("data-cat");
                if (cat && cat !== this.selectedCategory) {
                    this.selectedCategory = cat;
                    this.selectedItemId = null;
                    tabBtns.forEach(b => b.classList.remove("active"));
                    btn.classList.add("active");
                    this.renderItemsGrid(container);
                    this.renderItemDetail(container);
                }
            });
        });

        this.renderItemsGrid(container);
        this.renderItemDetail(container);

        return container;
    };

    InventoryUI.prototype.refreshUI = function () {
        const modal = document.getElementById("rpg-inventory-modal");
        if (modal) {
            this.renderItemsGrid(modal);
            this.renderItemDetail(modal);
        }
    };

    InventoryUI.prototype.renderItemsGrid = function (container) {
        const gridEl = container.querySelector("#rpg-items-grid");
        const totalItemsEl = container.querySelector("#rpg-inventory-total-items");
        if (!gridEl) return;

        gridEl.innerHTML = "";
        const items = this.inventoryService.getItems(this.selectedCategory);

        if (totalItemsEl) {
            const allItems = this.inventoryService.getItems();
            totalItemsEl.textContent = `Tổng loại vật phẩm: ${allItems.length}`;
        }

        if (items.length === 0) {
            gridEl.innerHTML = `
                <div class="rpg-empty-state">
                    <span class="rpg-empty-icon">📭</span>
                    <span>Không có vật phẩm nào trong mục này.</span>
                </div>
            `;
            return;
        }

        // Auto select first item if none is selected or current selection is no longer in this category
        if (!this.selectedItemId || !items.find(i => i.id === this.selectedItemId)) {
            this.selectedItemId = items[0].id;
        }

        items.forEach(item => {
            const card = document.createElement("div");
            card.className = `rpg-item-card ${item.id === this.selectedItemId ? "selected" : ""}`;
            card.setAttribute("data-item-id", item.id);

            card.innerHTML = `
                <span class="rpg-item-qty">x${item.quantity}</span>
                <span class="rpg-item-name" title="${item.name}">${item.name}</span>
            `;
            card.insertBefore(createItemIconElement(item, "rpg-item-icon"), card.querySelector(".rpg-item-name"));

            card.addEventListener("click", () => {
                this.selectedItemId = item.id;
                const cards = gridEl.querySelectorAll(".rpg-item-card");
                cards.forEach(c => c.classList.remove("selected"));
                card.classList.add("selected");
                this.renderItemDetail(container);
            });

            gridEl.appendChild(card);
        });
    };

    InventoryUI.prototype.renderItemDetail = function (container) {
        const detailEl = container.querySelector("#rpg-item-detail");
        if (!detailEl) return;

        if (!this.selectedItemId) {
            detailEl.innerHTML = `
                <div class="rpg-empty-state" style="height: 100%;">
                    <span>Chọn một vật phẩm để xem chi tiết.</span>
                </div>
            `;
            return;
        }

        const itemDef = Catalog.getItem(this.selectedItemId);
        const qty = this.inventoryService.getItemQuantity(this.selectedItemId);

        if (!itemDef || qty <= 0) {
            detailEl.innerHTML = `
                <div class="rpg-empty-state" style="height: 100%;">
                    <span>Vật phẩm không khả dụng.</span>
                </div>
            `;
            return;
        }

        const isUsable = itemDef.isUsable === true;
        const categoryName = Catalog.CATEGORY_NAMES[itemDef.category] || itemDef.category;
        const game = this.hud && this.hud.game;
        const partyService = game && game.pokemonPartyService;
        const activePokemon = partyService && typeof partyService.getActivePokemon === "function"
            ? partyService.getActivePokemon()
            : null;
        const targetsPokemonHp = itemDef.effect && itemDef.effect.type === "HEAL_HP";

        detailEl.innerHTML = `
            <div>
                <div class="rpg-detail-header">
                    <span class="rpg-detail-icon"></span>
                    <div>
                        <div class="rpg-detail-title">${itemDef.name}</div>
                        <div class="rpg-detail-category">${categoryName}</div>
                    </div>
                </div>
                <div class="rpg-detail-meta">
                    <strong>Số lượng sở hữu:</strong> x${qty}
                </div>
                <div class="rpg-detail-desc">${itemDef.description}</div>
                ${targetsPokemonHp ? `
                    <div class="rpg-detail-meta" style="margin-top: 8px;">
                        <strong>Pokémon mục tiêu:</strong>
                        ${activePokemon
                            ? `${activePokemon.name} — HP ${activePokemon.currentHp}/${activePokemon.maxHp}`
                            : "Không có Pokémon đủ điều kiện đang xuất chiến"}
                    </div>
                ` : ""}
                ${!isUsable && itemDef.unusableReason ? `
                    <div style="font-size: 10px; color: #ff6b6b; margin-bottom: 8px;">
                        ⚠️ ${itemDef.unusableReason}
                    </div>
                ` : ""}
            </div>
            <div>
                ${itemDef.isEquipment ? `
                    <button type="button" id="rpg-btn-go-equipment" class="rpg-btn-primary" style="width: 100%; margin-bottom: 6px;">
                        Xem trong Trang bị ⚔️
                    </button>
                ` : ""}
                <button type="button" id="rpg-btn-use-item" class="rpg-btn-primary" style="width: 100%;" ${!isUsable ? "disabled" : ""}>
                    ${isUsable ? "Sử Dụng" : "Không Thể Dùng"}
                </button>
            </div>
        `;

        detailEl.querySelector(".rpg-detail-icon").appendChild(createItemIconElement(itemDef, "rpg-detail-icon-image"));

        // Switch to equipment modal if clicked
        const goEquipBtn = detailEl.querySelector("#rpg-btn-go-equipment");
        if (goEquipBtn) {
            goEquipBtn.addEventListener("click", () => {
                this.modalManager.openModal("equipment");
            });
        }

        // Handle Item Usage with Concurrency Lock (Anti-spam / Anti-double-click)
        const useBtn = detailEl.querySelector("#rpg-btn-use-item");
        if (useBtn && isUsable) {
            useBtn.addEventListener("click", async () => {
                if (this._isUsingItem) return;
                this._isUsingItem = true;
                useBtn.disabled = true;

                const targetContext = {
                    canHealPokemon: () => {
                        const game = this.hud && this.hud.game;
                        const partyService = game && game.pokemonPartyService;
                        const pokemon = partyService && partyService.getActivePokemon();
                        return Boolean(pokemon && (game.state === "NORMAL" || game.state === "MENU") &&
                            pokemon.currentHp > 0 && pokemon.currentHp < pokemon.maxHp);
                    },
                    healPokemon: (amount) => {
                        const game = this.hud && this.hud.game;
                        const partyService = game && game.pokemonPartyService;
                        if (!partyService || typeof partyService.healActivePokemon !== "function") {
                            return {
                                success: false,
                                reason: "PARTY_SERVICE_UNAVAILABLE",
                                message: "Không tìm thấy hệ thống Pokémon Party để hồi phục."
                            };
                        }
                        return partyService.healActivePokemon(amount);
                    },
                    openMap: () => {
                        this.modalManager.openModal("map");
                    }
                };

                const result = await this.inventoryService.useItem(this.selectedItemId, targetContext);

                if (result.success) {
                    this.modalManager.showToast(result.message);
                    this.refreshUI();
                } else {
                    this.modalManager.showToast(result.message, 3000);
                }

                // Small debounce to protect against rapid clicking
                setTimeout(() => {
                    this._isUsingItem = false;
                    this.refreshUI();
                }, 300);
            });
        }
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = InventoryUI;
    } else {
        global.PokeInventoryUI = InventoryUI;
    }
})(typeof window !== "undefined" ? window : global);
