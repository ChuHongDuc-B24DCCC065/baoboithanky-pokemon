/**
 * Pokémon Party Service for Poké-Engine
 * Manages player's active team of up to 6 Pokémon instances.
 * Automatically synchronizes with PokedexProgressService (CAUGHT status).
 */
(function (global) {
    "use strict";

    const MAX_PARTY_SIZE = 6;

    /**
     * @param {Object} game - Game instance reference
     * @param {Object} progressService - PokedexProgressService instance
     * @param {string} [userId] - User ID for prototype scoped storage
     */
    const PokemonPartyService = function (game, progressService, userId, speciesCatalog, partySnapshot, options) {
        this.game = game;
        this.progressService = progressService;
        this.speciesCatalog = Array.isArray(speciesCatalog) ? speciesCatalog : [];
        this.userId = userId || (game && game.savedData ? game.savedData.userId : "guest");
        this.storagePrefix = "poke_proto_" + this.userId + "_";
        this.party = []; // Array of PokemonInstance (0 to 6)
        this.activePokemonId = null;
        this.starterChosen = false;
        this.revision = -1;
        this.updatedAt = null;
        this.migration = null;
        this.isReady = false;
        this.isSynchronized = false;
        this._serverSnapshot = null;
        this._pendingMutation = null;
        this._mutationQueue = Promise.resolve();
        this._fetch = options && options.fetch ? options.fetch : (typeof fetch === "function" ? fetch.bind(global) : null);
        this._listeners = [];
        this._passiveRecoveryTimer = null;
        this._lastPassiveRecoveryAt = Date.now();
        this._lastPersistedRecoveryState = null;

        if (partySnapshot) this.applySnapshot(partySnapshot, false);
        this._lastPersistedRecoveryState = this.getRecoveryStateSnapshot();
        this.startPassiveRecovery();
    };

    PokemonPartyService.MAX_PARTY_SIZE = MAX_PARTY_SIZE;

    PokemonPartyService.prototype.applySpeciesMetadata = function () {
        let changed = false;
        this.party.forEach((pokemon) => {
            if (!pokemon) return;
            const species = this.speciesCatalog.find((entry) => entry && String(entry.id) === String(pokemon.speciesId));
            if (!species) return;
            pokemon.name = species.name || pokemon.name;
            pokemon.types = Array.isArray(species.types) ? [...species.types] : pokemon.types;
            pokemon.baseStats = species.baseStats ? { ...species.baseStats } : pokemon.baseStats;
            pokemon.sprite = species.assets && species.assets.front
                ? species.assets.front
                : `/res/pokemon/sprites/animated/${pokemon.speciesId}.gif`;
            if (typeof pokemon.recalculateStats === "function") pokemon.recalculateStats();
            changed = true;
        });
        if (changed) this.notifyChange();
        return changed;
    };

    PokemonPartyService.prototype.applySnapshot = function (snapshot, notify) {
        if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.pokemon) ||
            snapshot.pokemon.length > MAX_PARTY_SIZE || !Number.isSafeInteger(snapshot.revision) ||
            typeof snapshot.starterChosen !== "boolean" || !snapshot.migration || snapshot.migration.status !== "completed") {
            this.isReady = false;
            this.isSynchronized = false;
            return false;
        }
        const InstanceClass = (typeof PokePokemonInstance !== "undefined")
            ? PokePokemonInstance
            : (typeof require !== "undefined" ? require("./pokemonInstance") : null);
        if (!InstanceClass || typeof InstanceClass.fromJSON !== "function") return false;
        const party = snapshot.pokemon.map((data) => InstanceClass.fromJSON(data));
        if (party.some((pokemon) => !pokemon)) return false;
        this.party = party;
        this.activePokemonId = snapshot.activePokemonId;
        this.starterChosen = snapshot.starterChosen;
        this.revision = snapshot.revision;
        this.updatedAt = Number.isFinite(snapshot.updatedAt) ? snapshot.updatedAt : Date.now();
        this.migration = { ...snapshot.migration };
        this._serverSnapshot = {
            schemaVersion: snapshot.schemaVersion,
            pokemon: party.map((pokemon) => pokemon.toJSON()),
            activePokemonId: this.activePokemonId,
            starterChosen: this.starterChosen,
            migration: { ...this.migration },
            revision: this.revision,
            updatedAt: this.updatedAt
        };
        this._lastPassiveRecoveryAt = this.updatedAt;
        this.isReady = true;
        this.isSynchronized = true;
        this.applySpeciesMetadata();
        if (notify) this.notifyChange();
        return true;
    };

    PokemonPartyService.prototype.loadFromStorage = function () {
        // Party data is loaded from the authenticated Firestore snapshot during boot.
        return false;
    };

    PokemonPartyService.prototype.saveToStorage = function () {
        return this.syncCurrentParty();
    };

    PokemonPartyService.prototype._newOperationId = function () {
        if (global.crypto && typeof global.crypto.randomUUID === "function") return global.crypto.randomUUID();
        return "party_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
    };

    PokemonPartyService.prototype._fetchWithTimeout = async function (url, options) {
        if (!this._fetch) throw new Error("Party API fetch is unavailable.");
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timeoutId = controller ? setTimeout(() => controller.abort(), 10000) : null;
        try {
            return await this._fetch(url, { ...(options || {}), credentials: "same-origin", signal: controller ? controller.signal : undefined });
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    };

    PokemonPartyService.prototype._sendPendingMutation = async function () {
        const pending = this._pendingMutation;
        if (!pending) return { success: true, unchanged: true };
        let lastError = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const csrfResponse = await this._fetchWithTimeout("/api/auth/csrf-token");
                const csrfBody = await csrfResponse.json();
                const csrfToken = csrfBody && csrfBody.data && csrfBody.data.csrfToken;
                if (!csrfResponse.ok || !csrfToken) {
                    const error = new Error("Không lấy được CSRF token cho Party.");
                    error.status = csrfResponse.status;
                    throw error;
                }
                const response = await this._fetchWithTimeout("/api/party/mutation", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
                    body: JSON.stringify(pending.payload)
                });
                const body = await response.json();
                if (response.ok && body && body.success === true && body.data) {
                    const snapshot = body.data;
                    if (!Number.isSafeInteger(snapshot.revision) || !Array.isArray(snapshot.pokemon) ||
                        !snapshot.migration || snapshot.migration.status !== "completed") {
                        throw new Error("Party API trả snapshot không hợp lệ.");
                    }
                    // Keep the exact operation payload until the authoritative response has
                    // been restored locally. If restoration fails after a server commit, the
                    // next retry must reuse the same operation ID instead of creating a new
                    // mutation against a stale revision.
                    if (!this.applySnapshot(snapshot, true)) throw new Error("Không thể khôi phục snapshot Party từ server.");
                    this._pendingMutation = null;
                    this._lastPersistedRecoveryState = this.getRecoveryStateSnapshot();
                    return { success: true, snapshot, alreadyProcessed: snapshot.alreadyProcessed === true };
                }

                const error = new Error(body && body.message ? body.message : "Party API từ chối cập nhật.");
                error.status = response.status;
                error.code = body && body.code;
                error.snapshot = body && body.data;
                if (error.code === "REVISION_CONFLICT" && error.snapshot) {
                    this._pendingMutation = null;
                    this.applySnapshot(error.snapshot, true);
                    this.isSynchronized = true;
                    return { success: false, reason: "REVISION_CONFLICT", message: error.message, snapshot: error.snapshot };
                }
                if (response.status >= 400 && response.status < 500) {
                    this._pendingMutation = null;
                    if (error.snapshot) this.applySnapshot(error.snapshot, true);
                    else if (this._serverSnapshot) this.applySnapshot(this._serverSnapshot, true);
                    this.isSynchronized = !!this._serverSnapshot;
                    return { success: false, reason: error.code || "PARTY_API_REJECTED", message: error.message };
                }
                throw error;
            } catch (error) {
                lastError = error;
                if (error.status && error.status < 500) break;
            }
        }
        this.isSynchronized = false;
        console.error("[PokemonPartyService] Party mutation was not confirmed:", lastError);
        return { success: false, reason: "PARTY_SYNC_FAILED", message: "Không thể xác nhận đồng bộ Party với máy chủ. Hãy thử lại trước khi tiếp tục." };
    };

    PokemonPartyService.prototype._enqueueMutation = function (buildPayload, onSuccess) {
        const execute = async () => {
            if (!this.isReady) return { success: false, reason: "PARTY_NOT_READY", message: "Party chưa được đồng bộ từ máy chủ." };
            if (this._pendingMutation) {
                const retryResult = await this._sendPendingMutation();
                if (!retryResult.success) return retryResult;
            }
            if (!this.isSynchronized) return { success: false, reason: "PARTY_SYNC_FAILED", message: "Party chưa được đồng bộ; thao tác đã bị khóa để bảo vệ dữ liệu." };
            const payload = buildPayload();
            if (!payload) return { success: false, reason: "NO_CHANGE" };
            const serverState = this._serverSnapshot && {
                pokemon: this._serverSnapshot.pokemon,
                activePokemonId: this._serverSnapshot.activePokemonId,
                starterChosen: this._serverSnapshot.starterChosen
            };
            if (serverState && JSON.stringify(payload) === JSON.stringify(serverState)) {
                return { success: true, unchanged: true, snapshot: this._serverSnapshot };
            }
            const operationPayload = {
                operationId: this._newOperationId(),
                expectedRevision: this.revision,
                pokemon: payload.pokemon,
                activePokemonId: payload.activePokemonId,
                starterChosen: payload.starterChosen
            };
            this._pendingMutation = { payload: operationPayload };
            const result = await this._sendPendingMutation();
            if (result.success && typeof onSuccess === "function") onSuccess(result.snapshot);
            return result;
        };
        const queued = this._mutationQueue.then(execute, execute);
        this._mutationQueue = queued.catch(() => {});
        return queued;
    };

    PokemonPartyService.prototype._serializeCandidate = function (candidate) {
        return {
            pokemon: candidate.pokemon.map((pokemon) => pokemon && typeof pokemon.toJSON === "function" ? pokemon.toJSON() : pokemon),
            activePokemonId: candidate.activePokemonId,
            starterChosen: candidate.starterChosen
        };
    };

    PokemonPartyService.prototype.syncCurrentParty = function () {
        return this._enqueueMutation(() => this._serializeCandidate({
            pokemon: this.party,
            activePokemonId: this.activePokemonId,
            starterChosen: this.starterChosen
        }));
    };

    PokemonPartyService.prototype.getRecoveryStateSnapshot = function () {
        return JSON.stringify(this.party.map(function (pokemon) {
            return pokemon ? [
                pokemon.instanceId || null,
                pokemon.currentHp,
                Number.isFinite(pokemon.faintedAt) ? pokemon.faintedAt : null
            ] : null;
        }));
    };

    PokemonPartyService.prototype.startPassiveRecovery = function () {
        if (this._passiveRecoveryTimer !== null) return;
        this._lastPassiveRecoveryAt = Number.isFinite(this.updatedAt) ? this.updatedAt : Date.now();
        this.processPassiveRecovery(Date.now());
        this._passiveRecoveryTimer = setInterval(() => {
            this.processPassiveRecovery(Date.now());
        }, 1000);
    };

    PokemonPartyService.prototype.processPassiveRecovery = function (now) {
        const timestamp = Number.isFinite(now) ? now : Date.now();
        if (this.game && this.game.state === "BATTLE") {
            this._lastPassiveRecoveryAt = timestamp;
            return false;
        }

        const elapsedSeconds = Math.max(0, Math.floor((timestamp - this._lastPassiveRecoveryAt) / 1000));
        this._lastPassiveRecoveryAt = timestamp;

        let changed = false;
        for (let i = 0; i < this.party.length; i++) {
            const pokemon = this.party[i];
            if (!pokemon || !Number.isFinite(pokemon.maxHp) || pokemon.maxHp <= 0 || !Number.isFinite(pokemon.currentHp)) continue;

            if (pokemon.currentHp <= 0) {
                pokemon.currentHp = 0;
                if (!Number.isFinite(pokemon.faintedAt) || pokemon.faintedAt <= 0) {
                    pokemon.faintedAt = timestamp;
                    changed = true;
                    continue;
                }

                if (timestamp - pokemon.faintedAt >= PokemonPartyService.REVIVE_DELAY_MS) {
                    pokemon.currentHp = Math.min(pokemon.maxHp, PokemonPartyService.getRecoveryAmount(pokemon.maxHp));
                    pokemon.faintedAt = null;
                    changed = true;
                }
                continue;
            }

            if (pokemon.faintedAt !== null && pokemon.faintedAt !== undefined) {
                pokemon.faintedAt = null;
                changed = true;
            }
            if (elapsedSeconds > 0 && pokemon.currentHp < pokemon.maxHp) {
                const recovery = PokemonPartyService.getRecoveryAmount(pokemon.maxHp) * elapsedSeconds;
                const nextHp = Math.min(pokemon.maxHp, pokemon.currentHp + recovery);
                if (nextHp !== pokemon.currentHp) {
                    pokemon.currentHp = nextHp;
                    changed = true;
                }
            }
        }

        if (changed) {
            this.notifyChange();
        }
        return changed;
    };

    PokemonPartyService.getRecoveryAmount = function (maxHp) {
        return Math.max(1, Math.floor(maxHp * 0.01));
    };
    PokemonPartyService.REVIVE_DELAY_MS = 120000;

    PokemonPartyService.prototype.onBattleEnd = function (now) {
        const timestamp = Number.isFinite(now) ? now : Date.now();
        let recordedFaint = false;
        this._lastPassiveRecoveryAt = timestamp;
        for (let i = 0; i < this.party.length; i++) {
            const pokemon = this.party[i];
            if (!pokemon || pokemon.currentHp > 0) continue;
            pokemon.currentHp = 0;
            if (!Number.isFinite(pokemon.faintedAt) || pokemon.faintedAt <= 0) {
                pokemon.faintedAt = timestamp;
                recordedFaint = true;
            }
        }
        const activePokemon = this.party.find((pokemon) => pokemon && pokemon.instanceId === this.activePokemonId);
        if (activePokemon && activePokemon.currentHp <= 0) this.activePokemonId = null;
        const recoveryChanged = this.processPassiveRecovery(timestamp);
        if (recordedFaint && !recoveryChanged) this.notifyChange();
        return this.syncCurrentParty().then((result) => {
            if (!result.success) this.isSynchronized = false;
            return { ...result, changed: recordedFaint || recoveryChanged };
        });
    };

    PokemonPartyService.prototype.destroy = function () {
        if (this._passiveRecoveryTimer !== null) {
            clearInterval(this._passiveRecoveryTimer);
            this._passiveRecoveryTimer = null;
        }
    };

    PokemonPartyService.prototype.isStarterChosen = function () {
        return !!this.starterChosen;
    };

    PokemonPartyService.prototype.setStarterChosen = function (chosen) {
        const value = !!chosen;
        if (value === this.starterChosen) return Promise.resolve({ success: true, unchanged: true });
        return this._enqueueMutation(() => this._serializeCandidate({
            pokemon: this.party,
            activePokemonId: this.activePokemonId,
            starterChosen: value
        }));
    };

    PokemonPartyService.prototype.getParty = function () {
        return this.party;
    };

    PokemonPartyService.prototype.getPartySize = function () {
        return this.party.length;
    };

    PokemonPartyService.prototype.isPartyFull = function () {
        return this.party.length >= MAX_PARTY_SIZE;
    };

    PokemonPartyService.prototype.hasStarter = function () {
        return this.isStarterChosen() || this.party.length > 0;
    };

    PokemonPartyService.prototype.getLeadPokemon = function () {
        return this.getActivePokemon();
    };

    PokemonPartyService.prototype.normalizeActivePokemon = function () {
        const selected = this.party.find(function (pokemon) {
            return pokemon && pokemon.instanceId === this.activePokemonId &&
                pokemon.currentHp > 0 && !(typeof pokemon.isFainted === "function" && pokemon.isFainted());
        }, this);
        if (selected) return selected;

        const firstAblePokemon = this.party.find(function (pokemon) {
            return pokemon && pokemon.currentHp > 0 &&
                !(typeof pokemon.isFainted === "function" && pokemon.isFainted());
        });
        this.activePokemonId = firstAblePokemon ? firstAblePokemon.instanceId : null;
        return firstAblePokemon || null;
    };

    PokemonPartyService.prototype.getActivePokemon = function () {
        return this.party.find((pokemon) => pokemon && pokemon.instanceId === this.activePokemonId &&
            pokemon.currentHp > 0 && !(typeof pokemon.isFainted === "function" && pokemon.isFainted())) || null;
    };

    PokemonPartyService.prototype.healActivePokemon = function (amount) {
        const state = this.game && this.game.state;
        if (state !== "NORMAL" && state !== "MENU") {
            return { success: false, reason: "INVALID_GAME_STATE", message: "Chỉ có thể dùng vật phẩm hồi phục bên ngoài trận đấu." };
        }

        const selectedPokemon = this.party.find((pokemon) => pokemon && pokemon.instanceId === this.activePokemonId);
        if (!selectedPokemon) {
            return { success: false, reason: "NO_ACTIVE_POKEMON", message: "Bạn chưa có Pokémon đang xuất chiến để hồi phục." };
        }
        if (selectedPokemon.currentHp <= 0 ||
            (typeof selectedPokemon.isFainted === "function" && selectedPokemon.isFainted())) {
            return { success: false, reason: "FAINTED", message: `${selectedPokemon.name || "Pokémon"} đã faint và không thể dùng thuốc hồi HP.` };
        }
        if (!Number.isFinite(selectedPokemon.maxHp) || selectedPokemon.maxHp <= 0 ||
            !Number.isFinite(selectedPokemon.currentHp) || selectedPokemon.currentHp >= selectedPokemon.maxHp) {
            return { success: false, reason: "FULL_HP", message: `${selectedPokemon.name || "Pokémon"} đã đầy HP.` };
        }

        const healAmount = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0;
        if (healAmount <= 0 || typeof selectedPokemon.heal !== "function") {
            return { success: false, reason: "INVALID_HEAL", message: "Không thể áp dụng hiệu ứng hồi HP cho Pokémon này." };
        }

        const healed = Math.min(healAmount, selectedPokemon.maxHp - selectedPokemon.currentHp);
        if (!Number.isFinite(healed) || healed <= 0) {
            return { success: false, reason: "NO_EFFECT", message: `Thuốc không hồi thêm HP cho ${selectedPokemon.name || "Pokémon"}.` };
        }
        let healedAmount = 0;
        return this._enqueueMutation(() => {
            if (this.activePokemonId !== selectedPokemon.instanceId) return null;
            const party = this.party.map((pokemon) => {
                const clone = typeof PokePokemonInstance !== "undefined"
                    ? PokePokemonInstance.fromJSON(pokemon.toJSON())
                    : require("./pokemonInstance").fromJSON(pokemon.toJSON());
                if (clone.instanceId === this.activePokemonId) healedAmount = clone.heal(healAmount);
                return clone;
            });
            return this._serializeCandidate({ pokemon: party, activePokemonId: this.activePokemonId, starterChosen: this.starterChosen });
        }).then((result) => result.success
            ? { ...result, pokemon: this.getActivePokemon(), healed: healedAmount }
            : { ...result, reason: result.reason || "PARTY_SYNC_FAILED" });
    };

    PokemonPartyService.prototype.getActivePokemonIndex = function () {
        const active = this.getActivePokemon();
        return active ? this.party.indexOf(active) : -1;
    };

    PokemonPartyService.prototype.selectActivePokemon = function (index) {
        if (this.game && this.game.state === "BATTLE") {
            return { success: false, reason: "BATTLE_ACTIVE" };
        }
        if (!Number.isInteger(index) || index < 0 || index >= this.party.length) {
            return { success: false, reason: "INVALID_INDEX" };
        }

        const pokemon = this.party[index];
        if (!pokemon || !(pokemon.currentHp > 0) ||
            (typeof pokemon.isFainted === "function" && pokemon.isFainted())) {
            return { success: false, reason: "FAINTED" };
        }
        if (!pokemon.instanceId) {
            return { success: false, reason: "INVALID_INSTANCE" };
        }

        const changed = this.activePokemonId !== pokemon.instanceId;
        if (!changed) return Promise.resolve({ success: true, changed: false, index, pokemon });
        return this._enqueueMutation(() => {
            if (!this.party.some((member) => member.instanceId === pokemon.instanceId && member.currentHp > 0)) return null;
            return this._serializeCandidate({
                pokemon: this.party,
                activePokemonId: pokemon.instanceId,
                starterChosen: this.starterChosen
            });
        }).then((result) => result.success
            ? { ...result, changed: true, index, pokemon: this.getActivePokemon() }
            : { ...result, changed: false });
    };

    PokemonPartyService.prototype.getPokemon = function (index) {
        if (index >= 0 && index < this.party.length) {
            return this.party[index];
        }
        return null;
    };

    PokemonPartyService.prototype.releasePokemon = function (instanceId) {
        const state = this.game && this.game.state;
        if (state !== "NORMAL" && state !== "MENU") {
            return { success: false, reason: "INVALID_GAME_STATE" };
        }
        if (typeof instanceId !== "string" || !instanceId) {
            return { success: false, reason: "INVALID_INSTANCE" };
        }

        const index = this.party.findIndex((pokemon) => pokemon && pokemon.instanceId === instanceId);
        if (index < 0) return { success: false, reason: "NOT_FOUND" };

        const releasedPokemon = this.party[index];
        return this._enqueueMutation(() => {
            if (!this.party.some((pokemon) => pokemon && pokemon.instanceId === instanceId)) return null;
            const party = this.party.filter((pokemon) => pokemon.instanceId !== instanceId);
            let activePokemonId = this.activePokemonId;
            let starterChosen = this.starterChosen;
            if (party.length === 0) {
                activePokemonId = null;
                starterChosen = false;
            } else if (!party.some((pokemon) => pokemon.instanceId === activePokemonId && pokemon.currentHp > 0)) {
                const next = party.find((pokemon) => pokemon.currentHp > 0);
                activePokemonId = next ? next.instanceId : null;
            }
            return this._serializeCandidate({ pokemon: party, activePokemonId, starterChosen });
        }).then((result) => result.success
            ? { ...result, pokemon: releasedPokemon, activePokemon: this.getActivePokemon(), partySize: this.party.length }
            : result);
    };

    /**
     * Adds a Pokémon instance to party.
     * Only marks CAUGHT in progressService when explicitly flagged as a new acquisition event (isNewCapture: true).
     * @param {PokemonInstance} instance
     * @param {Object} [options]
     * @param {boolean} [options.isNewCapture=false]
     * @returns {{ success: boolean, reason?: string, index?: number, pokemon?: PokemonInstance }}
     */
    PokemonPartyService.prototype.addPokemon = function (instance, options) {
        options = options || {};
        if (!instance || !instance.speciesId) {
            return { success: false, reason: "INVALID_INSTANCE" };
        }

        if (this.isPartyFull()) {
            return { success: false, reason: "PARTY_FULL" };
        }

        return this._enqueueMutation(() => {
            const pokemon = this.party.map((member) => member.toJSON());
            if (pokemon.length >= MAX_PARTY_SIZE || pokemon.some((member) => member.instanceId === instance.instanceId)) return null;
            const wasEmpty = pokemon.length === 0;
            pokemon.push(typeof instance.toJSON === "function" ? instance.toJSON() : instance);
            const activePokemonId = wasEmpty && instance.currentHp > 0 && this.activePokemonId === null
                ? instance.instanceId
                : this.activePokemonId;
            return {
                pokemon,
                activePokemonId,
                starterChosen: this.starterChosen || wasEmpty || options.isStarter === true
            };
        }, () => {
            if (options.isNewCapture && this.progressService && typeof this.progressService.markCaught === "function") {
                this.progressService.markCaught(instance.speciesId);
            }
        }).then((result) => result.success
            ? { ...result, index: this.party.findIndex((pokemon) => pokemon.instanceId === instance.instanceId), pokemon: this.party.find((pokemon) => pokemon.instanceId === instance.instanceId) }
            : result);
    };

    PokemonPartyService.prototype.onChange = function (callback) {
        if (typeof callback === "function") {
            this._listeners.push(callback);
        }
    };

    PokemonPartyService.prototype.offChange = function (callback) {
        const index = this._listeners.indexOf(callback);
        if (index !== -1) this._listeners.splice(index, 1);
    };

    PokemonPartyService.prototype.notifyChange = function () {
        const currentParty = [...this.party];
        for (let i = 0; i < this._listeners.length; i++) {
            try {
                this._listeners[i](currentParty);
            } catch (err) {
                console.error("[PokemonPartyService] Listener error:", err);
            }
        }
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = PokemonPartyService;
    } else {
        global.PokePokemonPartyService = PokemonPartyService;
    }
})(typeof window !== "undefined" ? window : global);
