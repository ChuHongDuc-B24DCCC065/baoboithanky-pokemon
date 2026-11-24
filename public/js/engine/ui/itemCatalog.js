/**
 * Item Catalog & Metadata Dictionary for Poké-Engine
 * Defines static item specifications, categories, equipment slot tags, and usability rules.
 */
(function (global) {
    "use strict";

    const CATEGORIES = {
        RECOVERY: "recovery",
        POKEBALL: "pokeball",
        KEY_ITEM: "key_item",
        OTHER: "other"
    };

    const CATEGORY_NAMES = {
        [CATEGORIES.RECOVERY]: "Hồi phục",
        [CATEGORIES.POKEBALL]: "Poké Ball",
        [CATEGORIES.KEY_ITEM]: "Vật phẩm chính",
        [CATEGORIES.OTHER]: "Khác"
    };

    const EQUIPMENT_SLOTS = {
        ARMOR: "armor",
        SHOES: "shoes",
        ACCESSORY: "accessory",
        HELD_ITEM: "held_item"
    };

    const EQUIPMENT_SLOT_NAMES = {
        [EQUIPMENT_SLOTS.ARMOR]: "Áo giáp / Trang phục",
        [EQUIPMENT_SLOTS.SHOES]: "Giày thám hiểm",
        [EQUIPMENT_SLOTS.ACCESSORY]: "Phụ kiện",
        [EQUIPMENT_SLOTS.HELD_ITEM]: "Vật phẩm giữ"
    };

    /**
     * Item Definitions Catalog
     */
    const ITEMS = {
        // --- 1. RECOVERY ITEMS ---
        "potion_standard": {
            id: "potion_standard",
            name: "Potion",
            category: CATEGORIES.RECOVERY,
            icon: "🧪",
            sprite: "/res/items/medicine/potion.png",
            description: "Dược phẩm dạng xịt phục hồi 20 HP cho nhân vật hoặc Pokémon.",
            shop: { buyable: true, buyPrice: 300, sellable: true, sellPrice: 150 },
            isUsable: true,
            isEquipment: false,
            effect: {
                type: "HEAL_HP",
                amount: 20,
                description: "Hồi 20 HP"
            }
        },
        "super_potion": {
            id: "super_potion",
            name: "Super Potion",
            category: CATEGORIES.RECOVERY,
            icon: "💊",
            sprite: "/res/items/medicine/super-potion.png",
            description: "Thuốc hồi phục nồng độ cao phục hồi 50 HP.",
            shop: { buyable: true, buyPrice: 300, sellable: true, sellPrice: 150 },
            isUsable: true,
            isEquipment: false,
            effect: {
                type: "HEAL_HP",
                amount: 50,
                description: "Hồi 50 HP"
            }
        },
        "antidote": {
            id: "antidote",
            name: "Antidote",
            category: CATEGORIES.RECOVERY,
            icon: "💉",
            sprite: "/res/items/medicine/antidote.png",
            description: "Thuốc giải độc đặc hiệu. Có thể giải trừ trạng thái nhiễm độc.",
            shop: { buyable: true, buyPrice: 300, sellable: true, sellPrice: 150 },
            isUsable: true,
            isEquipment: false,
            effect: {
                type: "CURE_STATUS",
                status: "POISON",
                description: "Giải độc"
            }
        },

        // --- 2. POKÉ BALLS ---
        "poke_ball": {
            id: "poke_ball",
            name: "Poké Ball",
            category: CATEGORIES.POKEBALL,
            icon: "🔴",
            sprite: "/res/items/ball/poke.png",
            description: "Thiết bị hình cầu cơ bản để thu phục Pokémon hoang dã.",
            shop: { buyable: true, buyPrice: 300, sellable: true, sellPrice: 150 },
            isUsable: false, // Battle system not implemented yet, so unusable in field
            unusableReason: "Chỉ có thể sử dụng khi tham gia trận đấu (Battle Scene).",
            isEquipment: false
        },
        "great_ball": {
            id: "great_ball",
            name: "Great Ball",
            category: CATEGORIES.POKEBALL,
            icon: "🔵",
            sprite: "/res/items/ball/great.png",
            description: "Bóng bắt bóng chất lượng cao với tỷ lệ bắt tốt hơn Poké Ball.",
            shop: { buyable: true, buyPrice: 300, sellable: true, sellPrice: 150 },
            isUsable: false,
            unusableReason: "Chỉ có thể sử dụng khi tham gia trận đấu (Battle Scene).",
            isEquipment: false
        },
        "ultra_ball": {
            id: "ultra_ball",
            name: "Ultra Ball",
            category: CATEGORIES.POKEBALL,
            icon: "🟡",
            sprite: "/res/items/ball/ultra.png",
            description: "Bóng bắt siêu cấp với tỷ lệ bắt cực kỳ ổn định.",
            shop: { buyable: true, buyPrice: 300, sellable: true, sellPrice: 150 },
            isUsable: false,
            unusableReason: "Chỉ có thể sử dụng khi tham gia trận đấu (Battle Scene).",
            isEquipment: false
        },

        // --- 3. KEY ITEMS ---
        "town_map": {
            id: "town_map",
            name: "Bản đồ vùng",
            category: CATEGORIES.KEY_ITEM,
            icon: "🗺️",
            sprite: "/res/items/key-item/town-map.png",
            description: "Bản đồ du hành vùng đất, ghi nhận tất cả làng mạc và tuyến đường.",
            shop: { buyable: false, buyPrice: null, sellable: false, sellPrice: null },
            isUsable: true,
            isEquipment: false,
            effect: {
                type: "OPEN_MAP",
                description: "Xem bản đồ"
            }
        },
        "pokedex_prototype": {
            id: "pokedex_prototype",
            name: "Pokédex (Bản thử nghiệm)",
            category: CATEGORIES.KEY_ITEM,
            icon: "📟",
            description: "Bách khoa toàn thư bỏ túi ghi chép thông tin các loài Pokémon.",
            shop: { buyable: false, buyPrice: null, sellable: false, sellPrice: null },
            isUsable: false,
            unusableReason: "Hệ thống cơ sở dữ liệu Pokémon chưa sẵn sàng.",
            isEquipment: false
        },
        "running_shoes": {
            id: "running_shoes",
            name: "Giày chạy bộ (Running Shoes)",
            category: CATEGORIES.KEY_ITEM,
            icon: "👟",
            description: "Đôi giày thể thao đặc biệt giúp người chơi di chuyển linh hoạt trên mọi nẻo đường.",
            shop: { buyable: false, buyPrice: null, sellable: false, sellPrice: null },
            isUsable: false,
            isEquipment: true,
            equipmentSlot: EQUIPMENT_SLOTS.SHOES,
            stats: {
                speed: 10,
                defense: 2
            }
        },

        // --- 4. OTHER ITEMS & EQUIPMENT ---
        "leather_jacket": {
            id: "leather_jacket",
            name: "Áo khoác thám hiểm",
            category: CATEGORIES.OTHER,
            icon: "🧥",
            description: "Áo khoác da bền chắc giúp chống đỡ sương gió và va quẹt trong rừng thẳm.",
            shop: { buyable: true, buyPrice: 300, sellable: true, sellPrice: 150 },
            isUsable: false,
            isEquipment: true,
            equipmentSlot: EQUIPMENT_SLOTS.ARMOR,
            stats: {
                defense: 15,
                maxHp: 20
            }
        },
        "lucky_egg": {
            id: "lucky_egg",
            name: "Lucky Egg",
            category: CATEGORIES.OTHER,
            icon: "🥚",
            sprite: "/res/items/hold-item/lucky-egg.png",
            description: "Trứng may mắn mang lại cảm giác bình an cho người nắm giữ.",
            shop: { buyable: true, buyPrice: 300, sellable: true, sellPrice: 150 },
            isUsable: false,
            isEquipment: true,
            equipmentSlot: EQUIPMENT_SLOTS.HELD_ITEM,
            stats: {
                luck: 10,
                expBonus: 5
            }
        },
        "silver_pendant": {
            id: "silver_pendant",
            name: "Mặt dây chuyền bạc",
            category: CATEGORIES.OTHER,
            icon: "📿",
            description: "Mặt dây chuyền tinh xảo bằng bạc sáng, tỏa ra từ trường nhẹ.",
            shop: { buyable: false, buyPrice: null, sellable: false, sellPrice: null },
            isUsable: false,
            isEquipment: true,
            equipmentSlot: EQUIPMENT_SLOTS.ACCESSORY,
            stats: {
                defense: 5,
                luck: 5
            }
        },
        "repel": {
            id: "repel",
            name: "Repel",
            category: CATEGORIES.OTHER,
            icon: "🧴",
            sprite: "/res/items/other-item/repel.png",
            description: "Bình xịt tạo mùi xua đuổi quái vật hoang dã trong 100 bước chân.",
            shop: { buyable: true, buyPrice: 300, sellable: true, sellPrice: 150 },
            isUsable: true,
            isEquipment: false,
            effect: {
                type: "REPEL",
                steps: 100,
                description: "Xua đuổi quái trong 100 bước"
            }
        }
    };

    Object.entries(ITEMS).forEach(([itemId, item]) => {
        if (item.id === undefined) item.id = itemId;
        if (item.icon === undefined) item.icon = "📦";
        if (item.sprite === undefined) item.sprite = null;
        if (item.description === undefined) item.description = "";
        if (item.isUsable === undefined) item.isUsable = false;
        if (item.unusableReason === undefined) item.unusableReason = null;
        if (item.isEquipment === undefined) item.isEquipment = false;
        if (item.equipmentSlot === undefined) item.equipmentSlot = null;
        if (item.stats === undefined) item.stats = null;
        if (item.effect === undefined) item.effect = null;
        if (item.shop === undefined) item.shop = { buyable: false, buyPrice: null, sellable: false, sellPrice: null };
    });

    const ItemCatalog = {
        CATEGORIES,
        CATEGORY_NAMES,
        EQUIPMENT_SLOTS,
        EQUIPMENT_SLOT_NAMES,
        ITEMS,

        getItem: function (id) {
            return ITEMS[id] || null;
        },

        getItemsByCategory: function (category) {
            return Object.values(ITEMS).filter(item => item.category === category);
        },

        getEquipmentBySlot: function (slot) {
            return Object.values(ITEMS).filter(item => item.isEquipment && item.equipmentSlot === slot);
        },

        applyServerMetadata: function (remoteItems) {
            if (!Array.isArray(remoteItems) || remoteItems.length !== Object.keys(ITEMS).length) return false;
            const normalized = Object.create(null);
            for (const remote of remoteItems) {
                if (!remote || typeof remote.id !== "string" || !ITEMS[remote.id] || normalized[remote.id] ||
                    typeof remote.name !== "string" || !remote.name.trim() || remote.name.trim().length > 80 ||
                    typeof remote.description !== "string" || remote.description.length > 500 ||
                    !remote.shop || typeof remote.shop !== "object" || Array.isArray(remote.shop)) return false;

                const shop = remote.shop;
                if (typeof shop.buyable !== "boolean" || typeof shop.sellable !== "boolean" ||
                    (shop.buyable ? !Number.isSafeInteger(shop.buyPrice) || shop.buyPrice <= 0 : shop.buyPrice !== null) ||
                    (shop.sellable ? !Number.isSafeInteger(shop.sellPrice) || shop.sellPrice <= 0 : shop.sellPrice !== null)) return false;

                normalized[remote.id] = {
                    name: remote.name.trim(),
                    description: remote.description,
                    shop: {
                        buyable: shop.buyable,
                        buyPrice: shop.buyPrice,
                        sellable: shop.sellable,
                        sellPrice: shop.sellPrice
                    }
                };
            }
            if (Object.keys(normalized).length !== Object.keys(ITEMS).length) return false;
            Object.keys(normalized).forEach(function (itemId) {
                ITEMS[itemId].name = normalized[itemId].name;
                ITEMS[itemId].description = normalized[itemId].description;
                ITEMS[itemId].shop = normalized[itemId].shop;
            });
            return true;
        }
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = ItemCatalog;
    } else {
        global.PokeItemCatalog = ItemCatalog;
    }
})(typeof window !== "undefined" ? window : global);
