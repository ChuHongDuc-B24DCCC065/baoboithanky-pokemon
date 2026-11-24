/**
 * Pokémon Instance Model for Poké-Engine
 * Represents a concrete Pokémon creature instance (runtime entity).
 * Supports level, dynamic stats scaling, current HP, and battle status.
 */
(function (global) {
    "use strict";

    const MAX_LEVEL = 100;

    function calculateStats(baseStats, level) {
        // Growth is always recalculated from immutable species base stats.
        // Level 1 uses base stats; each next level multiplies by 1.2.
        const multiplier = Math.pow(1.2, Math.max(0, level - 1));
        const scaled = function (stat) {
            return Math.floor((Number(baseStats[stat]) || 0) * multiplier);
        };
        return {
            maxHp: scaled("hp"),
            stats: {
                attack: scaled("attack"),
                defense: scaled("defense"),
                speed: scaled("speed"),
                special: scaled("special")
            }
        };
    }

    /**
     * @param {Object} speciesData - Entry from species.json
     * @param {number} [level=5] - Level of Pokémon instance
     */
    const PokemonInstance = function (speciesData, level) {
        if (!speciesData) {
            throw new Error("[PokemonInstance] speciesData is required");
        }

        this.instanceId = "pkmn_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
        this.speciesId = String(speciesData.id || "001").padStart(3, "0");
        this.nationalDex = speciesData.nationalDex || parseInt(this.speciesId, 10) || 1;
        this.name = speciesData.name || "Unknown";
        this.level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level || 5)));
        this.exp = 0;
        this.types = Array.isArray(speciesData.types) ? [...speciesData.types] : ["NORMAL"];

        const base = speciesData.baseStats || {
            hp: 45,
            attack: 45,
            defense: 45,
            speed: 45,
            special: 45
        };
        this.baseStats = { ...base };

        const calculated = calculateStats(this.baseStats, this.level);
        this.maxHp = calculated.maxHp;
        this.currentHp = this.maxHp;
        this.stats = calculated.stats;
        this.faintedAt = null;

        this.sprite = (speciesData.assets && speciesData.assets.front)
            ? speciesData.assets.front
            : `/res/pokemon/sprites/animated/${this.speciesId}.gif`;

        this.caughtAt = Date.now();
    };

    PokemonInstance.prototype.isFainted = function () {
        return this.currentHp <= 0;
    };

    PokemonInstance.prototype.takeDamage = function (amount) {
        const dmg = Math.max(0, Math.floor(amount || 0));
        this.currentHp = Math.max(0, this.currentHp - dmg);
        return dmg;
    };

    PokemonInstance.prototype.heal = function (amount) {
        const healAmt = Math.max(0, Math.floor(amount || 0));
        const prevHp = this.currentHp;
        this.currentHp = Math.min(this.maxHp, this.currentHp + healAmt);
        return this.currentHp - prevHp;
    };

    PokemonInstance.prototype.recalculateStats = function () {
        const calculated = calculateStats(this.baseStats, this.level);
        this.maxHp = calculated.maxHp;
        this.stats = calculated.stats;
        this.currentHp = Math.max(0, Math.min(this.currentHp, this.maxHp));
    };

    PokemonInstance.prototype.gainExp = function (amount) {
        const gained = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
        const previousLevel = this.level;
        if (gained <= 0 || this.level >= MAX_LEVEL) {
            if (this.level >= MAX_LEVEL) this.exp = 0;
            return {
                expGained: 0,
                previousLevel: previousLevel,
                newLevel: this.level,
                levelsGained: 0,
                exp: this.exp
            };
        }

        this.exp += gained;
        while (this.level < MAX_LEVEL && this.exp >= this.level * 50) {
            this.exp -= this.level * 50;
            this.level++;
            this.recalculateStats();
        }

        if (this.level >= MAX_LEVEL) this.exp = 0;
        return {
            expGained: gained,
            previousLevel: previousLevel,
            newLevel: this.level,
            levelsGained: this.level - previousLevel,
            exp: this.exp
        };
    };

    PokemonInstance.prototype.toJSON = function () {
        return {
            instanceId: this.instanceId,
            speciesId: this.speciesId,
            nationalDex: this.nationalDex,
            name: this.name,
            level: this.level,
            exp: this.exp,
            types: this.types,
            baseStats: this.baseStats,
            maxHp: this.maxHp,
            currentHp: this.currentHp,
            faintedAt: this.faintedAt,
            stats: this.stats,
            sprite: this.sprite,
            caughtAt: this.caughtAt
        };
    };

    /**
     * Recreates a PokemonInstance from serialized JSON data
     * @param {Object} data 
     * @returns {PokemonInstance|null}
     */
    PokemonInstance.fromJSON = function (data) {
        if (!data || !data.speciesId) return null;
        const inst = Object.create(PokemonInstance.prototype);
        inst.instanceId = data.instanceId || ("pkmn_" + Date.now() + "_" + Math.floor(Math.random() * 100000));
        inst.speciesId = String(data.speciesId || "001").padStart(3, "0");
        inst.nationalDex = data.nationalDex || parseInt(inst.speciesId, 10) || 1;
        inst.name = data.name || "Unknown";
        inst.level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(data.level || 5)));
        inst.exp = Number.isFinite(data.exp) && data.exp >= 0 ? Math.floor(data.exp) : 0;
        inst.types = Array.isArray(data.types) ? [...data.types] : ["NORMAL"];
        inst.baseStats = data.baseStats || { hp: 45, attack: 45, defense: 45, speed: 45, special: 45 };
        const calculated = calculateStats(inst.baseStats, inst.level);
        inst.maxHp = calculated.maxHp;
        inst.currentHp = typeof data.currentHp === "number" ? Math.max(0, Math.min(inst.maxHp, data.currentHp)) : inst.maxHp;
        inst.faintedAt = Number.isFinite(data.faintedAt) && data.faintedAt > 0 ? data.faintedAt : null;
        inst.stats = calculated.stats;
        inst.sprite = data.sprite || `/res/pokemon/sprites/animated/${inst.speciesId}.gif`;
        inst.caughtAt = data.caughtAt || Date.now();
        return inst;
    };

    PokemonInstance.MAX_LEVEL = MAX_LEVEL;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = PokemonInstance;
    } else {
        global.PokePokemonInstance = PokemonInstance;
    }
})(typeof window !== "undefined" ? window : global);
