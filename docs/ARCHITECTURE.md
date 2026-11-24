# KIẾN TRÚC MÃ NGUỒN HIỆN TẠI (ARCHITECTURE.MD)

*Tài liệu kiến trúc kỹ thuật dự án Poké-Engine — Cập nhật ngày: 12/11/2026 (Documentation Consistency Audit).*  
Tài liệu này phản ánh trung thực kiến trúc kỹ thuật, luồng dữ liệu, quan hệ phụ thuộc và các điểm nghẽn rủi ro của dự án **Poké-Engine** dựa trên việc rà soát và đối chiếu trực tiếp với mã nguồn thực tế tại thời điểm hiện tại.

---

## 1. TỔNG QUAN KIẾN TRÚC & PHÂN LOẠI THÔNG TIN

Dự án hiện tại hoạt động theo mô hình **Client-Server phân tán (Distributed Client-Server)** kết hợp kiến trúc hướng đối tượng prototype cổ điển:

* **Phía Server (Node.js)**:
  - Máy chủ ứng dụng xây dựng trên **Node.js + Express (v4.17.1) + Socket.io (v2.3.0)**.
  - Đóng vai trò phục vụ tài nguyên tĩnh (`public/`), xác thực người dùng bằng Firebase Auth Session Cookie và lưu hồ sơ/trạng thái người chơi trong Cloud Firestore; đồng thời chuyển tiếp không lưu trạng thái (Stateless Relay Server) các sự kiện di chuyển giữa client.
* **Phía Client (Trình duyệt web)**:
  - Chạy trực tiếp trên trình duyệt bằng JavaScript thuần (ES6), sử dụng mô hình kế thừa prototype (**Prototype-based Object-Oriented Programming**).
  - Cơ chế hiển thị: Dựng đồ họa dạng lưới tile 16x16 pixel trực tiếp trên cây DOM thông qua HTML/CSS, phối hợp thư viện **jQuery 3.1.1** (thao tác DOM, camera) và **Async.js 2.6.2** (chuỗi hoạt ảnh bước đi).
  - Không sử dụng Canvas 2D ở thời điểm này (Canvas chỉ là đề xuất tương lai cho màn hình chiến đấu Battle Scene). Không sử dụng hệ thống đóng gói bundler (Webpack/Vite) hay ES Modules tại thời điểm hiện tại.

### Quy chuẩn 4 nhãn thông tin trong tài liệu:
* `[Xác minh từ source]`: Thông tin đã được kiểm chứng trực tiếp từ từng dòng code, tên hàm, thuộc tính và đường dẫn file cụ thể.
* `[Xác minh Node.js runtime]`: Kết quả kỹ thuật đã được chạy thực nghiệm trên môi trường máy ảo Node.js (Node.js Runtime Simulation thông qua test runner/script mô phỏng). **Lưu ý: Không đồng nghĩa với kiểm thử đồ họa hiển thị trực tiếp trên trình duyệt người dùng**.
* `[Chưa xác minh]`: Thông tin suy luận kỹ thuật hoặc tính năng chưa đủ bằng chứng thực nghiệm (bao gồm Live Browser Testing trên trình duyệt thật khi chưa chạy trực tiếp).
* `[Đề xuất]`: Định hướng giải pháp kỹ thuật tiềm năng cho các giai đoạn phát triển tiếp theo, không phải tính năng đang tồn tại.

---

## 2. CẤU TRÚC THƯ MỤC & VAI TRÒ CÁC THÀNH PHẦN `[Xác minh từ source]`

