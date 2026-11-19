Game.prototype.fetchMapData = function () {
    const self = this;
    const registryUrl = "/res/world.json";

    return $.getJSON(registryUrl)
        .then(function (registry) {
            self.maps = self.validateWorldRegistry(registry);
            self.worldRegistry = registry;

            const mapId = self.savedData.map || registry.defaultMapId;
            return self.prepareMap(mapId).then(function (prepared) {
                if (!self.isPreparedTileWalkable(prepared, self.savedData.x, self.savedData.y)) {
                    const err = new Error("Vị trí đã lưu không hợp lệ hoặc bị chặn; dữ liệu tài khoản chưa được thay đổi.");
                    err.name = "MapDataError";
                    throw self.normalizeGameError(err, mapId);
                }
                self.applyPreparedMap(prepared);
                return self;
            });
        }, function (jqXHR, textStatus, errorThrown) {
            throw self.normalizeAjaxError(jqXHR, textStatus, errorThrown, registryUrl);
        })
        .catch(function (err) {
            const normalizedError = (err && err.type)
                ? err
                : self.normalizeGameError(err, registryUrl);
            return $.Deferred().reject(normalizedError).promise();
        });
};

Game.prototype.prepareMap = function (mapId) {
    const self = this;
    const registry = this.worldRegistry;
    if (!registry || !registry.maps || !Object.prototype.hasOwnProperty.call(registry.maps, mapId)) {
        const err = new Error("Tên bản đồ '" + mapId + "' không tồn tại trong World Registry.");
        err.name = "InvalidMapNameError";
        return $.Deferred().reject(self.normalizeGameError(err, mapId)).promise();
    }

    const entry = registry.maps[mapId];
    return $.getJSON(entry.data).then(function (mapData) {
        return $.getJSON(entry.npcs).then(function (npcData) {
            const prepared = self.prepareMapData(mapData, npcData, mapId);
            return self.preloadMapAssets(entry.assets, prepared).then(function () {
                return prepared;
            });
        }, function (jqXHR, textStatus, errorThrown) {
            throw self.normalizeAjaxError(jqXHR, textStatus, errorThrown, entry.npcs);
        });
    }, function (jqXHR, textStatus, errorThrown) {
        throw self.normalizeAjaxError(jqXHR, textStatus, errorThrown, entry.data);
    });
};

Game.prototype.isPreparedTileWalkable = function (prepared, x, y) {
    if (!prepared || !Number.isInteger(x) || !Number.isInteger(y) ||
        x < 0 || y < 0 || x >= prepared.width || y >= prepared.height) return false;
    const tileType = this.tileTypes[prepared.mapTiles[y][x]];
    return !!tileType && !tileType.block;
};

Game.prototype.preloadMapAssets = function (assets, prepared) {
    if (typeof Image === "undefined") return Promise.resolve();
    const expectedWidth = prepared.width * this.tileSize;
    const expectedHeight = prepared.height * this.tileSize;
    const paths = [assets.background, assets.overlay];
    return Promise.all(paths.map(function (src) {
        return new Promise(function (resolve, reject) {
            const image = new Image();
            image.onload = function () {
                const width = image.naturalWidth || image.width;
                const height = image.naturalHeight || image.height;
                if (width !== expectedWidth || height !== expectedHeight) {
                    const err = new Error("Kích thước asset '" + src + "' không khớp kích thước map.");
                    err.name = "MapDataError";
                    reject(err);
                    return;
                }
                resolve();
            };
            image.onerror = function () {
                const err = new Error("Không tải được asset map '" + src + "'.");
                err.name = "MapDataError";
                reject(err);
            };
            image.src = src;
        });
    }));
};

// Validate the trusted manifest before resolving map IDs from saved player data.
Game.prototype.validateWorldRegistry = function (registry) {
    const fail = function (message) {
        const err = new Error(message);
        err.name = "MapDataError";
        throw err;
    };
    const isObject = function (value) {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    };

    if (!isObject(registry) || registry.version !== 1 || !isObject(registry.maps)) {
        fail("World Registry phải là object version 1 và có danh sách maps hợp lệ.");
    }

    const mapIds = Object.keys(registry.maps);
    if (mapIds.length === 0 || typeof registry.defaultMapId !== "string" ||
        !Object.prototype.hasOwnProperty.call(registry.maps, registry.defaultMapId)) {
        fail("defaultMapId phải trỏ đến một map có trong World Registry.");
    }

    const validPath = function (value, prefix, suffix) {
        return typeof value === "string" && value.startsWith(prefix) && value.endsWith(suffix) &&
            value.indexOf("..") === -1 && value.indexOf("\\") === -1 &&
            value.indexOf("?") === -1 && value.indexOf("#") === -1;
    };

    for (let i = 0; i < mapIds.length; i++) {
        const mapId = mapIds[i];
        const map = registry.maps[mapId];
        if (!/^[A-Za-z0-9_-]+$/.test(mapId) || !isObject(map) ||
            !validPath(map.data, "/res/", ".json") || !validPath(map.npcs, "/res/npcs/", ".json")) {
            fail("Cấu hình dữ liệu hoặc NPC của map '" + mapId + "' không hợp lệ.");
        }

        if (!isObject(map.assets) || typeof map.assets.background !== "string" ||
            typeof map.assets.overlay !== "string" ||
            !validPath(map.assets.background, "/img/maps/", ".png") ||
            !validPath(map.assets.overlay, "/img/maps/", ".png")) {
            fail("Map '" + mapId + "' thiếu đường dẫn background hoặc overlay.");
        }

        if (!map.spawnPoints || !isObject(map.spawnPoints) || Object.keys(map.spawnPoints).length === 0 ||
            (map.transitions !== undefined && !Array.isArray(map.transitions))) {
            fail("Spawn point hoặc transition của map '" + mapId + "' không hợp lệ.");
        }
    }

    for (let i = 0; i < mapIds.length; i++) {
        const mapId = mapIds[i];
        const map = registry.maps[mapId];
        const ids = new Set();
        for (let j = 0; j < (map.transitions || []).length; j++) {
            const transition = map.transitions[j];
            const targetMap = transition && transition.target && registry.maps[transition.target.mapId];
            if (!transition || typeof transition.id !== "string" || !transition.id || ids.has(transition.id) ||
                !transition.tile || !Number.isInteger(transition.tile.x) || !Number.isInteger(transition.tile.y) ||
                !targetMap || !targetMap.spawnPoints || !Object.prototype.hasOwnProperty.call(targetMap.spawnPoints, transition.target.spawnId)) {
                fail("Transition của map '" + mapId + "' tham chiếu map hoặc spawn không hợp lệ.");
            }
            ids.add(transition.id);
        }
    }

    return registry.maps;
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
