"use strict";

const assert = require("assert");
const MiniBattleUI = require("../../public/js/engine/ui/miniBattleUI");

global.document = {
    getElementById: () => null,
    addEventListener: () => {},
    removeEventListener: () => {}
};

function createBattle(inventoryService, partyService, token) {
    const battle = Object.create(MiniBattleUI.prototype);
    battle.game = { state: "BATTLE", lastBattleResult: null, player: { stop: true, walkInProgress: false }, key: { _pressed: {} } };
    battle.partyService = partyService;
    battle.progressService = null;
    battle.inventoryService = inventoryService;
    battle.wildPokemon = { name: "Pidgey", speciesId: "016", level: 5, currentHp: 5, maxHp: 10 };
    battle.isProcessing = false;
    battle.containerEl = null;
    battle._throwTimer = null;
    battle._runTimer = null;
    battle._turnTimer = null;
    battle._keyListener = null;
    battle.pendingResult = null;
    battle.lastResult = null;
    battle._battleSequence = 1;
    battle._activeBattleId = 1;
    battle._activeBattleToken = token || "battle_token_123";
    battle._captureSequence = 0;
    battle._pendingCaptureId = null;
    battle._battleResolved = false;
    battle._participantPokemon = null;
    battle._expAwardedBattleId = null;
    battle._characterExpAwardedBattleId = null;
    battle._rewardAwardedBattleId = null;
    battle.messages = [];
    battle.logMessage = (message) => battle.messages.push(message);
    battle.updateBallButton = () => {};
    return battle;
}