```
Poke-Engine/
├── app.js                         # [Xác minh từ source] Entry point server: khởi tạo Express, HTTP server, Socket.io, static middleware, auth routes
├── package.json                   # [Xác minh từ source] Khai báo phụ thuộc backend (Express, Firebase Admin SDK, Socket.IO và dotenv)
├── server/
│   ├── core/
│   │   ├── events.json            # [Xác minh từ source] Định danh mã sự kiện mạng (PLAYER_MOVE: 1, PLAYER_LEAVE: 2)
│   │   ├── index.js               # [Xác minh từ source] Lớp Core server: quản lý kết nối socket, sinh UID, đăng ký handler PLAYER_MOVE
│   │   └── move.js                # [Xác minh từ source] Lớp Move server: sanitize tọa độ x, y, direction và broadcast qua Socket.io
│   ├── routes/                    # [Xác minh từ source] Router xác thực tài khoản (/api/auth/me, /api/auth/login, /api/auth/logout)
│   ├── services/                  # [Xác minh từ source] Firebase Auth và Firestore services
│   └── middleware/                # [Xác minh từ source] Middleware xác thực Firebase Session Cookie và bảo vệ route
└── public/
    ├── index.html                 # [Xác minh từ source] Entry point client: dựng cây DOM (#level, #world, #player, #dialogue-box) và nạp script
    ├── res/
    │   └── test.json              # [Xác minh từ source] Dữ liệu bản đồ Tiled 30x20 ô (lớp collision, tilelayer và objectgroup chứa NPC Guide Leaf tại pixel 48, 16 -> tile 3, 1)
    ├── img/
    │   ├── characters.png         # [Xác minh từ source] Spritesheet nhân vật (chứa Red, Leaf, Brendan và các frame bước đi 4 hướng)
    │   ├── maps/test.png          # [Xác minh từ source] Ảnh nền bản đồ chính
    │   └── maps/test_overlay.png  # [Xác minh từ source] Ảnh lớp phủ bản đồ (hiển thị trên đầu nhân vật, z-index: 6)
    ├── css/
    │   ├── style.game.css         # [Xác minh từ source] Khung nhìn #level (272x240px, --game-scale), HUD, class .npc và khung thoại #dialogue-box
    │   ├── character.game.css     # [Xác minh từ source] Định nghĩa tọa độ CSS background-position sprite cho các nhân vật và NPC (.red, .leaf, .brendan)
    │   ├── icon.game.css          # [Xác minh từ source] Tọa độ CSS background sprite cho menu level-icon
    │   ├── battle.game.css        # [Xác minh từ source] Đã được comment tạm ẩn trong index.html (file vật lý chưa tồn tại)
    │   └── bar.game.css           # [Xác minh từ source] Đã được comment tạm ẩn trong index.html (file vật lý chưa tồn tại)
    └── js/
        ├── socket.io.js           # [Xác minh từ source] Client Socket.io được lưu trữ cục bộ
        └── engine/
            ├── boot.js            # [Xác minh từ source] Điểm khởi chạy client: quản lý viewport scale, xử lý logout, gọi new Game().load().then(...)
            ├── index.js           # [Xác minh từ source] Constructor Game, vòng lặp game loop 30 FPS, máy trạng thái (NORMAL/DIALOGUE), tương tác NPC
            ├── gamedata.js        # [Xác minh từ source] Hằng số cấu hình: tileTypes, maps, stepTime (90ms), tileSize (16px), Game.EVENTS, khởi tạo Game.prototype.level
            ├── load.js            # [Xác minh từ source] Nạp cấu hình từ localStorage, xác thực phiên qua /api/auth/me, tải map JSON qua AJAX
            ├── gameobjects.js     # [Xác minh từ source] Lớp Character, Player, NPC; logic va chạm execCollision, hoạt ảnh syncWalk
            ├── keyboard.js        # [Xác minh từ source] Lắng nghe phím di chuyển WASD / Mũi tên qua đối tượng Game.prototype.key
            ├── map.js             # [Xác minh từ source] Phân tích map JSON (generateMapData), đọc layer objectgroup khởi tạo NPC (setupNpcs), applyMap
            ├── camera.js          # [Xác minh từ source] Tính toán vị trí tâm và cuộn phần tử #world bám theo người chơi qua jQuery animate
            ├── online.js          # [Xác minh từ source] Lắng nghe sự kiện PLAYER_MOVE từ socket, khởi tạo và điều khiển từ xa remote player (div[online])
            └── movement.js        # [Xác minh từ source] File chứa logic di chuyển cũ; hiện không được tham chiếu trong index.html
```

---

## 3. LUỒNG KHỞI ĐỘNG HỆ THỐNG (SYSTEM BOOTSTRAP FLOW)

### Pokémon Battle & Party Recovery `[Xác minh từ source]`
Mini Battle chọn Pokémon đánh trước theo `stats.speed` (nếu bằng nhau thì ngẫu nhiên) và vẫn tính damage từ `stats.attack` / `stats.defense`. `PokemonPartyService` duy trì một timer mỗi giây cho Party: Pokémon còn HP hồi `max(1, floor(maxHp × 0.01))`; Pokémon faint lưu `faintedAt` và hồi sinh sau 120 giây với đúng lượng HP hồi ban đầu. Timer bỏ qua trạng thái `BATTLE`, lưu Party khi HP hoặc trạng thái faint/revive đổi, và timestamp revive được serialize cùng Pokémon để tiếp tục sau khi tải game.

### 3.1. Phía Server (Node.js) `[Xác minh từ source]`
Khởi động trong `app.js`:
1. `express()`: Khởi tạo ứng dụng web Express.
2. `http.createServer(app)`: Bọc ứng dụng Express vào HTTP Server gốc.
3. `require("socket.io")(http)`: Gắn Socket.io vào HTTP server để phục vụ WebSocket.
4. Cấu hình middleware: Firebase Session Cookie authentication, CSRF/origin validation và phục vụ tĩnh thư mục `public/`.
5. Đăng ký các route xác thực danh tính: `/api/auth/*` và trang đăng nhập/đăng ký.
6. `io.on("connection", new Core().conn)`: Mỗi khi có client kết nối Socket.io, hàm `conn` của lớp `Core` (`server/core/index.js`) được gọi để sinh `uid` bằng `crypto.randomUUID()` và gán sự kiện lắng nghe `PLAYER_MOVE` (`server/core/move.js`).
7. `http.listen(port)`: Mở cổng và bắt đầu lắng nghe.

