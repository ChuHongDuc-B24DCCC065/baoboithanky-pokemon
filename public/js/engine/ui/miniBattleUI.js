/**
 * Mini Battle & Capture UI Component for Poké-Engine
 * Provides a streamlined battle scene against wild Pokémon:
 * - Displays animated front sprites for wild and lead Pokémon.
 * - Supports throwing Poké Balls with exact inventory tracking.
 * - Prevents ball loss or Pokémon loss when party is full (6/6).
 * - Correctly marks SEEN on encounter and CAUGHT only on successful capture.
 * - Restores movement state and keyboard inputs cleanly upon exit.
 */
(function (global) {
    "use strict";

    const MiniBattleUI = function (game, partyService, progressService, inventoryService) {
        this.game = game;
        this.partyService = partyService;
        this.progressService = progressService;
        this.inventoryService = inventoryService;

        this.wildPokemon = null;
        this.isProcessing = false;
        this.containerEl = null;
        this._throwTimer = null;
        this._runTimer = null;
        this._turnTimer = null;
        this._keyListener = null;
        this.pendingResult = null;
        this.lastResult = null;
        this._battleSequence = 0;
        this._activeBattleId = null;
        this._activeBattleToken = null;
        this._captureSequence = 0;
        this._pendingCaptureId = null;
        this._battleResolved = false;
        this._participantPokemon = null;
        this._expAwardedBattleId = null;
        this._characterExpAwardedBattleId = null;
        this._rewardAwardedBattleId = null;

        this.init();
    };

    MiniBattleUI.prototype.init = function () {
        this.setupDOM();
    };

    MiniBattleUI.prototype.setupDOM = function () {
        if (typeof document === "undefined") return;
        let container = document.getElementById("rpg-battle-container");
        if (!container) {
            container = document.createElement("div");
            container.id = "rpg-battle-container";
            container.style.display = "none";
            // Attach directly to document.body to avoid inheriting pointer-events: none from #modern-hud-root
            const root = document.body || document.getElementById("modern-hud-root");
            root.appendChild(container);
        } else if (container.parentElement && container.parentElement.id === "modern-hud-root") {
            // Relocate to document.body if previously nested inside #modern-hud-root
            document.body.appendChild(container);
        }
        this.containerEl = container;
    };

    /**
     * Launch a wild battle
     * @param {PokemonInstance} wildPokemon
     */
    MiniBattleUI.prototype.startBattle = function (wildPokemon) {
        if (!wildPokemon || (this._activeBattleId !== null && !this._battleResolved)) return false;
        this._activeBattleId = ++this._battleSequence;
        this._activeBattleToken = this.createOperationToken("battle");
        this._captureSequence = 0;
        this._pendingCaptureId = null;
        this._battleResolved = false;
        this._expAwardedBattleId = null;
        this._characterExpAwardedBattleId = null;
        this._rewardAwardedBattleId = null;
        this._participantPokemon = this.partyService && typeof this.partyService.getLeadPokemon === "function"
            ? this.partyService.getLeadPokemon()
            : null;
        this.wildPokemon = wildPokemon;
        this.isProcessing = false;
        this.pendingResult = null;
        this.lastResult = null;

        // Ensure container is attached directly to document.body
        if (this.containerEl && this.containerEl.parentElement && this.containerEl.parentElement.id === "modern-hud-root") {
            document.body.appendChild(this.containerEl);
        }

        // 1. Mark as SEEN immediately in Pokédex
        if (this.progressService && typeof this.progressService.markSeen === "function") {
            this.progressService.markSeen(this.wildPokemon.speciesId);
        }

        // 2. Halt player and lock game state
        if (this.game) {
            this.game.state = "BATTLE";
            this.game.lastBattleResult = null;
            if (this.game.player) {
                this.game.player.stop = true;
            }
            if (this.game.key && this.game.key._pressed) {
                this.game.key._pressed = {};
            }
        }

        this.render();
        if (this.containerEl) {
            this.containerEl.style.display = "flex";
        }

        // Register keyboard shortcuts during battle
        this.setupKeyboard();
        return true;
    };

    MiniBattleUI.prototype.createOperationToken = function (prefix) {
        const randomPart = (global.crypto && typeof global.crypto.randomUUID === "function")
            ? global.crypto.randomUUID()
            : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        return `${prefix}_${Date.now().toString(36)}_${randomPart}`;
    };

    MiniBattleUI.prototype.setupKeyboard = function () {
        this.removeKeyboard();
        if (typeof document === "undefined") return;
        this._keyListener = (e) => {
            if (!this.wildPokemon || (this.game && this.game.state !== "BATTLE")) return;
            if (this.isProcessing) return;
            if (e.key === "1" || e.key === "Enter") {
                e.preventDefault();
                this.throwPokeBall();
            } else if (e.key === "2" || e.key === "Escape" || e.key.toLowerCase() === "r") {
                e.preventDefault();
                this.runAway();
            }
        };
        document.addEventListener("keydown", this._keyListener);
    };

    MiniBattleUI.prototype.removeKeyboard = function () {
        if (this._keyListener && typeof document !== "undefined") {
            document.removeEventListener("keydown", this._keyListener);
            this._keyListener = null;
        }
    };

    MiniBattleUI.prototype.logMessage = function (msg) {
        if (typeof document === "undefined") return;
        const msgEl = document.getElementById("rpg-battle-msg");
        if (msgEl) {
            msgEl.textContent = msg;
        }
    };

    MiniBattleUI.prototype.getBattleDamage = function (attacker, defender) {
        const attack = attacker && attacker.stats && attacker.stats.attack;
        const defense = defender && defender.stats && defender.stats.defense;
        if (!Number.isFinite(attack) || !Number.isFinite(defense) || attack < 0 || defense < 0) return null;
        return Math.max(1, Math.floor((attack * 5) / Math.max(1, defense)));
    };

    MiniBattleUI.prototype.finishWithResult = async function (result, message) {
        if (this.pendingResult || !this.wildPokemon || this._activeBattleId === null) return;
        const battleId = this._activeBattleId;
        this.pendingResult = result;
        this.isProcessing = true;

        if (this.game) this.game.lastBattleResult = result;
        if (result === "WIN") {
            const reward = await this.awardWinReward(battleId);
            if (battleId !== this._activeBattleId || this._battleResolved) return;
            if (reward.success) {
                const battleReward = reward.battleReward;
                if (battleReward) {
                    message += ` Bạn nhận ${battleReward.gold} ₽.`;
                    if (battleReward.itemId) {
                        const catalog = global.PokeItemCatalog;
                        const item = catalog && typeof catalog.getItem === "function" ? catalog.getItem(battleReward.itemId) : null;
                        message += ` Vật phẩm rơi: ${item ? item.name : battleReward.itemId}.`;
                    } else {
                        message += " Không có vật phẩm rơi.";
                    }
                } else {
                    message += " Server đã ghi nhận phần thưởng trận đấu.";
                }
            } else {
                message += ` Không thể xác nhận phần thưởng: ${reward.message || "lỗi Economy API"}.`;
            }

            const expResult = this.awardWinExperience(battleId);
            if (expResult && expResult.expGained > 0) {
                message += ` ${expResult.pokemon.name} nhận ${expResult.expGained} EXP.`;
                if (expResult.levelsGained > 0) {
                    message += ` Lên cấp ${expResult.newLevel}!`;
                }
            } else if (expResult && expResult.atLevelCap) {
                message += ` ${expResult.pokemon.name} đã đạt cấp tối đa ${expResult.newLevel}, không nhận thêm EXP.`;
            }

            const characterResult = this.awardCharacterExperience(battleId);
            if (characterResult && characterResult.expGained > 0) {
                message += ` Bạn nhận ${characterResult.expGained} EXP.`;
                if (characterResult.levelsGained > 0) {
                    message += ` Nhân vật lên cấp ${characterResult.newLevel}!`;
                }
            } else if (characterResult && characterResult.atLevelCap) {
                message += ` Nhân vật đã đạt cấp tối đa ${characterResult.newLevel}, không nhận thêm EXP.`;
            }
        }
        this.logMessage(message);

        const actionsEl = (typeof document !== "undefined") ? document.getElementById("rpg-battle-actions") : null;
        if (!actionsEl) {
            this.endBattle(result);
            return;
        }

        actionsEl.innerHTML = `
            <button type="button" class="rpg-battle-btn btn-finish" style="width: 100%; background: #2ed573; color: #111; font-weight: bold; padding: 8px 16px;">
                Tiếp tục
            </button>
        `;
        const finishButton = actionsEl.querySelector(".btn-finish");
        if (finishButton) {
            finishButton.addEventListener("click", () => this.endBattle(result, battleId));
        } else {
            this.endBattle(result, battleId);
        }
    };

    MiniBattleUI.prototype.awardWinReward = async function (battleId) {
        if (!this.game || this.game.lastBattleResult !== "WIN" ||
            battleId !== this._activeBattleId || this._rewardAwardedBattleId === battleId ||
            !this.inventoryService || typeof this.inventoryService.awardBattleReward !== "function") {
            return { success: false, message: "Economy API phần thưởng chưa sẵn sàng." };
        }

        this._rewardAwardedBattleId = battleId;
        try {
            return await this.inventoryService.awardBattleReward(this._activeBattleToken, this.wildPokemon.level);
        } catch (err) {
            console.warn("[MiniBattleUI] Không thể cấp phần thưởng sau battle:", err && (err.message || err));
            return { success: false, message: err && err.message ? err.message : "lỗi Economy API" };
        }
    };

    MiniBattleUI.prototype.awardWinExperience = function (battleId) {
        if (!this.game || this.game.lastBattleResult !== "WIN" ||
            battleId !== this._activeBattleId || this._expAwardedBattleId === battleId) return null;

        this._expAwardedBattleId = battleId;
        const party = this.partyService && typeof this.partyService.getParty === "function"
            ? this.partyService.getParty()
            : null;
        const participant = this._participantPokemon;
        const activePokemon = this.partyService && typeof this.partyService.getActivePokemon === "function"
            ? this.partyService.getActivePokemon()
            : (Array.isArray(party) ? party[0] : null);
        if (!Array.isArray(party) || !participant || !party.includes(participant) || activePokemon !== participant ||
            typeof participant.gainExp !== "function") return null;

        // Basic battle EXP: award twenty EXP per level of the defeated wild Pokémon.
        const wildLevel = this.wildPokemon && this.wildPokemon.level;
        if (!Number.isFinite(wildLevel) || wildLevel <= 0) return null;
        const amount = Math.floor(wildLevel * 20);
        const previousExp = participant.exp;
        const result = participant.gainExp(amount);

        if (result.expGained > 0 || participant.exp !== previousExp) {
            if (typeof this.partyService.notifyChange === "function") this.partyService.notifyChange();
        }

        return {
            pokemon: participant,
            expGained: result.expGained,
            newLevel: result.newLevel,
            levelsGained: result.levelsGained,
            atLevelCap: participant.level >= 100
        };
    };

    MiniBattleUI.prototype.awardCharacterExperience = function (battleId) {
        if (!this.game || this.game.lastBattleResult !== "WIN" ||
            battleId !== this._activeBattleId || this._characterExpAwardedBattleId === battleId ||
            typeof this.game.gainCharacterExperience !== "function") return null;

        this._characterExpAwardedBattleId = battleId;
        const wildLevel = this.wildPokemon && this.wildPokemon.level;
        if (!Number.isFinite(wildLevel) || wildLevel <= 0) return null;

        const result = this.game.gainCharacterExperience(Math.floor(wildLevel * 20));
        if (!result) return null;
        return {
            expGained: result.expGained,
            newLevel: result.newLevel,
            levelsGained: result.levelsGained,
            atLevelCap: result.atLevelCap
        };
    };

    MiniBattleUI.prototype.attack = function () {
        if (this.isProcessing || !this.wildPokemon || (this.game && this.game.state !== "BATTLE")) return;

        const playerPokemon = this._participantPokemon;
        if (!playerPokemon || typeof playerPokemon.takeDamage !== "function") {
            this.finishWithResult("LOSE", "❌ Bạn không còn Pokémon có thể chiến đấu.");
            return;
        }
        if ((typeof playerPokemon.isFainted === "function" && playerPokemon.isFainted()) || playerPokemon.currentHp <= 0) {
            this.finishWithResult("LOSE", `❌ ${playerPokemon.name} không thể tiếp tục chiến đấu.`);
            return;
        }
        if ((typeof this.wildPokemon.isFainted === "function" && this.wildPokemon.isFainted()) || this.wildPokemon.currentHp <= 0) {
            this.finishWithResult("WIN", `🏆 ${this.wildPokemon.name} đã bị đánh bại! Bạn thắng trận!`);
            return;
        }

        const playerSpeed = playerPokemon.stats && Number.isFinite(playerPokemon.stats.speed) ? playerPokemon.stats.speed : 0;
        const wildSpeed = this.wildPokemon.stats && Number.isFinite(this.wildPokemon.stats.speed) ? this.wildPokemon.stats.speed : 0;
        const playerFirst = playerSpeed === wildSpeed ? Math.random() < 0.5 : playerSpeed > wildSpeed;
        const firstAttacker = playerFirst ? playerPokemon : this.wildPokemon;
        const secondAttacker = playerFirst ? this.wildPokemon : playerPokemon;
        const firstDamage = this.getBattleDamage(firstAttacker, secondAttacker);
        const secondDamage = this.getBattleDamage(secondAttacker, firstAttacker);
        if (firstDamage === null || secondDamage === null ||
            typeof this.wildPokemon.takeDamage !== "function") {
            this.logMessage("❌ Không thể xử lý lượt đấu vì dữ liệu chỉ số chưa sẵn sàng.");
            return;
        }

        this.isProcessing = true;
        secondAttacker.takeDamage(firstDamage);
        if (secondAttacker.currentHp <= 0) {
            this.render();
            if (secondAttacker === this.wildPokemon) {
                this.finishWithResult("WIN", `🏆 ${this.wildPokemon.name} đã bị đánh bại! Bạn thắng trận!`);
            } else {
                this.finishWithResult("LOSE", `💫 ${playerPokemon.name} đã hết HP. Bạn thua trận.`);
            }
            return;
        }

        firstAttacker.takeDamage(secondDamage);
        if (firstAttacker.currentHp <= 0) {
            this.render();
            if (firstAttacker === this.wildPokemon) {
                this.finishWithResult("WIN", `🏆 ${this.wildPokemon.name} đã bị đánh bại! Bạn thắng trận!`);
            } else {
                this.finishWithResult("LOSE", `💫 ${playerPokemon.name} đã hết HP. Bạn thua trận.`);
            }
            return;
        }

        this.render();
        this.logMessage(`${firstAttacker.name} đánh trước và gây ${firstDamage} sát thương. ${secondAttacker.name} phản công ${secondDamage} sát thương.`);
        const battleId = this._activeBattleId;
        this._turnTimer = setTimeout(() => {
            this._turnTimer = null;
            if (this.wildPokemon && this._activeBattleId === battleId && (!this.game || this.game.state === "BATTLE")) {
                this.isProcessing = false;
            }
        }, MiniBattleUI.TURN_LOCK_MS);
    };

    MiniBattleUI.TURN_LOCK_MS = 450;

    /**
     * Handle Throw Poké Ball action
     */
    MiniBattleUI.prototype.throwPokeBall = async function () {
        if (this.isProcessing || !this.wildPokemon || (this.game && this.game.state !== "BATTLE")) return;

        const targetPokemon = this.wildPokemon;
        const currentHp = targetPokemon.currentHp;
        const maxHp = targetPokemon.maxHp;
        if ((typeof targetPokemon.isFainted === "function" && targetPokemon.isFainted()) || currentHp <= 0) {
            this.logMessage("❌ Pokémon đã hết HP và không thể bị bắt.");
            return;
        }
        if (!Number.isFinite(currentHp) || !Number.isFinite(maxHp) || maxHp <= 0) {
            this.logMessage("❌ Không thể xác định HP của Pokémon để bắt.");
            return;
        }

        // Check 1: Party Full Protection (Mandatory condition: no lost balls or lost Pokémon)
        if (!this.partyService || typeof this.partyService.isPartyFull !== "function" ||
            typeof this.partyService.addPokemon !== "function") {
            this.logMessage("❌ Hệ thống Party chưa sẵn sàng. Poké Ball chưa bị tiêu thụ.");
            return;
        }
        if (this.partyService.isPartyFull()) {
            this.logMessage("⚠️ Đội hình đã đầy (6/6 Pokémon)! Không thể bắt thêm khi chưa có PC Box.");
            return;
        }

        // Check 2: Inventory check
        const hasInventoryApi = this.inventoryService &&
            typeof this.inventoryService.getItemQuantity === "function" &&
            typeof this.inventoryService.consumeCaptureBall === "function" &&
            typeof this.inventoryService.refundCaptureBall === "function";
        const ballCount = hasInventoryApi
            ? this.inventoryService.getItemQuantity("poke_ball")
            : 0;

        if (ballCount <= 0) {
            this.logMessage("❌ Túi đồ của bạn đã hết Poké Ball! Không thể ném.");
            return;
        }

        this.isProcessing = true;
        const battleId = this._activeBattleId;
        if (!this._pendingCaptureId) {
            this._pendingCaptureId = this._activeBattleToken + "_capture_" + (++this._captureSequence);
        }
        const captureId = this._pendingCaptureId;
        let consumeResult;
        try {
            consumeResult = await this.inventoryService.consumeCaptureBall(captureId);
        } catch (error) {
            consumeResult = { success: false, message: error && error.message ? error.message : "lỗi Economy API" };
        }
        if (!consumeResult || !consumeResult.success) {
            this.isProcessing = false;
            this.logMessage(`❌ Không thể xác nhận việc sử dụng Poké Ball: ${(consumeResult && consumeResult.message) || "lỗi Economy API"}.`);
            return;
        }
        this._pendingCaptureId = null;
        if (!this.wildPokemon || this._activeBattleId !== battleId || this._battleResolved) {
            const refund = await this.inventoryService.refundCaptureBall(captureId);
            if (!refund.success) console.error("[MiniBattleUI] Không thể hoàn Poké Ball sau khi lượt Battle đã kết thúc:", refund.message);
            this.isProcessing = false;
            return;
        }

        const remainingBalls = this.inventoryService.getItemQuantity("poke_ball");
        this.updateBallButton(remainingBalls);
        this.logMessage(`🔴 Bạn đã ném Poké Ball... (Còn lại: ${remainingBalls})`);

        // A weakened Pokémon is easier to catch. Tune the base and HP bonus here.
        const hpRatio = Math.max(0, Math.min(1, currentHp / maxHp));
        const catchChance = MiniBattleUI.CAPTURE_BASE_CHANCE +
            (1 - hpRatio) * MiniBattleUI.CAPTURE_MISSING_HP_BONUS;
        const roll = Math.random();

        this._throwTimer = setTimeout(async () => {
            this._throwTimer = null;
            if (!this.wildPokemon || this.wildPokemon !== targetPokemon || this._activeBattleId !== battleId || this._battleResolved) return;

            if (roll < catchChance) {
                // SUCCESSFUL CAPTURE
                const result = await this.partyService.addPokemon(targetPokemon, { isNewCapture: true });
                if (!result || !result.success) {
                    // The Party API is the authority for acquisition and Pokédex updates.
                    // Refund the ball if it rejects the instance after the pre-check.
                    let refund = { success: false, message: "Economy API hoàn bóng chưa sẵn sàng." };
                    if (this.inventoryService && typeof this.inventoryService.refundCaptureBall === "function") {
                        refund = await this.inventoryService.refundCaptureBall(captureId);
                    }
                    if (refund.success) this.updateBallButton(this.inventoryService.getItemQuantity("poke_ball"));
                    this.isProcessing = false;
                    const reason = result && result.reason === "PARTY_FULL"
                        ? "Đội hình đã đầy (6/6 Pokémon)!"
                        : "Không thể thêm Pokémon vào Party.";
                    this.logMessage(refund.success
                        ? `⚠️ ${reason} Poké Ball đã được hoàn lại.`
                        : `❌ ${reason} Không thể xác nhận hoàn Poké Ball: ${refund.message || "lỗi Economy API"}.`);
                    return;
                }

                this.logMessage(`✨ Tuyệt vời! Bạn đã bắt thành công ${targetPokemon.name}!`);

                // Show completion button
                const actionsEl = (typeof document !== "undefined") ? document.getElementById("rpg-battle-actions") : null;
                if (actionsEl) {
                    actionsEl.innerHTML = `
                        <button type="button" class="rpg-battle-btn btn-finish" style="width: 100%; background: #2ed573; color: #111; font-weight: bold; padding: 8px 16px;">
                            Thu nhận & Tiếp tục hành trình
                        </button>
                    `;
                    actionsEl.querySelector(".btn-finish").addEventListener("click", () => {
                        this.endBattle("CAUGHT", battleId);
                    });
                } else {
                    this.endBattle("CAUGHT", battleId);
                }
            } else {
                // FAILED CAPTURE
                this.logMessage(`💨 Tiếc quá! ${targetPokemon.name} đã nhảy ra khỏi bóng!`);
                this.isProcessing = false;
            }
        }, 1000);
    };

    MiniBattleUI.CAPTURE_BASE_CHANCE = 0.15;
    MiniBattleUI.CAPTURE_MISSING_HP_BONUS = 0.70;

    /**
     * Handle Run action
     */
    MiniBattleUI.prototype.runAway = function () {
        if (this.isProcessing || !this.wildPokemon || (this.game && this.game.state !== "BATTLE")) return;
        this.isProcessing = true;
        this.logMessage("💨 Bạn đã chạy thoát an toàn!");

        const battleId = this._activeBattleId;
        this._runTimer = setTimeout(() => {
            this._runTimer = null;
            this.endBattle("RUN", battleId);
        }, 600);
    };

    MiniBattleUI.prototype.updateBallButton = function (count) {
        if (typeof document === "undefined") return;
        const btn = document.getElementById("rpg-btn-throw-ball");
        if (btn) {
            btn.textContent = `🔴 Ném Poké Ball (${count})`;
            if (count <= 0 || (this.partyService && this.partyService.isPartyFull())) {
                btn.disabled = true;
                btn.style.opacity = "0.5";
            } else {
                btn.disabled = false;
                btn.style.opacity = "1";
            }
        }
    };

    /**
     * End battle and safely restore player state and controls
     */
    MiniBattleUI.prototype.endBattle = function (reason, battleId) {
        if (this._activeBattleId === null || this._battleResolved ||
            (battleId !== undefined && battleId !== this._activeBattleId)) return false;
        if ((reason === "WIN" || reason === "LOSE") && this.pendingResult !== reason) {
            reason = "CANCELLED";
        }
        const concludedWildPokemon = this.wildPokemon;
        this._battleResolved = true;
        this.removeKeyboard();
        if (this._throwTimer) {
            clearTimeout(this._throwTimer);
            this._throwTimer = null;
        }
        if (this._runTimer) {
            clearTimeout(this._runTimer);
            this._runTimer = null;
        }
        if (this._turnTimer) {
            clearTimeout(this._turnTimer);
            this._turnTimer = null;
        }

        if (this.containerEl) {
            this.containerEl.style.display = "none";
            this.containerEl.innerHTML = "";
        }
        this.wildPokemon = null;
        this.isProcessing = false;
        const result = ["WIN", "LOSE", "RUN", "CAUGHT"].includes(reason) ? reason : "CANCELLED";
        this.pendingResult = null;
        this.lastResult = result;

        // Hold overworld controls until the final Party state is confirmed by the server.
        if (this.game) {
            this.game.state = "PARTY_SYNC";
            this.game.lastBattleResult = result;
            if (this.game.player) {
                this.game.player.stop = true;
                this.game.player.walkInProgress = false;
            }
            if (this.game.key && this.game.key._pressed) {
                this.game.key._pressed = {};
            }
            // Safe cooldown: grant 6 steps before next wild encounter can occur
            this.game.encounterCooldown = 6;
        }
        this._pendingBattleEnd = { result, wildPokemon: concludedWildPokemon, battleId };
        this._completeBattleEndSync();
        return true;
    };

    MiniBattleUI.prototype._completeBattleEndSync = async function () {
        if (this._partyEndSyncPending || !this._pendingBattleEnd) return;
        this._partyEndSyncPending = true;
        let syncResult;
        try {
            if (!this.partyService || typeof this.partyService.onBattleEnd !== "function") {
                throw new Error("Party service is unavailable.");
            }
            syncResult = await this.partyService.onBattleEnd();
        } catch (error) {
            syncResult = { success: false, message: error && error.message ? error.message : "lỗi mạng" };
        }
        this._partyEndSyncPending = false;
        if (!syncResult || !syncResult.success) {
            const reloadRequired = syncResult && ["REVISION_CONFLICT", "PARTY_API_REJECTED"].includes(syncResult.reason);
            this._showPartySyncRetry(syncResult && syncResult.message, reloadRequired);
            return;
        }

        const pending = this._pendingBattleEnd;
        this._pendingBattleEnd = null;
        if (this.containerEl) {
            this.containerEl.style.display = "none";
            this.containerEl.innerHTML = "";
        }
        if (this.game) {
            this.game.state = "NORMAL";
            if (this.game.player) this.game.player.stop = false;
        }
        if (this.game && typeof this.game.resolveOverworldPokemonBattle === "function") {
            try {
                this.game.resolveOverworldPokemonBattle(pending.result, pending.wildPokemon);
            } catch (err) {
                console.warn("[MiniBattleUI] Không thể cập nhật Pokémon overworld sau battle:", err && (err.message || err));
            }
        }
        this._activeBattleId = null;
        this._activeBattleToken = null;
        this._pendingCaptureId = null;
        this._participantPokemon = null;
    };

    MiniBattleUI.prototype._showPartySyncRetry = function (detail, reloadRequired) {
        if (!this.containerEl) return;
        this.containerEl.style.display = "flex";
        this.containerEl.innerHTML = `
            <div style="max-width: 420px; margin: auto; padding: 20px; background: #202020; color: #fff; border: 2px solid #ffb142; border-radius: 10px; text-align: center; font-family: sans-serif;">
                <strong>Chưa thể đồng bộ Party</strong>
                <p class="rpg-party-sync-message"></p>
                <button type="button" class="rpg-party-sync-retry" style="padding: 8px 16px; cursor: pointer;">${reloadRequired ? "Tải lại game để dùng Party mới nhất" : "Thử lại"}</button>
            </div>`;
        const message = this.containerEl.querySelector(".rpg-party-sync-message");
        if (message) message.textContent = (detail || "Trạng thái Pokémon chưa được máy chủ xác nhận.") +
            (reloadRequired ? " Dữ liệu Party đã thay đổi ở phiên khác; hãy tải lại để tiếp tục an toàn." : " Nhân vật sẽ tiếp tục bị khóa để tránh ghi đè dữ liệu.");
        const retry = this.containerEl.querySelector(".rpg-party-sync-retry");
        if (retry) retry.addEventListener("click", () => {
            if (reloadRequired && typeof window !== "undefined" && window.location && typeof window.location.reload === "function") {
                window.location.reload();
                return;
            }
            retry.disabled = true;
            this._completeBattleEndSync();
        });
    };

    MiniBattleUI.prototype.render = function () {
        if (!this.containerEl || !this.wildPokemon) return;

        const wild = this.wildPokemon;
        const lead = this._participantPokemon || (this.partyService ? this.partyService.getLeadPokemon() : null);
        const ballCount = this.inventoryService ? this.inventoryService.getItemQuantity("poke_ball") : 0;
        const isPartyFull = this.partyService ? this.partyService.isPartyFull() : false;
        const wildHpPercent = wild.maxHp > 0 ? Math.max(0, Math.min(100, Math.round((wild.currentHp / wild.maxHp) * 100))) : 0;
        const leadHpPercent = lead && lead.maxHp > 0 ? Math.max(0, Math.min(100, Math.round((lead.currentHp / lead.maxHp) * 100))) : 100;

        this.containerEl.innerHTML = `
            <style>
                #rpg-battle-container {
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                    background: rgba(0, 0, 0, 0.75) !important;
                    z-index: 999999 !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    font-family: monospace;
                    color: #eee;
                    pointer-events: auto !important;
                    user-select: none;
                }
                .rpg-battle-panel {
                    width: 90%;
                    max-width: 440px;
                    background: #181818;
                    border: 2px solid #f6b93b;
                    border-radius: 8px;
                    padding: 14px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.9);
                    box-sizing: border-box;
                    pointer-events: auto !important;
                    position: relative;
                    z-index: 1000000 !important;
                }
                .rpg-battle-arena {
                    background: linear-gradient(180deg, #2c3e50 0%, #1a252f 100%);
                    border-radius: 6px;
                    padding: 12px;
                    margin-bottom: 12px;
                    border: 1px solid #34495e;
                    pointer-events: auto !important;
                }
                .rpg-battle-actor-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    margin-bottom: 12px;
                }
                .rpg-battle-sprite {
                    width: 56px;
                    height: 56px;
                    object-fit: contain;
                    image-rendering: pixelated;
                }
                .rpg-battle-info {
                    flex: 1;
                    margin-left: 12px;
                    background: rgba(0, 0, 0, 0.4);
                    padding: 6px 10px;
                    border-radius: 4px;
                    border: 1px solid #444;
                }
                .rpg-battle-name {
                    font-weight: bold;
                    color: #f6b93b;
                    font-size: 13px;
                }
                .rpg-battle-hp-bar {
                    width: 100%;
                    height: 6px;
                    background: #333;
                    border-radius: 3px;
                    overflow: hidden;
                    margin-top: 4px;
                }
                .rpg-battle-hp-fill {
                    width: 100%;
                    height: 100%;
                    background: #2ed573;
                }
                .rpg-battle-msg-box {
                    background: #111;
                    border: 1px solid #333;
                    border-radius: 4px;
                    padding: 8px 12px;
                    font-size: 12px;
                    color: #fff;
                    min-height: 38px;
                    margin-bottom: 12px;
                    display: flex;
                    align-items: center;
                }
                .rpg-battle-actions {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 8px;
                    pointer-events: auto !important;
                }
                .rpg-battle-btn {
                    padding: 10px 12px;
                    border: 1px solid #555;
                    border-radius: 4px;
                    background: #2c2c2c;
                    color: #fff;
                    cursor: pointer !important;
                    font-size: 12px;
                    font-family: inherit;
                    font-weight: bold;
                    transition: background 0.15s, border-color 0.15s;
                    pointer-events: auto !important;
                    position: relative;
                    z-index: 1000001 !important;
                }
                .rpg-battle-btn:hover:not(:disabled) {
                    background: #3c3c3c;
                    border-color: #f6b93b;
                }
                .rpg-battle-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed !important;
                }
            </style>
            <div class="rpg-battle-panel">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <span style="font-weight: bold; color: #ff4757; font-size: 13px;">⚔️ TRẬN ĐẤU HOANG DÃ</span>
                    <span style="font-size: 10px; color: #888;">Poké Ball: ${ballCount}</span>
                </div>

                <div class="rpg-battle-arena">
                    <!-- Wild Pokemon -->
                    <div class="rpg-battle-actor-row">
                        <img class="rpg-battle-sprite" src="${wild.sprite}" alt="${wild.name}">
                        <div class="rpg-battle-info">
                            <div style="display: flex; justify-content: space-between;">
                                <span class="rpg-battle-name">${wild.name}</span>
                                <span style="color: #38d9a9; font-size: 11px;">Lv.${wild.level}</span>
                            </div>
                            <div style="font-size: 10px; color: #aaa; margin-top: 2px;">
                                HP: ${wild.currentHp}/${wild.maxHp}
                            </div>
                            <div class="rpg-battle-hp-bar">
                                <div class="rpg-battle-hp-fill" style="width: ${wildHpPercent}%;"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Lead Player Pokemon -->
                    <div class="rpg-battle-actor-row" style="margin-bottom: 0;">
                        <div class="rpg-battle-info" style="margin-left: 0; margin-right: 12px;">
                            <div style="display: flex; justify-content: space-between;">
                                <span class="rpg-battle-name">${lead ? lead.name : "Trainer"}</span>
                                <span style="color: #38d9a9; font-size: 11px;">${lead ? `Lv.${lead.level}` : ""}</span>
                            </div>
                            <div style="font-size: 10px; color: #aaa; margin-top: 2px;">
                                ${lead ? `HP: ${lead.currentHp}/${lead.maxHp}` : "Đang xuất trận"}
                            </div>
                            <div class="rpg-battle-hp-bar">
                                <div class="rpg-battle-hp-fill" style="width: ${leadHpPercent}%;"></div>
                            </div>
                        </div>
                        <img class="rpg-battle-sprite" src="${lead ? lead.sprite : '/img/character/down_stand.png'}" alt="${lead ? lead.name : 'Player'}">
                    </div>
                </div>

                <div id="rpg-battle-msg" class="rpg-battle-msg-box">
                    Một Pokémon hoang dã ${wild.name} (Lv.${wild.level}) xuất hiện!
                </div>

                <div id="rpg-battle-actions" class="rpg-battle-actions">
                    <button type="button" id="rpg-btn-attack" class="rpg-battle-btn">
                        ⚔️ Tấn công
                    </button>
                    <button type="button" id="rpg-btn-throw-ball" class="rpg-battle-btn" ${ballCount <= 0 || isPartyFull ? "disabled" : ""}>
                        🔴 Ném Poké Ball (${ballCount})
                    </button>
                    <button type="button" id="rpg-btn-run" class="rpg-battle-btn">
                        🏃 Bỏ chạy
                    </button>
                </div>
            </div>
        `;

        const rootEl = this.containerEl || document;
        const attackBtn = rootEl.querySelector("#rpg-btn-attack");
        if (attackBtn) {
            attackBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.attack();
            });
        }

        const throwBtn = rootEl.querySelector("#rpg-btn-throw-ball");
        if (throwBtn) {
            throwBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.throwPokeBall();
            });
        }

        const runBtn = rootEl.querySelector("#rpg-btn-run");
        if (runBtn) {
            runBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.runAway();
            });
        }
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = MiniBattleUI;
    } else {
        global.PokeMiniBattleUI = MiniBattleUI;
    }
})(typeof window !== "undefined" ? window : global);
