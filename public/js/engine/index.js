const Game = function () {

    this.socket = io();

    this.$loader = document.querySelector("#load_layer");
    
    this.$level = document.querySelector("#level");
    this.$world = $("#world");
    this.$map = document.querySelector("#map");
    this.$overlay = document.querySelector("#map-overlay");
    this.$player = document.querySelector("#player");

    this.level.size = {
        width: this.$level.clientWidth,
        height: this.$level.clientHeight
    };

    this.level.scale = {
        x: (this.level.size.width / 2) - 7,
        y: (this.level.size.height / 2) - 7
    };

    this.state = "NORMAL";
    this.npcs = [];
    this.activeDialogue = null;
    this._positionSavePromise = Promise.resolve();
    this.$dialogueBox = document.querySelector("#dialogue-box");
    this.$dialogueText = document.querySelector("#dialogue-text");
};

Game.prototype.load = function () {
    const self = this;
    return this.fetchSavedData()
        .then(function () {
            return self.fetchMapData();
        });
};

Game.prototype.resolveErrorMessage = function (errorInfo) {
    if (!errorInfo) {
        return "Đã xảy ra lỗi khi khởi tạo trò chơi. Vui lòng làm mới trang (F5).";
    }

    // 1. Ưu tiên userMessage nếu có nội dung hợp lệ
    if (typeof errorInfo.userMessage === "string" && errorInfo.userMessage.trim().length > 0) {
        return errorInfo.userMessage.trim();
    }

    // 2. Ánh xạ theo mã type chuẩn hóa (B6)
    if (typeof errorInfo.type === "string") {
        switch (errorInfo.type) {
            case "UNAUTHORIZED":
                return "Phiên đăng nhập đã hết hạn. Đang chuyển hướng đến trang đăng nhập...";
            case "AUTH_TIMEOUT":
                return "Xác thực danh tính quá thời gian chờ (10s). Vui lòng kiểm tra mạng và làm mới trang.";
            case "AUTH_NETWORK_ERROR":
                return "Không thể kết nối đến máy chủ để xác thực tài khoản. Vui lòng kiểm tra mạng.";
            case "AUTH_SERVER_ERROR":
                return "Máy chủ gặp sự cố khi xác thực danh tính. Vui lòng thử lại sau.";
            case "AUTH_DATA_ERROR":
                return "Dữ liệu xác thực không hợp lệ. Vui lòng thử đăng nhập lại.";
            case "INVALID_MAP_NAME":
                return "Bản đồ yêu cầu không tồn tại trong hệ thống. Vui lòng kiểm tra cấu hình.";
            case "STORAGE_ACCESS_ERROR":
                return "Không thể truy cập bộ nhớ trình duyệt. Vui lòng kiểm tra cài đặt quyền riêng tư.";
            case "SAVED_DATA_PARSE_ERROR":
                return "Dữ liệu lưu trữ bị lỗi định dạng. Vui lòng xóa dữ liệu trang hoặc liên hệ hỗ trợ.";
            case "MAP_DATA_ERROR":
                return "Dữ liệu bản đồ không hợp lệ. Vui lòng liên hệ nhà phát triển.";
            case "NETWORK_ERROR":
                return "Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng.";
            case "REQUEST_ABORTED":
                return "Quá trình tải dữ liệu đã bị hủy. Vui lòng tải lại trang.";
            case "JSON_PARSE_ERROR":
                return "Tệp dữ liệu trò chơi bị lỗi định dạng.";
            case "HTTP_ERROR":
                return "Không thể tải tài nguyên trò chơi từ máy chủ.";
        }
    }

    // 3. Fallback theo message của Error thông thường nếu có
    if (typeof errorInfo.message === "string" && errorInfo.message.trim().length > 0) {
        return errorInfo.message.trim();
    }

    if (typeof errorInfo === "string" && errorInfo.trim().length > 0) {
        return errorInfo.trim();
    }

    // 4. Mặc định an toàn, tuyệt đối không bao giờ hiển thị rỗng, undefined hay null
    return "Đã xảy ra lỗi khi khởi tạo trò chơi. Vui lòng làm mới trang (F5).";
};

