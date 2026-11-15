Game.prototype.fetchMapData = function () {
    const self = this;
    const mapName = this.savedData.map;

    // 1. Kiểm tra tính hợp lệ của tên bản đồ trong danh mục Game.prototype.maps
    if (!this.maps || !this.maps[mapName]) {
        const err = new Error("Tên bản đồ '" + mapName + "' không tồn tại trong danh mục bản đồ hợp lệ (Game.prototype.maps).");
        err.name = "InvalidMapNameError";
        const normalized = self.normalizeGameError(err, mapName);
        return $.Deferred().reject(normalized).promise();
    }

    const mapUrl = "/res/" + mapName + ".json";

    // 2. Gửi yêu cầu AJAX tải dữ liệu JSON
    return $.getJSON(mapUrl)
        .then(
            function (data) {
                self.generateMapData(data);
                return self;
            },
            function (jqXHR, textStatus, errorThrown) {
                const ajaxError = self.normalizeAjaxError(jqXHR, textStatus, errorThrown, mapUrl);
                return $.Deferred().reject(ajaxError).promise();
            }
        )
        .catch(function (err) {
            const normalizedError = self.normalizeGameError(err, mapUrl);
            return $.Deferred().reject(normalizedError).promise();
        });
};

Game.prototype.normalizeAjaxError = function (jqXHR, textStatus, errorThrown, url) {
    const status = jqXHR ? jqXHR.status : 0;

    if (textStatus === "abort") {
        return {
            type: "REQUEST_ABORTED",
            userMessage: "Quá trình tải bản đồ đã bị hủy. Vui lòng tải lại trang.",
            technicalDetail: "AJAX request aborted for: " + url,
            status: status,
            textStatus: textStatus,
            errorThrown: errorThrown,
            url: url,
            rawError: jqXHR
        };
    }

    if (textStatus === "parsererror" || (errorThrown && errorThrown.name === "SyntaxError")) {
        return {
            type: "JSON_PARSE_ERROR",
            userMessage: "Tệp dữ liệu bản đồ bị lỗi định dạng. Vui lòng liên hệ nhà phát triển.",
            technicalDetail: "JSON parse error: " + (errorThrown ? (errorThrown.message || errorThrown) : textStatus),
            status: status,
            textStatus: textStatus,
            errorThrown: errorThrown,
            url: url,
            rawError: errorThrown || jqXHR
        };
    }

    if (status === 0 || textStatus === "timeout") {
        return {
            type: "NETWORK_ERROR",
            userMessage: "Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng.",
            technicalDetail: textStatus === "timeout" ? "Network timeout" : "Network failure / server unreachable (status: 0)",
            status: status,
            textStatus: textStatus,
            errorThrown: errorThrown,
            url: url,
            rawError: jqXHR
        };
    }

    if (typeof status === "number" && status >= 400) {
        return {
            type: "HTTP_ERROR",
            userMessage: "Không thể tải tài nguyên bản đồ (HTTP " + status + "). Vui lòng thử lại sau.",
            technicalDetail: "HTTP " + status + " (" + (errorThrown || jqXHR.statusText || "Error") + ") for: " + url,
            status: status,
            textStatus: textStatus,
            errorThrown: errorThrown,
            url: url,
            rawError: jqXHR
        };
    }

    return {
        type: "UNKNOWN_ERROR",
        userMessage: "Đã xảy ra lỗi không xác định khi tải bản đồ.",
        technicalDetail: "Unknown AJAX error (status: " + status + ", textStatus: " + textStatus + ")",
        status: status,
        textStatus: textStatus,
        errorThrown: errorThrown,
        url: url,
        rawError: jqXHR
    };
};