async function run() {
    let rewardCalls = 0;
    let resolveReward;
    const rewardInventory = {
        awardBattleReward(token, level) {
            rewardCalls++;
            assert.strictEqual(token, "battle_token_123");
            assert.strictEqual(level, 5);
            return new Promise((resolve) => { resolveReward = resolve; });
        }
    };
    const winBattle = createBattle(rewardInventory, null);
    const firstFinish = winBattle.finishWithResult("WIN", "Bạn thắng trận!");
    await winBattle.finishWithResult("WIN", "Callback lặp");
    assert.strictEqual(rewardCalls, 1, "Repeated WIN callback must only request one reward");
    resolveReward({ success: true, battleReward: { gold: 63, itemId: "antidote", rarity: "common" } });
    await firstFinish;
    assert(winBattle.messages.some((message) => message.includes("Bạn nhận 63 ₽") && message.includes("Vật phẩm rơi: antidote")));
    assert.strictEqual(winBattle.game.lastBattleResult, "WIN");

    let nonWinRewardCalls = 0;
    for (const result of ["LOSE", "RUN", "CAUGHT", "CANCELLED"]) {
        const nonWinBattle = createBattle({ awardBattleReward: async () => { nonWinRewardCalls++; return { success: true }; } }, null);
        await nonWinBattle.finishWithResult(result, "Battle ended.");
    }
    assert.strictEqual(nonWinRewardCalls, 0, "Non-WIN results must not call Battle Reward API");

    const failedRewardBattle = createBattle({
        awardBattleReward: async () => ({ success: false, message: "Session expired" })
    }, null);
    await failedRewardBattle.finishWithResult("WIN", "Bạn thắng trận!");
    assert(!failedRewardBattle.messages.some((message) => message.includes("Bạn nhận ")));
    assert(failedRewardBattle.messages.some((message) => message.includes("Session expired")));

    let consumeCalls = 0;
    let resolveConsume;
    let ballCount = 1;
    let added = 0;
    let timers = [];
    const originalSetTimeout = global.setTimeout;
    const originalRandom = Math.random;
    global.setTimeout = (callback) => { timers.push(callback); return timers.length; };
    Math.random = () => 0;
    try {
        const captureInventory = {
            getItemQuantity: (itemId) => itemId === "poke_ball" ? ballCount : 0,
            consumeCaptureBall: (captureId) => {
                consumeCalls++;
                assert(captureId.includes("_capture_1"));
                return new Promise((resolve) => { resolveConsume = (result) => {
                    if (result.success) ballCount--;
                    resolve(result);
                }; });
            },
            refundCaptureBall: async () => {
                ballCount++;
                return { success: true };
            }
        };
        const partyService = {
            isPartyFull: () => false,
            addPokemon: () => { added++; return { success: true }; }
        };
        const captureBattle = createBattle(captureInventory, partyService);
        const firstThrow = captureBattle.throwPokeBall();
        await captureBattle.throwPokeBall();
        assert.strictEqual(consumeCalls, 1, "Spam must not send concurrent ball consumes");
        resolveConsume({ success: true });
        await firstThrow;
        assert.strictEqual(ballCount, 0, "Ball quantity follows the server-confirmed consume result");
        assert.strictEqual(timers.length, 1);
        await timers[0]();
        assert.strictEqual(added, 1);
        assert.strictEqual(captureBattle.game.lastBattleResult, "CAUGHT");

        let rejectedPartyBallCount = 1;
        const rejectedPartyBattle = createBattle({
            getItemQuantity: () => rejectedPartyBallCount,
            consumeCaptureBall: async () => { rejectedPartyBallCount--; return { success: true }; },
            refundCaptureBall: async () => { rejectedPartyBallCount++; return { success: true }; }
        }, {
            isPartyFull: () => false,
            addPokemon: () => ({ success: false, reason: "PARTY_FULL" })
        });
        await rejectedPartyBattle.throwPokeBall();
        await timers[1]();
        assert.strictEqual(rejectedPartyBallCount, 1, "A server-confirmed Party rejection refund restores one ball");
        assert(rejectedPartyBattle.messages.at(-1).includes("Poké Ball đã được hoàn lại"));

        let failedRefundBallCount = 1;
        const failedRefundBattle = createBattle({
            getItemQuantity: () => failedRefundBallCount,
            consumeCaptureBall: async () => { failedRefundBallCount--; return { success: true }; },
            refundCaptureBall: async () => ({ success: false, message: "Network unavailable" })
        }, {
            isPartyFull: () => false,
            addPokemon: () => ({ success: false, reason: "PARTY_FULL" })
        });
        await failedRefundBattle.throwPokeBall();
        await timers[2]();
        assert(failedRefundBattle.messages.at(-1).includes("Network unavailable"));
        assert(!failedRefundBattle.messages.at(-1).includes("Poké Ball đã được hoàn lại"));

        Math.random = () => 0.99;
        let spentBallCount = 1;
        let refundCalls = 0;
        const escapedBattle = createBattle({
            getItemQuantity: () => spentBallCount,
            consumeCaptureBall: async () => { spentBallCount--; return { success: true }; },
            refundCaptureBall: async () => { refundCalls++; spentBallCount++; return { success: true }; }
        }, {
            isPartyFull: () => false,
            addPokemon: () => ({ success: true })
        });
        await escapedBattle.throwPokeBall();
        await timers[3]();
        assert.strictEqual(spentBallCount, 0, "A failed capture still consumes the thrown Poké Ball");
        assert.strictEqual(refundCalls, 0);
        assert.strictEqual(escapedBattle.game.lastBattleResult, null, "Failed capture keeps the battle active");
        assert(escapedBattle.messages.at(-1).includes("đã nhảy ra khỏi bóng"));

        let unavailableLog = "";
        const unavailableBattle = createBattle({
            getItemQuantity: () => 1,
            consumeCaptureBall: async () => ({ success: false, message: "403 CSRF" }),
            refundCaptureBall: async () => ({ success: false })
        }, partyService);
        unavailableBattle.logMessage = (message) => { unavailableLog = message; };
        await unavailableBattle.throwPokeBall();
        assert.strictEqual(added, 1, "API failure must not continue to Party capture");
        assert(unavailableLog.includes("403 CSRF"));
        assert(!unavailableLog.includes("Bạn đã ném Poké Ball"));
    } finally {
        global.setTimeout = originalSetTimeout;
        Math.random = originalRandom;
    }

    console.log("Mini Battle Economy tests: PASS (WIN-only reward, duplicate callback, API failure, capture consume, party refund, spam lock)");
}

run().catch((error) => {
    console.error("Mini Battle Economy tests: FAIL", error);
    process.exitCode = 1;
});
