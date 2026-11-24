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
        this.modalManager.registerModal("pokemon_status", {
            render: (onClose) => this.renderStatus(onClose)
        });
        const partyService = this.game && this.game.pokemonPartyService;
        if (partyService && !this._partyChangeListener && typeof partyService.onChange === "function") {
            this._partyChangeListener = () => {
                if (this.modalManager && this.modalManager.activeModal === "pokemon_status") {
                    this.modalManager.showModalContent("pokemon_status");
                } else if (this.modalManager && this.modalManager.activeModal === "pokemon") {
                    this.modalManager.showModalContent("pokemon");
                }
            };
            partyService.onChange(this._partyChangeListener);
        }
    };

    PokemonUI.prototype.destroy = function () {
        const partyService = this.game && this.game.pokemonPartyService;
        if (partyService && this._partyChangeListener && typeof partyService.offChange === "function") {
            partyService.offChange(this._partyChangeListener);
            this._partyChangeListener = null;
        }
    };

    PokemonUI.prototype.render = function (onClose) {
        const container = document.createElement("div");
        container.className = "rpg-modal-container";
        container.id = "rpg-pokemon-modal";

        // Check if game has real pokemon party data from pokemonPartyService
        const party = (this.game.pokemonPartyService && typeof this.game.pokemonPartyService.getParty === "function")
            ? this.game.pokemonPartyService.getParty()
            : ((this.game.party && Array.isArray(this.game.party)) ? this.game.party : []);
        const partyService = this.game.pokemonPartyService;
        const activePokemon = partyService && typeof partyService.getActivePokemon === "function"
            ? partyService.getActivePokemon()
            : (party.length > 0 ? party[0] : null);
        const activeIndex = partyService && typeof partyService.getActivePokemonIndex === "function"
            ? partyService.getActivePokemonIndex()
            : (activePokemon ? party.indexOf(activePokemon) : -1);
        const canReleasePokemon = this.game && (this.game.state === "NORMAL" || this.game.state === "MENU");

        let partySlotsHtml = "";
        const maxSlots = 6;

        for (let i = 0; i < maxSlots; i++) {
            const member = party[i] || null;
            if (member) {
                const hpPct = Math.round((member.currentHp / (member.maxHp || 1)) * 100);
                const hpColor = hpPct > 50 ? "#2ed573" : (hpPct > 20 ? "#ffa502" : "#ff4757");
                const isActive = i === activeIndex;
                const isFainted = !(member.currentHp > 0) ||
                    (typeof member.isFainted === "function" && member.isFainted());
                partySlotsHtml += `
                    <div class="rpg-party-member" style="display: grid; gap: 5px;">
                    <button type="button" class="rpg-pokemon-slot occupied" data-party-index="${i}" aria-pressed="${isActive}" ${isFainted ? "disabled" : ""} style="display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 10px; background: ${isActive ? "#263326" : "#1f1f1f"}; border: 1px solid ${isActive ? "#2ed573" : "#333"}; border-radius: 6px; color: inherit; text-align: left; font: inherit; cursor: ${isFainted ? "not-allowed" : "pointer"}; opacity: ${isFainted ? "0.55" : "1"};">
                        <img src="${member.sprite || `/res/pokemon/sprites/animated/${member.speciesId}.gif`}" alt="${member.name}" style="width: 36px; height: 36px; object-fit: contain; image-rendering: pixelated; flex-shrink: 0;">
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: baseline;">
                                <span style="font-weight: 700; color: #f6b93b; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${member.name || "Pokémon"}</span>
                                <span style="font-size: 10px; color: #38d9a9; font-weight: bold; margin-left: 4px;">Lv.${member.level || 1}</span>
                            </div>
                            <div style="font-size: 9px; color: #888; margin-top: 2px;">
                                HP: <span style="color: ${hpColor}; font-weight: bold;">${member.currentHp}</span>/${member.maxHp}
                            </div>
                            <div style="width: 100%; height: 4px; background: #333; border-radius: 2px; margin-top: 3px; overflow: hidden;">
                                <div style="width: ${hpPct}%; height: 100%; background: ${hpColor};"></div>
                            </div>
                            <div style="font-size: 9px; color: ${isActive ? "#2ed573" : (isFainted ? "#ff6b81" : "#aaa")}; margin-top: 4px;">
                                ${isActive ? "Đang xuất chiến" : (isFainted ? "Không thể chọn (HP 0)" : "Nhấn để chọn xuất chiến")}
                            </div>
                        </div>
                    </button>
                    <button type="button" data-pokemon-status-index="${i}" style="padding: 4px 8px; background: #282828; border: 1px solid #444; border-radius: 5px; color: #cbd5e1; cursor: pointer; font: inherit; font-size: 10px;">Thông tin</button>
                    <button type="button" data-pokemon-release-index="${i}" ${canReleasePokemon ? "" : "disabled"} style="padding: 4px 8px; background: #3a2020; border: 1px solid #6b3030; border-radius: 5px; color: #ffd6d6; cursor: ${canReleasePokemon ? "pointer" : "not-allowed"}; font: inherit; font-size: 10px;">Thả Pokémon</button>
                    </div>
                `;
            } else {
                partySlotsHtml += `
                    <div class="rpg-pokemon-slot" style="display: flex; align-items: center; justify-content: center; padding: 12px 6px; background: #181818; border: 1px dashed #333; border-radius: 6px; text-align: center;">
                        <div>
                            <div style="font-size: 16px; opacity: 0.3;">⚪</div>
                            <div style="font-size: 10px; color: #666; margin-top: 2px;">Ô ${i + 1}: Trống</div>
                        </div>
                    </div>
                `;
            }
        }

        const infoNotice = party.length === 0
            ? `<strong style="color: #f6b93b;">Chưa có Pokémon:</strong><br>
               Đội hình hiện đang trống. Hãy nói chuyện với <strong>Guide Leaf</strong> ở Làng Bình Minh (tọa độ x:3, y:1) để chọn Pokémon khởi đầu (Bulbasaur, Charmander hoặc Squirtle)!`
            : activePokemon
                ? `<strong style="color: #2ed573;">Đội hình đang hoạt động:</strong><br>
                   Bạn đang sở hữu ${party.length}/6 Pokémon. <strong>${activePokemon.name}</strong> đang xuất chiến; nhấn một Pokémon còn HP để đổi lựa chọn.`
                : `<strong style="color: #ff6b81;">Chưa có Pokémon đủ HP để xuất chiến.</strong><br>
                   Bạn đang sở hữu ${party.length}/6 Pokémon. Pokémon có HP bằng 0 không thể được chọn.`;

        container.innerHTML = `
            <div class="rpg-modal-header">
                <div class="rpg-modal-title">
                    <span class="rpg-modal-title-icon">⚡</span>
                    <span>Đội Hình Pokémon (Party — Tối Đa 6)</span>
                </div>
                <button type="button" class="rpg-pokedex-open-btn" title="Mở Pokédex">📖 Pokédex</button>
                <button type="button" class="rpg-modal-close-btn" title="Đóng (ESC)">✕</button>
            </div>
            <div class="rpg-modal-body">
                <div class="rpg-party-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
                    ${partySlotsHtml}
                </div>

                <div style="margin-top: 14px; background: rgba(0,0,0,0.3); border-left: 3px solid #f6b93b; padding: 10px 14px; border-radius: 4px; font-size: 11px; line-height: 1.5; color: #cbd5e1;">
                    ${infoNotice}
                </div>
            </div>
            <div class="rpg-modal-footer">
                <span>Số lượng hiện có: ${party.length}/6 Pokémon</span>
                <span>Nhấn ESC để đóng</span>
            </div>
        `;

        // attach close button
        container.querySelector(".rpg-modal-close-btn").addEventListener("click", onClose);
        const partySlots = container.querySelectorAll("[data-party-index]");
        partySlots.forEach((slot) => {
            slot.addEventListener("click", async () => {
                if (!partyService || typeof partyService.selectActivePokemon !== "function") return;
                slot.disabled = true;
                const result = await partyService.selectActivePokemon(Number(slot.getAttribute("data-party-index")));
                if (result.success && result.changed && this.modalManager &&
                    typeof this.modalManager.showModalContent === "function") {
                    this.modalManager.showModalContent("pokemon");
                } else if (!result.success && this.modalManager && typeof this.modalManager.showToast === "function") {
                    this.modalManager.showToast(result.message || "Không thể cập nhật Pokémon xuất chiến.", 3000);
                }
                slot.disabled = false;
            });
        });
        const statusButtons = container.querySelectorAll("[data-pokemon-status-index]");
        statusButtons.forEach((button) => {
            button.addEventListener("click", async () => {
                const index = Number(button.getAttribute("data-pokemon-status-index"));
                const selected = party[index];
                if (!selected) return;
                this.selectedPokemonInstanceId = selected.instanceId || null;
                this.modalManager.openModal("pokemon_status");
            });
        });
        const releaseButtons = container.querySelectorAll("[data-pokemon-release-index]");
        releaseButtons.forEach((button) => {
            button.addEventListener("click", async () => {
                if (!partyService || typeof partyService.releasePokemon !== "function" || !canReleasePokemon) return;
                const index = Number(button.getAttribute("data-pokemon-release-index"));
                const member = party[index];
                if (!member || typeof window === "undefined" || typeof window.confirm !== "function") return;
                const confirmed = window.confirm(`Bạn có chắc muốn thả ${member.name || "Pokémon"} khỏi Party không?`);
                if (!confirmed) return;
                button.disabled = true;
                const result = await partyService.releasePokemon(member.instanceId);
                if (!result.success && this.modalManager && typeof this.modalManager.showToast === "function") {
                    this.modalManager.showToast(result.message || "Không thể thả Pokémon khi chưa xác nhận từ máy chủ.", 3000);
                }
                button.disabled = false;
            });
        });
        // open Pokedex button
        const pokedexBtn = container.querySelector('.rpg-pokedex-open-btn');
        if (pokedexBtn) {
            pokedexBtn.addEventListener('click', () => {
                if (this.modalManager) {
                    this.modalManager.openModal('pokedex');
                }
            });
        }
        return container;
    };

    PokemonUI.prototype.renderStatus = function (onClose) {
        const partyService = this.game && this.game.pokemonPartyService;
        const party = partyService && typeof partyService.getParty === "function" ? partyService.getParty() : [];
        const pokemon = party.find((member) => member && member.instanceId === this.selectedPokemonInstanceId) || null;
        const container = document.createElement("div");
        container.className = "rpg-modal-container";
        container.id = "rpg-pokemon-status-modal";

        const addText = (parent, tag, className, value) => {
            const element = document.createElement(tag);
            if (className) element.className = className;
            element.textContent = value == null ? "—" : String(value);
            parent.appendChild(element);
            return element;
        };
        const header = document.createElement("div");
        header.className = "rpg-modal-header";
        const title = addText(header, "div", "rpg-modal-title", pokemon ? pokemon.name : "Pokémon không còn trong Party");
        title.setAttribute("data-status-field", "name");
        const closeButton = addText(header, "button", "rpg-modal-close-btn", "✕");
        closeButton.type = "button";
        closeButton.setAttribute("aria-label", "Đóng thông tin Pokémon");
        closeButton.addEventListener("click", onClose);
        container.appendChild(header);

        const body = document.createElement("div");
        body.className = "rpg-modal-body";
        if (pokemon) {
            const summary = document.createElement("div");
            summary.style.cssText = "display: grid; gap: 8px; margin-bottom: 16px; color: #cbd5e1;";
            const level = addText(summary, "div", "pokemon-status-level", "Level: " + (pokemon.level || 1));
            level.setAttribute("data-status-field", "level");
            const currentLevel = Number.isInteger(pokemon.level) && pokemon.level > 0 ? pokemon.level : 1;
            const currentExp = Number.isFinite(pokemon.exp) && pokemon.exp >= 0 ? pokemon.exp : 0;
            const expToNextLevel = currentLevel >= 100 ? 0 : currentLevel * 50;
            const expProgress = expToNextLevel > 0
                ? Math.max(0, Math.min(100, (currentExp / expToNextLevel) * 100))
                : 100;
            const exp = addText(summary, "div", "pokemon-status-exp", expToNextLevel > 0
                ? "EXP: " + currentExp + " / " + expToNextLevel
                : "EXP: MAX");
            exp.setAttribute("data-status-field", "exp");
            const expTrack = document.createElement("div");
            expTrack.className = "pokemon-status-exp-track";
            expTrack.setAttribute("role", "progressbar");
            expTrack.setAttribute("aria-label", "EXP đến cấp tiếp theo");
            expTrack.setAttribute("aria-valuemin", "0");
            expTrack.setAttribute("aria-valuemax", String(expToNextLevel || 100));
            expTrack.setAttribute("aria-valuenow", String(expToNextLevel > 0 ? currentExp : 100));
            expTrack.style.cssText = "height: 8px; background: #333; border-radius: 5px; overflow: hidden;";
            const expFill = document.createElement("div");
            expFill.className = "pokemon-status-exp-fill";
            expFill.setAttribute("data-status-field", "exp-progress");
            expFill.style.cssText = "width: " + expProgress + "%; height: 100%; background: #38d9a9; transition: width 0.2s ease;";
            expTrack.appendChild(expFill);
            summary.appendChild(expTrack);
            const hp = addText(summary, "div", "pokemon-status-hp", "HP: " + pokemon.currentHp + " / " + pokemon.maxHp);
            hp.setAttribute("data-status-field", "hp");
            body.appendChild(summary);

            const stats = pokemon.stats || {};
            const baseStats = pokemon.baseStats || {};
            const statNames = [
                ["hp", "HP", pokemon.maxHp, baseStats.hp],
                ["attack", "Attack", stats.attack, baseStats.attack],
                ["defense", "Defense", stats.defense, baseStats.defense],
                ["special", "Special", stats.special, baseStats.special],
                ["speed", "Speed", stats.speed, baseStats.speed]
            ];
            const heading = addText(body, "h3", "pokemon-status-heading", "Chỉ số hiện tại / Base Stats");
            heading.style.cssText = "margin: 0 0 8px; color: #f6b93b; font-size: 13px;";
            const table = document.createElement("div");
            table.style.cssText = "display: grid; grid-template-columns: 1fr auto auto; gap: 8px 14px; padding: 10px; background: rgba(0,0,0,0.25); border-radius: 6px; color: #cbd5e1;";
            addText(table, "strong", "", "Stat");
            addText(table, "strong", "", "Hiện tại");
            addText(table, "strong", "", "Gốc");
            statNames.forEach(([key, label, current, base]) => {
                addText(table, "span", "", label);
                const currentCell = addText(table, "span", "", current);
                currentCell.setAttribute("data-status-stat", key);
                const baseCell = addText(table, "span", "", base);
                baseCell.setAttribute("data-status-base-stat", key);
            });
            body.appendChild(table);
        } else {
            addText(body, "p", "pokemon-status-empty", "Không tìm thấy Pokémon này trong Party.");
        }
        container.appendChild(body);

        const footer = document.createElement("div");
        footer.className = "rpg-modal-footer";
        const backButton = addText(footer, "button", "pokemon-status-back", "Quay lại Party");
        backButton.type = "button";
        backButton.style.cssText = "padding: 6px 10px; background: #282828; border: 1px solid #444; border-radius: 5px; color: #cbd5e1; cursor: pointer; font: inherit;";
        backButton.addEventListener("click", () => this.modalManager.openModal("pokemon"));
        container.appendChild(footer);
        return container;
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = PokemonUI;
    } else {
        global.PokePokemonUI = PokemonUI;
    }
})(typeof window !== "undefined" ? window : global);
