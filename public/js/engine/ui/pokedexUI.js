// Pokedex UI Component for Poké-Engine
// Displays a paginated list of Pokémon from species.json and a detail view.
// No external CSS file – styles are scoped under #rpg-pokedex-modal.

(function (global) {
    "use strict";

    const PAGE_SIZE = 12;
    const TOTAL_POKEMON = 50; // expected catalogue size
    const TOTAL_PAGES = Math.ceil(TOTAL_POKEMON / PAGE_SIZE);

    const PokedexUI = function (game, modalManager, progressService) {
        this.game = game;
        this.modalManager = modalManager;
        this.progressService = progressService || (typeof PokePokedexProgressService !== "undefined" ? new PokePokedexProgressService() : null);
        this.currentPage = 1; // 1‑based
        this.species = Array.isArray(game && game.speciesCatalog) ? game.speciesCatalog : [];
        this.view = "list"; // "list" or "detail"
        this.detailData = null; // holds the selected pokemon object
        this.init();
    };

    // Register modal "pokedex"
    PokedexUI.prototype.init = function () {
        var self = this;
        this.modalManager.registerModal("pokedex", {
            render: function (onClose) { return self.render(onClose); }
        });
        // The game has already loaded the authoritative merged species catalog before UI setup.
        this.loadCatalogue();
    };

    // Use the authoritative catalog loaded during game initialization.
    PokedexUI.prototype.loadCatalogue = function () {
        this.species = Array.isArray(this.game && this.game.speciesCatalog)
            ? this.game.speciesCatalog
            : [];
    };

    // Helper to compute pagination slice
    PokedexUI.prototype.getPageSlice = function () {
        var start = (this.currentPage - 1) * PAGE_SIZE;
        var end = start + PAGE_SIZE;
        return this.species.slice(start, end);
    };

    // Render the whole modal (list or detail based on this.view)
    PokedexUI.prototype.render = function (onClose) {
        var container = document.createElement("div");
        container.id = "rpg-pokedex-modal";
        container.className = "rpg-modal-container";

        // Scoped CSS – injected once per render (lightweight)
        var style = document.createElement("style");
        style.textContent = `
            #rpg-pokedex-modal {
                font-family: monospace;
                color: #eee;
                background: #111;
                width: 90%;
                max-width: 540px;
                max-height: 85vh;
                font-size: 12px;
                box-sizing: border-box;
            }
            #rpg-pokedex-modal .header {
                padding: 8px 12px;
                background: #222;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid #333;
            }
            #rpg-pokedex-modal .title {
                font-weight: bold;
                font-size: 13px;
                color: #f6b93b;
            }
            #rpg-pokedex-modal .close-btn {
                cursor: pointer;
            }
            #rpg-pokedex-modal .list {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 6px;
                padding: 8px 10px;
                max-height: calc(85vh - 90px);
                overflow-x: hidden;
                overflow-y: auto;
                box-sizing: border-box;
            }
            #rpg-pokedex-modal .entry {
                padding: 4px 6px;
                background: #242424;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 6px;
                border: 1px solid #3a3a3a;
                border-radius: 4px;
                min-width: 0;
                box-sizing: border-box;
                transition: background 0.15s, border-color 0.15s;
            }
            #rpg-pokedex-modal .entry:hover {
                background: #383838;
                border-color: #f6b93b;
            }
            #rpg-pokedex-modal .entry-sprite-box {
                width: 28px;
                height: 28px;
                display: flex;
                align-items: center;
                justify-content: center;
                flex-shrink: 0;
            }
            #rpg-pokedex-modal .entry-sprite {
                max-width: 28px;
                max-height: 28px;
                object-fit: contain;
                image-rendering: pixelated;
            }
            #rpg-pokedex-modal .entry-placeholder {
                font-size: 14px;
                color: #888;
                font-weight: bold;
            }
            #rpg-pokedex-modal .entry-label {
                font-size: 11px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                line-height: 1.2;
            }
            #rpg-pokedex-modal .footer {
                display: flex;
                justify-content: space-between;
                padding: 6px 12px;
                background: #222;
                border-top: 1px solid #333;
            }
            #rpg-pokedex-modal .btn {
                cursor: pointer;
                padding: 3px 12px;
                background: #444;
                border: 1px solid #666;
                color: #fff;
                font-size: 11px;
                border-radius: 2px;
            }
            #rpg-pokedex-modal .btn:disabled {
                opacity: 0.35;
                cursor: default;
            }
            #rpg-pokedex-modal .detail {
                padding: 8px 14px;
                max-height: calc(85vh - 90px);
                overflow-y: auto;
                box-sizing: border-box;
            }
            #rpg-pokedex-modal .detail-sprite-container {
                text-align: center;
                margin: 4px 0 8px 0;
                min-height: 68px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(0, 0, 0, 0.3);
                border-radius: 4px;
                border: 1px solid #222;
            }
            #rpg-pokedex-modal .detail-sprite {
                max-width: 68px;
                max-height: 68px;
                object-fit: contain;
                image-rendering: pixelated;
            }
            #rpg-pokedex-modal .detail-sprite-placeholder {
                font-size: 40px;
                line-height: 1;
                color: #888;
            }
            #rpg-pokedex-modal .detail-row {
                margin: 3px 0;
                font-size: 11px;
            }
            .pokemon-silhouette {
                filter: brightness(0);
                opacity: 0.85;
            }
            #rpg-pokedex-modal .entry-badge {
                font-size: 10px;
                margin-left: auto;
                flex-shrink: 0;
            }
            #rpg-pokedex-modal .detail-badge {
                display: inline-block;
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 10px;
                font-weight: bold;
                margin-bottom: 6px;
            }
            #rpg-pokedex-modal .badge-caught {
                background: rgba(46, 213, 115, 0.2);
                color: #2ed573;
                border: 1px solid #2ed573;
            }
            #rpg-pokedex-modal .badge-seen {
                background: rgba(246, 185, 59, 0.2);
                color: #f6b93b;
                border: 1px solid #f6b93b;
            }
            #rpg-pokedex-modal .badge-unknown {
                background: rgba(149, 165, 166, 0.2);
                color: #95a5a6;
                border: 1px solid #95a5a6;
            }
        `;
        container.appendChild(style);

        if (this.view === "list") {
            container.appendChild(this.renderList(onClose));
        } else if (this.view === "detail") {
            container.appendChild(this.renderDetail(onClose));
        }
        // close button (always present in header)
        // Handled inside render* methods
        return container;
    };

    // ----- List view -----
    PokedexUI.prototype.renderList = function (onClose) {
        var self = this;
        var wrapper = document.createElement("div");

        // Header with page indicator and close button
        var header = document.createElement("div");
        header.className = "header";
        var title = document.createElement("span");
        title.className = "title";
        var counts = self.progressService ? self.progressService.getCounts(TOTAL_POKEMON) : { seen: 0, caught: 0, total: TOTAL_POKEMON };
        title.textContent = "Pokédex – Trang " + this.currentPage + "/" + TOTAL_PAGES + " [Gặp: " + counts.seen + " | Bắt: " + counts.caught + "]";
        var close = document.createElement("button");
        close.className = "close-btn btn";
        close.title = "Đóng (ESC)";
        close.textContent = "✕";
        close.addEventListener("click", onClose);
        header.appendChild(title);
        header.appendChild(close);
        wrapper.appendChild(header);

        // List grid
        var list = document.createElement("div");
        list.className = "list";
        // If catalogue not loaded yet, show placeholder loading text
        if (!this.species.length) {
            var loading = document.createElement("div");
            loading.textContent = "Loading catalogue… (demo mode)";
            list.appendChild(loading);
        } else {
            var slice = this.getPageSlice();
            slice.forEach(function (poke) {
                var entry = document.createElement("div");
                entry.className = "entry";

                var dex = (poke.nationalDex || 0).toString().padStart(3, "0");
                var status = self.progressService ? self.progressService.getStatus(poke.id) : "UNKNOWN";

                var spriteBox = document.createElement("div");
                spriteBox.className = "entry-sprite-box";

                if (status === "UNKNOWN") {
                    var ph = document.createElement("span");
                    ph.className = "entry-placeholder";
                    ph.textContent = "?";
                    spriteBox.appendChild(ph);
                } else {
                    if (poke.assets && poke.assets.front) {
                        var img = document.createElement("img");
                        img.className = "entry-sprite" + (status === "SEEN" ? " pokemon-silhouette" : "");
                        img.src = poke.assets.front;
                        img.alt = status === "SEEN" ? "Seen Pokémon" : (poke.name || "Pokémon");
                        img.onerror = function () {
                            this.style.display = "none";
                            var ph = document.createElement("span");
                            ph.className = "entry-placeholder";
                            ph.textContent = "?";
                            spriteBox.appendChild(ph);
                        };
                        spriteBox.appendChild(img);
                    } else {
                        var ph = document.createElement("span");
                        ph.className = "entry-placeholder";
                        ph.textContent = "?";
                        spriteBox.appendChild(ph);
                    }
                }
                entry.appendChild(spriteBox);

                var label = document.createElement("span");
                label.className = "entry-label";
                var displayName = (status === "UNKNOWN") ? "???" : (poke.name || "???");
                label.textContent = dex + " " + displayName;
                entry.appendChild(label);

                var badge = document.createElement("span");
                badge.className = "entry-badge";
                if (status === "CAUGHT") {
                    badge.textContent = "🔴";
                    badge.title = "Đã thu phục";
                } else if (status === "SEEN") {
                    badge.textContent = "👁️";
                    badge.title = "Đã nhìn thấy";
                }
                entry.appendChild(badge);

                entry.addEventListener("click", function () {
                    self.detailData = poke;
                    self.view = "detail";
                    // Re‑render modal – close current and open again with same id
                    self.modalManager.closeActiveModal();
                    self.modalManager.openModal("pokedex");
                });
                list.appendChild(entry);
            });
        }
        wrapper.appendChild(list);

        // Footer navigation
        var footer = document.createElement("div");
        footer.className = "footer";
        var prevBtn = document.createElement("button");
        prevBtn.className = "btn";
        prevBtn.textContent = "Prev";
        prevBtn.disabled = this.currentPage <= 1;
        prevBtn.addEventListener("click", function () {
            if (self.currentPage > 1) {
                self.currentPage--;
                self.modalManager.closeActiveModal();
                self.modalManager.openModal("pokedex");
            }
        });
        var nextBtn = document.createElement("button");
        nextBtn.className = "btn";
        nextBtn.textContent = "Next";
        nextBtn.disabled = this.currentPage >= TOTAL_PAGES;
        nextBtn.addEventListener("click", function () {
            if (self.currentPage < TOTAL_PAGES) {
                self.currentPage++;
                self.modalManager.closeActiveModal();
                self.modalManager.openModal("pokedex");
            }
        });
        footer.appendChild(prevBtn);
        footer.appendChild(nextBtn);
        wrapper.appendChild(footer);
        return wrapper;
    };

    // ----- Detail view -----
    PokedexUI.prototype.renderDetail = function (onClose) {
        var self = this;
        var wrapper = document.createElement("div");

        var header = document.createElement("div");
        header.className = "header";
        var title = document.createElement("span");
        title.className = "title";
        title.textContent = "Pokémon Detail";
        var backBtn = document.createElement("button");
        backBtn.className = "btn";
        backBtn.title = "Quay lại danh sách";
        backBtn.textContent = "← Back";
        backBtn.addEventListener("click", function () {
            self.view = "list";
            self.modalManager.closeActiveModal();
            self.modalManager.openModal("pokedex");
        });
        var close = document.createElement("button");
        close.className = "close-btn btn";
        close.title = "Đóng (ESC)";
        close.textContent = "✕";
        close.addEventListener("click", onClose);
        header.appendChild(title);
        header.appendChild(backBtn);
        header.appendChild(close);
        wrapper.appendChild(header);

        var detail = document.createElement("div");
        detail.className = "detail";
        var p = this.detailData || {};
        var status = self.progressService ? self.progressService.getStatus(p.id) : "UNKNOWN";

        // Status Badge
        var badgeEl = document.createElement("div");
        if (status === "CAUGHT") {
            badgeEl.className = "detail-badge badge-caught";
            badgeEl.textContent = "✔ ĐÃ BẮT (CAUGHT) 🔴⚪";
        } else if (status === "SEEN") {
            badgeEl.className = "detail-badge badge-seen";
            badgeEl.textContent = "👁 ĐÃ GẶP (SEEN)";
        } else {
            badgeEl.className = "detail-badge badge-unknown";
            badgeEl.textContent = "? CHƯA PHÁT HIỆN (UNKNOWN)";
        }
        detail.appendChild(badgeEl);

        // Helper to create a row
        function row(label, value) {
            var div = document.createElement("div");
            div.className = "detail-row";
            div.textContent = label + ": " + (value != null ? value : "‑");
            return div;
        }

        var dexStr = (p.nationalDex || "").toString().padStart(3, "0");
        detail.appendChild(row("Số Dex", dexStr));

        if (status === "UNKNOWN") {
            detail.appendChild(row("Tên", "???"));
            detail.appendChild(row("Hệ", "???"));
            detail.appendChild(row("Chiều cao", "---"));
            detail.appendChild(row("Cân nặng", "---"));
            detail.appendChild(row("Chỉ số", "Chưa có dữ liệu"));
        } else if (status === "SEEN") {
            detail.appendChild(row("Tên", p.name || "‑"));
            var types = Array.isArray(p.types) ? p.types.join(", ") : "‑";
            detail.appendChild(row("Hệ", types));
            detail.appendChild(row("Chiều cao", (p.heightM != null ? p.heightM + " m" : "‑")));
            detail.appendChild(row("Cân nặng", (p.weightKg != null ? p.weightKg + " kg" : "‑")));
            detail.appendChild(row("Chỉ số cơ bản", "Chưa thu phục — Chỉ số ẩn"));
        } else {
            // CAUGHT
            detail.appendChild(row("Tên", p.name || "‑"));
            var types = Array.isArray(p.types) ? p.types.join(", ") : "‑";
            detail.appendChild(row("Hệ", types));
            detail.appendChild(row("Chiều cao", (p.heightM != null ? p.heightM + " m" : "‑")));
            detail.appendChild(row("Cân nặng", (p.weightKg != null ? p.weightKg + " kg" : "‑")));
            var stats = p.baseStats || {};
            detail.appendChild(row("HP", stats.hp != null ? stats.hp : "‑"));
            detail.appendChild(row("Attack", stats.attack != null ? stats.attack : "‑"));
            detail.appendChild(row("Defense", stats.defense != null ? stats.defense : "‑"));
            detail.appendChild(row("Speed", stats.speed != null ? stats.speed : "‑"));
            detail.appendChild(row("Special", stats.special != null ? stats.special : "‑"));
        }

        // Sprite display with animation support & fallback placeholder
        var spriteContainer = document.createElement("div");
        spriteContainer.className = "detail-sprite-container";

        if (status === "UNKNOWN") {
            var ph = document.createElement("div");
            ph.className = "detail-sprite-placeholder";
            ph.textContent = "?";
            spriteContainer.appendChild(ph);
        } else if (p.assets && p.assets.front) {
            var img = document.createElement("img");
            img.className = "detail-sprite" + (status === "SEEN" ? " pokemon-silhouette" : "");
            img.src = p.assets.front;
            img.alt = (status === "SEEN" ? "Seen Pokémon" : (p.name || "Pokémon"));
            img.onerror = function () {
                this.style.display = "none";
                var ph = document.createElement("div");
                ph.className = "detail-sprite-placeholder";
                ph.textContent = "?";
                spriteContainer.appendChild(ph);
            };
            spriteContainer.appendChild(img);
        } else {
            var ph = document.createElement("div");
            ph.className = "detail-sprite-placeholder";
            ph.textContent = "?";
            spriteContainer.appendChild(ph);
        }
        wrapper.appendChild(spriteContainer);
        wrapper.appendChild(detail);
        return wrapper;
    };

    // Export
    if (typeof module !== "undefined" && module.exports) {
        module.exports = PokedexUI;
    } else {
        global.PokePokedexUI = PokedexUI;
    }
})(typeof window !== "undefined" ? window : global);
