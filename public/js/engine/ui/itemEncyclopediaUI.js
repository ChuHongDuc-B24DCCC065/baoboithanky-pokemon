/**
 * Item Encyclopedia UI for Poké-Engine
 * Displays the shared Item Catalog with live owned quantities from InventoryService.
 */
(function (global) {
    "use strict";

    const Catalog = (typeof require !== "undefined")
        ? require("./itemCatalog")
        : (global.PokeItemCatalog || {});

    const ItemEncyclopediaUI = function (modalManager, inventoryService) {
        this.modalManager = modalManager;
        this.inventoryService = inventoryService;
        this.selectedCategory = null;
        this.selectedItemId = null;
        this.view = "list";
        this.init();
    };

    ItemEncyclopediaUI.prototype.init = function () {
        this.modalManager.registerModal("item_encyclopedia", {
            render: (onClose) => this.render(onClose)
        });
    };

    ItemEncyclopediaUI.prototype.getCatalogItems = function () {
        const items = Catalog.ITEMS || {};
        return Object.entries(items).map(function (entry) {
            return entry[1] ? { id: entry[1].id || entry[0], definition: entry[1] } : null;
        }).filter(Boolean);
    };

    ItemEncyclopediaUI.prototype.getFilteredItems = function () {
        return this.getCatalogItems().filter((item) =>
            !this.selectedCategory || item.definition.category === this.selectedCategory
        );
    };

    ItemEncyclopediaUI.prototype.getOwnedQuantity = function (itemId) {
        if (!this.inventoryService || typeof this.inventoryService.getItemQuantity !== "function") return 0;
        const quantity = this.inventoryService.getItemQuantity(itemId);
        return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
    };

    ItemEncyclopediaUI.prototype.createTextElement = function (tagName, className, text) {
        const element = document.createElement(tagName);
        if (className) element.className = className;
        element.textContent = text == null ? "" : String(text);
        return element;
    };

    ItemEncyclopediaUI.prototype.createItemIcon = function (item, className) {
        if (!item || !item.sprite) {
            return this.createTextElement("span", className, item && item.icon ? item.icon : "📦");
        }

        const image = document.createElement("img");
        image.className = className;
        image.src = item.sprite;
        image.alt = item.name || "";
        image.width = 32;
        image.height = 32;
        image.style.width = "32px";
        image.style.height = "32px";
        image.style.objectFit = "contain";
        image.style.imageRendering = "pixelated";
        image.addEventListener("error", () => {
            image.replaceWith(this.createTextElement("span", className, item.icon || "📦"));
        }, { once: true });
        return image;
    };

    ItemEncyclopediaUI.prototype.createHeader = function (title, onClose, backAction) {
        const header = document.createElement("div");
        header.className = "rpg-itemdex-header";

        const titleEl = this.createTextElement("strong", "rpg-itemdex-title", title);
        header.appendChild(titleEl);

        const buttons = document.createElement("div");
        buttons.className = "rpg-itemdex-header-actions";
        if (backAction) {
            const back = this.createTextElement("button", "rpg-itemdex-button", "← Danh sách");
            back.type = "button";
            back.addEventListener("click", backAction);
            buttons.appendChild(back);
        }

        const close = this.createTextElement("button", "rpg-itemdex-button", "✕");
        close.type = "button";
        close.title = "Đóng";
        close.addEventListener("click", onClose);
        buttons.appendChild(close);
        header.appendChild(buttons);
        return header;
    };

    ItemEncyclopediaUI.prototype.render = function (onClose) {
        const container = document.createElement("div");
        container.id = "rpg-item-encyclopedia-modal";
        container.className = "rpg-modal-container rpg-item-encyclopedia";

        const style = document.createElement("style");
        style.textContent = `
            #rpg-item-encyclopedia-modal { color: #eee; background: #111; width: 90%; max-width: 560px; max-height: 85vh; font: 12px monospace; box-sizing: border-box; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 12px; background: #222; border-bottom: 1px solid #333; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-title { color: #f6b93b; font-size: 13px; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-header-actions { display: flex; gap: 5px; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-button { cursor: pointer; padding: 4px 8px; color: #fff; background: #3a3a3a; border: 1px solid #666; border-radius: 3px; font: inherit; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-categories { display: flex; flex-wrap: wrap; gap: 5px; padding: 8px 10px 0; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-category.active { border-color: #f6b93b; color: #f6b93b; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; padding: 8px 10px; max-height: calc(85vh - 105px); overflow-y: auto; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-entry { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 7px; color: #eee; text-align: left; background: #242424; border: 1px solid #3a3a3a; border-radius: 4px; cursor: pointer; font: inherit; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-entry:hover { border-color: #f6b93b; background: #303030; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-icon { font-size: 20px; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-entry-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-owned { margin-left: auto; color: #38d9a9; white-space: nowrap; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-footer { padding: 6px 12px; color: #94a3b8; background: #222; border-top: 1px solid #333; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-detail { padding: 12px 14px; max-height: calc(85vh - 75px); overflow-y: auto; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-detail-icon { font-size: 36px; margin-bottom: 4px; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-row { margin: 7px 0; line-height: 1.5; overflow-wrap: anywhere; }
            #rpg-item-encyclopedia-modal .rpg-itemdex-section { margin-top: 12px; color: #f6b93b; font-weight: bold; }
        `;
        container.appendChild(style);

        const content = document.createElement("div");
        if (this.view === "detail") {
            content.appendChild(this.renderDetail(onClose));
        } else {
            content.appendChild(this.renderList(onClose));
        }
        container.appendChild(content);
        return container;
    };

    ItemEncyclopediaUI.prototype.renderList = function (onClose) {
        const wrapper = document.createElement("div");
        wrapper.appendChild(this.createHeader("Bách khoa vật phẩm", onClose));

        const categoryBar = document.createElement("div");
        categoryBar.className = "rpg-itemdex-categories";
        const categories = [{ id: null, name: "Tất cả" }].concat(
            Object.values(Catalog.CATEGORIES || {}).map((category) => ({
                id: category,
                name: (Catalog.CATEGORY_NAMES && Catalog.CATEGORY_NAMES[category]) || category
            }))
        );
        categories.forEach((category) => {
            const button = this.createTextElement("button", "rpg-itemdex-button rpg-itemdex-category", category.name);
            button.type = "button";
            if (this.selectedCategory === category.id) button.className += " active";
            button.addEventListener("click", () => {
                this.selectedCategory = category.id;
                this.view = "list";
                this.modalManager.showModalContent("item_encyclopedia");
            });
            categoryBar.appendChild(button);
        });
        wrapper.appendChild(categoryBar);

        const list = document.createElement("div");
        list.className = "rpg-itemdex-list";
        const items = this.getFilteredItems();
        if (items.length === 0) {
            list.appendChild(this.createTextElement("div", "rpg-empty-state", "Không có vật phẩm trong nhóm này."));
        }

        items.forEach((entry) => {
            const item = entry.definition;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "rpg-itemdex-entry";
            button.setAttribute("data-item-id", entry.id);
            button.appendChild(this.createItemIcon(item, "rpg-itemdex-icon"));
            button.appendChild(this.createTextElement("span", "rpg-itemdex-entry-name", item.name || entry.id));
            button.appendChild(this.createTextElement("span", "rpg-itemdex-owned", "x" + this.getOwnedQuantity(entry.id)));
            button.addEventListener("click", () => {
                this.selectedItemId = entry.id;
                this.view = "detail";
                this.modalManager.showModalContent("item_encyclopedia");
            });
            list.appendChild(button);
        });
        wrapper.appendChild(list);
        wrapper.appendChild(this.createTextElement("div", "rpg-itemdex-footer", items.length + " vật phẩm"));
        return wrapper;
    };

    ItemEncyclopediaUI.prototype.renderDetail = function (onClose) {
        const wrapper = document.createElement("div");
        wrapper.appendChild(this.createHeader("Chi tiết vật phẩm", onClose, () => {
            this.view = "list";
            this.modalManager.showModalContent("item_encyclopedia");
        }));

        const detail = document.createElement("div");
        detail.className = "rpg-itemdex-detail";
        const item = Catalog.getItem ? Catalog.getItem(this.selectedItemId) : null;
        if (!item) {
            detail.appendChild(this.createTextElement("div", "rpg-empty-state", "Không tìm thấy vật phẩm trong catalog."));
            wrapper.appendChild(detail);
            return wrapper;
        }

        const categoryName = (Catalog.CATEGORY_NAMES && Catalog.CATEGORY_NAMES[item.category]) || item.category || "—";
        detail.appendChild(this.createItemIcon(item, "rpg-itemdex-detail-icon"));
        detail.appendChild(this.createTextElement("h3", "rpg-itemdex-title", item.name || this.selectedItemId));
        detail.appendChild(this.createTextElement("div", "rpg-itemdex-row", "ID: " + this.selectedItemId));
        detail.appendChild(this.createTextElement("div", "rpg-itemdex-row", "Loại: " + categoryName));
        detail.appendChild(this.createTextElement("div", "rpg-itemdex-row", "Số lượng sở hữu: x" + this.getOwnedQuantity(this.selectedItemId)));
        detail.appendChild(this.createTextElement("p", "rpg-itemdex-row", item.description || "Chưa có mô tả."));

        if (item.effect && typeof item.effect === "object") {
            detail.appendChild(this.createTextElement("div", "rpg-itemdex-section", "Hiệu ứng"));
            Object.entries(item.effect).forEach(([key, value]) => {
                const displayValue = value && typeof value === "object" ? JSON.stringify(value) : value;
                detail.appendChild(this.createTextElement("div", "rpg-itemdex-row", key + ": " + displayValue));
            });
        }
        if (item.isEquipment && item.stats) {
            detail.appendChild(this.createTextElement("div", "rpg-itemdex-section", "Chỉ số trang bị"));
            Object.entries(item.stats).forEach(([key, value]) => {
                detail.appendChild(this.createTextElement("div", "rpg-itemdex-row", key + ": " + value));
            });
        }

        wrapper.appendChild(detail);
        return wrapper;
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = ItemEncyclopediaUI;
    } else {
        global.PokeItemEncyclopediaUI = ItemEncyclopediaUI;
    }
})(typeof window !== "undefined" ? window : global);
