const pokemonPartyService = require("../services/pokemonPartyService");

function getSessionUid(req) {
    const uid = req.user && (req.user.uid || req.user.id);
    return typeof uid === "string" && uid.trim() ? uid : null;
}

async function getSnapshot(req, res) {
    const uid = getSessionUid(req);
    if (!uid) return res.status(401).json({ success: false, message: "Authenticated session is required.", code: "UNAUTHORIZED" });
    try {
        const snapshot = await pokemonPartyService.getPartySnapshot(uid);
        return res.status(200).json({ success: true, data: snapshot });
    } catch (error) {
        console.error("[Party Snapshot Error]:", error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode && error.statusCode < 500 ? error.message : "Unable to load Party data.",
            code: error.code || "INTERNAL_ERROR"
        });
    }
}

async function mutate(req, res) {
    const uid = getSessionUid(req);
    if (!uid) return res.status(401).json({ success: false, message: "Authenticated session is required.", code: "UNAUTHORIZED" });
    try {
        const snapshot = await pokemonPartyService.mutateParty(uid, req.body);
        return res.status(200).json({ success: true, data: snapshot });
    } catch (error) {
        if ((error.statusCode || 500) >= 500) console.error("[Party Mutation Error]:", error.message);
        const body = {
            success: false,
            message: error.statusCode && error.statusCode < 500 ? error.message : "Unable to update Party.",
            code: error.code || "INTERNAL_ERROR"
        };
        if (error.snapshot) body.data = error.snapshot;
        return res.status(error.statusCode || 500).json(body);
    }
}

async function migrate(req, res) {
    const uid = getSessionUid(req);
    if (!uid) return res.status(401).json({ success: false, message: "Authenticated session is required.", code: "UNAUTHORIZED" });
    try {
        const result = await pokemonPartyService.migrateParty(uid, req.body);
        return res.status(200).json({ success: true, data: result.snapshot, migrationOutcome: result.migrationOutcome });
    } catch (error) {
        if ((error.statusCode || 500) >= 500) console.error("[Party Migration Error]:", error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode && error.statusCode < 500 ? error.message : "Unable to migrate Party data.",
            code: error.code || "INTERNAL_ERROR"
        });
    }
}

module.exports = { getSnapshot, mutate, migrate };