### 3.2. Phía Client (Browser) & Thứ tự nạp Script `[Xác minh từ source]`
Trong `public/index.html` (dòng 48-60), các script được nạp tuần tự theo đúng thứ tự sau:

```
[1. jquery.min.js (CDN)] ──► [2. async.min.js (CDN)] ──► [3. socket.io.js (Local)]
                                                                    │
                                                                    ▼
[4. index.js] ──► [5. gamedata.js] ──► [6. load.js] ──► [7. online.js] ──► [8. gameobjects.js]
                                                                                  │
                                                                                  ▼
[9. keyboard.js] ──► [10. map.js] ──► [11. camera.js] ──► [12. boot.js]
```

#### Phân tích phụ thuộc giữa các file script tại thời điểm nạp:
1. **`online.js` và `gameobjects.js`**: `online.js` (script 7) được nạp trước `gameobjects.js` (script 8). Trong `online.js`, hàm `dispatchOnlinePlayer` có gọi `new Character(...)`. Tuy nhiên, tại thời điểm nạp file, `online.js` chỉ gắn các hàm vào `Game.prototype` mà chưa thực thi. Lệnh `new Character(...)` chỉ được kích hoạt trong thời gian chạy (runtime) khi có sự kiện socket từ remote player gửi đến (vốn chỉ xảy ra sau khi `boot.js` khởi tạo game xong). Do đó, thứ tự nạp này không gây lỗi cú pháp hoặc lỗi nạp file.
2. **`index.js` và `gamedata.js`**: Trong constructor `Game()` (`index.js`), code truy cập `this.level.size`. Thuộc tính `level` được khởi tạo sẵn trên prototype qua `Game.prototype.level = {}` trong `gamedata.js`. Do constructor `Game` chỉ được gọi khi `boot.js` (script 12) chạy sự kiện `DOMContentLoaded`, `gamedata.js` đã được nạp xong từ trước, bảo đảm `this.level` tồn tại an toàn.
3. **`gameobjects.js` và `map.js`**: `map.js` (script 10) có hàm `setupNpcs` gọi trực tiếp `new NPC(...)`. Vì `gameobjects.js` (script 8) được nạp trước `map.js`, định nghĩa lớp `NPC` đã sẵn sàng trong phạm vi toàn cục khi `setupNpcs` được kích hoạt.

*Lưu ý đính chính*: Khác với tài liệu cũ, các thư viện GSAP (TweenLite, jquery.gsap) **không có mặt trong `index.html`**. Chỉ có jQuery 3.1.1 và Async.js 2.6.2 được nạp từ CDN.

### 3.3. Vòng đời khởi tạo Client qua Promise `[Xác minh từ source]` `[Xác minh Node.js runtime]`
1. **Sự kiện `DOMContentLoaded`** trong `public/js/engine/boot.js` gọi hàm `init()`:
   - `setupViewportManager()`: Đo kích thước cửa sổ trình duyệt, tính toán và thiết lập biến CSS `--game-scale` theo tỷ lệ gốc 272:240.
   - `setupLogoutHandler()`: Gắn sự kiện click nút Thoát trên HUD, gọi API `/api/auth/logout`.
   - `new Game()`: Khởi tạo đối tượng Game (`public/js/engine/index.js`).
2. **Khởi tạo instance `new Game()`**:
   - `this.socket = io()`: Mở kết nối Socket.io.
   - Bắt các tham chiếu phần tử DOM: `#load_layer`, `#level`, `#world` (dạng jQuery object `$("#world")`), `#map`, `#map-overlay`, `#player`, `#dialogue-box`, `#dialogue-text`.
   - Khởi tạo trạng thái ban đầu: `this.state = "NORMAL"`, `this.npcs = []`, `this.activeDialogue = null`.
   - Tính toán viewport: `this.level.size` và tọa độ căn giữa `this.level.scale`.