Game.prototype.normalizeGameError = function (err, source) {
    if (err && err.type) {
        return err;
    }

    if (err instanceof Error && err.name === "InvalidMapNameError") {
        return {
            type: "INVALID_MAP_NAME",
            userMessage: "Bản đồ yêu cầu không tồn tại trong hệ thống. Vui lòng kiểm tra cấu hình lưu trữ.",
            technicalDetail: err.message,
            status: null,
            textStatus: "invalidmapname",
            errorThrown: err.message,
            url: source,
            rawError: err
        };
    }

    if (err instanceof Error && err.name === "StorageAccessError") {
        return {
            type: "STORAGE_ACCESS_ERROR",
            userMessage: "Không thể truy cập bộ nhớ trình duyệt. Vui lòng kiểm tra cài đặt quyền riêng tư.",
            technicalDetail: err.message,
            status: null,
            textStatus: "storageerror",
            errorThrown: err.message,
            url: source,
            rawError: err.rawError || err
        };
    }

    if (err instanceof Error && err.name === "SavedDataParseError") {
        return {
            type: "SAVED_DATA_PARSE_ERROR",
            userMessage: "Dữ liệu lưu trữ cá nhân bị lỗi định dạng. Vui lòng xóa dữ liệu trang hoặc liên hệ hỗ trợ.",
            technicalDetail: err.message,
            status: null,
            textStatus: "saveddataparseerror",
            errorThrown: err.message,
            url: source,
            rawError: err.rawError || err
        };
    }

    if (err instanceof Error && err.name === "MapDataError") {
        return {
            type: "MAP_DATA_ERROR",
            userMessage: "Dữ liệu bản đồ không hợp lệ. Vui lòng liên hệ nhà phát triển.",
            technicalDetail: err.message,
            status: null,
            textStatus: "mapdataerror",
            errorThrown: err.message,
            url: source,
            rawError: err
        };
    }

    return {
        type: "UNKNOWN_ERROR",
        userMessage: "Đã xảy ra lỗi không xác định khi tải trò chơi.",
        technicalDetail: err ? (err.message || String(err)) : "Unknown runtime error",
        status: null,
        textStatus: "error",
        errorThrown: err ? (err.message || String(err)) : "Error",
        url: source,
        rawError: err
    };
};

