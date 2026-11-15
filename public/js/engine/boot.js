function showFatalError (err) {
    console.error("[Poké-Engine - FATAL_CONSTRUCTOR_ERROR]:", err);
    var loader = document.querySelector("#load_layer");
    if (loader) {
        var msg = "Không thể khởi động trò chơi. Vui lòng làm mới trang hoặc kiểm tra trình duyệt.";
        if (err && typeof err.userMessage === "string" && err.userMessage.trim().length > 0) {
            msg = err.userMessage.trim();
        } else if (err && typeof err.message === "string" && err.message.trim().length > 0) {
            msg = err.message.trim();
        }
        loader.textContent = msg;
        loader.style.display = "flex";
        loader.style.alignItems = "center";
        loader.style.justifyContent = "center";
        loader.style.color = "#ffffff";
        loader.style.fontFamily = "monospace";
        loader.style.fontSize = "14px";
        loader.style.padding = "20px";
        loader.style.textAlign = "center";
    }
}

/**
 * Quản lý Viewport Responsive Pixel-Perfect theo tỷ lệ gốc 272:240
 */
function setupViewportManager () {
    var resizeTicking = false;

    function applyGameScale () {
        var BASE_WIDTH = 272;
        var BASE_HEIGHT = 240;

        var scaleX = window.innerWidth / BASE_WIDTH;
        var scaleY = window.innerHeight / BASE_HEIGHT;
        var rawScale = Math.min(scaleX, scaleY);

        var finalScale;
        if (rawScale >= 1) {
            finalScale = Math.floor(rawScale);
        } else {
            finalScale = Math.max(0.2, rawScale);
        }

        document.documentElement.style.setProperty("--game-scale", finalScale);
        resizeTicking = false;
    }

    function onWindowResize () {
        if (!resizeTicking) {
            window.requestAnimationFrame(applyGameScale);
            resizeTicking = true;
        }
    }

    // Áp dụng scale ngay lập tức khi khởi tạo
    applyGameScale();

    // Lắng nghe sự kiện resize cửa sổ duy nhất
    window.addEventListener("resize", onWindowResize);
}

/**
 * Thiết lập sự kiện đăng xuất an toàn trên giao diện Game (B5)
 */
var isLoggingOut = false;
function setupLogoutHandler () {
    var logoutBtn = document.getElementById("btn-logout");
    if (!logoutBtn) return;

    logoutBtn.addEventListener("click", function () {
        // Chống gửi nhiều request logout đồng thời
        if (isLoggingOut) return;

        if (!window.confirm("Bạn có chắc chắn muốn đăng xuất khỏi Poké-Engine?")) {
            logoutBtn.blur();
            return;
        }

        isLoggingOut = true;
        logoutBtn.disabled = true;
        var originalText = logoutBtn.textContent;
        logoutBtn.textContent = "...";

        function getCsrfToken() {
            var match = document.cookie.match(/(?:^|;\s*)poke\.csrf=([^;]+)/);
            if (match && match[1]) {
                return decodeURIComponent(match[1].trim());
            }
            return "";
        }

        // Lưu vị trí người chơi trước khi logout để không mất tiến trình (POS-01)
        function doLogout() {
            var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
            let timeoutId = controller ? setTimeout(function () { controller.abort(); }, 10000) : null;

            function cleanupLogoutTimer() {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
            }

            fetch("/api/auth/logout", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-csrf-token": getCsrfToken()
                },
                credentials: "same-origin",
                signal: controller ? controller.signal : undefined
            })
            .then(function (res) {
                return res.json()
                    .then(function (data) {
                        cleanupLogoutTimer();
                        return { ok: res.ok, status: res.status, data: data };
                    })
                    .catch(function (bodyErr) {
                        cleanupLogoutTimer();
                        var isAbort = (bodyErr && bodyErr.name === "AbortError") || (controller && controller.signal && controller.signal.aborted);
                        if (isAbort) {
                            throw bodyErr;
                        }
                        return { ok: res.ok, status: res.status, data: null };
                    });
            })
            .then(function (result) {
                cleanupLogoutTimer();
                // B5: Chỉ chuyển hướng khi backend xác nhận HTTP ok và success === true
                if (result.ok && result.data && result.data.success) {
                    window.location.href = "/login?logout=1";
                } else {
                    var errMsg = (result.data && typeof result.data.message === "string" && result.data.message.trim().length > 0)
                        ? result.data.message.trim()
                        : ("Đăng xuất thất bại từ máy chủ (HTTP " + result.status + "). Vui lòng thử lại.");
                    alert(errMsg);
                    isLoggingOut = false;
                    logoutBtn.disabled = false;
                    logoutBtn.textContent = originalText;
                }
            })
            .catch(function (err) {
                cleanupLogoutTimer();
                var isTimeout = (err && err.name === "AbortError") || (controller && controller.signal && controller.signal.aborted);
                var netMsg = isTimeout
                    ? "Yêu cầu đăng xuất quá thời gian chờ (10s). Vui lòng thử lại."
                    : ("Không thể kết nối đến máy chủ khi đăng xuất: " + (err ? err.message : "Lỗi mạng"));
                alert(netMsg);
                isLoggingOut = false;
                logoutBtn.disabled = false;
                logoutBtn.textContent = originalText;
            });
        }

        // Lưu vị trí trước, rồi mới thực hiện logout
        var game = window._pokeGameInstance;
        if (game && typeof game.savePosition === "function") {
            game.savePosition(function () {
                doLogout();
            });
        } else {
            doLogout();
        }
    });
}

function init () {

    // 1. Kích hoạt viewport scale ngay khi DOM sẵn sàng
    setupViewportManager();

    // 2. Kích hoạt xử lý đăng xuất trên giao diện HUD
    setupLogoutHandler();

    var gameInstance = null;

    try {
        gameInstance = new Game();
    } catch (constructorError) {
        showFatalError(constructorError);
        return;
    }

    // Lưu tham chiếu gameInstance ra ngoài để logout handler dùng
    window._pokeGameInstance = gameInstance;

    gameInstance
        .load()
        .then(function () {
            gameInstance.start();
            gameInstance.$release();
        })
        .catch(function (errorInfo) {
            gameInstance.showInitError(errorInfo);
        });
};

window.addEventListener("DOMContentLoaded", init);