3. **Chuỗi Promise bất đồng bộ `gameInstance.load()`**:
   ```javascript
   gameInstance
       .load()
       .then(function () {
           gameInstance.start();
           gameInstance.$release();
       })
       .catch(function (errorInfo) {
           gameInstance.showInitError(errorInfo);
       });
   ```
   - `fetchSavedData()` (`load.js`): Đọc cấu hình mặc định từ `localStorage`, sau đó gửi request `fetch("/api/auth/me")` với `AbortController` (timeout 10 giây). Khi backend trả về user profile hợp lệ, cập nhật `character`, `username`, `userId`.
   - `fetchMapData()` (`load.js`): Sau khi xác thực danh tính, gửi AJAX `$.getJSON("/res/test.json")`.
   - `generateMapData(data)` (`map.js`): Kiểm tra cấu trúc bản đồ, trích xuất layer `collision` thành ma trận 2D `this.mapTiles[y][x]`. Gọi `this.setupNpcs(data.layers)` để nạp NPC, sau đó gọi `this.applyMap()` áp dụng kích thước và hình ảnh nền.
4. **Kích hoạt Game qua `start()` và `$release()`**:
   - `start()` (`index.js`): Khởi tạo đối tượng người chơi `this.player = new Player(this, x, y, facing, ...)` và gọi `addToScene()` để gắn thẻ `<div id="character">` vào DOM `#player`.
   - `$release()` (`index.js`):
     - `this.keyBoardListener()`: Gắn sự kiện `keydown` và `keyup` vào `document` cho phím di chuyển WASD / Mũi tên.
     - `this.setupInteractionListener()`: Gắn sự kiện `keydown` cho phím `Space` (32) và `Enter` (13) có kiểm tra `!e.repeat` để xử lý tương tác NPC & hội thoại.
     - `this.socketListener()`: Đăng ký nhận sự kiện `PLAYER_MOVE` từ WebSocket (`online.js`).
     - `setInterval(() => this.update(), 1000 / 30)`: Bắt đầu vòng lặp game loop tần số 30 FPS.

---

## 4. LUỒNG NHẬP LIỆU, DI CHUYỂN, VA CHẠM VÀ CAMERA `[Xác minh từ source]` `[Xác minh Node.js runtime]`

```
[Bàn phím người dùng: WASD / Arrow keys]
        │ keydown / keyup
        ▼
Game.prototype.key (keyboard.js)
  - Lưu trạng thái: _pressed[keyCode] = true / delete
        │
        ▼ Mỗi 33.3ms (Vòng lặp Game Loop 30 FPS)
Game.prototype.update (index.js)
  - KIỂM TRA MÁY TRẠNG THÁI:
      Nếu this.state === "DIALOGUE" ──► [DỪNG LẬP TỨC (Return), KHÓA DI CHUYỂN]
  - Nếu this.state === "NORMAL":
      Kiểm tra phím đang nhấn (UP/DOWN/LEFT/RIGHT/W/S/A/D)
      Gọi this.player.walk(direction)
        │
        ▼
Character.prototype.walk (gameobjects.js)
  - Kiểm tra cờ bận: if (this.walkInProgress || this.stop) return;
  - Gọi execCollision(direction) để tính toán ô đích
        │
        ├──► [Nếu Va Chạm (Return 0)]:
        │       - Cập nhật hướng nhìn: position.facing = direction
        │       - Đổi sprite chân đứng: switchStep("", direction)
        │       - Kết thúc, không bước tiếp.
        │
        └──► [Nếu Hợp Lệ (Return 1)]:
                - Khóa cờ: this.walkInProgress = true
                - Cập nhật hướng nhìn: position.facing = direction
                - Bắt đầu cuộn camera: game.cameraFollow(position)
                - Gửi gói tin mạng: this.sendWalk(direction)
                - Thực thi chuỗi hoạt ảnh bất đồng bộ qua async.series (4 frame x 4px)
```

### 4.1. Hệ tọa độ và công thức tính ô kế tiếp `[Xác minh từ source]`
Trong `Character.prototype.execCollision(direction)`:
* Tọa độ logic `position.x` và `position.y` được tính toán bằng đơn vị **Tile** (mỗi tile = 16px).
* Công thức tính tọa độ ô tiếp theo chính xác từ mã nguồn:
  - Hướng `"right"`: `position.x ++` (tăng cột $x+1$)
  - Hướng `"left"`: `position.x --` (giảm cột $x-1$)
  - Hướng `"up"`: `position.y --` (giảm hàng $y-1$, trục $y$ hướng xuống dưới)
  - Hướng `"down"`: `position.y ++` (tăng hàng $y+1$)

### 4.2. Cơ chế kiểm tra va chạm 2 lớp `[Xác minh từ source]` `[Xác minh Node.js runtime]`
Khi `this.isPlayer` di chuyển, hàm `execCollision` thực hiện kiểm tra tuần tự:
1. **Lớp 1 — Va chạm với NPC**:
   ```javascript
   if (this.game.getNpcAt && this.game.getNpcAt(position.x, position.y)) {
       return 0; // Chặn đứng người chơi, không thể đi xuyên qua NPC
   }
   ```
