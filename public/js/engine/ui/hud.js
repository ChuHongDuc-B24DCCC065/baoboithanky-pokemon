/**
 * Modern RPG HUD Component (Toolbar, Player Status Bar, Map Modal & Settings Modal)
 * Integrates into Poké-Engine viewport.
 */
(function (global) {
    "use strict";

    const ModernHUD = function (game, modalManager, inventoryService) {
        this.game = game;
        this.modalManager = modalManager;
        this.inventoryService = inventoryService;

        // Prototype player HP (reactive to healing items in inventory)
        this.maxHp = 100;
        this.currentHp = 100;
        this._removeInventoryListener = null;

        this.init();
        this.bindInventoryBalance();
    };

    ModernHUD.prototype.init = function () {
        this.ensureRoot();
        this.renderStatusBar();
        this.renderBottomToolbar();
        this.registerMapModal();
        this.registerSettingsModal();
    };

    ModernHUD.prototype.ensureRoot = function () {
        let root = document.getElementById("modern-hud-root");
        if (!root) {
            root = document.createElement("div");
            root.id = "modern-hud-root";
            const gameContainer = document.getElementById("game");
            if (gameContainer) {
                gameContainer.appendChild(root);
            } else {
                document.body.appendChild(root);
            }
        }
        this.$root = root;
    };

    // Heal HP method called by inventory service
    ModernHUD.prototype.healHp = function (amount) {
        const prev = this.currentHp;
        this.currentHp = Math.min(this.maxHp, this.currentHp + amount);
        this.updateHpDisplay();
        return this.currentHp - prev;
    };

    ModernHUD.prototype.updateHpDisplay = function () {
        const hpFill = document.getElementById("rpg-hp-fill");
        const hpText = document.getElementById("rpg-hp-text");
        if (hpFill) {
            const pct = Math.max(0, Math.min(100, (this.currentHp / this.maxHp) * 100));
            hpFill.style.width = pct + "%";
        }
        if (hpText) {
            hpText.textContent = `${this.currentHp}/${this.maxHp}`;
        }
    };

    /**
     * Top-Left Player Status Panel
     */
    ModernHUD.prototype.renderStatusBar = function () {
        const username = (this.game.savedData && this.game.savedData.username)
            ? this.game.savedData.username
            : "Trainer";
        const characterSkin = (this.game.savedData && this.game.savedData.character)
            ? this.game.savedData.character
            : "red";
        const characterLevel = this.game.savedData && Number.isInteger(this.game.savedData.characterLevel)
            ? this.game.savedData.characterLevel : 1;
        const characterExp = this.game.savedData && Number.isFinite(this.game.savedData.characterExp)
            ? this.game.savedData.characterExp : 0;
        const expToNextLevel = this.game.getCharacterExpToNextLevel
            ? this.game.getCharacterExpToNextLevel(characterLevel) : characterLevel * 50;
        const characterExpPercent = expToNextLevel > 0
            ? Math.max(0, Math.min(100, (characterExp / expToNextLevel) * 100)) : 100;

        const panel = document.createElement("div");
        panel.className = "rpg-status-panel";
        panel.id = "rpg-status-panel";

        panel.innerHTML = `
            <div class="rpg-avatar-box" title="Nhân vật: ${characterSkin}">
                <span>🧢</span>
            </div>
            <div class="rpg-status-info">
                <div class="rpg-status-header">
                    <span class="rpg-player-name" id="rpg-status-username">${username}</span>
                    <span class="rpg-player-level" id="rpg-player-level">Lv. ${characterLevel}</span>
                </div>
                <div class="rpg-bar-container">
                    <span class="rpg-bar-label">HP</span>
                    <div class="rpg-bar-track">
                        <div id="rpg-hp-fill" class="rpg-bar-fill hp-bar" style="width: 100%;"></div>
                    </div>
                    <span id="rpg-hp-text" class="rpg-bar-text">100/100</span>
                </div>
                <div class="rpg-bar-container">
                    <span class="rpg-bar-label">EXP</span>
                    <div class="rpg-bar-track">
                        <div id="rpg-player-exp-fill" class="rpg-bar-fill exp-bar" style="width: ${characterExpPercent}%;"></div>
                    </div>
                    <span id="rpg-player-exp-text" class="rpg-bar-text">${expToNextLevel > 0 ? `${characterExp}/${expToNextLevel}` : "MAX"}</span>
                </div>
                <div class="rpg-currency-badge" title="Số dư hiện tại">
                    <span class="currency-icon">🪙</span>
                    <span id="rpg-currency-balance">₽ 0</span>
                </div>
            </div>
        `;

        // Click on status panel opens Character Profile
        panel.addEventListener("click", () => {
            this.modalManager.openModal("character");
        });

        this.$root.appendChild(panel);
    };

    ModernHUD.prototype.updateBalanceDisplay = function () {
        const balanceEl = document.getElementById("rpg-currency-balance");
        if (!balanceEl) return;
        const balance = this.inventoryService && Number.isSafeInteger(this.inventoryService.balance) && this.inventoryService.balance >= 0
            ? this.inventoryService.balance
            : 0;
        balanceEl.textContent = "₽ " + balance.toLocaleString("vi-VN");
    };

    ModernHUD.prototype.bindInventoryBalance = function () {
        if (this._removeInventoryListener) this._removeInventoryListener();
        this.updateBalanceDisplay();
        if (this.inventoryService && typeof this.inventoryService.onChange === "function") {
            this._removeInventoryListener = this.inventoryService.onChange(() => this.updateBalanceDisplay());
        }
    };

    ModernHUD.prototype.updateCharacterProgress = function () {
        const saved = this.game && this.game.savedData ? this.game.savedData : {};
        const level = Number.isInteger(saved.characterLevel) ? saved.characterLevel : 1;
        const exp = Number.isFinite(saved.characterExp) ? saved.characterExp : 0;
        const required = this.game && typeof this.game.getCharacterExpToNextLevel === "function"
            ? this.game.getCharacterExpToNextLevel(level) : level * 50;
        const percent = required > 0 ? Math.max(0, Math.min(100, (exp / required) * 100)) : 100;
        const levelEl = document.getElementById("rpg-player-level");
        const fillEl = document.getElementById("rpg-player-exp-fill");
        const textEl = document.getElementById("rpg-player-exp-text");
        if (levelEl) levelEl.textContent = "Lv. " + level;
        if (fillEl) fillEl.style.width = percent + "%";
        if (textEl) textEl.textContent = required > 0 ? exp + "/" + required : "MAX";
    };

    /**
     * Fixed Bottom Toolbar (6 Buttons)
     */
    ModernHUD.prototype.renderBottomToolbar = function () {
        const toolbar = document.createElement("div");
        toolbar.className = "rpg-bottom-toolbar";
        toolbar.id = "rpg-bottom-toolbar";

        const buttons = [
            { id: "character", icon: "👤", label: "Nhân vật" },
            { id: "inventory", icon: "🎒", label: "Túi đồ" },
            { id: "shop", icon: "🛒", label: "Shop" },
            { id: "equipment", icon: "⚔️", label: "Trang bị" },
            { id: "pokemon",   icon: "⚡", label: "Pokémon" },
            { id: "map",       icon: "🗺️", label: "Bản đồ" },
            { id: "settings",  icon: "⚙️", label: "Cài đặt" }
        ];

        buttons.forEach((btnDef) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "rpg-toolbar-btn";
            btn.setAttribute("data-modal-target", btnDef.id);
            btn.title = `Mở ${btnDef.label} (Click hoặc chọn từ thanh)`;

            btn.innerHTML = `
                <span class="btn-icon">${btnDef.icon}</span>
                <span class="btn-label">${btnDef.label}</span>
            `;

            btn.addEventListener("click", (e) => {
                e.preventDefault();
                this.modalManager.openModal(btnDef.id);
            });

            toolbar.appendChild(btn);
        });

        this.$root.appendChild(toolbar);
    };

    /**
     * Register Real Map Modal
     * Displays real data from World Registry and current player position
     */
    ModernHUD.prototype.registerMapModal = function () {
        this.modalManager.registerModal("map", {
            render: (onClose) => {
                const mapId = (this.game.savedData && this.game.savedData.map) || "test";
                const registry = this.game.worldRegistry || {};
                const maps = registry.maps || {};
                const currentMap = maps[mapId] || {};
                const displayName = currentMap.displayName || mapId;
                const transitions = currentMap.transitions || [];

                const container = document.createElement("div");
                container.className = "rpg-modal-container";

                let exitsHtml = "";
                if (transitions.length > 0) {
                    exitsHtml = transitions.map(t => `
                        <div class="rpg-portal-item">
                            <div>
                                <strong style="color: #4bcffa;">${t.displayName || t.id}</strong>
                                <span style="color: #94a3b8; font-size: 10px; margin-left: 6px;">
                                    (Tọa độ cổng: ${t.tile ? `${t.tile.x}, ${t.tile.y}` : "N/A"})
                                </span>
                            </div>
                            <span style="color: #f6b93b; font-size: 10px;">Bản đồ: ${t.target ? t.target.mapId : ""}</span>
                        </div>
                    `).join("");
                } else {
                    exitsHtml = `<div class="rpg-empty-state"><p>Bản đồ hiện tại không có cổng dịch chuyển nào.</p></div>`;
                }

                container.innerHTML = `
                    <div class="rpg-modal-header">
                        <div class="rpg-modal-title">
                            <span class="rpg-modal-title-icon">🗺️</span>
                            <span>Bản Đồ Du Hành — ${displayName}</span>
                        </div>
                        <button type="button" class="rpg-modal-close-btn" title="Đóng (ESC)">✕</button>
                    </div>
                    <div class="rpg-modal-body">
                        <div class="rpg-map-info-card">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                                <span><strong>Khu vực hiện tại:</strong> ${displayName}</span>
                                <span style="color: #4bcffa; font-family: monospace;">ID: ${mapId}</span>
                            </div>
                            <div style="font-size: 11px; color: #94a3b8;">
                                Vị trí Trainer: Tile (X: ${this.game.player ? this.game.player.position.x : "?"}, Y: ${this.game.player ? this.game.player.position.y : "?"})
                            </div>
                        </div>

                        <div class="rpg-section-title" style="margin-bottom: 8px;">Các Cổng Kết Nối & Tuyến Đường (World Portals)</div>
                        <div class="rpg-portals-list">
                            ${exitsHtml}
                        </div>
                    </div>
                    <div class="rpg-modal-footer">
                        <span>Dữ liệu thực từ World Registry</span>
                        <span>Nhấn [Space] khi đứng trước Cổng để di chuyển</span>
                    </div>
                `;

                container.querySelector(".rpg-modal-close-btn").addEventListener("click", onClose);
                return container;
            }
        });
    };

    /**
     * Register Real Settings Modal
     * Contains functional options: Viewport Scale, Portal Destination Hint, Controls, Logout
     */
    ModernHUD.prototype.registerSettingsModal = function () {
        this.modalManager.registerModal("settings", {
            render: (onClose) => {
                const container = document.createElement("div");
                container.className = "rpg-modal-container";

                const currentScale = getComputedStyle(document.documentElement).getPropertyValue("--game-scale").trim() || "2";

                container.innerHTML = `
                    <div class="rpg-modal-header">
                        <div class="rpg-modal-title">
                            <span class="rpg-modal-title-icon">⚙️</span>
                            <span>Cài Đặt Trò Chơi (Settings)</span>
                        </div>
                        <button type="button" class="rpg-modal-close-btn" title="Đóng (ESC)">✕</button>
                    </div>
                    <div class="rpg-modal-body">
                        <div class="rpg-settings-group">
                            <div class="rpg-section-title">Hiển Thị & Giao Diện</div>

                            <div class="rpg-setting-row">
                                <div>
                                    <div class="rpg-setting-label">Tỷ lệ phóng to màn hình (Game Scale)</div>
                                    <div class="rpg-setting-desc">Điều chỉnh độ phóng đại Pixel-Perfect của cửa sổ game</div>
                                </div>
                                <select id="rpg-setting-scale" style="background: #172a45; color: #fff; border: 1px solid #4bcffa; border-radius: 4px; padding: 4px 8px; font-size: 11px;">
                                    <option value="auto">Tự động (Theo cửa sổ)</option>
                                    <option value="1" ${currentScale === "1" ? "selected" : ""}>1x (272 x 240)</option>
                                    <option value="2" ${currentScale === "2" ? "selected" : ""}>2x (544 x 480)</option>
                                    <option value="3" ${currentScale === "3" ? "selected" : ""}>3x (816 x 720)</option>
                                    <option value="4" ${currentScale === "4" ? "selected" : ""}>4x (1088 x 960)</option>
                                </select>
                            </div>

                            <div class="rpg-setting-row">
                                <div>
                                    <div class="rpg-setting-label">Gợi ý điểm đến cổng (Portal Hint)</div>
                                    <div class="rpg-setting-desc">Hiển thị hộp thoại gợi ý khi đứng cạnh hoặc trên cổng chuyển bản đồ</div>
                                </div>
                                <label class="rpg-switch">
                                    <input type="checkbox" id="rpg-setting-portal-hint" checked>
                                    <span class="rpg-slider"></span>
                                </label>
                            </div>
                        </div>

                        <div class="rpg-settings-group">
                            <div class="rpg-section-title">Hướng Dẫn Phím Điều Khiển</div>
                            <div style="font-size: 11px; line-height: 1.6; color: #cbd5e1; background: rgba(0,0,0,0.3); padding: 8px 12px; border-radius: 4px;">
                                <div>• <strong>W, A, S, D</strong> hoặc <strong>Phím Mũi Tên</strong>: Di chuyển nhân vật 4 hướng.</div>
                                <div>• <strong>Phím Space</strong> hoặc <strong>Enter</strong>: Tương tác với NPC đối diện / Kích hoạt Cổng chuyển map.</div>
                                <div>• <strong>Phím ESC</strong>: Đóng ngay menu hoặc hộp thoại đang mở.</div>
                            </div>
                        </div>

                        <div class="rpg-settings-group">
                            <div class="rpg-section-title">Tài Khoản & Phiên Làm Việc</div>
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0;">
                                <div>
                                    <div class="rpg-setting-label">Đăng xuất khỏi Poké-Engine</div>
                                    <div class="rpg-setting-desc">Lưu tiến trình vị trí hiện tại và ngắt kết nối an toàn</div>
                                </div>
                                <button type="button" id="rpg-btn-settings-logout" class="rpg-btn-primary" style="background: #e55039; border-color: #ff4757;">Đăng Xuất</button>
                            </div>
                        </div>
                    </div>
                    <div class="rpg-modal-footer">
                        <span>Poké-Engine v1.0.0</span>
                        <span>Nhấn ESC để đóng</span>
                    </div>
                `;

                // Handle Scale Change
                const scaleSelect = container.querySelector("#rpg-setting-scale");
                if (scaleSelect) {
                    scaleSelect.addEventListener("change", (e) => {
                        const val = e.target.value;
                        if (val === "auto") {
                            // Re-trigger viewport manager
                            const BASE_WIDTH = 272;
                            const BASE_HEIGHT = 240;
                            const rawScale = Math.min(window.innerWidth / BASE_WIDTH, window.innerHeight / BASE_HEIGHT);
                            const finalScale = rawScale >= 1 ? Math.floor(rawScale) : Math.max(0.2, rawScale);
                            document.documentElement.style.setProperty("--game-scale", finalScale);
                            this.modalManager.showToast(`Đã chuyển tỷ lệ: Tự động (${finalScale}x)`);
                        } else {
                            document.documentElement.style.setProperty("--game-scale", val);
                            this.modalManager.showToast(`Đã đặt tỷ lệ màn hình: ${val}x`);
                        }
                    });
                }

                // Handle Portal Hint Toggle
                const portalCheck = container.querySelector("#rpg-setting-portal-hint");
                if (portalCheck) {
                    const hintEl = document.getElementById("portal-hint");
                    portalCheck.checked = !(hintEl && hintEl.getAttribute("data-disabled") === "true");
                    portalCheck.addEventListener("change", (e) => {
                        if (hintEl) {
                            if (e.target.checked) {
                                hintEl.removeAttribute("data-disabled");
                                this.modalManager.showToast("Đã BẬT gợi ý điểm đến cổng");
                            } else {
                                hintEl.setAttribute("data-disabled", "true");
                                hintEl.style.display = "none";
                                this.modalManager.showToast("Đã TẮT gợi ý điểm đến cổng");
                            }
                        }
                    });
                }

                // Handle Logout
                const logoutBtn = container.querySelector("#rpg-btn-settings-logout");
                if (logoutBtn) {
                    logoutBtn.addEventListener("click", () => {
                        const realLogout = document.getElementById("btn-logout");
                        if (realLogout) {
                            onClose();
                            realLogout.click();
                        }
                    });
                }

                container.querySelector(".rpg-modal-close-btn").addEventListener("click", onClose);
                return container;
            }
        });
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = ModernHUD;
    } else {
        global.PokeModernHUD = ModernHUD;
    }
})(typeof window !== "undefined" ? window : global);
