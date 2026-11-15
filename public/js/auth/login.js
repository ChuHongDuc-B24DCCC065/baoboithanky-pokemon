/**
 * Poké-Engine — Login Client Script
 * Handles authentication request, form validation, and feedback
 */

(function () {
    "use strict";

    const form = document.getElementById("login-form");
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const submitBtn = document.getElementById("btn-login");
    const alertBox = document.getElementById("auth-alert");

    // Hiển thị thông báo trạng thái
    function showAlert(message, type) {
        if (!alertBox) return;
        alertBox.textContent = message;
        alertBox.className = "auth-alert " + (type === "success" ? "success" : "error");
    }

    function clearAlert() {
        if (!alertBox) return;
        alertBox.textContent = "";
        alertBox.className = "auth-alert";
    }

    // Đặt trạng thái tải (Loading state)
    function setLoading(isLoading) {
        if (!submitBtn) return;
        submitBtn.disabled = isLoading;
        if (usernameInput) usernameInput.disabled = isLoading;
        if (passwordInput) passwordInput.disabled = isLoading;

        const btnText = submitBtn.querySelector(".btn-text");
        if (isLoading) {
            submitBtn.classList.add("loading");
            if (btnText) btnText.textContent = "Đang kiểm tra...";
        } else {
            submitBtn.classList.remove("loading");
            if (btnText) btnText.textContent = "Vào Trò Chơi";
        }
    }

    // Kiểm tra thông báo từ query parameters (ví dụ vừa đăng ký xong)
    function checkQueryParams() {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get("registered") === "1") {
            showAlert("Đăng ký tài khoản thành công! Vui lòng đăng nhập để bắt đầu chơi.", "success");
        } else if (urlParams.get("logout") === "1") {
            showAlert("Bạn đã đăng xuất an toàn khỏi trò chơi.", "success");
        }
    }

    // Lấy CSRF token từ cookie poke.csrf hoặc fallback gọi GET /api/auth/csrf-token
    async function getCsrfToken() {
        const match = document.cookie.match(/(?:^|;\s*)poke\.csrf=([^;]+)/);
        if (match && match[1]) {
            return decodeURIComponent(match[1].trim());
        }

        try {
            const res = await fetch("/api/auth/csrf-token", {
                method: "GET",
                credentials: "same-origin"
            });
            if (res.ok) {
                const json = await res.json();
                if (json && json.success && json.data && json.data.csrfToken) {
                    return json.data.csrfToken;
                }
            }
        } catch {
            // Không thể kết nối tới endpoint lấy CSRF token
        }

        const retryMatch = document.cookie.match(/(?:^|;\s*)poke\.csrf=([^;]+)/);
        if (retryMatch && retryMatch[1]) {
            return decodeURIComponent(retryMatch[1].trim());
        }

        return null;
    }

    checkQueryParams();

    if (form) {
        form.addEventListener("submit", async function (e) {
            e.preventDefault();
            clearAlert();

            const username = usernameInput ? usernameInput.value.trim() : "";
            const password = passwordInput ? passwordInput.value : "";

            // Client-side validation
            if (!username) {
                showAlert("Vui lòng nhập tên đăng nhập.", "error");
                if (usernameInput) usernameInput.focus();
                return;
            }

            if (!password) {
                showAlert("Vui lòng nhập mật khẩu.", "error");
                if (passwordInput) passwordInput.focus();
                return;
            }

            setLoading(true);

            // Xác thực bảo mật CSRF: lấy token trước khi gửi POST
            const csrfToken = await getCsrfToken();
            if (!csrfToken) {
                showAlert("Không thể xác thực bảo mật CSRF. Vui lòng tải lại trang và thử lại.", "error");
                setLoading(false);
                return;
            }

            try {
                const response = await fetch("/api/auth/login", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-csrf-token": csrfToken
                    },
                    credentials: "same-origin",
                    body: JSON.stringify({
                        username: username,
                        password: password
                    })
                });

                let resData = null;
                try {
                    resData = await response.json();
                } catch {
                    resData = null;
                }

                if (response.ok && resData && resData.success) {
                    showAlert("Đăng nhập thành công! Đang chuyển vào thế giới game...", "success");
                    // Chuyển hướng trực tiếp vào màn hình game
                    window.location.href = "/";
                } else {
                    const errorMsg = (resData && resData.message)
                        ? resData.message
                        : "Tên đăng nhập hoặc mật khẩu không chính xác.";
                    showAlert(errorMsg, "error");
                    setLoading(false);
                    if (passwordInput) {
                        passwordInput.value = "";
                        passwordInput.focus();
                    }
                }
            } catch (networkErr) {
                showAlert("Không thể kết nối đến máy chủ. Vui lòng kiểm tra lại kết nối mạng.", "error");
                setLoading(false);
            }
        });
    }
})();