2. **Lớp 2 — Va chạm với địa hình bản đồ (Map Tile)**:
   - Tra cứu ma trận: `checkY = this.game.mapTiles[position.y]`.
   - Lấy mã tile: `checkXY = checkY ? this.game.tileTypes[checkY[position.x]] : 0`.
   - Nếu `!checkXY` hoặc `checkXY.block === true` (tile loại 1): Trả về `0` (bị cản).
   - Nếu là tile đi được (tile loại 2): Cập nhật `this.position.x = position.x`, `this.position.y = position.y` và trả về `1` (thành công).

### 4.3. Hoạt ảnh bước đi và đồng bộ DOM `[Xác minh từ source]`
Trong `Character.prototype.syncWalk` (`gameobjects.js`):
* Sử dụng thư viện `async.series` thực hiện 4 bước liên tiếp với thời gian chờ giữa các bước là `stepTime = 90ms`:
  - Bước 1: Dịch 4px (`setPosition`) và đổi class CSS sang chân bước (`switchStep(stepFlag, direction)`).
  - Bước 2: Dịch tiếp 4px (`setPosition`).
  - Bước 3: Dịch tiếp 4px (`setPosition`) và đổi class CSS về tư thế đứng (`switchStep("", direction)`).
  - Bước 4: Dịch 4px cuối cùng (tổng cộng đủ 16px) và mở khóa `this.walkInProgress = false`.

### 4.4. Camera bám theo người chơi `[Xác minh từ source]`
Trong `public/js/engine/camera.js`:
* Hàm `coordinate2CameraCenter` tính toán tọa độ mục tiêu để đặt người chơi tại tâm viewport 272x240.
* Hàm `cameraGetLimit` giới hạn tọa độ cuộn không vượt quá kích thước bản đồ (`this.mapData.width * 16` và `this.mapData.height * 16`).
* Sử dụng jQuery `.animate()` để cuộn thuộc tính `left` và `top` của phần tử `#world` với thời gian trôi `timer = 700ms`.

---

## 5. KIẾN TRÚC HỆ THỐNG NPC & DIALOGUE `[Xác minh từ source]` `[Xác minh Node.js runtime]`

Hệ thống NPC và Hội thoại là kiến trúc mới được tích hợp độc lập vào client engine, bao gồm hai luồng chính:

```
[LUỒNG NẠP DỮ LIỆU NPC]
Tiled Map JSON (test.json)
  └── Layer 'objects' (objectgroup)
        │
        ▼ map.js: generateMapData() ──► setupNpcs(layers)
          - Trích xuất properties (Hỗ trợ Object {key: val} & Array [{name, val}])
          - Tính tọa độ Tile: tileX = floor(obj.x / 16), tileY = floor(obj.y / 16)
          - Dọn dẹp DOM NPC cũ (chống nhân đôi khi reload map)
          - Khởi tạo new NPC(game, tileX, tileY, facing, { id, name, character, dialogue })
          - Gọi npc.addToScene() ──► Gắn thẻ <div class="npc ..."> vào #world

──────────────────────────────────────────────────────────────────────────

[LUỒNG TƯƠNG TÁC & VÒNG ĐỜI HỘI THOẠI]
Người chơi nhấn phím [Space] (32) hoặc [Enter] (13)
        │
        ▼ index.js: setupInteractionListener (Chặn e.repeat để chống lặp đè phím)
        │
        ▼ index.js: handleInteraction()
        │
        ├──► TRƯỜNG HỢP 1: Đang ở trạng thái [NORMAL]
        │       - Kiểm tra player không bận bước đi (!walkInProgress)
        │       - Tính ô trước mặt qua getTileInFrontOfPlayer()
        │       - Tìm NPC đối diện qua getNpcInFront()
        │       - [Nếu có NPC]:
        │           • Chuyển state = "DIALOGUE"
        │           • Xóa sạch phím di chuyển đang giữ (key._pressed = {})
        │           • NPC tự động xoay mặt về phía Player (npc.setFacing(oppositeFacing))
        │           • Hiển thị #dialogue-box (style.display = "block")
        │           • Render câu thoại đầu tiên: lines[0]
        │
        └──► TRƯỜNG HỢP 2: Đang ở trạng thái [DIALOGUE]
                - Gọi advanceDialogue()
                - Tăng chỉ số activeDialogue.index ++
                - [Nếu còn câu thoại]: Render nội dung câu tiếp theo
                - [Nếu hết câu thoại]:
                    • Gọi closeDialogue()
                    • Ẩn #dialogue-box (style.display = "none")
                    • Trả state = "NORMAL"
                    • Xóa buffer phím (key._pressed = {})
                    • Trả lại quyền di chuyển tự do cho người chơi
```

