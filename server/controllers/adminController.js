const adminService = require("../services/adminService");

/**
 * Controller trả về thông tin Admin hiện tại
 * GET /api/admin/me
 */
const getMe = async (req, res) => {
    try {
        const adminUser = req.adminUser;
        if (!adminUser || !adminUser.uid) {
            return res.status(403).json({
                success: false,
                message: "Không tìm thấy thông tin quản trị viên trong ngữ cảnh yêu cầu.",
                code: "FORBIDDEN"
            });
        }

        const profile = await adminService.getAdminProfile(adminUser.uid);

        return res.status(200).json({
            success: true,
            data: {
                uid: profile.uid,
                username: profile.username,
                character: profile.character,
                role: profile.role,
                createdAt: profile.createdAt
            }
        });
    } catch (err) {
        if (err.statusCode && err.statusCode < 500) {
            return res.status(err.statusCode).json({
                success: false,
                message: err.message,
                code: err.code || "ADMIN_ERROR"
            });
        }

        console.error("[Admin Controller Error - getMe]:", err.message);
        return res.status(500).json({
            success: false,
            message: "Lỗi hệ thống khi tải thông tin quản trị viên.",
            code: "INTERNAL_ERROR"
        });
    }
};

/**
 * Controller lấy danh sách người chơi thực từ Firestore (có phân trang và tìm kiếm)
 * GET /api/admin/players
 */
const getPlayers = async (req, res) => {
    try {
        const { page, limit, search } = req.query || {};

        const result = await adminService.getPlayersList({
            page,
            limit,
            search
        });

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (err) {
        if (err.statusCode && err.statusCode < 500) {
            return res.status(err.statusCode).json({
                success: false,
                message: err.message,
                code: err.code || "ADMIN_ERROR"
            });
        }

        console.error("[Admin Controller Error - getPlayers]:", err.message);
        return res.status(500).json({
            success: false,
            message: "Lỗi hệ thống khi tải danh sách người chơi.",
            code: "INTERNAL_ERROR"
        });
    }
};

/**
 * Controller lấy chi tiết hồ sơ người chơi theo UID
 * GET /api/admin/players/:uid
 */
const getPlayerDetail = async (req, res) => {
    try {
        const targetUid = req.params ? req.params.uid : null;

        const player = await adminService.getPlayerDetail(targetUid);

        return res.status(200).json({
            success: true,
            data: player
        });
    } catch (err) {
        if (err.statusCode && err.statusCode < 500) {
            return res.status(err.statusCode).json({
                success: false,
                message: err.message,
                code: err.code || "ADMIN_ERROR"
            });
        }

        console.error("[Admin Controller Error - getPlayerDetail]:", err.message);
        return res.status(500).json({
            success: false,
            message: "Lỗi hệ thống khi tải hồ sơ người chơi.",
            code: "INTERNAL_ERROR"
        });
    }
};

/**
 * Controller cập nhật trạng thái khóa/mở khóa tài khoản người chơi
 * PATCH /api/admin/players/:uid/status
 */
const updatePlayerStatus = async (req, res) => {
    try {
        const targetUid = req.params ? req.params.uid : null;
        const { isActive } = req.body || {};
        const adminUid = req.adminUser ? req.adminUser.uid : null;

        if (typeof isActive !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "Trường isActive bắt buộc phải là giá trị boolean (true hoặc false).",
                code: "INVALID_BODY"
            });
        }

        const result = await adminService.setPlayerStatus(targetUid, isActive, adminUid);

        const actionText = isActive ? "Mở khóa" : "Khóa";
        return res.status(200).json({
            success: true,
            message: `${actionText} tài khoản người chơi thành công.`,
            data: result
        });
    } catch (err) {
        if (err.statusCode && err.statusCode < 500) {
            return res.status(err.statusCode).json({
                success: false,
                message: err.message,
                code: err.code || "ADMIN_ERROR"
            });
        }

        console.error("[Admin Controller Error - updatePlayerStatus]:", err.message);
        return res.status(500).json({
            success: false,
            message: err.message || "Lỗi hệ thống khi cập nhật trạng thái tài khoản.",
            code: err.code || "INTERNAL_ERROR",
            partialSync: err.partialSync || false
        });
    }
};

