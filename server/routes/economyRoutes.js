const express = require("express");
const router = express.Router();
const economyController = require("../controllers/economyController");
const { requireAuth } = require("../middleware/authMiddleware");
const { csrfProtection } = require("../middleware/csrfMiddleware");

router.get("/", requireAuth, economyController.getSnapshot);
router.get("/item-catalog", requireAuth, economyController.getItemCatalog);
router.get("/pokemon-catalog", requireAuth, economyController.getPokemonCatalog);
router.post("/migrate-inventory", requireAuth, csrfProtection, economyController.migrateLegacyInventory);
router.post("/use-item", requireAuth, csrfProtection, economyController.useItem);
router.post("/equip", requireAuth, csrfProtection, economyController.equipItem);
router.post("/unequip", requireAuth, csrfProtection, economyController.unequipItem);
router.post("/buy-item", requireAuth, csrfProtection, economyController.buyShopItem);
router.post("/battle-reward", requireAuth, csrfProtection, economyController.awardBattleReward);
router.post("/capture-ball", requireAuth, csrfProtection, economyController.resolveCaptureBall);

module.exports = router;