### Các đặc điểm kỹ thuật cốt lõi:
1. **Lớp đối tượng `NPC`** (`gameobjects.js`):
   - Kế thừa prototype từ `Character`.
   - Có thuộc tính riêng: `id`, `name`, `dialogue` (mảng chuỗi) và cờ `isNPC = true`.
   - Phương thức `setFacing(direction)` cập nhật lại thuộc tính `position.facing` và thay đổi class CSS tương ứng của phần tử DOM.
2. **Khóa di chuyển tuyệt đối (State Isolation)**:
   - Trong `Game.prototype.update` (`index.js`), cờ `this.state === "DIALOGUE"` chặn đứng toàn bộ mã đọc phím WASD/Arrow keys. Do đó, người chơi hoàn toàn không thể bước đi khi đang mở khung thoại.
   - Không thể phát sinh gói tin `PLAYER_MOVE` ngoài ý muốn lên server trong suốt quá trình đọc thoại.
3. **Cơ chế chống lặp phím (`e.repeat`)**:
   - Khi người chơi đè giữ phím Space hoặc Enter, trình duyệt phát sinh chuỗi sự kiện `keydown` liên tục. Điều kiện `if (!e.repeat)` trong `setupInteractionListener` loại bỏ các sự kiện này, đảm bảo mỗi lần nhấn phím vật lý chỉ chuyển đúng 1 câu thoại.
4. **Phạm vi hoạt động (Local Client Scope)**:
   - Toàn bộ thực thể NPC, va chạm NPC và khung thoại là **Client-side thuần túy**. Không có bất kỳ gói tin Socket.io nào được gửi lên server liên quan đến NPC hay nội dung hội thoại.
5. **Mức độ xác minh thực tế**:
   - *Logic code và máy trạng thái*: Đã được xác minh qua Node.js Runtime Simulation và Static Check (`node -c` exit code 0).
   - *Hiển thị visual trên trình duyệt thực tế*: Ghi nhận trạng thái `[Chưa xác minh]` (Live Browser Testing: NOT RUN) cho đến khi người dùng mở trình duyệt kiểm tra thực tế.

---

## 6. CƠ CHẾ GIAO TIẾP MẠNG MULTIPLAYER HIỆN TẠI `[Xác minh từ source]`

Hệ thống multiplayer hoạt động theo mô hình **Client-Authoritative Relay**:

```
[Client A (Local Player)]               [Server Node.js]               [Client B (Remote Player)]
          │                                     │                                     │
          │ emit(PLAYER_MOVE, payload)          │                                     │
          ├────────────────────────────────────►│                                     │
          │                                     │ broadcast.emit(PLAYER_MOVE, ...)    │
          │                                     ├────────────────────────────────────►│
          │                                     │                                     │ dispatchOnlinePlayer()
          │                                     │                                     │  - Tạo new Character(type: 1)
          │                                     │                                     │  - Gọi walk(data.direction)
```

1. **Client gửi dữ liệu di chuyển** (`Player.prototype.sendWalk` trong `gameobjects.js`):
   - Khi di chuyển thành công một bước hợp lệ, client gửi gói tin:
     `this.game.socket.emit(Game.EVENTS.PLAYER_MOVE, { x, y, character, direction, uid })`.
   - `uid`: Mã định danh người chơi, lấy từ `this.game.savedData.uid`.
2. **Server chuyển tiếp dữ liệu** (`server/core/index.js` & `server/core/move.js`):
   - Server kiểm tra tính hợp lệ cơ bản của payload (x, y phải là số nguyên $\ge 0$, direction nằm trong danh sách 4 hướng).
   - Gọi `this.socket.broadcast.emit(EVENTS.PLAYER_MOVE, input)` để gửi đến các client khác.
   - Server **không lưu trữ trạng thái thế giới (Stateless Relay)**, không kiểm tra va chạm với bản đồ hay NPC trên server.
3. **Client nhận và hiển thị** (`public/js/engine/online.js`):
   - Hàm `dispatchOnlinePlayer(data)`:
     - Nếu `uid` chưa tồn tại trong `this.onlinePlayers`: Tạo đối tượng `Character` mới với `type: 1`, gọi `addToScene()` thêm `<div online="true">` vào `#world`.
     - Nếu `uid` đã tồn tại: Gọi `this.onlinePlayers[data.uid].walk(data.direction)` để thực hiện hoạt ảnh bước đi.
4. **Mối quan hệ giữa NPC và Multiplayer**:
   - NPC là các phần tử DOM độc lập với thuộc tính class `.npc`, không có thuộc tính `online="true"`.
   - Hệ thống remote player xử lý độc lập trong `onlinePlayers`, hoàn toàn không gây nhầm lẫn hay can thiệp vào mảng `npcs`.

---

## 7. CƠ CHẾ LƯU TRỮ DỮ LIỆU & PHIÊN LÀM VIỆC `[Xác minh từ source]`

