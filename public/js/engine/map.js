Game.prototype.prepareMapData = function (data, npcData, mapId) {

    // 1. Kiểm tra cấu trúc gốc
    if (!data || typeof data !== "object") {
        const err = new Error("Dữ liệu bản đồ gốc không hợp lệ (không phải Object).");
        err.name = "MapDataError";
        throw err;
    }

    // 2. Kiểm tra kích thước cấp gốc
    if (!Number.isInteger(data.width) || data.width <= 0 || !Number.isInteger(data.height) || data.height <= 0) {
        const err = new Error("Kích thước bản đồ cấp gốc (width/height) phải là số nguyên dương.");
        err.name = "MapDataError";
        throw err;
    }

    // 3. Kiểm tra danh sách layers
    if (!Array.isArray(data.layers) || data.layers.length === 0) {
        const err = new Error("Bản đồ thiếu thuộc tính 'layers' hoặc danh sách layers rỗng.");
        err.name = "MapDataError";
        throw err;
    }

    // 4. Tìm layer collision
    let collisionLayer = null;
    for (let i = 0, l = data.layers.length; i < l; i++) {
        if (data.layers[i] && data.layers[i].name === "collision") {
            collisionLayer = data.layers[i];
            break;
        }
    }

    if (!collisionLayer) {
        const err = new Error("Bản đồ không chứa layer có tên 'collision'.");
        err.name = "MapDataError";
        throw err;
    }

    // 5. Kiểm tra kích thước layer collision và đối chiếu với cấp gốc
    if (!Number.isInteger(collisionLayer.width) || collisionLayer.width <= 0 ||
        !Number.isInteger(collisionLayer.height) || collisionLayer.height <= 0) {
        const err = new Error("Kích thước layer collision (width/height) phải là số nguyên dương.");
        err.name = "MapDataError";
        throw err;
    }

    if (collisionLayer.width !== data.width || collisionLayer.height !== data.height) {
        const err = new Error("Kích thước layer collision không khớp với kích thước bản đồ gốc.");
        err.name = "MapDataError";
        throw err;
    }

    // 6. Kiểm tra mảng dữ liệu collision
    if (!Array.isArray(collisionLayer.data)) {
        const err = new Error("Dữ liệu của layer collision (data) phải là một mảng.");
        err.name = "MapDataError";
        throw err;
    }

    const expectedLength = data.width * data.height;
    if (collisionLayer.data.length !== expectedLength) {
        const err = new Error("Số lượng phần tử collision (" + collisionLayer.data.length + ") không khớp với width * height (" + expectedLength + ").");
        err.name = "MapDataError";
        throw err;
    }

    // 7. Kiểm tra từng ô theo từ điển tileTypes (mã 0, 1, 2, 3 đều hợp lệ)
    const collision = collisionLayer.data;
    for (let i = 0; i < expectedLength; i++) {
        const val = collision[i];
        if (!Number.isInteger(val) || val < 0 || this.tileTypes[val] === undefined) {
            const err = new Error("Ô collision tại chỉ số " + i + " có giá trị không hợp lệ: " + val);
            err.name = "MapDataError";
            throw err;
        }
    }

    // --- Giữ nguyên logic xử lý dữ liệu và dựng map gốc của tác giả ---
    var y = data.height,
        x = data.width,
        total = 0,
        map = [];

    for (let i = 0; i < y; i++) {
        map.push([]);
        for (let ii = 0; ii < x; ii++) 
            map[i].push(collision[total++]);
    }

    const entry = this.worldRegistry && this.worldRegistry.maps && this.worldRegistry.maps[mapId];
    if (!entry || !npcData || npcData.version !== 1 || npcData.mapId !== mapId || !Array.isArray(npcData.npcs)) {
        const err = new Error("Dữ liệu NPC của map '" + mapId + "' không hợp lệ.");
        err.name = "MapDataError";
        throw err;
    }

    const isWalkable = function (x, y) {
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= data.width || y >= data.height) return false;
        const tile = collision[y * data.width + x];
        const type = this.tileTypes[tile];
        return !!type && !type.block;
    }.bind(this);

    const spawnPoints = entry.spawnPoints;
    if (!spawnPoints || typeof spawnPoints !== "object" || Array.isArray(spawnPoints) || Object.keys(spawnPoints).length === 0) {
        const err = new Error("Map '" + mapId + "' phải có ít nhất một spawn point.");
        err.name = "MapDataError";
        throw err;
    }

    for (const spawnId of Object.keys(spawnPoints)) {
        const spawn = spawnPoints[spawnId];
        if (!spawn || !isWalkable(spawn.x, spawn.y) ||
            !["up", "down", "left", "right"].includes(spawn.facing)) {
            const err = new Error("Spawn point '" + spawnId + "' của map '" + mapId + "' không hợp lệ hoặc bị chặn.");
            err.name = "MapDataError";
            throw err;
        }
    }

    const npcIds = new Set();
    for (let i = 0; i < npcData.npcs.length; i++) {
        const npc = npcData.npcs[i];
        if (!npc || typeof npc.id !== "string" || !npc.id || npcIds.has(npc.id) ||
            !npc.position || !isWalkable(npc.position.x, npc.position.y) ||
            typeof npc.sprite !== "string" || !/^[A-Za-z0-9_-]+$/.test(npc.sprite) ||
            !["up", "down", "left", "right"].includes(npc.facing) ||
            !Array.isArray(npc.dialogue) || !npc.dialogue.every(line => typeof line === "string")) {
            const err = new Error("NPC tại chỉ số " + i + " của map '" + mapId + "' không hợp lệ.");
            err.name = "MapDataError";
            throw err;
        }
        npcIds.add(npc.id);
    }

    const transitions = Array.isArray(entry.transitions) ? entry.transitions : [];
    const transitionIds = new Set();
    for (let i = 0; i < transitions.length; i++) {
        const transition = transitions[i];
        const targetMap = transition && transition.target && this.worldRegistry.maps[transition.target.mapId];
        const targetSpawn = targetMap && targetMap.spawnPoints && targetMap.spawnPoints[transition.target.spawnId];
        if (!transition || typeof transition.id !== "string" || !transition.id || transitionIds.has(transition.id) ||
            !transition.tile || !isWalkable(transition.tile.x, transition.tile.y) || !targetSpawn) {
            const err = new Error("Transition tại chỉ số " + i + " của map '" + mapId + "' không hợp lệ.");
            err.name = "MapDataError";
            throw err;
        }
        transitionIds.add(transition.id);
    }

    return {
        mapId: mapId,
        width: data.width,
        height: data.height,
        mapTiles: map,
        npcs: npcData.npcs,
        transitions: transitions
    };
};