Game.prototype.showInitError = function (errorInfo) {
    const errorType = (errorInfo && typeof errorInfo.type === "string") ? errorInfo.type : "INIT_ERROR";
    const detail = (errorInfo && typeof errorInfo.technicalDetail === "string")
        ? errorInfo.technicalDetail
        : ((errorInfo && errorInfo.message) || "Unknown error");

    console.error("[Poké-Engine - " + errorType + "]:", detail, errorInfo);

    if (this.$loader) {
        this.$loader.textContent = this.resolveErrorMessage(errorInfo);
        this.$loader.style.display = "flex";
        this.$loader.style.alignItems = "center";
        this.$loader.style.justifyContent = "center";
        this.$loader.style.color = "#ffffff";
        this.$loader.style.fontFamily = "monospace";
        this.$loader.style.fontSize = "14px";
        this.$loader.style.padding = "20px";
        this.$loader.style.textAlign = "center";
    }
};

Game.prototype.start = function () {
    this.player = new Player(
        this, 
        this.savedData.x, 
        this.savedData.y, 
        this.savedData.facing, 
        {
            character: this.savedData.character,
            type: 0
        }
    );

    this.player.addToScene();
    if (this.player.position.x * this.tileSize >= this.level.size.width ||
        this.player.position.y * this.tileSize >= this.level.size.height) {
        this.cameraResetToPlayer();
    }
};

Game.prototype.update = function () {
    if (this.state !== "NORMAL")
        return;

    if (this.key.isDown(this.key.UP) || this.key.isDown(this.key.W))
        this.player.walk("up");
    else if (this.key.isDown(this.key.DOWN) || this.key.isDown(this.key.S))
        this.player.walk("down");

    if (this.key.isDown(this.key.LEFT) || this.key.isDown(this.key.A))
        this.player.walk("left");
    else if (this.key.isDown(this.key.RIGHT) || this.key.isDown(this.key.D)) 
        this.player.walk("right");

    this.updatePortalHint();
};

// Tìm NPC theo tọa độ ô tile (x, y)
Game.prototype.getNpcAt = function (x, y) {
    if (!this.npcs || !Array.isArray(this.npcs)) return null;
    for (let i = 0; i < this.npcs.length; i++) {
        const npc = this.npcs[i];
        if (npc && npc.collision !== false && npc.position && npc.position.x === x && npc.position.y === y) {
            return npc;
        }
    }
    return null;
};

// Tính tọa độ ô ngay trước mặt người chơi dựa theo hướng nhìn
Game.prototype.getTileInFrontOfPlayer = function () {
    if (!this.player || !this.player.position) return { x: 0, y: 0 };
    const pos = { x: this.player.position.x, y: this.player.position.y };
    switch (this.player.position.facing) {
        case "up":
            pos.y--;
            break;
        case "down":
            pos.y++;
            break;
        case "left":
            pos.x--;
            break;
        case "right":
            pos.x++;
            break;
    }
    return pos;
};

// Lấy đối tượng NPC đang đứng đối diện người chơi nếu có
Game.prototype.getNpcInFront = function () {
    const frontTile = this.getTileInFrontOfPlayer();
    return this.getNpcAt(frontTile.x, frontTile.y);
};

// Lấy portal người chơi đang đứng trên hoặc đứng cạnh (theo hướng nhìn)
Game.prototype.getTransitionAtPlayer = function () {
    if (!Array.isArray(this.portals) || !this.player || !this.player.position) return null;
    const position = this.player.position;
    let target = { x: position.x, y: position.y };
    for (let i = 0; i < this.portals.length; i++) {
        const portal = this.portals[i];
        if (portal.tile.x === target.x && portal.tile.y === target.y) return portal;
    }

    switch (position.facing) {
        case "up": target.y--; break;
        case "down": target.y++; break;
        case "left": target.x--; break;
        case "right": target.x++; break;
        default: return null;
    }

    for (let i = 0; i < this.portals.length; i++) {
        const portal = this.portals[i];
        if (portal.tile.x === target.x && portal.tile.y === target.y) return portal;
    }
    return null;
};