Game.prototype.fetchSavedData = function () {
    const self = this;
    const dfd = $.Deferred();

    try {
        let rawMap, rawX, rawY, rawFacing, rawChar, rawItems, rawChoices;

        try {
            rawMap = localStorage.getItem("map");
            rawX = localStorage.getItem("x");
            rawY = localStorage.getItem("y");
            rawFacing = localStorage.getItem("facing");
            rawChar = localStorage.getItem("character");
            rawItems = localStorage.getItem("items");
            rawChoices = localStorage.getItem("choices");
        } catch (storageErr) {
            const err = new Error("Không thể đọc từ localStorage (" + (storageErr.message || storageErr) + ")");
            err.name = "StorageAccessError";
            err.rawError = storageErr;
            throw err;
        }

        let parsedItems = {};
        if (rawItems !== null && rawItems !== undefined && rawItems !== "") {
            try {
                parsedItems = JSON.parse(rawItems) || {};
            } catch (parseErr) {
                const err = new Error("Dữ liệu vật phẩm ('items') trong localStorage bị lỗi cú pháp JSON.");
                err.name = "SavedDataParseError";
                err.key = "items";
                err.rawError = parseErr;
                throw err;
            }
        }

        let parsedChoices = {};
        if (rawChoices !== null && rawChoices !== undefined && rawChoices !== "") {
            try {
                parsedChoices = JSON.parse(rawChoices) || {};
            } catch (parseErr) {
                const err = new Error("Dữ liệu lựa chọn ('choices') trong localStorage bị lỗi cú pháp JSON.");
                err.name = "SavedDataParseError";
                err.key = "choices";
                err.rawError = parseErr;
                throw err;
            }
        }

        self.savedData = {
            map: rawMap || "test",
            x: (rawX !== null && rawX !== undefined && rawX !== "") ? parseInt(rawX, 10) || 1 : 1,
            y: (rawY !== null && rawY !== undefined && rawY !== "") ? parseInt(rawY, 10) || 1 : 1,
            facing: rawFacing || "down",
            character: rawChar || "red",
            item: parsedItems,
            choices: parsedChoices,
            uid: Date.now()
        };

        // B1, B2, B3: Đồng bộ danh tính từ /api/auth/me với timeout bao phủ cả response body
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        let timeoutId = controller ? setTimeout(function () { controller.abort(); }, 10000) : null;

        function cleanupAuthTimer() {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        }

        fetch("/api/auth/me", {
            credentials: "same-origin",
            signal: controller ? controller.signal : undefined
        })
        .then(function (response) {
            // B3: Khi nhận 401 Unauthorized, dừng toàn bộ chuỗi khởi tạo và chuyển về /login
            if (response.status === 401) {
                cleanupAuthTimer();
                const authError = {
                    type: "UNAUTHORIZED",
                    status: 401,
                    userMessage: "Phiên đăng nhập đã hết hạn. Đang chuyển hướng đến trang đăng nhập...",
                    technicalDetail: "HTTP 401 Unauthorized from /api/auth/me"
                };
                window.location.href = "/login";
                dfd.reject(authError);
                return;
            }

            // B1: Nếu server trả mã lỗi khác 200 (ví dụ 500, 502, 503, 403), không fallback im lặng sang localStorage
            if (!response.ok) {
                cleanupAuthTimer();
                const serverError = {
                    type: "AUTH_SERVER_ERROR",
                    status: response.status,
                    userMessage: "Máy chủ gặp sự cố khi xác thực danh tính (HTTP " + response.status + "). Vui lòng tải lại trang hoặc thử lại sau.",
                    technicalDetail: "Non-200 HTTP response (" + response.status + ") from /api/auth/me"
                };
                dfd.reject(serverError);
                return;
            }

            // B2: Timeout 10s tiếp tục bao phủ quá trình tải và phân tích response body (response.json)
            return response.json()
                .then(function (meData) {
                    cleanupAuthTimer();
                    if (meData && meData.success && meData.data && meData.data.user) {
                        const user = meData.data.user;
                        // Ưu tiên nhân vật đã lưu trong Database, loại bỏ rủi ro bị ghi đè bởi localStorage cũ
                        if (user.character) {
                            self.savedData.character = user.character;
                        }
                        self.savedData.username = user.username;
                        self.savedData.userId = user.id;

                        // Khôi phục vị trí người chơi từ Firestore (ưu tiên hơn localStorage)
                        if (user.position && Number.isInteger(user.position.x) && Number.isInteger(user.position.y)) {
                            self.savedData.x = user.position.x;
                            self.savedData.y = user.position.y;
                            if (typeof user.position.map === "string" && user.position.map.length > 0) {
                                self.savedData.map = user.position.map;
                            }
                            if (typeof user.position.facing === "string" && user.position.facing.length > 0) {
                                self.savedData.facing = user.position.facing;
                            }
                        }

                        // Hiển thị tên huấn luyện viên lên HUD nếu phần tử tồn tại
                        const trainerNameEl = document.getElementById("trainer-name");
                        if (trainerNameEl) {
                            trainerNameEl.textContent = user.username;
                        }

                        // Chỉ resolve khi đã xác thực thành công danh tính từ backend
                        dfd.resolve(self);
                    } else {
                        // B1: Payload trả về không hợp lệ, từ chối khởi tạo
                        const dataError = {
                            type: "AUTH_DATA_ERROR",
                            status: response.status,
                            userMessage: "Dữ liệu xác thực tài khoản từ máy chủ không hợp lệ. Vui lòng thử đăng nhập lại.",
                            technicalDetail: "Missing user profile in /api/auth/me response"
                        };
                        dfd.reject(dataError);
                    }
                })
                .catch(function (bodyErr) {
                    cleanupAuthTimer();
                    // B2: Phân biệt rõ lỗi do AbortController hủy khi đang đọc body vs lỗi cú pháp JSON thật
                    const isAbort = (bodyErr && bodyErr.name === "AbortError") || (controller && controller.signal && controller.signal.aborted);
                    if (isAbort) {
                        const timeoutError = {
                            type: "AUTH_TIMEOUT",
                            status: 0,
                            userMessage: "Xác thực danh tính quá thời gian chờ (10s). Vui lòng kiểm tra mạng và làm mới trang.",
                            technicalDetail: "Reading response body for /api/auth/me timed out after 10000ms"
                        };
                        dfd.reject(timeoutError);
                    } else {
                        const parseError = {
                            type: "JSON_PARSE_ERROR",
                            status: response.status,
                            userMessage: "Phản hồi xác thực từ máy chủ bị lỗi định dạng JSON.",
                            technicalDetail: "JSON parse error from /api/auth/me: " + (bodyErr ? bodyErr.message : "Invalid JSON")
                        };
                        dfd.reject(parseError);
                    }
                });
        })
        .catch(function (fetchErr) {
            cleanupAuthTimer();

            // B2: Phân biệt rõ Timeout vs Network Error, tuyệt đối không fallback im lặng
            const isTimeout = (fetchErr && fetchErr.name === "AbortError") || (controller && controller.signal && controller.signal.aborted);
            const netError = {
                type: isTimeout ? "AUTH_TIMEOUT" : "AUTH_NETWORK_ERROR",
                status: 0,
                userMessage: isTimeout
                    ? "Xác thực danh tính quá thời gian chờ (10s). Vui lòng kiểm tra mạng và làm mới trang."
                    : "Không thể kết nối đến máy chủ để xác thực tài khoản. Vui lòng kiểm tra kết nối mạng.",
                technicalDetail: isTimeout
                    ? "Request to /api/auth/me timed out after 10000ms"
                    : ("Network error on /api/auth/me: " + (fetchErr ? fetchErr.message : "Unknown error"))
            };
            dfd.reject(netError);
        });
    } catch (err) {
        const normalized = self.normalizeGameError(err, "localStorage");
        dfd.reject(normalized);
    }

    return dfd.promise();
};
