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
            description: "Dược phẩm dạng xịt phục hồi 20 HP cho nhân vật hoặc Pokémon.",
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
            description: "Thuốc hồi phục nồng độ cao phục hồi 50 HP.",
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
            description: "Thuốc giải độc đặc hiệu. Có thể giải trừ trạng thái nhiễm độc.",
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
            description: "Thiết bị hình cầu cơ bản để thu phục Pokémon hoang dã.",
            isUsable: false, // Battle system not implemented yet, so unusable in field
            unusableReason: "Chỉ có thể sử dụng khi tham gia trận đấu (Battle Scene).",
            isEquipment: false
        },
        "great_ball": {
            id: "great_ball",
            name: "Great Ball",
            category: CATEGORIES.POKEBALL,
            icon: "🔵",
            description: "Bóng bắt bóng chất lượng cao với tỷ lệ bắt tốt hơn Poké Ball.",
            isUsable: false,
            unusableReason: "Chỉ có thể sử dụng khi tham gia trận đấu (Battle Scene).",
            isEquipment: false
        },
        "ultra_ball": {
            id: "ultra_ball",
            name: "Ultra Ball",
            category: CATEGORIES.POKEBALL,
            icon: "🟡",
            description: "Bóng bắt siêu cấp với tỷ lệ bắt cực kỳ ổn định.",
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
            description: "Bản đồ du hành vùng đất, ghi nhận tất cả làng mạc và tuyến đường.",
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
            description: "Trứng may mắn mang lại cảm giác bình an cho người nắm giữ.",
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
            description: "Bình xịt tạo mùi xua đuổi quái vật hoang dã trong 100 bước chân.",
            isUsable: true,
            isEquipment: false,
            effect: {
                type: "REPEL",
                steps: 100,
                description: "Xua đuổi quái trong 100 bước"
            }
        }
    };

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
        }
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = ItemCatalog;
    } else {
        global.PokeItemCatalog = ItemCatalog;
    }
})(typeof window !== "undefined" ? window : global);