// Hiển thị tên nơi đến khi người chơi đứng trên hoặc cạnh portal.

// Hiển thị tên nơi đến khi người chơi đứng trên hoặc cạnh portal.
// Tên đọc từ world.json qua this.portals[i].displayName — không hardcode.
Game.prototype.updatePortalHint = function () {
    if (!this.$portalHint || !this.$portalHint.parentNode) {
        this.$portalHint = document.querySelector("#portal-hint");
    }
    if (!this.$portalHint) return;

    if (this.$portalHint.getAttribute("data-disabled") === "true") {
        this.$portalHint.style.display = "none";
        return;
    }

    if (this.state !== "NORMAL") {
        this.$portalHint.style.display = "none";
        return;
    }

    const portal = this.getTransitionAtPlayer();
    if (portal && portal.displayName) {
        const next = "Đi đến " + portal.displayName + "? (Space)";
        if (this.$portalHint.textContent !== next) {
            this.$portalHint.textContent = next;
        }
        this.$portalHint.style.display = "block";
    } else {
        this.$portalHint.style.display = "none";
    }
};

// Mở khung thoại với NPC
Game.prototype.openDialogue = function (npc) {
    if (!npc) return;
    this.state = "DIALOGUE";
    if (this.player) this.player.stop = true;
    if (this.key && this.key._pressed) this.key._pressed = {};

    if (npc.setFacing && this.player && this.player.position) {
        const oppositeFacing = { up:"down", down:"up", left:"right", right:"left" };
        const newFacing = oppositeFacing[this.player.position.facing];
        if (newFacing) npc.setFacing(newFacing);
    }

    const lines = (npc.dialogue && Array.isArray(npc.dialogue) && npc.dialogue.length > 0)
        ? npc.dialogue
        : ["..."];
    this.activeDialogue = { npc: npc, lines: lines, index: 0 };

    // Đảm bảo $dialogueBox có trước khi append #dialogue-name
    if (!this.$dialogueBox) this.$dialogueBox = document.querySelector("#dialogue-box");

    // Tạo & hiển thị tên NPC (không hardcode tên — đọc từ npc.name)
    let nameEl = document.querySelector("#dialogue-name");
    if (!nameEl && this.$dialogueBox) {
        nameEl = document.createElement("div");
        nameEl.id = "dialogue-name";
        this.$dialogueBox.appendChild(nameEl);
    }
    if (nameEl) {
        nameEl.textContent = (typeof npc.name === "string" && npc.name.trim())
            ? npc.name.trim()
            : "NPC";
    }

    this.renderDialogueText(lines[0]);
    if (this.$dialogueBox) this.$dialogueBox.style.display = "block";
};
// Hiển thị nội dung câu thoại
Game.prototype.renderDialogueText = function (text) {
    if (!this.$dialogueText) {
        this.$dialogueText = document.querySelector("#dialogue-text");
    }
    if (this.$dialogueText) {
        this.$dialogueText.textContent = text || "";
    }
};

// Chuyển sang câu thoại kế tiếp hoặc đóng khung thoại khi hết câu
Game.prototype.advanceDialogue = function () {
    if (!this.activeDialogue) {
        this.closeDialogue();
        return;
    }

    this.activeDialogue.index++;
    if (this.activeDialogue.index < this.activeDialogue.lines.length) {
        this.renderDialogueText(this.activeDialogue.lines[this.activeDialogue.index]);
    } else {
        this.closeDialogue();
    }
};

// Đóng khung thoại và trả quyền điều khiển cho người chơi
Game.prototype.closeDialogue = function () {
    this.state = "NORMAL";
    this.activeDialogue = null;

    // Trả lại quyền di chuyển cho người chơi (DLG-05)
    if (this.player) {
        this.player.stop = false;
    }

    if (!this.$dialogueBox) {
        this.$dialogueBox = document.querySelector("#dialogue-box");
    }
    if (this.$dialogueBox) {
        this.$dialogueBox.style.display = "none";
    }
    if (this.key && this.key._pressed) {
        this.key._pressed = {};
    }
};

