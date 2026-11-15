const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");
const { csrfProtection, generateCsrfToken, setCsrfCookie, extractCookie } = require("../middleware/csrfMiddleware");

// Endpoint lấy CSRF token cho client/frontend
router.get("/csrf-token", (req, res) => {
    let scope = "anon";
    if (req.user && (req.user.uid || req.user.id)) {
        scope = (req.user.uid || req.user.id).toString();
    }

    let token = extractCookie(req, "poke.csrf");
    if (!token) {
        token = generateCsrfToken(scope);
        setCsrfCookie(res, token);
    }

    return res.status(200).json({
        success: true,
        data: {
            csrfToken: token
        }
    });
});

// Các endpoint POST thay đổi trạng thái áp dụng CSRF protection
router.post("/register", csrfProtection, authController.register);
router.post("/login", csrfProtection, authController.login);
router.post("/logout", requireAuth, csrfProtection, authController.logout);
router.post("/logout-all", requireAuth, csrfProtection, authController.logoutAll);
router.post("/position", requireAuth, csrfProtection, authController.savePosition);

// Endpoint GET /me yêu cầu session hợp lệ thông qua requireAuth
router.get("/me", requireAuth, authController.me);

module.exports = router;
