/**
 * Starter Selection UI Component for Poké-Engine
 * Provides a clean modal interface to choose 1 of 3 classic Gen 1 starter Pokémon:
 * - Bulbasaur (#001)
 * - Charmander (#004)
 * - Squirtle (#007)
 */
(function (global) {
    "use strict";

    const STARTERS = [
        {
            id: "001",
            nationalDex: 1,
            name: "Bulbasaur",
            typeLabel: "Cỏ / Độc",
            typeColor: "#2ed573",
            description: "Pokémon hạt giống. Thích tắm nắng và rất hiền hòa.",
            sprite: "/res/pokemon/sprites/animated/001.gif"
        },
        {
            id: "004",
            nationalDex: 4,
            name: "Charmander",
            typeLabel: "Lửa",
            typeColor: "#ff4757",
            description: "Pokémon thằn lằn lửa. Ngọn lửa đuôi thể hiện sức sống mãnh liệt.",
            sprite: "/res/pokemon/sprites/animated/004.gif"
        },
        {
            id: "007",
            nationalDex: 7,
            name: "Squirtle",
            typeLabel: "Nước",
            typeColor: "#1e90ff",
            description: "Pokémon rùa tí hon. Mai cứng cáp và có thể phun nước áp lực cao.",
            sprite: "/res/pokemon/sprites/animated/007.gif"
        }
    ];

    const StarterSelectionUI = function (game, modalManager, partyService, pokedexProgressService) {
        this.game = game;
        this.modalManager = modalManager;
        this.partyService = partyService;
        this.progressService = pokedexProgressService;
        this.speciesCache = [];

        this.init();
    };

    StarterSelectionUI.prototype.init = function () {
        const self = this;
        if (this.modalManager && typeof this.modalManager.registerModal === "function") {
            this.modalManager.registerModal("starter_select", {
                render: function (onClose) {
                    return self.render(onClose);
                }
            });
        }
        this.loadSpeciesCache();
    };

    StarterSelectionUI.prototype.loadSpeciesCache = function () {
        this.speciesCache = Array.isArray(this.game && this.game.speciesCatalog)
            ? this.game.speciesCatalog
            : [];
    };

    StarterSelectionUI.prototype.getSpeciesData = function (speciesId) {
        if (this.speciesCache.length > 0) {
            const found = this.speciesCache.find(function (s) { return s.id === speciesId; });
            if (found) return found;
        }
        return null;
    };

    StarterSelectionUI.prototype.chooseStarter = async function (speciesId, onClose) {
        if (this.isChoosing) return;
        const starterMeta = STARTERS.find(function (s) { return s.id === speciesId; });
        const name = starterMeta ? starterMeta.name : speciesId;

        const confirmed = window.confirm(`Bạn có chắc chắn muốn chọn ${name} làm Pokémon đồng hành đầu tiên không?`);
        if (!confirmed) return;

        const speciesData = this.getSpeciesData(speciesId);
        if (!speciesData) {
            window.alert("Không thể tải dữ liệu Pokémon mới nhất. Vui lòng tải lại game rồi thử lại.");
            return;
        }
        const InstanceClass = (typeof PokePokemonInstance !== "undefined")
            ? PokePokemonInstance
            : (typeof require !== "undefined" ? require("./pokemonInstance") : null);

        if (!InstanceClass) {
            alert("Lỗi: Không tìm thấy lớp đối tượng Pokémon Instance.");
            return;
        }

        if (!this.partyService || typeof this.partyService.addPokemon !== "function") {
            alert("Party chưa được đồng bộ với máy chủ. Vui lòng tải lại game trước khi chọn Pokémon.");
            return;
        }

        const instance = new InstanceClass(speciesData, 5);
        this.isChoosing = true;
        let result;
        try {
            result = await this.partyService.addPokemon(instance, { isNewCapture: true, isStarter: true });
            if (!result || !result.success) {
                alert("Không thể nhận Pokémon: " + ((result && (result.message || result.reason)) || "Lỗi không xác định"));
                return;
            }
            if (typeof this.partyService.setStarterChosen === "function" && !this.partyService.isStarterChosen()) {
                const starterResult = await this.partyService.setStarterChosen(true);
                if (!starterResult || !starterResult.success) {
                    alert("Pokémon đã được lưu nhưng chưa thể xác nhận lựa chọn Starter. Vui lòng tải lại game.");
                    return;
                }
            }
        } catch (error) {
            alert("Không thể lưu Pokémon lên máy chủ: " + (error && error.message ? error.message : "lỗi mạng"));
            return;
        } finally {
            this.isChoosing = false;
        }

        if (this.game) {
            this.game.starterChosen = true;
        }

        // Close modal
        if (typeof onClose === "function") {
            onClose();
        } else if (this.modalManager) {
            this.modalManager.closeActiveModal();
        }

        // Open notification dialogue with Guide Leaf
        if (this.game && typeof this.game.renderDialogueText === "function") {
            const dialogueLines = [
                `Chúc mừng bạn! Bạn đã nhận được ${instance.name} (Lv. 5)!`,
                `${instance.name} đã được ghi nhận vào Pokédex ở trạng thái ĐÃ BẮT (CAUGHT)!`,
                "Hãy mở Đội Hình (phím P) hoặc Pokédex (phím X) để kiểm tra nhé!"
            ];
            this.game.state = "DIALOGUE";
            if (this.game.player) this.game.player.stop = true;
            this.game.activeDialogue = {
                npc: { name: "Guide Leaf" },
                lines: dialogueLines,
                index: 0
            };
            let nameEl = document.querySelector("#dialogue-name");
            if (nameEl) nameEl.textContent = "Guide Leaf";
            this.game.renderDialogueText(dialogueLines[0]);
            if (this.game.$dialogueBox) this.game.$dialogueBox.style.display = "block";
        }
    };

    StarterSelectionUI.prototype.render = function (onClose) {
        const self = this;
        const container = document.createElement("div");
        container.id = "rpg-starter-modal";
        container.className = "rpg-modal-container";

        const style = document.createElement("style");
        style.textContent = `
            #rpg-starter-modal {
                font-family: monospace;
                color: #eee;
                background: #141414;
                width: 90%;
                max-width: 520px;
                padding: 16px;
                border-radius: 8px;
                border: 2px solid #f6b93b;
                box-shadow: 0 8px 30px rgba(0,0,0,0.8);
                box-sizing: border-box;
            }
            #rpg-starter-modal .title {
                text-align: center;
                font-size: 15px;
                font-weight: bold;
                color: #f6b93b;
                margin-bottom: 6px;
            }
            #rpg-starter-modal .subtitle {
                text-align: center;
                font-size: 11px;
                color: #aaa;
                margin-bottom: 16px;
            }
            #rpg-starter-modal .starter-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 10px;
                margin-bottom: 16px;
            }
            #rpg-starter-modal .starter-card {
                background: #222;
                border: 1px solid #444;
                border-radius: 6px;
                padding: 10px 6px;
                text-align: center;
                cursor: pointer;
                transition: transform 0.15s, border-color 0.15s, background 0.15s;
                display: flex;
                flex-direction: column;
                align-items: center;
            }
            #rpg-starter-modal .starter-card:hover {
                transform: translateY(-3px);
                border-color: #f6b93b;
                background: #2c2c2c;
            }
            #rpg-starter-modal .starter-sprite {
                width: 48px;
                height: 48px;
                object-fit: contain;
                image-rendering: pixelated;
                margin-bottom: 8px;
            }
            #rpg-starter-modal .starter-name {
                font-weight: bold;
                font-size: 12px;
                color: #fff;
                margin-bottom: 4px;
            }
            #rpg-starter-modal .starter-type {
                font-size: 9px;
                padding: 2px 6px;
                border-radius: 3px;
                font-weight: bold;
                margin-bottom: 6px;
            }
            #rpg-starter-modal .starter-desc {
                font-size: 9px;
                color: #888;
                line-height: 1.3;
            }
            #rpg-starter-modal .close-footer {
                text-align: center;
                font-size: 10px;
                color: #666;
            }
        `;
        container.appendChild(style);

        const title = document.createElement("div");
        title.className = "title";
        title.textContent = "CHỌN POKÉMON KHỞI ĐẦU";
        container.appendChild(title);

        const subtitle = document.createElement("div");
        subtitle.className = "subtitle";
        subtitle.textContent = "Hãy chọn người bạn đồng hành đầu tiên cho chuyến hành trình của bạn:";
        container.appendChild(subtitle);

        const grid = document.createElement("div");
        grid.className = "starter-grid";

        STARTERS.forEach(function (starter) {
            const species = self.getSpeciesData(starter.id);
            const name = species ? species.name : starter.name;
            const types = species && Array.isArray(species.types) ? species.types.join(" / ") : starter.typeLabel;
            const description = species && species.dexEntry ? species.dexEntry : starter.description;
            const sprite = species && species.assets && species.assets.front ? species.assets.front : starter.sprite;
            const card = document.createElement("div");
            card.className = "starter-card";
            const image = document.createElement("img");
            image.className = "starter-sprite";
            image.src = sprite;
            image.alt = name;
            const nameLabel = document.createElement("div");
            nameLabel.className = "starter-name";
            nameLabel.textContent = "#" + starter.id + " " + name;
            const typeLabel = document.createElement("div");
            typeLabel.className = "starter-type";
            typeLabel.style.cssText = "background: " + starter.typeColor + "22; color: " + starter.typeColor + "; border: 1px solid " + starter.typeColor + ";";
            typeLabel.textContent = types;
            const descriptionLabel = document.createElement("div");
            descriptionLabel.className = "starter-desc";
            descriptionLabel.textContent = description;
            card.append(image, nameLabel, typeLabel, descriptionLabel);
            card.addEventListener("click", function () {
                self.chooseStarter(starter.id, onClose);
            });
            grid.appendChild(card);
        });
        container.appendChild(grid);

        const footer = document.createElement("div");
        footer.className = "close-footer";
        footer.textContent = "Nhấn vào Pokémon bạn muốn chọn | ESC để quay lại sau";
        container.appendChild(footer);

        return container;
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = StarterSelectionUI;
    } else {
        global.PokeStarterSelectionUI = StarterSelectionUI;
    }
})(typeof window !== "undefined" ? window : global);