Game.prototype.generateMapData = function (data, npcData, mapId) {
    const prepared = this.prepareMapData(data, npcData, mapId || this.savedData.map);
    this.applyPreparedMap(prepared);
    return this;
};

Game.prototype.applyPreparedMap = function (prepared) {
    if (!prepared || !this.worldRegistry || !this.worldRegistry.maps[prepared.mapId]) {
        const err = new Error("Không thể áp dụng dữ liệu map chưa được kiểm tra.");
        err.name = "MapDataError";
        throw err;
    }

    this.mapLoaded = false;
    this.savedData.map = prepared.mapId;
    this.mapTiles = prepared.mapTiles;
    this.mapData.width = prepared.width;
    this.mapData.height = prepared.height;
    this.setupNpcs(prepared.npcs);
    this.setupPortals(prepared.transitions);
    if (typeof this.setupOverworldPokemon === "function") {
        this.setupOverworldPokemon(prepared);
    }
    this.applyMap();
};

Game.prototype.setupNpcs = function (npcs) {
    // 1. Dọn dẹp DOM và danh sách NPC cũ nếu có (chống nhân đôi khi nạp lại map - MAP-01)
    if (this.npcs && Array.isArray(this.npcs)) {
        for (let i = 0; i < this.npcs.length; i++) {
            const oldNpc = this.npcs[i];
            if (oldNpc && oldNpc.$el && oldNpc.$el.parentNode) {
                oldNpc.$el.parentNode.removeChild(oldNpc.$el);
            }
        }
    }
    this.npcs = [];

    if (!Array.isArray(npcs)) return;
    for (let i = 0; i < npcs.length; i++) {
        const data = npcs[i];
        const npc = new NPC(this, data.position.x, data.position.y, data.facing, {
            id: data.id,
            name: data.name || "NPC",
            character: data.sprite,
            dialogue: data.dialogue
        });
        npc.collision = data.collision !== false;
        this.npcs.push(npc);
        npc.addToScene();
    }
};

Game.prototype.setupPortals = function (transitions) {
    if (Array.isArray(this.portals)) {
        this.portals.forEach(function (portal) {
            if (portal.element && portal.element.parentNode) {
                portal.element.parentNode.removeChild(portal.element);
            }
        });
    }
    this.portals = [];

    if (!Array.isArray(transitions)) return;
    for (let i = 0; i < transitions.length; i++) {
        const transition = transitions[i];
        const element = document.createElement("div");
        element.className = "world-portal";
        element.setAttribute("data-portal-id", transition.id);

        // Tên hiển thị: ưu tiên transition.displayName, fallback map.displayName, fallback mapId.
        // Không hardcode tên trong JS; mọi tên đến từ world.json.
        const targetMap = this.worldRegistry && this.worldRegistry.maps
            ? this.worldRegistry.maps[transition.target.mapId]
            : null;
        const targetName = (targetMap && typeof targetMap.displayName === "string" && targetMap.displayName)
            ? targetMap.displayName
            : transition.target.mapId;
        const portalName = (typeof transition.displayName === "string" && transition.displayName)
            ? transition.displayName
            : targetName;

        element.setAttribute("role", "img");
        element.setAttribute("aria-label", "Cổng đến " + portalName);
        element.title = portalName + " — Nhấn Space/Enter";
        element.setAttribute("data-portal-name", portalName);
        element.style.left = transition.tile.x * this.tileSize + "px";
        element.style.top = transition.tile.y * this.tileSize + "px";
        this.$world.append(element);
        this.portals.push({
            id: transition.id,
            tile: transition.tile,
            target: transition.target,
            displayName: portalName,
            element: element
        });
    }
};

Game.prototype.applyMap = function () {
    const 
        name = this.savedData.map,
        m = this.worldRegistry && this.worldRegistry.maps[name];

    // Kiểm tra an toàn trước khi truy cập m.src / m.ext
    if (!m) {
        const err = new Error("Không tìm thấy cấu hình tài nguyên hình ảnh cho bản đồ: " + name);
        err.name = "MapDataError";
        throw err;
    }

    $(this.$loader).fadeOut(1200);
    
    this.$map.style.background = "url(" + m.assets.background + ")";
    this.$map.style.width = this.mapData.width * this.tileSize + "px";
    this.$map.style.height = this.mapData.height * this.tileSize + "px";

    this.$overlay.style.background = "url(" + m.assets.overlay + ")";
    this.$overlay.style.width = this.mapData.width * this.tileSize + "px";
    this.$overlay.style.height = this.mapData.height * this.tileSize + "px";

    this.mapLoaded = true;

    return this;
};
