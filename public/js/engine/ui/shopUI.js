/**
 * Shop UI for catalog-backed item purchases.
 * All prices and transaction results come from the Economy API contract.
 */
(function (global) {
    "use strict";

    const Catalog = (typeof require !== "undefined")
        ? require("./itemCatalog")
        : (global.PokeItemCatalog || {});

    const ShopUI = function (modalManager, inventoryService) {
        this.modalManager = modalManager;
        this.inventoryService = inventoryService;
        this.init();
    };

    ShopUI.prototype.init = function () {
        this.modalManager.registerModal("shop", {
            render: (onClose) => this.render(onClose)
        });
    };

    ShopUI.prototype.getBuyableItems = function () {
        return Object.values(Catalog.ITEMS || {}).filter((item) => item && item.shop && item.shop.buyable === true);
    };

    ShopUI.prototype.createText = function (tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        element.textContent = text == null ? "" : String(text);
        return element;
    };

    ShopUI.prototype.getPurchaseFailureMessage = function (result) {
        if (result && result.code === "INSUFFICIENT_FUNDS") return "Không đủ vàng để mua vật phẩm này.";
        return result && result.message ? result.message : "Không thể mua vật phẩm.";
    };

    ShopUI.prototype.render = function (onClose) {
        const container = document.createElement("div");
        container.className = "rpg-modal-container rpg-shop-modal";
        container.id = "rpg-shop-modal";

        const style = document.createElement("style");
        style.textContent = `
            #rpg-shop-modal { color: #eee; background: #111; width: 90%; max-width: 560px; max-height: 85vh; font: 12px monospace; box-sizing: border-box; }
            #rpg-shop-modal .rpg-shop-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 9px 12px; color: #f6b93b; background: #222; border-bottom: 1px solid #333; }
            #rpg-shop-modal .rpg-shop-balance { padding: 8px 12px; color: #38d9a9; border-bottom: 1px solid #333; }
            #rpg-shop-modal .rpg-shop-list { display: grid; gap: 7px; padding: 10px; max-height: calc(85vh - 90px); overflow-y: auto; }
            #rpg-shop-modal .rpg-shop-entry { display: flex; align-items: center; gap: 9px; padding: 8px; background: #242424; border: 1px solid #3a3a3a; border-radius: 4px; }
            #rpg-shop-modal .rpg-shop-icon { width: 32px; height: 32px; object-fit: contain; image-rendering: pixelated; }
            #rpg-shop-modal .rpg-shop-icon-fallback { width: 32px; text-align: center; font-size: 22px; }
            #rpg-shop-modal .rpg-shop-info { flex: 1; min-width: 0; }
            #rpg-shop-modal .rpg-shop-name { color: #fff; font-weight: bold; }
            #rpg-shop-modal .rpg-shop-detail { margin-top: 3px; color: #94a3b8; }
            #rpg-shop-modal .rpg-shop-buy { padding: 6px 9px; color: #111; background: #f6b93b; border: 0; border-radius: 3px; cursor: pointer; font: inherit; }
            #rpg-shop-modal .rpg-shop-buy:disabled { opacity: .55; cursor: wait; }
            #rpg-shop-modal .rpg-shop-close { padding: 4px 8px; color: #fff; background: #3a3a3a; border: 1px solid #666; border-radius: 3px; cursor: pointer; font: inherit; }
        `;
        container.appendChild(style);

        const header = document.createElement("div");
        header.className = "rpg-shop-header";
        header.appendChild(this.createText("strong", "", "Cửa hàng vật phẩm"));
        const closeButton = this.createText("button", "rpg-shop-close", "✕");
        closeButton.type = "button";
        closeButton.title = "Đóng";
        closeButton.addEventListener("click", onClose);
        header.appendChild(closeButton);
        container.appendChild(header);

        const balance = this.inventoryService && Number.isSafeInteger(this.inventoryService.balance)
            ? this.inventoryService.balance : 0;
        container.appendChild(this.createText("div", "rpg-shop-balance", "Số vàng: ₽ " + balance.toLocaleString("vi-VN")));

        const list = document.createElement("div");
        list.className = "rpg-shop-list";
        this.getBuyableItems().forEach((item) => {
            const entry = document.createElement("div");
            entry.className = "rpg-shop-entry";
            if (item.sprite) {
                const icon = document.createElement("img");
                icon.className = "rpg-shop-icon";
                icon.src = item.sprite;
                icon.alt = item.name || item.id;
                icon.addEventListener("error", () => {
                    icon.replaceWith(this.createText("span", "rpg-shop-icon-fallback", item.icon || "📦"));
                }, { once: true });
                entry.appendChild(icon);
            } else {
                entry.appendChild(this.createText("span", "rpg-shop-icon-fallback", item.icon || "📦"));
            }

            const info = document.createElement("div");
            info.className = "rpg-shop-info";
            info.appendChild(this.createText("div", "rpg-shop-name", item.name || item.id));
            const quantity = this.inventoryService && typeof this.inventoryService.getItemQuantity === "function"
                ? this.inventoryService.getItemQuantity(item.id) : 0;
            info.appendChild(this.createText("div", "rpg-shop-detail", `Giá: ₽ ${item.shop.buyPrice} · Đang có: ${quantity}`));
            entry.appendChild(info);

            const buyButton = this.createText("button", "rpg-shop-buy", "Mua");
            buyButton.type = "button";
            buyButton.addEventListener("click", async () => {
                buyButton.disabled = true;
                buyButton.textContent = "Đang mua…";
                const result = this.inventoryService && typeof this.inventoryService.buyItem === "function"
                    ? await this.inventoryService.buyItem(item.id)
                    : { success: false, message: "Economy service chưa sẵn sàng." };
                if (result.success) {
                    this.modalManager.showToast(`Đã mua ${item.name}.`, 2400);
                    this.modalManager.showModalContent("shop");
                } else {
                    this.modalManager.showToast(this.getPurchaseFailureMessage(result), 3000);
                    buyButton.disabled = false;
                    buyButton.textContent = "Mua";
                }
            });
            entry.appendChild(buyButton);
            list.appendChild(entry);
        });

        if (!this.getBuyableItems().length) {
            list.appendChild(this.createText("div", "rpg-empty-state", "Hiện không có vật phẩm nào để mua."));
        }
        container.appendChild(list);
        return container;
    };

    if (typeof module !== "undefined" && module.exports) module.exports = ShopUI;
    else global.PokeShopUI = ShopUI;
})(typeof window !== "undefined" ? window : global);
