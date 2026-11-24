/**
 * Equipment UI Component for Poké-Engine
 * Manages 4-slot RPG equipment interface, slot validation, equip/unequip,
 * and stat comparison preview.
 */
(function (global) {
    "use strict";

    const Catalog = (typeof require !== "undefined")
        ? require("./itemCatalog")
        : (global.PokeItemCatalog || {});

    const EquipmentUI = function (modalManager, inventoryService) {
        this.modalManager = modalManager;
        this.inventoryService = inventoryService;

        this.selectedSlot = Catalog.EQUIPMENT_SLOTS.ARMOR;

        this.init();
    };

    EquipmentUI.prototype.init = function () {
        this.modalManager.registerModal("equipment", {
            render: (onClose) => this.render(onClose),
            onClose: () => this.onClose()
        });

        this.inventoryService.onChange(() => {
            if (this.modalManager.activeModal === "equipment") {
                this.refreshUI();
            }
        });
    };

    EquipmentUI.prototype.onClose = function () {
        this.selectedSlot = Catalog.EQUIPMENT_SLOTS.ARMOR;
    };

    EquipmentUI.prototype.render = function (onClose) {
        const container = document.createElement("div");
        container.className = "rpg-modal-container";
        container.id = "rpg-equipment-modal";

        container.innerHTML = `
            <div class="rpg-modal-header">
                <div class="rpg-modal-title">
                    <span class="rpg-modal-title-icon">⚔️</span>
                    <span>Trang Bị Nhân Vật (Equipment System)</span>
                </div>
                <button type="button" class="rpg-modal-close-btn" title="Đóng (ESC)">✕</button>
            </div>
            <div class="rpg-modal-body">
                <div class="rpg-equip-layout">
                    <!-- Left: 4 Equipment Slots -->
                    <div class="rpg-slots-list" id="rpg-slots-list"></div>

                    <!-- Right: Slot Management, Available Items & Stat Comparison -->
                    <div class="rpg-equip-panel" id="rpg-equip-panel"></div>
                </div>
            </div>
            <div class="rpg-modal-footer">
                <span>Tính năng mở rộng RPG — Không thay đổi cơ chế va chạm gốc</span>
                <span style="color: #4bcffa;">4 Vị Trí Trang Bị</span>
            </div>
        `;

        container.querySelector(".rpg-modal-close-btn").addEventListener("click", onClose);

        this.renderSlotsList(container);
        this.renderEquipPanel(container);

        return container;
    };

    EquipmentUI.prototype.refreshUI = function () {
        const modal = document.getElementById("rpg-equipment-modal");
        if (modal) {
            this.renderSlotsList(modal);
            this.renderEquipPanel(modal);
        }
    };

    EquipmentUI.prototype.renderSlotsList = function (container) {
        const listEl = container.querySelector("#rpg-slots-list");
        if (!listEl) return;

        listEl.innerHTML = "";
        const equipment = this.inventoryService.getEquipment();

        const slotIcons = {
            [Catalog.EQUIPMENT_SLOTS.ARMOR]: "🥋",
            [Catalog.EQUIPMENT_SLOTS.SHOES]: "👟",
            [Catalog.EQUIPMENT_SLOTS.ACCESSORY]: "📿",
            [Catalog.EQUIPMENT_SLOTS.HELD_ITEM]: "🥚"
        };

        for (const [slot, itemDef] of Object.entries(equipment)) {
            const slotName = Catalog.EQUIPMENT_SLOT_NAMES[slot] || slot;
            const card = document.createElement("div");
            card.className = `rpg-slot-card ${slot === this.selectedSlot ? "active" : ""}`;
            card.setAttribute("data-slot", slot);

            card.innerHTML = `
                <div class="rpg-slot-icon">
                    <span>${itemDef ? (itemDef.icon || "⚔️") : (slotIcons[slot] || "❔")}</span>
                </div>
                <div class="rpg-slot-info">
                    <div class="rpg-slot-label">${slotName}</div>
                    <div class="rpg-slot-item-name ${!itemDef ? "empty" : ""}">
                        ${itemDef ? itemDef.name : "(Trống - Chưa trang bị)"}
                    </div>
                </div>
            `;

            card.addEventListener("click", () => {
                this.selectedSlot = slot;
                const cards = listEl.querySelectorAll(".rpg-slot-card");
                cards.forEach(c => c.classList.remove("active"));
                card.classList.add("active");
                this.renderEquipPanel(container);
            });

            listEl.appendChild(card);
        }
    };

    EquipmentUI.prototype.renderEquipPanel = function (container) {
        const panelEl = container.querySelector("#rpg-equip-panel");
        if (!panelEl) return;

        panelEl.innerHTML = "";
        const slot = this.selectedSlot;
        const slotName = Catalog.EQUIPMENT_SLOT_NAMES[slot] || slot;
        const currentEquip = this.inventoryService.getEquipment()[slot];
        const stats = this.inventoryService.calculateEquipmentStats();

        // 1. Stats Summary Panel
        const statsBox = document.createElement("div");
        statsBox.className = "rpg-equip-stats-preview";
        statsBox.innerHTML = `
            <div style="font-weight: 700; color: #f6b93b; font-size: 11px; margin-bottom: 6px;">
                Tổng Chỉ Số Từ Trang Bị (Equipment Stats)
            </div>
            <div class="rpg-stat-row">
                <span>Phòng thủ (Defense):</span>
                <span class="rpg-stat-val-bonus">+${stats.defense}</span>
            </div>
            <div class="rpg-stat-row">
                <span>Tốc độ (Speed bonus):</span>
                <span class="rpg-stat-val-bonus">+${stats.speed}</span>
            </div>
            <div class="rpg-stat-row">
                <span>HP mở rộng (Max HP):</span>
                <span class="rpg-stat-val-bonus">+${stats.maxHp}</span>
            </div>
            <div class="rpg-stat-row">
                <span>May mắn (Luck):</span>
                <span class="rpg-stat-val-bonus">+${stats.luck}</span>
            </div>
            <div style="font-size: 9px; color: #94a3b8; margin-top: 4px; font-style: italic;">
                *Lưu ý: Tốc độ di chuyển thực tế trên bản đồ hiện đang cố định 90ms/tile theo chuẩn engine cũ.
            </div>
        `;
        panelEl.appendChild(statsBox);

        // 2. Currently Equipped Item in this Slot
        const currentBox = document.createElement("div");
        currentBox.style.marginBottom = "12px";

        if (currentEquip) {
            currentBox.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.25); padding: 8px 10px; border-radius: 6px;">
                    <div>
                        <div style="font-size: 10px; color: #94a3b8;">Đang trang bị ở ô ${slotName}:</div>
                        <div style="font-weight: 700; font-size: 13px; color: #4bcffa;">${currentEquip.name}</div>
                    </div>
                    <button type="button" id="rpg-btn-unequip" class="rpg-btn-primary" style="background: #e55039; border-color: #ff4757; padding: 4px 10px; font-size: 11px;">
                        Tháo Đồ
                    </button>
                </div>
            `;
            const unequipBtn = currentBox.querySelector("#rpg-btn-unequip");
            if (unequipBtn) {
                unequipBtn.addEventListener("click", async () => {
                    if (unequipBtn.disabled) return;
                    unequipBtn.disabled = true;
                    const result = await this.inventoryService.unequipItem(slot);
                    this.modalManager.showToast(result.message);
                    if (!result.success) unequipBtn.disabled = false;
                });
            }
        } else {
            currentBox.innerHTML = `
                <div style="font-size: 11px; color: #94a3b8; padding: 6px 0;">
                    Vị trí <strong>${slotName}</strong> hiện chưa trang bị vật phẩm nào.
                </div>
            `;
        }
        panelEl.appendChild(currentBox);

        // 3. Available Items in Inventory for this Slot
        const availableItems = this.inventoryService.getItems().filter(item => {
            return item.isEquipment && item.equipmentSlot === slot;
        });

        const availableBox = document.createElement("div");
        availableBox.innerHTML = `
            <div class="rpg-section-title" style="margin-bottom: 8px;">
                Vật phẩm tương thích trong túi (${availableItems.length})
            </div>
        `;

        if (availableItems.length === 0) {
            availableBox.innerHTML += `
                <div class="rpg-empty-state" style="padding: 16px 0;">
                    <span>Không có trang bị nào cho ô này trong túi đồ.</span>
                </div>
            `;
        } else {
            const list = document.createElement("div");
            list.style.display = "flex";
            list.style.flexDirection = "column";
            list.style.gap = "6px";
            list.style.maxHeight = "150px";
            list.style.overflowY = "auto";

            availableItems.forEach(item => {
                const isThisEquipped = this.inventoryService.isEquipped(item.id);
                const itemRow = document.createElement("div");
                itemRow.style.display = "flex";
                itemRow.style.justifyContent = "space-between";
                itemRow.style.alignItems = "center";
                itemRow.style.padding = "6px 8px";
                itemRow.style.background = "rgba(0,0,0,0.3)";
                itemRow.style.borderRadius = "4px";

                itemRow.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 18px;">${item.icon || "⚔️"}</span>
                        <div>
                            <div style="font-weight: 600; font-size: 11px;">${item.name}</div>
                            <div style="font-size: 9px; color: #94a3b8;">${item.description}</div>
                        </div>
                    </div>
                    <button type="button" class="rpg-btn-primary" style="padding: 3px 8px; font-size: 10px;" ${isThisEquipped ? "disabled" : ""}>
                        ${isThisEquipped ? "Đang Mặc" : "Trang Bị"}
                    </button>
                `;

                const btn = itemRow.querySelector("button");
                if (btn && !isThisEquipped) {
                    btn.addEventListener("click", async () => {
                        if (btn.disabled) return;
                        btn.disabled = true;
                        const result = await this.inventoryService.equipItem(slot, item.id);
                        this.modalManager.showToast(result.message);
                        if (!result.success) btn.disabled = false;
                    });
                }

                list.appendChild(itemRow);
            });
            availableBox.appendChild(list);
        }

        panelEl.appendChild(availableBox);
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = EquipmentUI;
    } else {
        global.PokeEquipmentUI = EquipmentUI;
    }
})(typeof window !== "undefined" ? window : global);
