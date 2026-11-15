/**
 * Poké-Engine — Registration Client Script
 * Handles account creation, character selection, and validation
 */

(function () {
    "use strict";

    const VALID_CHARACTERS = [
        "red",
        "leaf",
        "brendan",
        "ethan",
        "kris",
        "lucas",
        "dawn",
        "blue",
        "silver"
    ];

    const form = document.getElementById("register-form");
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const confirmPasswordInput = document.getElementById("confirm-password");
    const submitBtn = document.getElementById("btn-register");
    const alertBox = document.getElementById("auth-alert");
    const characterCards = document.querySelectorAll(".character-card");

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
        if (confirmPasswordInput) confirmPasswordInput.disabled = isLoading;

        const btnText = submitBtn.querySelector(".btn-text");
        if (isLoading) {
            submitBtn.classList.add("loading");
            if (btnText) btnText.textContent = "Đang khởi tạo...";
        } else {
            submitBtn.classList.remove("loading");
            if (btnText) btnText.textContent = "Tạo Tài Khoản";
        }
    }

    // Xử lý chọn nhân vật giao diện
    characterCards.forEach(function (card) {
        card.addEventListener("click", function () {
            characterCards.forEach(function (c) { c.classList.remove("selected"); });
            card.classList.add("selected");
            const radio = card.querySelector('input[type="radio"]');
            if (radio) radio.checked = true;
        });
    });

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

    if (form) {
        form.addEventListener("submit", async function (e) {
            e.preventDefault();
            clearAlert();

            const username = usernameInput ? usernameInput.value.trim() : "";
            const password = passwordInput ? passwordInput.value : "";
            const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : "";

            // Lấy nhân vật đã chọn
            const checkedRadio = form.querySelector('input[name="character"]:checked');
            const character = checkedRadio ? checkedRadio.value.toLowerCase() : "red";

            // Client-side validations
            if (!username) {
                showAlert("Vui lòng nhập tên đăng nhập.", "error");
                if (usernameInput) usernameInput.focus();
                return;
            }

            if (username.length < 3 || username.length > 20) {
                showAlert("Tên đăng nhập phải có độ dài từ 3 đến 20 ký tự.", "error");
                if (usernameInput) usernameInput.focus();
                return;
            }

            const usernameRegex = /^[a-zA-Z0-9_]+$/;
            if (!usernameRegex.test(username)) {
                showAlert("Tên đăng nhập chỉ được chứa chữ cái tiếng Anh, chữ số và dấu gạch dưới (_).", "error");
                if (usernameInput) usernameInput.focus();
                return;
            }

            if (!password) {
                showAlert("Vui lòng nhập mật khẩu.", "error");
                if (passwordInput) passwordInput.focus();
                return;
            }

            if (password.length < 6) {
                showAlert("Mật khẩu phải có ít nhất 6 ký tự.", "error");
                if (passwordInput) passwordInput.focus();
                return;
            }

            if (password !== confirmPassword) {
                showAlert("Mật khẩu xác nhận không khớp. Vui lòng nhập lại.", "error");
                if (confirmPasswordInput) {
                    confirmPasswordInput.value = "";
                    confirmPasswordInput.focus();
                }
                return;
            }

            if (!VALID_CHARACTERS.includes(character)) {
                showAlert("Nhân vật đã chọn không hợp lệ trong danh mục.", "error");
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
                const response = await fetch("/api/auth/register", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-csrf-token": csrfToken
                    },
                    credentials: "same-origin",
                    body: JSON.stringify({
                        username: username,
                        password: password,
                        character: character
                    })
                });

                let resData = null;
                try {
                    resData = await response.json();
                } catch {
                    resData = null;
                }

                if (response.ok && resData && resData.success) {
                    showAlert("Đăng ký thành công! Đang chuyển sang trang đăng nhập...", "success");
                    setTimeout(function () {
                        window.location.href = "/login?registered=1";
                    }, 800);
                } else {
                    const errorMsg = (resData && resData.message)
                        ? resData.message
                        : "Đã xảy ra lỗi khi đăng ký tài khoản.";
                    showAlert(errorMsg, "error");
                    setLoading(false);
                }
            } catch (networkErr) {
                showAlert("Không thể kết nối đến máy chủ. Vui lòng kiểm tra lại kết nối mạng.", "error");
                setLoading(false);
            }
        });
    }
})();
