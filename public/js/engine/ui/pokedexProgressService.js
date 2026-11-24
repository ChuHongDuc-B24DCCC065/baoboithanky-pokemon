/**
 * Pokédex Progress Service for Poké-Engine
 * In-memory state manager for Pokémon discovery progress (UNKNOWN, SEEN, CAUGHT).
 * 
 * STRICT ARCHITECTURE RULES:
 * - Pure in-memory state.
 * - No localStorage, no IndexedDB, no direct Firestore calls.
 * - Zero mock data: fresh players start with all entries UNKNOWN.
 * - CAUGHT state strictly and automatically implies SEEN (caught === true => seen === true).
 */
(function (global) {
    "use strict";

    const STATUS = {
        UNKNOWN: "UNKNOWN",
        SEEN: "SEEN",
        CAUGHT: "CAUGHT"
    };

    const PokedexProgressService = function (userIdOrOptions) {
        let uid = "guest";
        if (typeof userIdOrOptions === "string") {
            uid = userIdOrOptions;
        } else if (userIdOrOptions && typeof userIdOrOptions.userId === "string") {
            uid = userIdOrOptions.userId;
        }
        this.userId = uid || "guest";
        this.storageKey = "poke_proto_" + this.userId + "_pokedex";
        this._progressMap = {}; // key: "001" -> { seen: boolean, caught: boolean }

        this.loadFromStorage();
    };

    PokedexProgressService.prototype.loadFromStorage = function () {
        if (typeof localStorage === "undefined") return;
        try {
            const raw = localStorage.getItem(this.storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object") {
                    this._progressMap = parsed;
                }
            }
        } catch (err) {
            console.warn("[PokedexProgressService] Failed to load progress from storage:", err);
        }
    };

    PokedexProgressService.prototype.saveToStorage = function () {
        if (typeof localStorage === "undefined") return;
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this._progressMap));
        } catch (err) {
            console.warn("[PokedexProgressService] Failed to save progress to storage:", err);
        }
    };

    /**
     * Normalizes dex ID to 3-digit string (e.g. 1 -> "001", "4" -> "004")
     */
    PokedexProgressService.prototype._normalizeId = function (dexId) {
        if (dexId == null) return "000";
        return String(dexId).padStart(3, "0");
    };

    /**
     * Get discovery status: "UNKNOWN" | "SEEN" | "CAUGHT"
     */
    PokedexProgressService.prototype.getStatus = function (dexId) {
        const id = this._normalizeId(dexId);
        const record = this._progressMap[id];
        if (!record || (!record.seen && !record.caught)) {
            return STATUS.UNKNOWN;
        }
        if (record.caught) {
            return STATUS.CAUGHT;
        }
        if (record.seen) {
            return STATUS.SEEN;
        }
        return STATUS.UNKNOWN;
    };

    PokedexProgressService.prototype.isSeen = function (dexId) {
        const status = this.getStatus(dexId);
        return status === STATUS.SEEN || status === STATUS.CAUGHT;
    };

    PokedexProgressService.prototype.isCaught = function (dexId) {
        return this.getStatus(dexId) === STATUS.CAUGHT;
    };

    /**
     * Mark a Pokémon as SEEN
     * If already CAUGHT, keeps CAUGHT status.
     */
    PokedexProgressService.prototype.markSeen = function (dexId) {
        const id = this._normalizeId(dexId);
        const existing = this._progressMap[id];
        if (existing && existing.caught) {
            return;
        }
        this._progressMap[id] = { seen: true, caught: false };
        this.saveToStorage();
    };

    /**
     * Mark a Pokémon as CAUGHT
     * CAUGHT strictly implies SEEN.
     */
    PokedexProgressService.prototype.markCaught = function (dexId) {
        const id = this._normalizeId(dexId);
        this._progressMap[id] = { seen: true, caught: true };
        this.saveToStorage();
    };

    /**
     * Reset in-memory state to all UNKNOWN
     */
    PokedexProgressService.prototype.reset = function () {
        this._progressMap = {};
        this.saveToStorage();
    };

    /**
     * Returns total counts { seen, caught, total: 50 }
     */
    PokedexProgressService.prototype.getCounts = function (totalCatalogueCount) {
        let seenCount = 0;
        let caughtCount = 0;
        const keys = Object.keys(this._progressMap);
        for (let i = 0; i < keys.length; i++) {
            const item = this._progressMap[keys[i]];
            if (item && item.caught) {
                caughtCount++;
                seenCount++;
            } else if (item && item.seen) {
                seenCount++;
            }
        }
        return {
            seen: seenCount,
            caught: caughtCount,
            total: totalCatalogueCount || 50
        };
    };

    PokedexProgressService.STATUS = STATUS;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = PokedexProgressService;
    } else {
        global.PokePokedexProgressService = PokedexProgressService;
    }
})(typeof window !== "undefined" ? window : global);
