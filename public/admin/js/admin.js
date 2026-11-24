/**
 * POKÉ-ENGINE ADMIN DASHBOARD SCRIPT (PHASE C & MODULE PLAYERS)
 * Client-Side Authorization, Dynamic Tab Switching & Players Real-Data Management
 */

(function () {
    "use strict";

    // Danh sách avatar biểu tượng theo nhân vật
    const CHARACTER_AVATARS = {
        red: "🔴",
        leaf: "🟢",
        brendan: "🟢",
        ethan: "🟡",
        kris: "🔵",
        lucas: "🔵",
        dawn: "⚪",
        blue: "🔵",
        silver: "⚫"
    };

    // Tên hiển thị các tab
    const TAB_TITLES = {
        dashboard: "Bảng Điều Khiển",
        players: "Quản Lý Người Chơi (Players)",
        pokemon: "Pokémon Management",
        items: "Item Management",
        maps: "Quản Lý Bản Đồ (Sắp Ra Mắt)",
        settings: "Cài Đặt Hệ Thống (Sắp Ra Mắt)"
    };

    // Biến lưu trạng thái quản trị viên đang đăng nhập trong bộ nhớ (KHÔNG lưu localStorage)
    let currentAdminUid = null;

    // Trạng thái của module Players
    const playersState = {
        page: 1,
        limit: 10,
        search: "",
        total: 0,
        totalPages: 1,
        players: [],
        isLoading: false,
        hasLoadedOnce: false,
        selectedPlayer: null
    };

    const catalogState = {
        pokemonLoaded: false,
        itemsLoaded: false,
        pokemonLoading: false,
        itemsLoading: false,
        pokemon: [],
        items: [],
        selectedPokemonId: null,
        selectedItemId: null
    };

    // Cache các phần tử màn hình trạng thái toàn trang
    const stateScreens = {
        loading: document.getElementById("state-loading"),
        unauthenticated: document.getElementById("state-unauthenticated"),
        forbidden: document.getElementById("state-forbidden"),
        error: document.getElementById("state-error"),
        authorized: document.getElementById("state-authorized")
    };

    /**
     * Hiển thị thông báo Toast góc màn hình
     * @param {string} message
     * @param {"success"|"error"} type
     */
    function showToast(message, type) {
        const container = document.getElementById("admin-toast-container");
        if (!container) return;

        const toast = document.createElement("div");
        toast.className = "toast-message toast-" + (type || "success");
        toast.textContent = message;

        container.appendChild(toast);

        setTimeout(function () {
            toast.style.opacity = "0";
            toast.style.transform = "translateX(40px)";
            toast.style.transition = "all 0.3s ease";
            setTimeout(function () {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3500);
    }

    /**
     * Chuyển đổi màn hình trạng thái hiển thị
     * @param {"loading"|"unauthenticated"|"forbidden"|"error"|"authorized"} activeState
     */
    function showState(activeState) {
        Object.keys(stateScreens).forEach(function (stateKey) {
            const screen = stateScreens[stateKey];
            if (screen) {
                if (stateKey === activeState) {
                    screen.classList.add("active");
                } else {
                    screen.classList.remove("active");
                }
            }
        });
    }

    /**
     * Định dạng thời gian hiển thị thân thiện
     * @param {string|Object} dateVal
     * @returns {string}
     */
    function formatDateTime(dateVal) {
        if (!dateVal) return "---";
        try {
            // Trường hợp Firestore Timestamp serialized object { _seconds, ... }
            if (dateVal._seconds) {
                return new Date(dateVal._seconds * 1000).toLocaleString("vi-VN");
            }
            if (typeof dateVal === "string" || typeof dateVal === "number") {
                return new Date(dateVal).toLocaleString("vi-VN");
            }
            return String(dateVal);
        } catch {
            return String(dateVal);
        }
    }

    /**
     * Cập nhật thông tin Admin đã xác thực vào giao diện
     * @param {Object} adminData
     */
    function renderAdminProfile(adminData) {
        const username = adminData.username || "Admin";
        const uid = adminData.uid || "N/A";
        currentAdminUid = uid;
        const character = (adminData.character || "red").toLowerCase();
        const avatar = CHARACTER_AVATARS[character] || "🔴";

        // Header
        const headerUsername = document.getElementById("header-username");
        const headerAvatar = document.getElementById("header-avatar");
        if (headerUsername) headerUsername.textContent = username;
        if (headerAvatar) headerAvatar.textContent = avatar;

        // Welcome Banner
        const welcomeAdminName = document.getElementById("welcome-admin-name");
        if (welcomeAdminName) welcomeAdminName.textContent = username;

        // Dashboard Info Card
        const dashUsername = document.getElementById("dash-username");
        const dashUid = document.getElementById("dash-uid");
        const dashCharacter = document.getElementById("dash-character");

        if (dashUsername) dashUsername.textContent = username;
        if (dashUid) {
            dashUid.textContent = uid;
            dashUid.title = uid;
        }
        if (dashCharacter) dashCharacter.textContent = character;
    }

    /**
     * Xác thực quyền Quản trị viên thông qua backend API
     * Backend là nguồn quyết định duy nhất (Single Source of Truth).
     */
    async function checkAdminAuth() {
        showState("loading");

        try {
            const response = await fetch("/api/admin/me", {
                method: "GET",
                headers: {
                    "Accept": "application/json"
                },
                credentials: "include" // Gửi kèm cookie poke.sid
            });

            if (response.status === 200) {
                const resData = await response.json();
                if (resData && resData.success && resData.data) {
                    renderAdminProfile(resData.data);
                    showState("authorized");
                    fetchOverview();
                    return;
                }
            }

            if (response.status === 401) {
                const errData = await response.json().catch(function () { return {}; });
                const unauthMsg = document.getElementById("unauth-message");
                if (unauthMsg && errData.message) {
                    unauthMsg.textContent = errData.message;
                }
                showState("unauthenticated");
                return;
            }

            if (response.status === 403) {
                const errData = await response.json().catch(function () { return {}; });
                const forbiddenMsg = document.getElementById("forbidden-message");
                if (forbiddenMsg && errData.message) {
                    forbiddenMsg.textContent = errData.message;
                }
                showState("forbidden");
                return;
            }

            // Các mã lỗi 500 hoặc khác
            const errData = await response.json().catch(function () { return {}; });
            const errorMsg = document.getElementById("error-message");
            if (errorMsg && errData.message) {
                errorMsg.textContent = errData.message;
            }
            showState("error");
        } catch (netErr) {
            console.error("[Admin Client Error]:", netErr);
            const errorMsg = document.getElementById("error-message");
            if (errorMsg) {
                errorMsg.textContent = "Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng hoặc thử lại sau.";
            }
            showState("error");
        }
    }

    // =========================================================================
    // MODULE OVERVIEW DASHBOARD (TASK ADMIN-DASHBOARD-01)
    // =========================================================================

    const overviewState = {
        isLoading: false,
        hasLoadedOnce: false,
        data: null
    };

    /**
     * Tải dữ liệu thống kê tổng quan từ GET /api/admin/overview
     */
    async function fetchOverview() {
        if (overviewState.isLoading) return;
        overviewState.isLoading = true;

        const chartLoading = document.getElementById("chart-loading");
        const chartEmpty = document.getElementById("chart-empty");
        const chartContainer = document.getElementById("chart-container");
        const recentLoading = document.getElementById("recent-players-loading");
        const recentEmpty = document.getElementById("recent-players-empty");
        const recentTableWrap = document.getElementById("recent-players-table-wrap");

        if (chartLoading) chartLoading.style.display = "flex";
        if (chartEmpty) chartEmpty.style.display = "none";
        if (chartContainer) chartContainer.style.display = "none";

        if (recentLoading) recentLoading.style.display = "flex";
        if (recentEmpty) recentEmpty.style.display = "none";
        if (recentTableWrap) recentTableWrap.style.display = "none";

        try {
            const response = await fetch("/api/admin/overview", {
                method: "GET",
                headers: { "Accept": "application/json" },
                credentials: "include"
            });

            if (!response.ok) {
                throw new Error("Lỗi tải dữ liệu tổng quan từ server.");
            }

            const resData = await response.json();
            if (resData && resData.success && resData.data) {
                overviewState.data = resData.data;
                overviewState.hasLoadedOnce = true;
                renderOverviewStats(resData.data.stats || {});
                renderRegistrationChart(resData.data.registrationChart || []);
                renderRecentPlayers(resData.data.recentPlayers || []);
            }
        } catch (err) {
            console.error("[Fetch Overview Error]:", err);
            showToast(err.message || "Không thể tải dữ liệu tổng quan.", "error");
            if (chartLoading) chartLoading.style.display = "none";
            if (chartEmpty) chartEmpty.style.display = "flex";
            if (recentLoading) recentLoading.style.display = "none";
            if (recentEmpty) recentEmpty.style.display = "flex";
        } finally {
            overviewState.isLoading = false;
        }
    }

    /**
     * Cập nhật 4 thẻ thống kê số lượng
     * @param {Object} stats
     */
    function renderOverviewStats(stats) {
        const totalEl = document.getElementById("stat-total-players");
        const activeEl = document.getElementById("stat-active-players");
        const lockedEl = document.getElementById("stat-locked-players");
        const newEl = document.getElementById("stat-new-players");

        if (totalEl) totalEl.textContent = Number(stats.totalPlayers || 0).toLocaleString("vi-VN");
        if (activeEl) activeEl.textContent = Number(stats.activePlayers || 0).toLocaleString("vi-VN");
        if (lockedEl) lockedEl.textContent = Number(stats.lockedPlayers || 0).toLocaleString("vi-VN");
        if (newEl) newEl.textContent = Number(stats.newPlayers7Days || 0).toLocaleString("vi-VN");
    }

    /**
     * Render biểu đồ đăng ký 7 ngày gần nhất (Asia/Ho_Chi_Minh)
     * @param {Array<{ date: string, dateKey: string, count: number }>} chartData
     */
    function renderRegistrationChart(chartData) {
        const chartLoading = document.getElementById("chart-loading");
        const chartEmpty = document.getElementById("chart-empty");
        const chartContainer = document.getElementById("chart-container");

        if (chartLoading) chartLoading.style.display = "none";

        if (!chartData || chartData.length === 0) {
            if (chartEmpty) chartEmpty.style.display = "flex";
            if (chartContainer) chartContainer.style.display = "none";
            return;
        }

        // Tính tổng số lượt đăng ký trong 7 ngày
        const totalCount = chartData.reduce(function (sum, item) { return sum + (item.count || 0); }, 0);
        if (totalCount === 0) {
            if (chartEmpty) chartEmpty.style.display = "flex";
            if (chartContainer) chartContainer.style.display = "none";
            return;
        }

        if (chartEmpty) chartEmpty.style.display = "none";
        if (chartContainer) {
            chartContainer.style.display = "flex";
            chartContainer.innerHTML = "";

            const counts = chartData.map(function (d) { return d.count || 0; });
            const maxCount = Math.max.apply(null, counts.concat([1]));

            chartData.forEach(function (item) {
                const count = item.count || 0;
                const percent = Math.min(100, Math.round((count / maxCount) * 100));

                const barItem = document.createElement("div");
                barItem.className = "chart-bar-item";

                const valSpan = document.createElement("span");
                valSpan.className = "chart-bar-value";
                valSpan.textContent = count;

                const trackDiv = document.createElement("div");
                trackDiv.className = "chart-bar-track";

                const fillDiv = document.createElement("div");
                fillDiv.className = "chart-bar-fill";
                fillDiv.style.height = count === 0 ? "4px" : percent + "%";
                trackDiv.appendChild(fillDiv);

                const labelSpan = document.createElement("span");
                labelSpan.className = "chart-bar-label";
                labelSpan.textContent = item.date;

                barItem.appendChild(valSpan);
                barItem.appendChild(trackDiv);
                barItem.appendChild(labelSpan);

                chartContainer.appendChild(barItem);
            });
        }
    }

    /**
     * Render bảng 5 người chơi mới nhất
     * @param {Array<Object>} recentPlayers
     */
    function renderRecentPlayers(recentPlayers) {
        const recentLoading = document.getElementById("recent-players-loading");
        const recentEmpty = document.getElementById("recent-players-empty");
        const recentTableWrap = document.getElementById("recent-players-table-wrap");
        const tbody = document.getElementById("recent-players-tbody");

        if (recentLoading) recentLoading.style.display = "none";

        if (!recentPlayers || recentPlayers.length === 0) {
            if (recentEmpty) recentEmpty.style.display = "flex";
            if (recentTableWrap) recentTableWrap.style.display = "none";
            return;
        }

        if (recentEmpty) recentEmpty.style.display = "none";
        if (recentTableWrap) recentTableWrap.style.display = "block";

        if (tbody) {
            tbody.innerHTML = "";
            recentPlayers.forEach(function (p) {
                const tr = document.createElement("tr");
                const charKey = (p.character || "red").toLowerCase();
                const avatar = CHARACTER_AVATARS[charKey] || "🔴";
                const isLocked = p.isActive === false;

                const tdUser = document.createElement("td");
                const userCell = document.createElement("div");
                userCell.className = "recent-player-cell";

                const avSpan = document.createElement("span");
                avSpan.setAttribute("aria-hidden", "true");
                avSpan.textContent = avatar;

                const nameSpan = document.createElement("span");
                nameSpan.textContent = p.username || "---";

                userCell.appendChild(avSpan);
                userCell.appendChild(nameSpan);
                tdUser.appendChild(userCell);

                const tdChar = document.createElement("td");
                const charSpan = document.createElement("span");
                charSpan.className = "text-capitalize";
                charSpan.textContent = p.character || "red";
                tdChar.appendChild(charSpan);

                const tdDate = document.createElement("td");
                tdDate.textContent = formatDateTime(p.createdAt);

                const tdStatus = document.createElement("td");
                const statusSpan = document.createElement("span");
                statusSpan.className = isLocked ? "status-pill pill-locked" : "status-pill pill-active";
                statusSpan.textContent = isLocked ? "Đã Khóa" : "Hoạt Động";
                tdStatus.appendChild(statusSpan);

                tr.appendChild(tdUser);
                tr.appendChild(tdChar);
                tr.appendChild(tdDate);
                tr.appendChild(tdStatus);

                tbody.appendChild(tr);
            });
        }
    }

    /**
     * Khởi tạo các sự kiện của Module Overview Dashboard
     */
    function initOverviewModule() {
        const btnRefresh = document.getElementById("btn-refresh-overview");
        if (btnRefresh) {
            btnRefresh.addEventListener("click", function () {
                fetchOverview();
            });
        }

        const btnToPlayers = document.getElementById("btn-overview-to-players");
        if (btnToPlayers) {
            btnToPlayers.addEventListener("click", function () {
                switchTab("players");
            });
        }
    }

    // =========================================================================
    // MODULE PLAYERS (QUẢN LÝ NGƯỜI CHƠI)
    // =========================================================================

    /**
     * Chuyển đổi trạng thái giao diện của bảng Players
     * @param {"loading"|"empty"|"error"|"table"} viewState
     */
    function showPlayersTableView(viewState) {
        const loadingBox = document.getElementById("players-table-loading");
        const emptyBox = document.getElementById("players-table-empty");
        const errorBox = document.getElementById("players-table-error");
        const table = document.getElementById("players-table");
        const pagination = document.getElementById("players-pagination");

        if (loadingBox) loadingBox.style.display = viewState === "loading" ? "flex" : "none";
        if (emptyBox) emptyBox.style.display = viewState === "empty" ? "flex" : "none";
        if (errorBox) errorBox.style.display = viewState === "error" ? "flex" : "none";
        if (table) table.style.display = viewState === "table" ? "table" : "none";
        if (pagination) pagination.style.display = viewState === "table" ? "flex" : "none";
    }

    /**
     * Tải danh sách người chơi từ API có phân trang và tìm kiếm
     */
    async function fetchPlayers() {
        if (playersState.isLoading) return;
        playersState.isLoading = true;
        showPlayersTableView("loading");

        try {
            const url = new URL("/api/admin/players", window.location.origin);
            url.searchParams.set("page", String(playersState.page));
            url.searchParams.set("limit", String(playersState.limit));
            if (playersState.search) {
                url.searchParams.set("search", playersState.search);
            }

            const response = await fetch(url.toString(), {
                method: "GET",
                headers: { "Accept": "application/json" },
                credentials: "include"
            });

            if (!response.ok) {
                const errData = await response.json().catch(function () { return {}; });
                throw new Error(errData.message || "Lỗi tải danh sách người chơi từ server.");
            }

            const resData = await response.json();
            const data = resData.data || {};
            playersState.players = Array.isArray(data.players) ? data.players : [];
            const pagination = data.pagination || {};

            playersState.total = typeof pagination.total === "number" ? pagination.total : 0;
            playersState.totalPages = typeof pagination.totalPages === "number" ? pagination.totalPages : 1;
            playersState.page = typeof pagination.page === "number" ? pagination.page : 1;
            playersState.hasLoadedOnce = true;

            // Cập nhật tổng số
            const totalCountEl = document.getElementById("players-total-count");
            if (totalCountEl) totalCountEl.textContent = String(playersState.total);

            if (playersState.players.length === 0) {
                const emptyDesc = document.getElementById("players-empty-desc");
                if (emptyDesc) {
                    emptyDesc.textContent = playersState.search
                        ? `Không tìm thấy người chơi nào khớp với từ khóa "${playersState.search}".`
                        : "Hệ thống hiện chưa có tài khoản người chơi nào.";
                }
                showPlayersTableView("empty");
            } else {
                renderPlayersTable(playersState.players);
                updatePaginationControls();
                showPlayersTableView("table");
            }
        } catch (err) {
            console.error("[Fetch Players Error]:", err);
            const errorDesc = document.getElementById("players-error-desc");
            if (errorDesc) errorDesc.textContent = err.message;
            showPlayersTableView("error");
        } finally {
            playersState.isLoading = false;
        }
    }

    /**
     * Render các dòng người chơi vào thẻ <tbody>
     * @param {Array} players
     */
    function renderPlayersTable(players) {
        const tbody = document.getElementById("players-table-body");
        if (!tbody) return;

        tbody.innerHTML = "";

        players.forEach(function (player) {
            const tr = document.createElement("tr");

            const isSelf = currentAdminUid && player.uid === currentAdminUid;
            const avatar = CHARACTER_AVATARS[player.character] || "🔴";
            const pos = player.position || {};
            const posText = `${pos.map || "test"} (${pos.x || 1}, ${pos.y || 1})`;
            const statusClass = player.isActive ? "pill-active" : "pill-disabled";
            const statusText = player.isActive ? "Hoạt động" : "Bị khóa";

            // Tạo các cột
            tr.innerHTML = `
                <td><code class="info-code" title="${escapeHtml(player.uid)}">${escapeHtml(player.uid)}</code></td>
                <td><span class="font-bold">${escapeHtml(player.username)}</span> ${isSelf ? '<span class="status-pill pill-success" style="font-size:10px; margin-left:4px;">Bạn</span>' : ''}</td>
                <td><span class="user-avatar-inline">${avatar}</span><span class="text-capitalize">${escapeHtml(player.character || "red")}</span></td>
                <td><span class="info-value">${escapeHtml(posText)}</span></td>
                <td><span class="status-pill ${statusClass}">${statusText}</span></td>
                <td><span class="info-value" style="font-size:12px;">${formatDateTime(player.createdAt)}</span></td>
                <td class="text-right table-actions-cell">
                    <button type="button" class="btn-action btn-action-view" data-action="view" data-uid="${escapeHtml(player.uid)}">Chi Tiết</button>
                    ${
                        player.isActive
                            ? `<button type="button" class="btn-action btn-action-lock" data-action="toggle-status" data-uid="${escapeHtml(player.uid)}" ${isSelf ? 'disabled title="Bạn không thể tự khóa chính mình"' : ""}>Khóa</button>`
                            : `<button type="button" class="btn-action btn-action-unlock" data-action="toggle-status" data-uid="${escapeHtml(player.uid)}">Mở Khóa</button>`
                    }
                </td>
            `;

            tbody.appendChild(tr);
        });

        // Gắn sự kiện click cho các nút hành động trong bảng
        tbody.querySelectorAll("[data-action='view']").forEach(function (btn) {
            btn.addEventListener("click", function () {
                const uid = this.getAttribute("data-uid");
                const player = playersState.players.find(function (p) { return p.uid === uid; });
                if (player) openPlayerDetailModal(player);
            });
        });

        tbody.querySelectorAll("[data-action='toggle-status']").forEach(function (btn) {
            btn.addEventListener("click", function () {
                const uid = this.getAttribute("data-uid");
                const player = playersState.players.find(function (p) { return p.uid === uid; });
                if (player) openConfirmStatusModal(player);
            });
        });
    }

    /**
     * Cập nhật các nút và thông tin phân trang
     */
    function updatePaginationControls() {
        const infoEl = document.getElementById("players-pagination-info");
        const indicatorEl = document.getElementById("players-page-indicator");
        const btnPrev = document.getElementById("btn-prev-page");
        const btnNext = document.getElementById("btn-next-page");

        const page = playersState.page;
        const totalPages = playersState.totalPages;
        const total = playersState.total;
        const limit = playersState.limit;

        const start = Math.min((page - 1) * limit + 1, total);
        const end = Math.min(page * limit, total);

        if (infoEl) {
            infoEl.textContent = `Hiển thị ${start} - ${end} trên tổng ${total} người chơi`;
        }

        if (indicatorEl) {
            indicatorEl.textContent = `Trang ${page} / ${totalPages}`;
        }

        if (btnPrev) {
            btnPrev.disabled = page <= 1;
        }

        if (btnNext) {
            btnNext.disabled = page >= totalPages;
        }
    }

    /**
     * Mở modal chi tiết hồ sơ người chơi
     * @param {Object} player
     */
    function openPlayerDetailModal(player) {
        playersState.selectedPlayer = player;

        const modal = document.getElementById("modal-player-detail");
        if (!modal) return;

        const isSelf = currentAdminUid && player.uid === currentAdminUid;
        const avatar = CHARACTER_AVATARS[player.character] || "🔴";
        const pos = player.position || {};

        document.getElementById("modal-player-avatar").textContent = avatar;
        document.getElementById("modal-player-title").textContent = `Người chơi: ${player.username}`;
        document.getElementById("modal-player-uid").textContent = player.uid;
        document.getElementById("modal-player-username").textContent = player.username;
        document.getElementById("modal-player-character").textContent = player.character || "red";

        const badgeEl = document.getElementById("modal-player-status-badge");
        badgeEl.className = "status-pill " + (player.isActive ? "pill-active" : "pill-disabled");
        badgeEl.textContent = player.isActive ? "Đang hoạt động" : "Bị vô hiệu hóa";

        document.getElementById("modal-player-map").textContent = pos.map || "test";
        document.getElementById("modal-player-coords").textContent = `X: ${pos.x || 1}, Y: ${pos.y || 1} (Hướng: ${pos.facing || "down"})`;
        document.getElementById("modal-player-created").textContent = formatDateTime(player.createdAt);
        document.getElementById("modal-player-updated").textContent = formatDateTime(player.updatedAt);

        // Nút khóa/mở khóa bên trong modal
        const btnToggle = document.getElementById("btn-modal-toggle-status");
        if (btnToggle) {
            btnToggle.textContent = player.isActive ? "Khóa Tài Khoản" : "Mở Khóa Tài Khoản";
            btnToggle.className = "btn btn-sm " + (player.isActive ? "btn-action-lock" : "btn-action-unlock");
            btnToggle.disabled = isSelf;
            if (isSelf) {
                btnToggle.title = "Bạn không thể tự khóa chính mình";
            } else {
                btnToggle.title = "";
            }
        }

        modal.style.display = "flex";
    }

    function closePlayerDetailModal() {
        const modal = document.getElementById("modal-player-detail");
        if (modal) modal.style.display = "none";
    }

    /**
     * Mở modal xác nhận thao tác khóa / mở khóa tài khoản
     * @param {Object} player
     */
    function openConfirmStatusModal(player) {
        playersState.selectedPlayer = player;

        const modal = document.getElementById("modal-confirm-status");
        if (!modal) return;

        const isLocking = player.isActive;
        const titleEl = document.getElementById("confirm-title");
        const msgEl = document.getElementById("confirm-message");
        const subMsgEl = document.getElementById("confirm-submessage");
        const iconEl = document.getElementById("confirm-icon");
        const btnExec = document.getElementById("btn-execute-confirm");

        if (isLocking) {
            if (titleEl) titleEl.textContent = "Xác Nhận Khóa Tài Khoản";
            if (iconEl) iconEl.textContent = "⛔";
            if (msgEl) msgEl.textContent = `Bạn có chắc chắn muốn KHÓA tài khoản người chơi "${player.username}"?`;
            if (subMsgEl) subMsgEl.textContent = "Tài khoản sẽ bị vô hiệu hóa trên Firebase Auth, thu hồi toàn bộ session và ngắt kết nối Socket.IO ngay lập tức.";
            if (btnExec) {
                btnExec.textContent = "Khóa Ngay";
                btnExec.className = "btn btn-primary btn-sm";
            }
        } else {
            if (titleEl) titleEl.textContent = "Xác Nhận Mở Khóa Tài Khoản";
            if (iconEl) iconEl.textContent = "🔓";
            if (msgEl) msgEl.textContent = `Bạn có chắc chắn muốn MỞ KHÓA tài khoản "${player.username}"?`;
            if (subMsgEl) subMsgEl.textContent = "Tài khoản sẽ được kích hoạt lại trên Firebase Auth và Firestore, cho phép đăng nhập bình thường.";
            if (btnExec) {
                btnExec.textContent = "Mở Khóa";
                btnExec.className = "btn btn-secondary btn-sm";
            }
        }

        modal.style.display = "flex";
    }

    function closeConfirmModal() {
        const modal = document.getElementById("modal-confirm-status");
        if (modal) modal.style.display = "none";
    }

    /**
     * Trích xuất CSRF Token từ cookie poke.csrf
     * @returns {string}
     */
    function getCsrfToken() {
        const cookies = document.cookie ? document.cookie.split(";") : [];
        for (let i = 0; i < cookies.length; i++) {
            const parts = cookies[i].trim().split("=");
            if (parts[0] === "poke.csrf") {
                return decodeURIComponent(parts[1] || "");
            }
        }
        return "";
    }

    /**
     * Thực thi gọi API PATCH cập nhật trạng thái tài khoản
     */
    async function executeStatusToggle() {
        const player = playersState.selectedPlayer;
        if (!player || !player.uid) return;

        const btnExec = document.getElementById("btn-execute-confirm");
        if (btnExec) {
            btnExec.disabled = true;
            btnExec.textContent = "Đang xử lý...";
        }

        const targetNewStatus = !player.isActive;

        try {
            const csrfToken = getCsrfToken();
            const response = await fetch(`/api/admin/players/${encodeURIComponent(player.uid)}/status`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "X-CSRF-Token": csrfToken
                },
                credentials: "include",
                body: JSON.stringify({
                    isActive: targetNewStatus
                })
            });

            const resData = await response.json().catch(function () { return {}; });

            if (!response.ok) {
                let errorMessage = resData.message || "Cập nhật trạng thái người chơi thất bại.";
                if (resData.code === "INVALID_ORIGIN") {
                    errorMessage = "Yêu cầu bị từ chối do nguồn gốc không hợp lệ (Origin Blocked).";
                } else if (resData.code === "CSRF_TOKEN_INVALID") {
                    errorMessage = "Phiên làm việc hoặc mã bảo vệ CSRF không hợp lệ. Vui lòng tải lại trang.";
                }
                throw new Error(errorMessage);
            }

            // Thành công
            closeConfirmModal();
            closePlayerDetailModal();
            showToast(resData.message || "Cập nhật trạng thái thành công!", "success");

            // Tải lại bảng người chơi ở trang hiện tại
            await fetchPlayers();
        } catch (err) {
            console.error("[Status Toggle Error]:", err);
            showToast(err.message, "error");
        } finally {
            if (btnExec) {
                btnExec.disabled = false;
                btnExec.textContent = "Xác Nhận";
            }
        }
    }

    /**
     * Khởi tạo các sự kiện của Module Players
     */
    function initPlayersModule() {
        // Tìm kiếm
        const searchForm = document.getElementById("players-search-form");
        const searchInput = document.getElementById("players-search-input");
        const btnClear = document.getElementById("btn-clear-search");
        const limitSelect = document.getElementById("players-limit-select");
        const btnRefresh = document.getElementById("btn-refresh-players");
        const btnRetry = document.getElementById("btn-retry-players");

        if (searchForm) {
            searchForm.addEventListener("submit", function (e) {
                e.preventDefault();
                const term = searchInput ? searchInput.value.trim() : "";
                playersState.search = term;
                playersState.page = 1;
                if (btnClear) btnClear.style.display = term ? "inline-flex" : "none";
                fetchPlayers();
            });
        }

        if (btnClear) {
            btnClear.addEventListener("click", function () {
                if (searchInput) searchInput.value = "";
                playersState.search = "";
                playersState.page = 1;
                btnClear.style.display = "none";
                fetchPlayers();
            });
        }

        if (limitSelect) {
            limitSelect.addEventListener("change", function () {
                playersState.limit = parseInt(this.value, 10) || 10;
                playersState.page = 1;
                fetchPlayers();
            });
        }

        if (btnRefresh) {
            btnRefresh.addEventListener("click", function () {
                fetchPlayers();
            });
        }

        if (btnRetry) {
            btnRetry.addEventListener("click", function () {
                fetchPlayers();
            });
        }

        // Phân trang
        const btnPrev = document.getElementById("btn-prev-page");
        const btnNext = document.getElementById("btn-next-page");

        if (btnPrev) {
            btnPrev.addEventListener("click", function () {
                if (playersState.page > 1) {
                    playersState.page--;
                    fetchPlayers();
                }
            });
        }

        if (btnNext) {
            btnNext.addEventListener("click", function () {
                if (playersState.page < playersState.totalPages) {
                    playersState.page++;
                    fetchPlayers();
                }
            });
        }

        // Modals close buttons
        const btnCloseDetail = document.getElementById("btn-close-player-modal");
        const btnCloseAction = document.getElementById("btn-modal-close-action");
        if (btnCloseDetail) btnCloseDetail.addEventListener("click", closePlayerDetailModal);
        if (btnCloseAction) btnCloseAction.addEventListener("click", closePlayerDetailModal);

        const btnModalToggle = document.getElementById("btn-modal-toggle-status");
        if (btnModalToggle) {
            btnModalToggle.addEventListener("click", function () {
                if (playersState.selectedPlayer) {
                    openConfirmStatusModal(playersState.selectedPlayer);
                }
            });
        }

        const btnCloseConfirm = document.getElementById("btn-close-confirm-modal");
        const btnCancelConfirm = document.getElementById("btn-cancel-confirm");
        const btnExecConfirm = document.getElementById("btn-execute-confirm");

        if (btnCloseConfirm) btnCloseConfirm.addEventListener("click", closeConfirmModal);
        if (btnCancelConfirm) btnCancelConfirm.addEventListener("click", closeConfirmModal);
        if (btnExecConfirm) btnExecConfirm.addEventListener("click", executeStatusToggle);
    }

    /**
     * Escape HTML để ngăn chặn XSS
     * @param {string} str
     * @returns {string}
     */
    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // =========================================================================
    // INITIALIZATION & TAB ROUTING
    // =========================================================================

    /**
     * Chuyển đổi tab điều hướng trong trang quản trị
     * @param {string} targetTab - Tên tab ("dashboard" | "players" | ...)
     */
    function switchTab(targetTab) {
        if (!targetTab) return;

        const navLinks = document.querySelectorAll(".nav-link[data-tab]");
        const panels = document.querySelectorAll(".content-panel");
        const breadcrumbCurrent = document.getElementById("breadcrumb-current");

        // Cập nhật trạng thái active của link sidebar
        navLinks.forEach(function (btn) {
            if (btn.getAttribute("data-tab") === targetTab) {
                btn.classList.add("active");
            } else {
                btn.classList.remove("active");
            }
        });

        // Cập nhật panel hiển thị
        panels.forEach(function (panel) {
            if (panel.id === "panel-" + targetTab) {
                panel.classList.add("active");
            } else {
                panel.classList.remove("active");
            }
        });

        // Cập nhật Breadcrumb
        if (breadcrumbCurrent && TAB_TITLES[targetTab]) {
            breadcrumbCurrent.textContent = TAB_TITLES[targetTab];
        }

        // Tự động tải dữ liệu nếu chuyển sang tab tương ứng
        if (targetTab === "players" && !playersState.hasLoadedOnce) {
            fetchPlayers();
        } else if (targetTab === "dashboard") {
            fetchOverview();
        } else if (targetTab === "pokemon" && !catalogState.pokemonLoaded) {
            fetchPokemonCatalog();
        } else if (targetTab === "items" && !catalogState.itemsLoaded) {
            fetchItemCatalog();
        }
    }

    function appendTextCell(row, value) {
        const cell = document.createElement("td");
        cell.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
        row.appendChild(cell);
    }

    function setCatalogStatus(id, message, isError) {
        const status = document.getElementById(id);
        if (!status) return;
        status.textContent = message;
        status.setAttribute("aria-live", isError ? "assertive" : "polite");
    }

    async function loadAdminCatalog(endpoint) {
        const response = await fetch(endpoint, {
            method: "GET",
            headers: { "Accept": "application/json" },
            credentials: "include"
        });
        const result = await response.json().catch(function () { return null; });
        if (!response.ok || !result || result.success !== true || !result.data) {
            const error = new Error(result && result.message ? result.message : "Không thể tải dữ liệu danh mục.");
            error.status = response.status;
            throw error;
        }
        return result.data;
    }

    async function fetchPokemonCatalog() {
        if (catalogState.pokemonLoading) return;
        catalogState.pokemonLoading = true;
        setCatalogStatus("pokemon-catalog-status", "Đang tải danh mục Pokémon...", false);
        try {
            const data = await loadAdminCatalog("/api/admin/pokemon");
            const pokemon = Array.isArray(data.pokemon) ? data.pokemon : [];
            catalogState.pokemon = pokemon;
            const body = document.getElementById("pokemon-catalog-body");
            const table = document.getElementById("pokemon-catalog-table");
            const count = document.getElementById("pokemon-catalog-count");
            if (!body || !table || !count) return;
            body.replaceChildren();
            pokemon.forEach(function (entry) {
                const row = document.createElement("tr");
                appendTextCell(row, entry.id);
                appendTextCell(row, entry.name);
                appendTextCell(row, Array.isArray(entry.types) ? entry.types.join(" / ") : "");
                appendTextCell(row, entry.generation);
                appendTextCell(row, Number.isFinite(entry.heightM) ? entry.heightM + " m" : "");
                appendTextCell(row, Number.isFinite(entry.weightKg) ? entry.weightKg + " kg" : "");
                ["hp", "attack", "defense", "speed", "special"].forEach(function (stat) {
                    appendTextCell(row, entry.baseStats && entry.baseStats[stat]);
                });
                const actionCell = document.createElement("td");
                const editButton = document.createElement("button");
                editButton.type = "button";
                editButton.className = "btn btn-secondary btn-sm";
                editButton.textContent = "Sửa";
                editButton.addEventListener("click", function () { openPokemonEditor(entry); });
                actionCell.appendChild(editButton);
                row.appendChild(actionCell);
                body.appendChild(row);
            });
            count.textContent = String(pokemon.length);
            table.style.display = pokemon.length ? "table" : "none";
            setCatalogStatus("pokemon-catalog-status", pokemon.length ? "Đã tải danh mục Pokémon." : "Catalog chưa có Pokémon.", false);
            catalogState.pokemonLoaded = true;
        } catch (err) {
            console.error("[Admin Pokémon Catalog Error]:", err);
            setCatalogStatus("pokemon-catalog-status", err.message || "Không thể tải danh mục Pokémon.", true);
        } finally {
            catalogState.pokemonLoading = false;
        }
    }

    function openPokemonEditor(pokemon) {
        if (!pokemon || !pokemon.baseStats) return;
        catalogState.selectedPokemonId = pokemon.id;
        document.getElementById("modal-edit-pokemon-title").textContent = "Chỉnh sửa: " + pokemon.name;
        document.getElementById("pokemon-edit-id").textContent = "ID " + pokemon.id + " · National Dex #" + pokemon.nationalDex + " (không thể thay đổi)";
        document.getElementById("pokemon-edit-name").value = pokemon.name || "";
        document.getElementById("pokemon-edit-types").value = Array.isArray(pokemon.types) ? pokemon.types.join(", ") : "";
        document.getElementById("pokemon-edit-generation").value = String(pokemon.generation || 1);
        document.getElementById("pokemon-edit-height").value = String(pokemon.heightM || "");
        document.getElementById("pokemon-edit-weight").value = String(pokemon.weightKg || "");
        document.getElementById("pokemon-edit-dex-entry").value = pokemon.dexEntry || "";
        ["hp", "attack", "defense", "speed", "special"].forEach(function (stat) {
            document.getElementById("pokemon-edit-stat-" + stat).value = String(pokemon.baseStats[stat]);
        });
        document.getElementById("pokemon-edit-status").textContent = "";
        document.getElementById("modal-edit-pokemon").style.display = "flex";
    }

    function closePokemonEditor() {
        const modal = document.getElementById("modal-edit-pokemon");
        if (modal) modal.style.display = "none";
        catalogState.selectedPokemonId = null;
    }

    async function savePokemonMetadata(event) {
        event.preventDefault();
        const speciesId = catalogState.selectedPokemonId;
        const status = document.getElementById("pokemon-edit-status");
        const saveButton = document.getElementById("btn-save-pokemon-edit");
        if (!speciesId || !status || !saveButton) return;
        const csrfToken = getCsrfToken();
        if (!csrfToken) {
            status.textContent = "Thiếu CSRF token. Hãy tải lại trang Admin rồi thử lại.";
            return;
        }
        const payload = {
            name: document.getElementById("pokemon-edit-name").value,
            types: document.getElementById("pokemon-edit-types").value.split(",").map(function (type) { return type.trim().toUpperCase(); }).filter(Boolean),
            generation: Number(document.getElementById("pokemon-edit-generation").value),
            heightM: Number(document.getElementById("pokemon-edit-height").value),
            weightKg: Number(document.getElementById("pokemon-edit-weight").value),
            dexEntry: document.getElementById("pokemon-edit-dex-entry").value,
            baseStats: {}
        };
        ["hp", "attack", "defense", "speed", "special"].forEach(function (stat) {
            payload.baseStats[stat] = Number(document.getElementById("pokemon-edit-stat-" + stat).value);
        });

        saveButton.disabled = true;
        status.textContent = "Đang lưu...";
        try {
            const response = await fetch("/api/admin/pokemon/" + encodeURIComponent(speciesId), {
                method: "PATCH",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "X-CSRF-Token": csrfToken
                },
                credentials: "include",
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(function () { return null; });
            if (!response.ok || !result || result.success !== true || !result.data || !result.data.pokemon) {
                throw new Error(result && result.message ? result.message : "Server không xác nhận lưu Pokémon.");
            }
            closePokemonEditor();
            showToast("Đã lưu metadata " + result.data.pokemon.name + ".", "success");
            await fetchPokemonCatalog();
        } catch (error) {
            status.textContent = error.message || "Không thể lưu metadata Pokémon.";
            console.error("[Admin Pokémon Save Error]:", error);
        } finally {
            saveButton.disabled = false;
        }
    }

    function initPokemonEditor() {
        const form = document.getElementById("pokemon-edit-form");
        const close = document.getElementById("btn-close-pokemon-edit");
        const cancel = document.getElementById("btn-cancel-pokemon-edit");
        if (form) form.addEventListener("submit", savePokemonMetadata);
        if (close) close.addEventListener("click", closePokemonEditor);
        if (cancel) cancel.addEventListener("click", closePokemonEditor);
    }

    async function fetchItemCatalog() {
        if (catalogState.itemsLoading) return;
        catalogState.itemsLoading = true;
        setCatalogStatus("item-catalog-status", "Đang tải Item Catalog...", false);
        try {
            const data = await loadAdminCatalog("/api/admin/items");
            const items = Array.isArray(data.items) ? data.items : [];
            const body = document.getElementById("item-catalog-body");
            const table = document.getElementById("item-catalog-table");
            const count = document.getElementById("item-catalog-count");
            if (!body || !table || !count) return;
            catalogState.items = items;
            body.replaceChildren();
            items.forEach(function (item) {
                const row = document.createElement("tr");
                appendTextCell(row, item.id);
                appendTextCell(row, (item.icon ? item.icon + " " : "") + (item.name || ""));
                appendTextCell(row, item.category);
                appendTextCell(row, item.description);
                appendTextCell(row, item.effect ? (item.effect.description || item.effect.type) : "—");
                appendTextCell(row, item.shop && item.shop.buyable ? item.shop.buyPrice : "Không bán");
                appendTextCell(row, item.shop && item.shop.sellable ? item.shop.sellPrice : "Không bán");
                const actionCell = document.createElement("td");
                const editButton = document.createElement("button");
                editButton.type = "button";
                editButton.className = "btn btn-secondary btn-sm";
                editButton.textContent = "Sửa";
                editButton.addEventListener("click", function () { openItemEditor(item); });
                actionCell.appendChild(editButton);
                row.appendChild(actionCell);
                body.appendChild(row);
            });
            count.textContent = String(items.length);
            table.style.display = items.length ? "table" : "none";
            setCatalogStatus("item-catalog-status", items.length ? "Đã tải Item Catalog." : "Catalog chưa có vật phẩm.", false);
            catalogState.itemsLoaded = true;
        } catch (err) {
            console.error("[Admin Item Catalog Error]:", err);
            setCatalogStatus("item-catalog-status", err.message || "Không thể tải Item Catalog.", true);
        } finally {
            catalogState.itemsLoading = false;
        }
    }

    function setItemEditPriceControls() {
        const buyable = document.getElementById("item-edit-buyable");
        const buyPrice = document.getElementById("item-edit-buy-price");
        const sellable = document.getElementById("item-edit-sellable");
        const sellPrice = document.getElementById("item-edit-sell-price");
        if (buyable && buyPrice) buyPrice.disabled = !buyable.checked;
        if (sellable && sellPrice) sellPrice.disabled = !sellable.checked;
    }

    function openItemEditor(item) {
        if (!item || !item.shop) return;
        catalogState.selectedItemId = item.id;
        document.getElementById("modal-edit-item-title").textContent = "Chỉnh sửa: " + (item.name || item.id);
        document.getElementById("modal-edit-item-id").textContent = "ID cố định: " + item.id;
        document.getElementById("item-edit-name").value = item.name || "";
        document.getElementById("item-edit-description").value = item.description || "";
        document.getElementById("item-edit-buyable").checked = item.shop.buyable === true;
        document.getElementById("item-edit-buy-price").value = item.shop.buyPrice == null ? "" : String(item.shop.buyPrice);
        document.getElementById("item-edit-sellable").checked = item.shop.sellable === true;
        document.getElementById("item-edit-sell-price").value = item.shop.sellPrice == null ? "" : String(item.shop.sellPrice);
        document.getElementById("item-edit-status").textContent = "";
        setItemEditPriceControls();
        document.getElementById("modal-edit-item").style.display = "flex";
    }

    function closeItemEditor() {
        const modal = document.getElementById("modal-edit-item");
        if (modal) modal.style.display = "none";
        catalogState.selectedItemId = null;
    }

    async function saveItemMetadata(event) {
        event.preventDefault();
        const itemId = catalogState.selectedItemId;
        const status = document.getElementById("item-edit-status");
        const saveButton = document.getElementById("btn-save-item-edit");
        if (!itemId || !status || !saveButton) return;

        const csrfToken = getCsrfToken();
        if (!csrfToken) {
            status.textContent = "Thiếu CSRF token. Hãy tải lại trang Admin rồi thử lại.";
            return;
        }
        const buyable = document.getElementById("item-edit-buyable").checked;
        const sellable = document.getElementById("item-edit-sellable").checked;
        const payload = {
            name: document.getElementById("item-edit-name").value,
            description: document.getElementById("item-edit-description").value,
            shop: {
                buyable,
                buyPrice: buyable ? Number(document.getElementById("item-edit-buy-price").value) : null,
                sellable,
                sellPrice: sellable ? Number(document.getElementById("item-edit-sell-price").value) : null
            }
        };

        saveButton.disabled = true;
        status.textContent = "Đang lưu...";
        try {
            const response = await fetch("/api/admin/items/" + encodeURIComponent(itemId), {
                method: "PATCH",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "X-CSRF-Token": csrfToken
                },
                credentials: "include",
                body: JSON.stringify(payload)
            });
            const result = await response.json().catch(function () { return null; });
            if (!response.ok || !result || result.success !== true || !result.data || !result.data.item) {
                throw new Error(result && result.message ? result.message : "Server không xác nhận lưu vật phẩm.");
            }
            closeItemEditor();
            showToast("Đã lưu metadata " + result.data.item.name + ".", "success");
            await fetchItemCatalog();
        } catch (error) {
            status.textContent = error.message || "Không thể lưu metadata vật phẩm.";
            console.error("[Admin Item Save Error]:", error);
        } finally {
            saveButton.disabled = false;
        }
    }

    function initItemEditor() {
        const form = document.getElementById("item-edit-form");
        const close = document.getElementById("btn-close-item-edit");
        const cancel = document.getElementById("btn-cancel-item-edit");
        const buyable = document.getElementById("item-edit-buyable");
        const sellable = document.getElementById("item-edit-sellable");
        if (form) form.addEventListener("submit", saveItemMetadata);
        if (close) close.addEventListener("click", closeItemEditor);
        if (cancel) cancel.addEventListener("click", closeItemEditor);
        if (buyable) buyable.addEventListener("change", setItemEditPriceControls);
        if (sellable) sellable.addEventListener("change", setItemEditPriceControls);
    }

    /**
     * Khởi tạo tính năng chuyển đổi tab trên Sidebar
     */
    function initTabNavigation() {
        const navLinks = document.querySelectorAll(".nav-link[data-tab]");

        navLinks.forEach(function (link) {
            link.addEventListener("click", function () {
                const targetTab = this.getAttribute("data-tab");
                switchTab(targetTab);
            });
        });
    }

    /**
     * Khởi tạo xử lý Đăng xuất Admin
     */
    function initLogoutHandler() {
        const btnLogout = document.getElementById("btn-admin-logout");
        if (!btnLogout) return;

        btnLogout.addEventListener("click", async function () {
            if (!confirm("Bạn có chắc chắn muốn đăng xuất khỏi phiên Quản trị viên?")) {
                return;
            }

            try {
                const csrfToken = getCsrfToken();

                await fetch("/api/auth/logout", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRF-Token": csrfToken
                    },
                    credentials: "include"
                });
            } catch (err) {
                console.warn("[Admin Logout Error]:", err.message);
            } finally {
                window.location.href = "/login";
            }
        });
    }

    /**
     * Khởi tạo các nút kiểm tra lại quyền
     */
    function initActionButtons() {
        const btnRetry = document.getElementById("btn-retry-auth");
        if (btnRetry) btnRetry.addEventListener("click", checkAdminAuth);

        const btnRecheck = document.getElementById("btn-recheck-auth");
        if (btnRecheck) btnRecheck.addEventListener("click", checkAdminAuth);
    }

    // Khởi chạy khi DOM sẵn sàng
    document.addEventListener("DOMContentLoaded", function () {
        initTabNavigation();
        initLogoutHandler();
        initActionButtons();
        initOverviewModule();
        initPlayersModule();
        initItemEditor();
        initPokemonEditor();
        const refreshPokemon = document.getElementById("btn-refresh-pokemon-catalog");
        if (refreshPokemon) refreshPokemon.addEventListener("click", fetchPokemonCatalog);
        const refreshItems = document.getElementById("btn-refresh-item-catalog");
        if (refreshItems) refreshItems.addEventListener("click", fetchItemCatalog);
        checkAdminAuth();
    });
})();
