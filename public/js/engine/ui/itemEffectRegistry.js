/**
 * Item Effect Handler Registry for Poké-Engine
 * Dispatches catalog effects by type and returns a structured result.
 */
(function (global) {
    "use strict";

    const handlers = Object.create(null);

    const ItemEffectRegistry = {
        register: function (type, handler) {
            if (typeof type !== "string" || !type || typeof handler !== "function") return false;
            handlers[type] = handler;
            return true;
        },

        execute: function (effect, item, targetContext) {
            const handler = effect && handlers[effect.type];
            if (!handler) {
                return {
                    success: false,
                    consumeItem: false,
                    message: `Vật phẩm ${item && item.name ? item.name : "này"} chưa có hiệu ứng gameplay được hỗ trợ.`
                };
            }

            const result = handler({
                effect,
                item,
                targetContext: targetContext || null
            });
            const validateResult = function (resolved) {
                if (!resolved || typeof resolved.success !== "boolean") {
                    return {
                        success: false,
                        consumeItem: false,
                        message: "Effect handler trả về kết quả không hợp lệ."
                    };
                }
                return resolved;
            };
            return result && typeof result.then === "function"
                ? result.then(validateResult)
                : validateResult(result);
        }
    };

    ItemEffectRegistry.register("HEAL_HP", async function (context) {
        const effect = context.effect;
        const item = context.item;
        const targetContext = context.targetContext;
        const healAmount = effect.amount;
        if (!Number.isFinite(healAmount) || healAmount <= 0) {
            return { success: false, consumeItem: false, message: "Vật phẩm không có lượng hồi HP hợp lệ trong catalog." };
        }
        if (!targetContext || (typeof targetContext.healPokemon !== "function" &&
            typeof targetContext.healHp !== "function")) {
            return { success: false, consumeItem: false, message: "Không tìm thấy Pokémon đang xuất chiến để hồi phục." };
        }

        const healResult = await (typeof targetContext.healPokemon === "function"
            ? targetContext.healPokemon(healAmount)
            : {
                success: true,
                healed: targetContext.healHp(healAmount),
                pokemon: { name: "Trainer" }
            });
        if (!healResult || !healResult.success || !Number.isFinite(healResult.healed) || healResult.healed <= 0) {
            return {
                success: false,
                consumeItem: false,
                message: (healResult && healResult.message) || "Vật phẩm không hồi được HP; vật phẩm chưa bị tiêu thụ."
            };
        }

        return {
            success: true,
            consumeItem: true,
            message: `Đã sử dụng ${item.name}, hồi ${healResult.healed} HP cho ${(healResult.pokemon && healResult.pokemon.name) || "Pokémon"}!`
        };
    });

    ItemEffectRegistry.register("CURE_STATUS", function (context) {
        return {
            success: true,
            consumeItem: true,
            message: `Đã sử dụng ${context.item.name}, giải trừ trạng thái ${context.effect.status || "bất thường"}!`
        };
    });

    ItemEffectRegistry.register("OPEN_MAP", function (context) {
        const targetContext = context.targetContext;
        if (targetContext && typeof targetContext.openMap === "function") {
            targetContext.openMap();
        }
        return {
            success: true,
            consumeItem: false,
            message: "Đã mở bản đồ du hành!"
        };
    });

    ItemEffectRegistry.register("REPEL", function (context) {
        return {
            success: true,
            consumeItem: true,
            message: `Đã xịt ${context.item.name}! Xua đuổi quái vật trong ${context.effect.steps} bước chân.`
        };
    });

    if (typeof module !== "undefined" && module.exports) {
        module.exports = ItemEffectRegistry;
    } else {
        global.PokeItemEffectRegistry = ItemEffectRegistry;
    }
})(typeof window !== "undefined" ? window : global);