* **Đọc dữ liệu từ `localStorage`** (`public/js/engine/load.js`):
  - Hàm `fetchSavedData()` đọc 7 khóa: `"map"`, `"x"`, `"y"`, `"facing"`, `"character"`, `"items"`, `"choices"`.
  - Có xử lý `try/catch` bọc `JSON.parse` cho `"items"` và `"choices"` để tránh lỗi cú pháp hỏng toàn bộ game (`SavedDataParseError`).
* **Đồng bộ phiên đăng nhập từ máy chủ**:
  - `fetch("/api/auth/me")` được gọi bất đồng bộ. Nếu phiên đăng nhập hợp lệ (HTTP 200), `character`, `username` và `userId` được đồng bộ trực tiếp từ Database, ghi đè lên dữ liệu tạm thời của `localStorage`.
  - Tên huấn luyện viên được tự động hiển thị lên HUD qua phần tử `#trainer-name`.
* **Ghi dữ liệu (`localStorage.setItem`)**:
  - Trong phạm vi mã nguồn gameplay hiện tại, **chưa có cơ chế tự động ghi (`setItem`) vị trí người chơi hay trạng thái NPC xuống `localStorage` trong khi chơi**.
  - Tọa độ người chơi và tiến trình hội thoại chỉ tồn tại trên bộ nhớ RAM trong suốt phiên chơi; khi tải lại trang (F5), game sẽ nạp lại từ dữ liệu khởi tạo ban đầu.

---

## 8. MỐI QUAN HỆ PHỤ THUỘC & ĐIỂM NGHẼN RỦI RO KỸ THUẬT

### 8.1. Phụ thuộc thứ tự nạp thẻ `<script>` (Script Loading Coupling) `[Xác minh từ source]`
* Các file JavaScript không sử dụng cơ chế import/export của ES Modules mà gắn trực tiếp phương thức vào prototype của `Game`, `Character`, `Player`, `NPC`.
* Thứ tự nạp trong `index.html` mang tính ràng buộc bắt buộc:
  - `index.js` phải nạp đầu tiên để khai báo constructor `Game`.
  - `gameobjects.js` phải nạp trước `boot.js` để các class `Player` và `NPC` sẵn sàng khi `boot.js` gọi `gameInstance.start()`.
  - `map.js` phải nạp sau `gameobjects.js` vì hàm `setupNpcs` trực tiếp gọi `new NPC(...)`.
* **Rủi ro**: Nếu vô tình xáo trộn thứ tự script trong `index.html`, ứng dụng sẽ phát sinh lỗi `TypeError: NPC is not a constructor` hoặc `TypeError: Game is not a constructor`.

### 8.2. Phạm vi bảo vệ và giới hạn của chuỗi Promise nạp tài nguyên `[Xác minh từ source]`
* Trong `public/js/engine/boot.js`, chuỗi Promise được sử dụng:
  `gameInstance.load().then(function() { gameInstance.start(); gameInstance.$release(); })`.
* **Phạm vi bảo vệ thực tế**:
  - Chuỗi Promise đảm bảo dữ liệu logic của trò chơi (danh tính người chơi từ `/api/auth/me`, ma trận va chạm `mapTiles` và danh sách NPC từ `/res/test.json`) được tải và phân tích xong trước khi `start()` và `$release()` bắt đầu vòng lặp game loop.
* **Giới hạn kỹ thuật cần lưu ý**:
  - Các tài nguyên hình ảnh (ảnh nền bản đồ `test.png`, ảnh lớp phủ `test_overlay.png`, sprite sheet `characters.png`) được tải bất đồng bộ bởi trình duyệt thông qua CSS background-image mà không có cơ chế `Image.onload` chờ đợi. Do đó, trên các kết nối mạng trễ, nhân vật có thể xuất hiện trên màn hình một khoảng ngắn trước khi hình nền bản đồ hoàn tất hiển thị.

### 8.3. Ghép nối chặt chẽ giữa Logic Game và DOM (Tight DOM Coupling) `[Xác minh từ source]`
* Tọa độ bước đi của nhân vật vẫn đang được cập nhật bằng cách đọc và ghi chuỗi pixel trực tiếp trên style DOM:
  `this.$el.style.left = parseInt(this.$el.style.left) + 4 + "px"` (`gameobjects.js`).
* Việc đọc ghi style liên tục trong các bước hoạt ảnh của `async.series` tạo ra hiện tượng **Layout Reflow/Repaint** trên trình duyệt. Khi số lượng nhân vật online hoặc NPC tăng cao, điều này có thể gây sụt giảm khung hình trên các thiết bị cấu hình yếu.

