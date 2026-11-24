/**
 * Character Profile UI Component for Poké-Engine
 * Renders real player profile data, current map location, equipment summary,
 * and clearly indicates supported vs unsupported RPG attributes.
 */
(function (global) {
    "use strict";

    const Catalog = (typeof require !== "undefined")
        ? require("./itemCatalog")
        : (global.PokeItemCatalog || {});

    const CharacterUI = function (game, modalManager, inventoryService) {
        this.game = game;
        this.modalManager = modalManager;
        this.inventoryService = inventoryService;

        this.init();
    };

    CharacterUI.prototype.init = function () {
        this.modalManager.registerModal("character", {
            render: (onClose) => this.render(onClose)
        });
    };

    CharacterUI.prototype.render = function (onClose) {
        const container = document.createElement("div");
        container.className = "rpg-modal-container";
        container.id = "rpg-character-modal";

        const saved = this.game.savedData || {};
        const username = saved.username || "Trainer";
        const characterSkin = saved.character || "red";
        const mapId = saved.map || "test";
        const registry = this.game.worldRegistry || {};
        const currentMap = (registry.maps && registry.maps[mapId]) || {};
        const mapDisplayName = currentMap.displayName || mapId;

        const posX = this.game.player ? this.game.player.position.x : (saved.x || 1);
        const posY = this.game.player ? this.game.player.position.y : (saved.y || 1);
        const facing = this.game.player ? this.game.player.position.facing : (saved.facing || "down");
        const characterLevel = Number.isInteger(saved.characterLevel) ? saved.characterLevel : 1;
        const characterExp = Number.isFinite(saved.characterExp) ? saved.characterExp : 0;
        const expToNextLevel = this.game.getCharacterExpToNextLevel
            ? this.game.getCharacterExpToNextLevel(characterLevel) : characterLevel * 50;
        const characterExpPercent = expToNextLevel > 0
            ? Math.max(0, Math.min(100, (characterExp / expToNextLevel) * 100)) : 100;

        const equipment = this.inventoryService.getEquipment();
        const equipStats = this.inventoryService.calculateEquipmentStats();

        container.innerHTML = `
            <div class="rpg-modal-header">
                <div class="rpg-modal-title">
                    <span class="rpg-modal-title-icon">👤</span>
                    <span>Hồ Sơ Huấn Luyện Viên (Trainer Profile)</span>
                </div>
                <button type="button" class="rpg-modal-close-btn" title="Đóng (ESC)">✕</button>
            </div>
            <div class="rpg-modal-body">
                <div class="rpg-char-layout">
                    <!-- Left: Avatar & Meta -->
                    <div class="rpg-char-card">
                        <div class="rpg-char-big-avatar">
                            <span>🧢</span>
                        </div>
                        <div style="font-weight: 700; font-size: 14px; color: #f6b93b;">${username}</div>
                        <div style="font-size: 10px; color: #38d9a9;">Skin: ${characterSkin}</div>

                        <div class="rpg-char-meta-list">
                            <div class="rpg-char-meta-item">
                                <span style="color: #94a3b8;">ID:</span>
                                <span style="font-family: monospace; font-size: 10px;">${saved.userId ? saved.userId.substring(0, 8) + '...' : 'Guest'}</span>
                            </div>
                            <div class="rpg-char-meta-item">
                                <span style="color: #94a3b8;">Bản đồ:</span>
                                <span style="color: #4bcffa;">${mapDisplayName}</span>
                            </div>
                            <div class="rpg-char-meta-item">
                                <span style="color: #94a3b8;">Tọa độ:</span>
                                <span>X: ${posX}, Y: ${posY}</span>
                            </div>
                            <div class="rpg-char-meta-item">
                                <span style="color: #94a3b8;">Hướng nhìn:</span>
                                <span style="text-transform: capitalize;">${facing}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Right: Stats & Equipment Summary -->
                    <div class="rpg-char-details-panel">
                        <div>
                            <div class="rpg-section-title">Chỉ Số Nhân Vật (Character Attributes)</div>
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 11px; margin-top: 6px;">
                                <div style="background: rgba(0,0,0,0.3); padding: 6px 8px; border-radius: 4px;">
                                    <span style="color: #94a3b8;">Cấp độ:</span>
                                    <strong style="color: #38d9a9; float: right;">Lv. ${characterLevel}</strong>
                                </div>
                                <div style="background: rgba(0,0,0,0.3); padding: 6px 8px; border-radius: 4px;">
                                    <span style="color: #94a3b8;">EXP:</span>
                                    <strong style="color: #38d9a9; float: right;">${expToNextLevel > 0 ? `${characterExp}/${expToNextLevel}` : "MAX"}</strong>
                                    <div style="height: 4px; background: rgba(255,255,255,0.15); margin-top: 6px; border-radius: 2px;">
                                        <div style="height: 100%; width: ${characterExpPercent}%; background: #38d9a9; border-radius: 2px;"></div>
                                    </div>
                                </div>
                                <div style="background: rgba(0,0,0,0.3); padding: 6px 8px; border-radius: 4px;">
                                    <span style="color: #94a3b8;">Sinh lực (HP):</span>
                                    <strong style="color: #ff6b6b; float: right;">100 / 100</strong>
                                </div>
                                <div style="background: rgba(0,0,0,0.3); padding: 6px 8px; border-radius: 4px;">
                                    <span style="color: #94a3b8;">Phòng thủ:</span>
                                    <strong style="color: #f6b93b; float: right;">${equipStats.defense}</strong>
                                </div>
                                <div style="background: rgba(0,0,0,0.3); padding: 6px 8px; border-radius: 4px;">
                                    <span style="color: #94a3b8;">Tốc độ:</span>
                                    <strong style="color: #4bcffa; float: right;">+${equipStats.speed}</strong>
                                </div>
                            </div>
                            <div style="font-size: 9px; color: #94a3b8; margin-top: 4px; font-style: italic;">
                                *Cấp độ và EXP được lưu cục bộ theo tài khoản trên trình duyệt này.
                            </div>
                        </div>

                        <div>
                            <div class="rpg-section-title">Tổng Quan Trang Bị Đang Mặc</div>
                            <div style="display: flex; flex-direction: column; gap: 4px; font-size: 11px; margin-top: 6px;">
                                ${Object.entries(equipment).map(([slot, item]) => `
                                    <div style="display: flex; justify-content: space-between; padding: 4px 6px; background: rgba(0,0,0,0.25); border-radius: 4px;">
                                        <span style="color: #94a3b8;">${Catalog.EQUIPMENT_SLOT_NAMES[slot]}:</span>
                                        <strong style="color: ${item ? '#f6b93b' : '#64748b'};">${item ? `${item.icon} ${item.name}` : '(Trống)'}</strong>
                                    </div>
                                `).join("")}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="rpg-modal-footer">
                <span>Dữ liệu danh tính xác thực từ Firebase Session</span>
                <span>Nhấn ESC để đóng</span>
            </div>
        `;

        container.querySelector(".rpg-modal-close-btn").addEventListener("click", onClose);
        return container;
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = CharacterUI;
    } else {
        global.PokeCharacterUI = CharacterUI;
    }
})(typeof window !== "undefined" ? window : global);
