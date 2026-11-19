/**
 * Pokémon Party UI Component for Poké-Engine
 * Renders Pokémon team / party interface.
 * 
 * STRICT HONESTY REQUIREMENT (AGENTS.md):
 * - Does not invent fake Pokémon or pretend catching/battling already exists.
 * - Displays an honest empty state with extensible slot architecture.
 */
(function (global) {
    "use strict";

    const PokemonUI = function (game, modalManager) {
        this.game = game;
        this.modalManager = modalManager;

        this.init();
    };

    PokemonUI.prototype.init = function () {
        this.modalManager.registerModal("pokemon", {
            render: (onClose) => this.render(onClose)
        });
    };

    PokemonUI.prototype.render = function (onClose) {
        const container = document.createElement("div");
        container.className = "rpg-modal-container";
        container.id = "rpg-pokemon-modal";

        // Check if game has real pokemon party data
        const party = (this.game.party && Array.isArray(this.game.party)) ? this.game.party : [];

        let partySlotsHtml = "";
        const maxSlots = 6;

        for (let i = 0; i < maxSlots; i++) {
            const member = party[i] || null;
            if (member) {
                partySlotsHtml += `
                    <div class="rpg-pokemon-slot occupied">
                        <div style="font-weight: 700; color: #f6b93b;">${member.name || "Pokémon"}</div>
                        <div style="font-size: 10px; color: #38d9a9;">Lv. ${member.level || 1}</div>
                    </div>
                `;
            } else {
                partySlotsHtml += `
                    <div class="rpg-pokemon-slot">
                        <div>
                            <div style="font-size: 20px; opacity: 0.4;">⚪</div>
                            <div>Ô ${i + 1}: (Trống)</div>
                        </div>
                    </div>
                `;
            }
        }

        container.innerHTML = `
            <div class="rpg-modal-header">
                <div class="rpg-modal-title">
                    <span class="rpg-modal-title-icon">⚡</span>
                    <span>Đội Hình Pokémon (Party — Tối Đa 6)</span>
                </div>
                <button type="button" class="rpg-modal-close-btn" title="Đóng (ESC)">✕</button>
            </div>
            <div class="rpg-modal-body">
                <div class="rpg-party-grid">
                    ${partySlotsHtml}
                </div>

                <div style="margin-top: 16px; background: rgba(0,0,0,0.3); border-left: 3px solid #f6b93b; padding: 10px 14px; border-radius: 4px; font-size: 11px; line-height: 1.5; color: #cbd5e1;">
                    <strong style="color: #f6b93b;">Trạng thái hệ thống:</strong><br>
                    Hiện tại máy chủ và cơ sở dữ liệu chưa có module Pokémon Party và Battle Scene. 
                    Giao diện đội hình này đã sẵn sàng cấu trúc 6 slot mở rộng để tích hợp dữ liệu ngay khi tính năng bắt thú và chiến đấu được triển khai.
                </div>
            </div>
            <div class="rpg-modal-footer">
                <span>Số lượng hiện có: ${party.length}/6 Pokémon</span>
                <span>Nhấn ESC để đóng</span>
            </div>
        `;

        container.querySelector(".rpg-modal-close-btn").addEventListener("click", onClose);
        return container;
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = PokemonUI;
    } else {
        global.PokePokemonUI = PokemonUI;
    }
})(typeof window !== "undefined" ? window : global);