### 8.4. Phụ thuộc mạng bên ngoài qua CDN `[Xác minh từ source]`
* `index.html` nạp trực tiếp `jquery.min.js` và `async.min.js` từ `cdnjs.cloudflare.com`.
* Nếu thiết bị mất kết nối mạng Internet khi tải trang, ứng dụng sẽ không thể tải được 2 thư viện này và việc khởi tạo game sẽ thất bại hoàn toàn. Do đó, **khả năng vận hành ngoại tuyến hoàn chỉnh (Offline-ready) hiện chưa đạt được**.

### 8.5. Mô hình Multiplayer Client-Authoritative thiếu xác thực thế giới `[Xác minh từ source]`
* Máy chủ Socket.io chỉ đóng vai trò chuyển tiếp tọa độ do client tự tính toán. Server không sở hữu bản sao ma trận bản đồ để kiểm tra người chơi có đi xuyên tường hay dịch chuyển tức thời bất thường hay không.

### 8.6. Admin đọc catalog Pokémon và vật phẩm `[Xác minh từ source]`
* Trang `/admin` gọi `/api/admin/me` trước khi hiện dashboard. Các API `GET /api/admin/pokemon` và `GET /api/admin/items` nằm trong router có `requireAdmin`, xác minh Firebase session cookie, custom claim `admin: true` và tài khoản còn hoạt động.
* Species gốc được đọc từ `public/res/pokemon/species.json`; Admin override metadata cho ID có sẵn trong Firestore `systemCatalogs/pokemonSpecies`. `PATCH /api/admin/pokemon/:speciesId` dùng `requireAdmin`, Origin và CSRF; game tải catalog đã merge qua endpoint session-authenticated trước khi khởi tạo hệ thống Pokémon.
* Pokédex, Starter Selection, Pokémon Party và overworld dùng catalog đã tải. Khi khôi phục Party, metadata species được đồng bộ và chỉ số tính lại; level, EXP và HP hiện tại được giữ nguyên (HP chỉ bị giới hạn nếu vượt Max HP mới).
* Vật phẩm dùng chung `PokeItemCatalog` trong `public/js/engine/ui/itemCatalog.js`. Admin có thể sửa metadata cho species/item hiện có; ID, `nationalDex`, asset và gameplay fields vẫn do nguồn gốc quản lý.
* `itemCatalog.js` vẫn là nguồn gốc của item ID và gameplay. Firestore `systemCatalogs/itemCatalog` chỉ lưu override `name`, `description` và `shop`; Admin PATCH được bảo vệ bởi quyền Admin, Origin và CSRF.
* Game tải metadata qua `GET /api/economy/item-catalog` trong `Game.load()` trước migration và `$release()`. Khi tải lỗi, boot dừng để không dùng giá cũ; giao dịch mua đọc giá hiện tại từ Firestore trong cùng transaction cập nhật Economy.
* Party UI mở Pokémon Status từ từng Pokémon trong Party. Status chỉ đọc `PokemonInstance`; Base Stats và calculated stats được trình bày riêng, không làm thay đổi Party hoặc trạng thái Pokémon.

---

## 9. ĐỀ XUẤT NÂNG CẤP KIẾN TRÚC CHO TƯƠNG LAI `[Đề xuất]`

1. **Vendor Isolation (Khép kín thư viện)** `[Đề xuất]`: Tải các file jQuery và Async.js từ CDN về lưu trữ cục bộ trong `public/vendor/` để đảm bảo game có thể khởi động và chơi đơn ngoại tuyến hoàn toàn mà không phụ thuộc Internet.
2. **Quản lý trạng thái thực thể tập trung (Entity Component / Registry System)** `[Đề xuất]`: Hiện tại người chơi được quản lý ở `this.player`, NPC ở mảng `this.npcs`, người chơi từ xa ở đối tượng `this.onlinePlayers`. Trong tương lai, nên trừu tượng hóa thành một hệ thống quản lý thực thể thống nhất (`EntityManager`) để tối ưu hóa việc kiểm tra va chạm đa đối tượng.
3. **Cơ chế gõ chữ từng ký tự (Typewriter Effect)** `[Đề xuất]`: Nâng cấp `renderDialogueText` trong `index.js` hỗ trợ hiệu ứng hiện chữ dần dần theo phong cách RPG cổ điển với khả năng nhấn phím để hiện nhanh toàn bộ câu.
4. **Hệ thống lưu trạng thái hoàn chỉnh (Save Manager)** `[Đề xuất]`: Xây dựng module tự động lưu tọa độ, thông tin nhân vật và cờ sự kiện xuống LocalStorage hoặc Database mỗi khi người chơi chuyển map hoặc lưu thủ công qua menu.
5. **Lộ trình chuyển đổi ES Modules** `[Đề xuất]`: Khi quy mô game mở rộng sang hệ thống Battle và Pokemon Data, từng bước đóng gói các module tính toán độc lập sang cú pháp `import/export` chuẩn để loại bỏ sự phụ thuộc mong manh vào thứ tự nạp thẻ `<script>` toàn cục.
