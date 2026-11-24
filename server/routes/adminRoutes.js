const express = require("express");
const router = express.Router();
const { requireAdmin } = require("../middleware/adminMiddleware");
const { validateOrigin } = require("../middleware/authMiddleware");
const { csrfProtection } = require("../middleware/csrfMiddleware");
const adminController = require("../controllers/adminController");

// Tất cả các route /api/admin/* đều được bảo vệ nghiêm ngặt bởi middleware requireAdmin
router.use(requireAdmin);

// 1. Quản trị viên hiện tại & Dashboard Tổng quan
router.get("/me", adminController.getMe);
router.get("/overview", adminController.getOverview);
router.get("/pokemon", adminController.getPokemonCatalog);
router.patch(
    "/pokemon/:speciesId",
    validateOrigin,
    csrfProtection,
    adminController.updatePokemonCatalogEntry
);
router.get("/items", adminController.getItemCatalog);
router.patch(
    "/items/:itemId",
    validateOrigin,
    csrfProtection,
    adminController.updateItemCatalogEntry
);

// 2. Module Quản lý người chơi (Players)
router.get("/players", adminController.getPlayers);
router.get("/players/:uid", adminController.getPlayerDetail);
router.patch(
    "/players/:uid/status",
    validateOrigin,
    csrfProtection,
    adminController.updatePlayerStatus
);

module.exports = router;
