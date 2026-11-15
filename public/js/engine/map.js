Game.prototype.generateMapData = function (data) {

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

    this.mapTiles = map;
    this.mapData.width = data.width;
    this.mapData.height = data.height;

    // 8. Đọc và khởi tạo các đối tượng NPC từ objectgroup (NPC-01, MAP-01)
    this.setupNpcs(data.layers);

    this.applyMap();
};

Game.prototype.setupNpcs = function (layers) {
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

    if (!Array.isArray(layers)) return;

    // 2. Tìm các layer kiểu objectgroup
    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        if (layer && (layer.type === "objectgroup" || layer.name === "objects") && Array.isArray(layer.objects)) {
            for (let j = 0; j < layer.objects.length; j++) {
                const obj = layer.objects[j];
                if (!obj) continue;

                // Chuẩn hóa custom properties
                let props = {};
                if (Array.isArray(obj.properties)) {
                    for (let p = 0; p < obj.properties.length; p++) {
                        const prop = obj.properties[p];
                        if (prop && prop.name) props[prop.name] = prop.value;
                    }
                } else if (obj.properties && typeof obj.properties === "object") {
                    props = obj.properties;
                }

                // Nhận diện đối tượng NPC theo type hoặc thuộc tính dialogue
                if (obj.type === "npc" || props.type === "npc" || props.dialogue) {
                    const tileSize = this.tileSize || 16;
                    const tileX = (props.tileX !== undefined) ? parseInt(props.tileX, 10) : Math.floor(obj.x / tileSize);
                    const tileY = (props.tileY !== undefined) ? parseInt(props.tileY, 10) : Math.floor(obj.y / tileSize);
                    const facing = props.facing || "down";
                    const character = props.character || "leaf";

                    let dialogue = props.dialogue;
                    if (typeof dialogue === "string") {
                        try {
                            dialogue = JSON.parse(dialogue);
                        } catch (e) {
                            dialogue = [dialogue];
                        }
                    }

                    const npc = new NPC(this, tileX, tileY, facing, {
                        id: obj.id || ("npc_" + j),
                        name: obj.name || "NPC",
                        character: character,
                        dialogue: dialogue
                    });

                    this.npcs.push(npc);
                    npc.addToScene();
                }
            }
        }
    }
};

Game.prototype.applyMap = function () {
    const 
        name = this.savedData.map,
        m = this.maps[name];

    // Kiểm tra an toàn trước khi truy cập m.src / m.ext
    if (!m) {
        const err = new Error("Không tìm thấy cấu hình tài nguyên hình ảnh cho bản đồ: " + name);
        err.name = "MapDataError";
        throw err;
    }

    $(this.$loader).fadeOut(1200);
    
    this.$map.style.background = "url(" + m.src + name + m.ext + ")";
    this.$map.style.width = this.mapData.width * this.tileSize + "px";
    this.$map.style.height = this.mapData.height * this.tileSize + "px";

    this.$overlay.style.background = "url(" + m.src + name + "_overlay" + m.ext + ")";
    this.$overlay.style.width = this.mapData.width * this.tileSize + "px";
    this.$overlay.style.height = this.mapData.height * this.tileSize + "px";

    this.mapLoaded = true;

    return this;
};