// Xử lý khi nhấn phím tương tác Space hoặc Enter
Game.prototype.handleInteraction = function () {
    if (this.state === "DIALOGUE") {
        this.advanceDialogue();
    } else if (this.state === "NORMAL") {
        if (this.player && this.player.walkInProgress) {
            return;
        }
        const transition = this.getTransitionAtPlayer();
        if (transition) {
            this.transitionMap(transition.id);
            return;
        }
        const npc = this.getNpcInFront();
        if (npc) {
            this.openDialogue(npc);
        }
    }
};

Game.prototype.transitionMap = function (transitionId) {
    const self = this;
    if (this.state !== "NORMAL" || !this.player || this.player.walkInProgress || !this.worldRegistry) {
        return Promise.resolve(false);
    }

    const currentMap = this.worldRegistry.maps[this.savedData.map];
    const transitions = currentMap && Array.isArray(currentMap.transitions) ? currentMap.transitions : [];
    const transition = transitions.find(item => item.id === transitionId);
    if (!transition || !this.getTransitionAtPlayer() || this.getTransitionAtPlayer().id !== transitionId) {
        return Promise.resolve(false);
    }

    const targetMap = this.worldRegistry.maps[transition.target.mapId];
    const spawn = targetMap && targetMap.spawnPoints && targetMap.spawnPoints[transition.target.spawnId];
    if (!targetMap || !spawn) {
        return Promise.resolve(false);
    }

    this.state = "TRANSITION";
    this.player.stop = true;
    if (this.key && this.key._pressed) this.key._pressed = {};
    if (this._savePositionTimer) {
        clearTimeout(this._savePositionTimer);
        this._savePositionTimer = null;
    }

    let committed = false;
    let preparedState = null;
    const pendingSave = this._positionSavePromise || Promise.resolve();
    return Promise.resolve(pendingSave)
        .then(function () {
            return self.prepareMap(transition.target.mapId);
        })
        .then(function (prepared) {
            if (!self.isPreparedTileWalkable(prepared, spawn.x, spawn.y)) {
                throw new Error("Spawn đích không đi được trên collision map.");
            }
            preparedState = prepared;
            return self.requestServerMapTransition(transitionId);
        })
        .then(function (serverState) {
            if (!serverState || serverState.mapId !== transition.target.mapId) {
                throw new Error("Server returned an unexpected destination map.");
            }
            self.cancelCameraMotion();
            self.activeDialogue = null;
            if (self.$dialogueBox) self.$dialogueBox.style.display = "none";
            self.clearOnlinePlayers();
            self.applyPreparedMap(preparedState);
            self.player.setTilePosition(spawn.x, spawn.y, spawn.facing);
            self.savedData.x = spawn.x;
            self.savedData.y = spawn.y;
            self.savedData.facing = spawn.facing;
            self.cameraResetToPlayer();
            self.addOnlinePlayerSnapshot(serverState.players || []);
            committed = true;
            self.state = "NORMAL";
            self.player.stop = false;
            self.key._pressed = {};
            return self.savePosition().then(function () {
                return true;
            }).catch(function (saveError) {
                console.warn("[Poké-Engine] Position save after map transition failed:", saveError.message || saveError);
                self.scheduleSavePosition();
                return true;
            });
        })
        .catch(function (err) {
            if (!committed) {
                self.state = "NORMAL";
                if (self.player) self.player.stop = false;
                if (self.key && self.key._pressed) self.key._pressed = {};
                console.warn("[Poké-Engine] Map transition rejected:", err && (err.message || err));
            }
            return false;
        });
};

// Thiết lập lắng nghe phím Space / Enter an toàn, chống auto-repeat
Game.prototype.setupInteractionListener = function () {
    const self = this;
    document.addEventListener("keydown", function (e) {
        if (e.keyCode === 32 || e.keyCode === 13) {
            const target = e.target;
            if (target && (target.id === "btn-logout" || (target.closest && target.closest("#btn-logout"))))
                return;

            e.preventDefault();
            if (!e.repeat) {
                self.handleInteraction();
            }
        }
    }, false);
};

