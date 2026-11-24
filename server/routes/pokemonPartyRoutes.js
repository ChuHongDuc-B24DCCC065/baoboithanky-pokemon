const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { csrfProtection } = require("../middleware/csrfMiddleware");
const pokemonPartyController = require("../controllers/pokemonPartyController");

router.get("/", requireAuth, pokemonPartyController.getSnapshot);
router.post("/mutation", requireAuth, csrfProtection, pokemonPartyController.mutate);
router.post("/migration", requireAuth, csrfProtection, pokemonPartyController.migrate);

module.exports = router;