/**
 * Controller trả về dữ liệu Dashboard tổng quan (Overview)
 * GET /api/admin/overview
 */
const getOverview = async (req, res) => {
    try {
        const overviewData = await adminService.getOverviewDashboard();

        return res.status(200).json({
            success: true,
            data: overviewData
        });
    } catch (err) {
        console.error("[Admin Controller Error - getOverview]:", err.message);
        return res.status(500).json({
            success: false,
            message: "Lỗi hệ thống khi tải dữ liệu bảng điều khiển tổng quan.",
            code: "INTERNAL_ERROR"
        });
    }
};

/** GET /api/admin/pokemon — danh mục Pokémon hiện có cùng metadata override. */
const getPokemonCatalog = async (req, res) => {
    try {
        return res.status(200).json({
            success: true,
            data: { pokemon: await adminService.getPokemonCatalog() }
        });
    } catch (err) {
        console.error("[Admin Controller Error - getPokemonCatalog]:", err.message);
        return res.status(500).json({
            success: false,
            message: "Lỗi hệ thống khi tải danh mục Pokémon.",
            code: "INTERNAL_ERROR"
        });
    }
};

/** PATCH /api/admin/pokemon/:speciesId — cập nhật metadata Pokémon đã tồn tại. */
const updatePokemonCatalogEntry = async (req, res) => {
    try {
        const pokemon = await adminService.updatePokemonCatalogEntry(req.params && req.params.speciesId, req.body);
        return res.status(200).json({ success: true, data: { pokemon } });
    } catch (err) {
        if (err.statusCode && err.statusCode < 500) {
            return res.status(err.statusCode).json({
                success: false,
                message: err.message,
                code: err.code || "ADMIN_ERROR"
            });
        }
        console.error("[Admin Controller Error - updatePokemonCatalogEntry]:", err.message);
        return res.status(500).json({
            success: false,
            message: "Không thể lưu metadata Pokémon.",
            code: "INTERNAL_ERROR"
        });
    }
};

/** GET /api/admin/items — Item Catalog hiện có, chỉ đọc. */
const getItemCatalog = async (req, res) => {
    try {
        return res.status(200).json({
            success: true,
            data: { items: await adminService.getItemCatalog() }
        });
    } catch (err) {
        console.error("[Admin Controller Error - getItemCatalog]:", err.message);
        return res.status(500).json({
            success: false,
            message: "Lỗi hệ thống khi tải danh mục vật phẩm.",
            code: "INTERNAL_ERROR"
        });
    }
};

/** PATCH /api/admin/items/:itemId — cập nhật metadata cho item đã có. */
const updateItemCatalogEntry = async (req, res) => {
    try {
        const item = await adminService.updateItemCatalogEntry(req.params && req.params.itemId, req.body);
        return res.status(200).json({ success: true, data: { item } });
    } catch (err) {
        if (err.statusCode && err.statusCode < 500) {
            return res.status(err.statusCode).json({
                success: false,
                message: err.message,
                code: err.code || "ADMIN_ERROR"
            });
        }
        console.error("[Admin Controller Error - updateItemCatalogEntry]:", err.message);
        return res.status(500).json({
            success: false,
            message: "Không thể lưu metadata vật phẩm.",
            code: "INTERNAL_ERROR"
        });
    }
};

module.exports = {
    getMe,
    getOverview,
    getPlayers,
    getPlayerDetail,
    updatePlayerStatus,
    getPokemonCatalog,
    updatePokemonCatalogEntry,
    getItemCatalog,
    updateItemCatalogEntry
};