Game.prototype.$release = function () {
    // Tạo #portal-hint nếu HTML chưa có — tránh phải sửa file HTML.
    if (!document.querySelector("#portal-hint")) {
        const hint = document.createElement("div");
        hint.id = "portal-hint";
        const levelEl = document.querySelector("#level");
        if (levelEl) levelEl.appendChild(hint);
    }
    this.$portalHint = document.querySelector("#portal-hint");

    this.keyBoardListener();
    this.setupInteractionListener();
    this.socketListener();

    // Khởi tạo hệ thống Modern RPG UI (HUD, Inventory, Equipment, Character, Pokémon)
    if (typeof PokeInventoryService !== "undefined" && typeof PokeModalManager !== "undefined") {
        this.inventoryService = new PokeInventoryService(this.savedData ? this.savedData.userId : "guest");
        this.modalManager = new PokeModalManager(this);
        this.hud = new PokeModernHUD(this, this.modalManager, this.inventoryService);
        this.inventoryUI = new PokeInventoryUI(this.modalManager, this.inventoryService, this.hud);
        this.equipmentUI = new PokeEquipmentUI(this.modalManager, this.inventoryService);
        this.characterUI = new PokeCharacterUI(this, this.modalManager, this.inventoryService);
        this.pokemonUI = new PokePokemonUI(this, this.modalManager);
    }

    setInterval(() => this.update(), 1000 / 30);
};

// ===========================================================================
// POSITION PERSISTENCE – Lưu vị trí người chơi lên Firestore (POS-01)
// Sử dụng Debounce 2000ms: Chỉ gửi khi người chơi đứng yên ≥ 2 giây
// Tọa độ được tính theo đơn vị tile (integer), không phải pixel
// ===========================================================================

Game.prototype._savePositionTimer = null;
Game.prototype._lastSavedPosition = null;

// Gửi vị trí hiện tại lên server ngay lập tức (dùng khi logout)
Game.prototype.savePosition = function (callback) {
    if (!this.player || !this.player.position) {
        if (typeof callback === "function") callback(null);
        return Promise.resolve(null);
    }

    const pos = {
        x: this.player.position.x,
        y: this.player.position.y,
        map: this.savedData ? (this.savedData.map || "test") : "test",
        facing: this.player.position.facing || "down"
    };

    // Không gửi nếu vị trí không thay đổi so với lần lưu cuối
    const lastStr = this._lastSavedPosition ? JSON.stringify(this._lastSavedPosition) : null;
    const curStr = JSON.stringify(pos);
    if (lastStr === curStr) {
        if (typeof callback === "function") callback(null);
        return Promise.resolve(null);
    }

    function getCsrfToken() {
        var match = document.cookie.match(/(?:^|;\s*)poke\.csrf=([^;]+)/);
        if (match && match[1]) {
            return decodeURIComponent(match[1].trim());
        }
        return "";
    }

    var self = this;
    const previousSave = this._positionSavePromise || Promise.resolve();
    const savePromise = Promise.resolve(previousSave).catch(function () {}).then(function () {
        return fetch("/api/auth/position", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-csrf-token": getCsrfToken()
            },
            credentials: "same-origin",
            body: JSON.stringify(pos)
        });
    }).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status + " while saving player position.");
        self._lastSavedPosition = pos;
        if (typeof callback === "function") callback(null);
        return pos;
    }).catch(function (err) {
        console.warn("[Poké-Engine] savePosition failed:", err ? err.message : err);
        if (typeof callback === "function") callback(err);
        throw err;
    });
    this._positionSavePromise = savePromise;
    return savePromise;
};

// Lên lịch lưu vị trí với Debounce 2000ms (gọi sau mỗi bước đi)
Game.prototype.scheduleSavePosition = function () {
    var self = this;
    if (self._savePositionTimer) {
        clearTimeout(self._savePositionTimer);
    }
    self._savePositionTimer = setTimeout(function () {
        self._savePositionTimer = null;
        self.savePosition().catch(function () {});
    }, 2000);
};
