# BÁO CÁO KIỂM TOÁN HIỆN TRẠNG DỰ ÁN VÀ LỘ TRÌNH PHÁT TRIỂN GAMEPLAY
## PROJECT STATUS AUDIT AND GAMEPLAY DEVELOPMENT ROADMAP

**Mã tài liệu**: `TASK_NEXT_PROJECT_STATUS_AND_GAMEPLAY_ROADMAP.md`  
**Dự án**: Poké-Engine (`D:\cc\Poke-Engine`)  
**Thời điểm kiểm toán**: 2026-11-10T16:42:00+07:00  
**Vai trò**: Technical Lead & Senior Game Architect  
**Trọng tâm**: Đánh giá thực trạng mã nguồn, ưu tiên mở khóa và phát triển gameplay, dừng mở rộng Security Phase 1.3.6.

---

## 1. TỔNG QUAN ĐIỀU HÀNH (EXECUTIVE SUMMARY)

Dự án **Poké-Engine** đã hoàn thành chuỗi rà soát và thử nghiệm kiểm chứng bảo mật (Security Phase 1.3.x, kết thúc ở PoC Task 1.3.6L). Nhằm đáp ứng mục tiêu cốt lõi của dự án là xây dựng một tựa game nhập vai Pokémon trực tuyến trên nền web, đợt kiểm toán này chuyển dịch trọng tâm hoàn toàn từ hạ tầng bảo mật lý thuyết sang **hiện trạng gameplay thực tế**.

### Các phát hiện cốt lõi:
1. **Gameplay hiện tại chỉ mới ở mức "Vỏ di chuyển 2D trên một bản đồ đơn lẻ"**:
   - Đã có cơ chế render bản đồ dựa trên DOM/CSS, camera cuộn theo người chơi, phát hiện va chạm vật lý cơ bản với các ô chặn (`block: true`), và điều khiển di chuyển nhân vật bằng phím mũi tên/WASD.
   - Các hệ thống trụ cột của một game Pokémon RPG gồm: **Pokémon/Pet**, **Hệ thống chiến đấu (Combat/Battle)**, **Hệ thống túi đồ (Inventory/Items)**, **Hệ thống NPC và hội thoại (NPC/Dialogue)**, **Chuyển bản đồ (Teleport/Warp)** hoàn toàn **CHƯA ĐƯỢC TRIỂN KHAI** (0 dòng code xử lý logic nghiệp vụ).
2. **Nút thắt cổ chai lớn nhất cản trở việc chạy và phát triển gameplay (Blocker số 1)**:
   - Backend hiện dùng Firebase Authentication và Cloud Firestore; middleware `requireAuth` bảo vệ các route cần đăng nhập, còn Socket.IO giữ vai trò relay multiplayer.
   - Tuy nhiên, Frontend **CHƯA CÓ GIAO DIỆN ĐĂNG NHẬP HAY ĐĂNG KÝ**. Khi mở trình duyệt vào `http://localhost:3000/`, người chơi bị chuyển hướng sang `/login` và chỉ nhận về một chuỗi thông báo dạng chữ thuần ([app.js L204-210](file:///d:/cc/Poke-Engine/app.js#L204-L210)). Người chơi và lập trình viên hiện không thể truy cập màn hình game bằng thao tác thông thường trên trình duyệt nếu không dùng công cụ bên ngoài (Postman/curl) để tạo session giả lập.
3. **Sự lệch pha giữa Dữ liệu Client và Dữ liệu Server**:
   - Backend lưu hồ sơ và trạng thái người chơi trong Cloud Firestore; client tải thông tin đăng nhập qua `/api/auth/me` và dữ liệu gameplay qua API hiện hành.
   - Chưa hề có cơ chế lưu game (Save mechanism): Toàn bộ mã nguồn chỉ có lệnh đọc `localStorage.getItem()`, tuyệt đối không có lệnh ghi `localStorage.setItem()` hay API đồng bộ tọa độ về cơ sở dữ liệu.
4. **Định hướng chiến lược**:
   - Dừng việc mở rộng Security Phase 1.3.6.
   - Ưu tiên số 1: Xây dựng ngay giao diện Đăng nhập/Đăng ký tối giản để **mở khóa luồng truy cập game trực tiếp từ trình duyệt (Playability Gateway)**, sau đó tuần tự xây dựng Hệ thống Lưu trữ Game và Tương tác Thế giới.

---

## 2. HIỆN TRẠNG GIT VÀ WORKING TREE (GIT WORKING TREE STATUS)

### 2.1. Nhánh làm việc:
* **Current Branch**: `main` (Xác minh qua `git branch --show-current`).

### 2.2. Trạng thái cây làm việc (`git status --short`):
```
 M .gitignore
 M app.js
 M package-lock.json
 M package.json
 M public/css/style.game.css
 M public/index.html
 M public/js/engine/boot.js
 M public/js/engine/gamedata.js
 M public/js/engine/index.js
 M public/js/engine/load.js
 M public/js/engine/map.js
 M public/js/engine/online.js
 M server/core/events.json
 M server/core/index.js
 M server/core/move.js
?? .env.example
?? AGENTS.md
?? docs/
?? server/config/
?? server/controllers/
?? server/db.js
?? server/middleware/
?? server/models/
?? server/routes/
?? tasks/
```

### 2.3. Phân tích các thay đổi chưa commit:
* **Các file bị sửa đổi (`M`)**:
  - `app.js`: Khởi tạo backend Firebase Auth + Firestore, gắn middleware xác thực Firebase và Socket.IO.
  - `package.json`, `package-lock.json`: Khai báo dependency backend hiện hành, gồm Express, Firebase Admin SDK, Socket.IO và dotenv.
  - `public/index.html`, `public/css/style.game.css`: Chuẩn hóa responsive pixel-perfect và tạm ẩn các stylesheet chưa tồn tại (`battle.game.css`, `bar.game.css`).
  - `public/js/engine/*.js`: Chuẩn hóa xử lý lỗi nạp bản đồ, chuẩn hóa scale màn hình và relay di chuyển.
  - `server/core/*.js`: Xác thực tọa độ di chuyển phía server trước khi broadcast.
* **Các file/thư mục mới (`??`)**:
  - `server/config/`, `server/controllers/`, `server/middleware/`, `server/routes/`, `server/services/`: Các module cấu hình Firebase, xác thực và truy cập Firestore hiện hành.
  - `tasks/`: Chứa các tài liệu phân tích thiết kế Task 1.3.x và thư mục PoC độc lập `tasks/poc/task-1.3.6L/`.
  - `AGENTS.md`: Bộ quy tắc phát triển và chuẩn mực kỹ thuật dự án.
* **Đánh giá**: Các thay đổi chưa commit là kết quả hợp lệ từ các đợt hoàn thiện kiến trúc xác thực trước đó, phản ánh đúng tiến trình phát triển và **không phải là lỗi kỹ thuật**.

---

## 3. KIẾN TRÚC HIỆN TẠI VÀ PHÂN CHIA MODULE (CURRENT ARCHITECTURE)

```
Poke-Engine (D:\cc\Poke-Engine)
├── app.js                          # Điểm khởi đầu Server: HTTP, Socket.IO, Middleware, Routes
├── package.json                    # Cấu hình dependency và npm start
├── server/                         # Module Backend (Node.js)
│   ├── config/firebase.js          # Khởi tạo Firebase Admin SDK và các dịch vụ Auth/Firestore
│   ├── controllers/authController.js # API đăng ký, đăng nhập, đăng xuất, lấy thông tin cá nhân
│   ├── middleware/authMiddleware.js  # requireAuth, requireGuest
│   ├── services/                   # Dịch vụ Firebase Auth và Firestore
│   ├── routes/authRoutes.js        # Khai báo endpoint /api/auth/*
│   └── core/                       # Logic thời gian thực (Real-time Socket.IO)
│       ├── events.json             # Danh mục mã sự kiện (PLAYER_MOVE: 1, PLAYER_LEAVE: 2)
│       ├── index.js                # Core.prototype.conn: Cấp playerUid và bắt sự kiện socket
│       └── move.js                 # Move.prototype.walk: Kiểm tra tọa độ và broadcast di chuyển
└── public/                         # Module Frontend & Game Client (Browser DOM/CSS)
    ├── index.html                  # Khung hiển thị DOM game (#world, #map, #player, #battle)
    ├── css/                        # CSS styling & Sprite sheets
    │   ├── character.game.css      # 3.188 dòng CSS Sprite định vị các frame bước đi của nhân vật
    │   ├── icon.game.css           # CSS icons cho menu game
    │   └── style.game.css          # Reset CSS, kích thước khung nhìn #level, responsive scale
    ├── img/                        # Tài nguyên hình ảnh
    │   ├── characters.png          # Spritesheet chứa các nhân vật (Red, Leaf, Brendan, ...)
    │   ├── maps/test.png, test_overlay.png # Ảnh nền bản đồ mẫu
    │   └── levelicon.png, loader.gif # Icon giao diện và ảnh động tải trang
    ├── res/test.json               # Dữ liệu cấu trúc bản đồ Tiled Map (layer collision)
    └── js/                         # Logic thực thi Game Engine phía Client
        ├── socket.io.js            # Thư viện client Socket.IO 2.3.0
        └── engine/
            ├── boot.js             # setupViewportManager (responsive pixel-perfect) & hàm init()
            ├── index.js            # Khởi tạo class Game, vòng lặp game loop (setInterval 30fps)
            ├── gamedata.js         # Khai báo tileTypes, maps, stepTime (90ms), tileSize (16px)
            ├── load.js             # fetchSavedData (localStorage) & fetchMapData (AJAX test.json)
            ├── map.js              # generateMapData & applyMap (vẽ nền DOM #map & #map-overlay)
            ├── gameobjects.js      # Character & Player: walk(), syncWalk, execCollision()
            ├── camera.js           # coordinate2CameraCenter, cameraFollow (jQuery animate #world)
            ├── keyboard.js         # Lắng nghe keydown/keyup (phím mũi tên & WASD)
            ├── online.js           # socketListener: dispatchOnlinePlayer & removeOnlinePlayer
            └── movement.js         # [MỒ CÔI] File cũ của tác giả, không được index.html import
```

### Đánh giá tính độc lập và sự phụ thuộc:
1. **Phụ thuộc CDN ngoài**: `public/index.html` đang nạp `jQuery 3.1.1` và `async 2.6.2` từ `cdnjs.cloudflare.com` ([index.html L41-42](file:///d:/cc/Poke-Engine/public/index.html#L41-L42)). Nếu chạy không có Internet hoặc CDN gặp sự cố, engine sẽ lập tức đứng tại màn hình loading.
2. **Gắn chặt vào DOM và jQuery Animate**: Chuyển động của camera được điều khiển bằng `this.$world.stop(false, false).animate(...)` ([camera.js L55, L119](file:///d:/cc/Poke-Engine/public/js/engine/camera.js#L55)), tạo độ trễ 700ms (`timer = 700`) cố định, xung đột với nhịp di chuyển nhân vật (90ms).
3. **Phân mảnh danh tính người chơi**: Client tự sinh `uid = Date.now()` ([load.js L225](file:///d:/cc/Poke-Engine/public/js/engine/load.js#L225)) và gửi lên server ([gameobjects.js L215](file:///d:/cc/Poke-Engine/public/js/engine/gameobjects.js#L215)); Server nhận diện và đè lại bằng `socket.playerUid = crypto.randomUUID()` ([server/core/index.js L16](file:///d:/cc/Poke-Engine/server/core/index.js#L16)). Dữ liệu client gửi lên bị dư thừa và thiếu đồng bộ.

---

## 4. MA TRẬN TÍNH NĂNG GAMEPLAY CHI TIẾT (GAMEPLAY FEATURE MATRIX)

Dưới đây là bảng đánh giá thực nghiệm từng tính năng dựa trên việc rà soát trực tiếp mã nguồn:

| Tính năng | Hiện trạng kỹ thuật | Trạng thái | Bằng chứng mã nguồn | Lỗi / Rủi ro đáng chú ý |
| :--- | :--- | :---: | :--- | :--- |
| **1. Nhân vật & Di chuyển** | Di chuyển 4 hướng (Up, Down, Left, Right) bằng bàn phím (Mũi tên hoặc WASD). Hoạt ảnh bước đi đổi CSS class tuần tự theo 3 frame (`red_down0`, `red_down`, `red_down1`). | **ĐÃ HOẠT ĐỘNG** | [gameobjects.js L34-94](file:///d:/cc/Poke-Engine/public/js/engine/gameobjects.js#L34-L94), [keyboard.js L8-31](file:///d:/cc/Poke-Engine/public/js/engine/keyboard.js#L8-L31) | Sử dụng `async.series` kết hợp 4 hàm `setTimeout` thay đổi tọa độ DOM 4px mỗi bước. Nếu người chơi giữ phím hoặc chuyển hướng nhanh có thể gây lệch frame hoạt ảnh hoặc trễ nhịp di chuyển. |
| **2. Bản đồ & Va chạm** | Nạp bản đồ mẫu `test` từ file JSON `public/res/test.json`. Phân tích layer `collision` chứa mảng ô: 1 (chặn), 2 (đi được), 3 (teleport). Render ảnh nền và lớp phủ overlay bằng CSS background. | **ĐÃ HOẠT ĐỘNG (BẢN ĐỒ ĐƠN)** | [map.js L1-122](file:///d:/cc/Poke-Engine/public/js/engine/map.js#L1-L122), [test.json L37-46](file:///d:/cc/Poke-Engine/public/res/test.json#L37-L46) | Chỉ có 1 map mẫu duy nhất. Ô loại 3 (`teleport: true` trong `gamedata.js L10`) **hoàn toàn không có code xử lý chuyển map**; khi người chơi đi vào ô 3, game chỉ coi đó là ô đi được bình thường. Layer `objects` trong `test.json` bị bỏ qua. |
| **3. Pokémon / Pet** | Lưu trữ, bắt, chọn starter, hiển thị Pokémon theo sau, bảng chỉ số (IV, EV, Stats, Nature, Moves). | **CHƯA TRIỂN KHAI** | Khảo sát toàn bộ repository không tìm thấy bất kỳ file hoặc dòng code nào liên quan đến Pokémon. | Trụ cột cốt lõi của trò chơi hiện bằng 0. |
| **4. Combat / Battle** | Giao diện trận chiến, hệ thống turn-based, tính toán sát thương, hiệu ứng chiêu thức, bắt Pokémon hoang dã. | **CHƯA TRIỂN KHAI** | [index.html L36](file:///d:/cc/Poke-Engine/public/index.html#L36) chỉ có thẻ rỗng `<div id="battle"></div>`. File `battle.game.css` không tồn tại. Không có logic JavaScript trận đấu nào. | Chưa có bất kỳ logic nào phục vụ màn hình chiến đấu. |
| **5. Túi đồ (Inventory)** | Thu thập vật phẩm, sử dụng bình máu/pokeball, quản lý số lượng, giao diện túi đồ. | **CHƯA TRIỂN KHAI** | [load.js L182, L223](file:///d:/cc/Poke-Engine/public/js/engine/load.js#L182) chỉ đọc chuỗi JSON từ `localStorage.getItem("items")`. [index.html L29](file:///d:/cc/Poke-Engine/public/index.html#L29) có `<li class="level-icon icon-bag"></li>` nhưng không có code xử lý click hay mở menu. | Không có dữ liệu item, không có giao diện mở túi. |
| **6. NPC & Tương tác** | Nhân vật NPC đứng yên/đi tuần tra trên bản đồ, hội thoại văn bản (dialogue box), kích hoạt sự kiện khi bấm phím tương tác. | **CHƯA TRIỂN KHAI** | Không có class NPC. Mảng `Game.prototype.objs = {}` tại [gamedata.js L23](file:///d:/cc/Poke-Engine/public/js/engine/gamedata.js#L23) để trống. Thẻ `<div id="map-objects"></div>` không được render bất kỳ phần tử nào. | Thế giới game hoàn toàn trống rỗng, không có tương tác môi trường hay nhân vật phụ. |
| **7. Save / Load** | Lưu lại vị trí tọa độ người chơi `(x, y)`, bản đồ hiện tại `map`, hướng nhìn `facing`, vật phẩm, Pokémon. | **DANG DỞ (CHỈ ĐỌC)** | [load.js L169-235](file:///d:/cc/Poke-Engine/public/js/engine/load.js#L169-L235) đọc dữ liệu từ `localStorage`. | **KHÔNG CÓ HỆ THỐNG LƯU GAME**. Toàn bộ mã nguồn không hề có lệnh `localStorage.setItem()` hay endpoint lưu tọa độ về server. Tọa độ người chơi không bao giờ được lưu lại khi di chuyển. |
| **8. Multiplayer** | Đồng bộ hóa thời gian thực vị trí người chơi khác trong cùng không gian bản đồ qua Socket.IO. | **HOẠT ĐỘNG CƠ BẢN (RELAY)** | [online.js L1-60](file:///d:/cc/Poke-Engine/public/js/engine/online.js#L1-L60), [server/core/index.js L13-32](file:///d:/cc/Poke-Engine/server/core/index.js#L13-L32), [server/core/move.js L11-50](file:///d:/cc/Poke-Engine/server/core/move.js#L11-L50) | **Lỗi người chơi đứng yên bị vô hình (Invisible Static Players)**: Server chỉ lắng nghe và phát lại `PLAYER_MOVE` và `PLAYER_LEAVE`. Khi người chơi B đăng nhập vào map, nếu người chơi A đang đứng yên thì B hoàn toàn không nhìn thấy A cho đến khi A di chuyển một bước. |
| **9. UI & Âm thanh** | Giao diện thanh trạng thái, menu tùy chọn, nhạc nền khu vực (BGM), hiệu ứng âm thanh bước chân/va chạm (SFX). | **TỐI THIỂU (UI) / CHƯA CÓ (AUDIO)** | [index.html L26-32](file:///d:/cc/Poke-Engine/public/index.html#L26-L32) chứa menu tĩnh. [boot.js L20-54](file:///d:/cc/Poke-Engine/public/js/engine/boot.js#L20-L54) có responsive scale. Không có bất kỳ file `.mp3`, `.wav`, `.ogg` nào trong dự án. | Menu game không bấm được. Không có bất kỳ âm thanh hay tiếng động nào trong game. |

---

## 5. KHẢ NĂNG CHẠY DỰ ÁN VÀ RÀO CẢN KHỞI ĐỘNG (RUNTIME & STARTUP STATUS)

### 5.1. Cách khởi động hiện tại:
* Khởi chạy qua lệnh: `npm start` (thực thi `node app.js`).
* Cổng mặc định: `3000` (hoặc cấu hình qua biến `PORT` trong `.env`).
* Phụ thuộc bắt buộc: Cấu hình Firebase phù hợp với môi trường đã chọn (Emulator hoặc Production), bao gồm Project ID và thông tin xác thực Admin SDK khi dùng Production. Mã nguồn fail-closed nếu thiếu cấu hình cần thiết.

### 5.2. Các phiên bản runtime và dependency:
* **Node.js runtime trên máy host**: `v22.14.0`.
* **Node.js production target**: Chưa được xác minh (`UNVERIFIED`).
* **Dependencies chính**:
  - `express`: `^4.17.1`
  - `socket.io`: `^2.3.0`
  - `firebase-admin`: phiên bản được khóa trong `package-lock.json`
  - `dotenv`: `^16.6.1`

### 5.3. Rào cản trực tiếp cản trở việc chơi và phát triển gameplay:
1. **Thiếu hoàn toàn giao diện Web cho Đăng nhập/Đăng ký**:
   - Khi chạy `node app.js` và mở trình duyệt tại `http://localhost:3000/`, middleware `requireAuth` phát hiện chưa có session và điều hướng sang `/login`.
   - Tại route `/login`, server kiểm tra file `public/login.html` nhưng file này không tồn tại ([app.js L205-209](file:///d:/cc/Poke-Engine/app.js#L205-L209)), trả về dòng thông báo plain text:
     > *"Trang đăng nhập (login.html) sẽ được tích hợp giao diện ở Task tiếp theo. Hiện tại bạn có thể sử dụng API POST /api/auth/login."*
   - **Hậu quả**: Không thể mở giao diện game trực tiếp từ trình duyệt để thử nghiệm bất kỳ tính năng gameplay nào nếu không dùng công cụ kỹ thuật để giả lập cookie session.
2. **Nguy cơ lỗi phụ thuộc mạng khi chạy offline**:
   - `jQuery 3.1.1` và `async 2.6.2` nạp từ CDN cdnjs; nếu máy phát triển mất kết nối Internet, màn hình game sẽ bị treo vĩnh viễn ở trạng thái "Carregando..." do không nạp được thư viện.

---

## 6. DANH MỤC LỖI KỸ THUẬT VÀ NỢ CÔNG NGHỆ (KNOWN BUGS & TECHNICAL DEBT)

1. **Lỗi `localStorage` trả về kiểu chuỗi (Type Inconsistency)**:
   - Trong [load.js L178-179, L219-220](file:///d:/cc/Poke-Engine/public/js/engine/load.js#L178-L220), `rawX` và `rawY` được lấy từ `localStorage.getItem()`. Khi có dữ liệu lưu, chúng là kiểu `String` (ví dụ `"5"`).
   - Khi đưa vào `position.x = rawX`, biểu thức `position.x * this.game.tileSize` có thể tự ép kiểu, nhưng trong các phép toán cộng chuỗi hoặc so sánh nghiêm ngặt (`===`), nó có thể sinh ra hành vi bất định nếu không được bọc hàm `parseInt(..., 10)`.
2. **Lỗi Invisible Static Players trong Multiplayer**:
   - Khi một người chơi mới tham gia phòng, server không gửi danh sách các người chơi hiện có trong map. Người chơi mới chỉ nhìn thấy người khác khi người kia bấm nút bước đi ([online.js L17-31](file:///d:/cc/Poke-Engine/public/js/engine/online.js#L17-L31)).
3. **Camera Animate lag và giật khi bấm giữ phím**:
   - `cameraFollow` gọi jQuery `.animate()` với `timer = 700ms` ([camera.js L114-119](file:///d:/cc/Poke-Engine/public/js/engine/camera.js#L114-L119)). Trong khi đó, mỗi bước chân của nhân vật chỉ mất 90ms (`stepTime = 90`). Khi người chơi giữ phím di chuyển, hàng loạt lệnh animate bị xếp hàng hoặc cắt ngang liên tục bằng `.stop(false, false)`, gây hiện tượng rung/giật khung hình (camera jitter).
4. **File mã nguồn mồ côi (Dead Code)**:
   - File `public/js/engine/movement.js` (184 dòng code) không hề được nạp trong `public/index.html`. Toàn bộ logic di chuyển thực tế đã được chuyển sang `public/js/engine/gameobjects.js`. Việc tồn tại song song hai file dễ gây hiểu lầm cho lập trình viên bảo trì.
   - File `public/img/maps/test.txt` nằm trong thư mục asset nhưng không có bất kỳ tham chiếu nào trong code.
5. **Tile Teleport là "Dead Tile"**:
   - Tile loại 3 trong `gamedata.js` định nghĩa `{ teleport: true }`, nhưng hàm `execCollision` tại [gameobjects.js L135-149](file:///d:/cc/Poke-Engine/public/js/engine/gameobjects.js#L135-L149) chỉ kiểm tra `checkXY.block`. Do ô 3 không có `block: true`, nhân vật bước lên ô này nhưng không có bất kỳ sự kiện nào xảy ra.

---

## 7. TOP 5 TASK TIẾP THEO ĐƯỢC ĐỀ XUẤT (TOP 5 RECOMMENDED NEXT TASKS)

Tuân thủ nghiêm ngặt định hướng ưu tiên phát triển Gameplay và không mở rộng Security Phase 1.3.6:

### 1. **TASK 1: XÂY DỰNG GIAO DIỆN AUTH TỐI GIẢN & MỞ KHÓA TRẢI NGHIỆM TRÌNH DUYỆT (BROWSER PLAYABILITY GATEWAY)**
* **Mục tiêu**: Xây dựng trang `login.html` và `register.html` nhẹ nhàng, cho phép người dùng mở trình duyệt, đăng ký tài khoản (chọn nhân vật khởi đầu như Red, Leaf, Brendan), đăng nhập và tự động chuyển hướng vào màn hình game.
* **Lý do ưu tiên**: Đây là điều kiện tiên quyết (Blocker) để bất kỳ ai có thể chơi và kiểm thử trực tiếp các tính năng gameplay trên trình duyệt.

### 2. **TASK 2: HỆ THỐNG LƯU TRỮ TRẠNG THÁI GAMEPLAY (GAME STATE PERSISTENCE / AUTO-SAVE)**
* **Mục tiêu**: Duy trì và xác minh việc lưu/khôi phục trạng thái nhân vật `(map, x, y, facing)` trong Cloud Firestore để người chơi tiếp tục tại vị trí đã lưu.
* **Lý do ưu tiên**: Đảm bảo tính nhất quán của một game RPG, kết nối dữ liệu thực giữa Client và Database.

### 3. **TASK 3: HỆ THỐNG CHUYỂN BẢN ĐỒ VÀ TƯƠNG TÁC THẾ GIỚI (WARP/TELEPORT & WORLD INTERACTION SYSTEM)**
* **Mục tiêu**: Triển khai logic xử lý cho tile loại 3 (`teleport`). Khi nhân vật bước vào cửa nhà hoặc cổng làng, game fade màn hình và nạp bản đồ mới. Lắng nghe phím tương tác (`Space`/`Enter`) để chuẩn bị cho NPC và nhặt đồ.
* **Lý do ưu tiên**: Mở rộng không gian thế giới game vượt ra khỏi bản đồ đơn lẻ 30x20 tile hiện tại.

### 4. **TASK 4: KHẮC PHỤC LỖI ĐỒNG BỘ MULTIPLAYER (ROOM PLAYER STATE SYNCHRONIZATION)**
* **Mục tiêu**: Thêm sự kiện `PLAYER_JOIN` / `GET_MAP_PLAYERS` trên Socket.IO server. Khi một người chơi mới kết nối vào bản đồ, server gửi danh sách toàn bộ các người chơi đang có mặt trong map để client vẽ ngay lên màn hình, giải quyết triệt để lỗi người chơi đứng yên bị vô hình.
* **Lý do ưu tiên**: Hoàn thiện tính năng Multiplayer cốt lõi vốn có của dự án.

### 5. **TASK 5: CẤU TRÚC DỮ LIỆU VÀ GIAO DIỆN POKÉMON CƠ BẢN (POKÉMON SYSTEM FOUNDATION & PARTY UI)**
* **Mục tiêu**: Tạo cấu trúc dữ liệu Pokémon (Species ID, Name, Level, HP, MaxHP, Types), gắn mảng `party` (tối đa 6 Pokémon) vào tài khoản người chơi. Kích hoạt icon Pokeball trên menu để mở giao diện xem danh sách Pokémon trong đội hình.
* **Lý do ưu tiên**: Đặt viên gạch đầu tiên cho yếu tố cốt lõi nhất của thương hiệu Pokémon.

---

## 8. ĐỀ XUẤT CHÍNH XÁC MỘT TASK NÊN THỰC HIỆN TIẾP THEO

> ### **NHIỆM VỤ ĐỀ XUẤT CHÍNH THỨC: TASK 1.4.1**
> **Tên nhiệm vụ**: **XÂY DỰNG GIAO DIỆN ĐĂNG NHẬP/ĐĂNG KÝ VÀ MỞ KHÓA TRẢI NGHIỆM GAME TRÊN TRÌNH DUYỆT (BROWSER PLAYABILITY GATEWAY)**
>
> **Lý do kỹ thuật duy nhất**:  
> Dù game engine có hoàn thiện đến đâu về mặt di chuyển hay bản đồ, nhưng nếu người chơi mở trình duyệt lên và bị chặn đứng bởi dòng thông báo lỗi do thiếu file `login.html`, toàn bộ dự án vẫn ở trạng thái **"không thể chơi được đối với người dùng thông thường"**. Việc mở khóa cổng truy cập này sẽ tạo ra nền tảng trực quan để kiểm thử mọi tính năng gameplay tiếp theo ngay trên giao diện web thực tế.

---

## 9. DANH SÁCH FILE LIÊN QUAN ĐẾN TASK ĐƯỢC ĐỀ XUẤT (TASK 1.4.1)

1. **`public/login.html`** *(Tạo mới)*: Giao diện form đăng nhập gọn gàng (Username, Password), gọi API `POST /api/auth/login` bằng AJAX và chuyển hướng sang `/` khi thành công.
2. **`public/register.html`** *(Tạo mới)*: Giao diện đăng ký tài khoản, cho phép chọn nhân vật khởi đầu từ danh sách hợp lệ (`red`, `leaf`, `brendan`, `ethan`, v.v.), gọi API `POST /api/auth/register`.
3. **`app.js`** *(Chỉnh sửa nhỏ)*: Cập nhật handler route `/login` và `/register` ([app.js L204-218](file:///d:/cc/Poke-Engine/app.js#L204-L218)) để phục vụ file tĩnh một cách mượt mà và an toàn.
4. **`public/css/style.game.css`** *(Chỉnh sửa bổ sung)*: Bổ sung định dạng CSS cho form đăng nhập/đăng ký mang phong cách retro pixel phù hợp với tổng thể game.
5. **`public/js/engine/load.js`** *(Chỉnh sửa nhỏ)*: Bổ sung logic đọc thông tin nhân vật từ API phiên người dùng (`/api/auth/me`) để đồng bộ avatar nhân vật người chơi đã chọn trong database vào scene thay vì chỉ phụ thuộc vào `localStorage`.

---

## 10. ĐÁNH GIÁ RỦI RO KHI TRIỂN KHAI TASK ĐƯỢC ĐỀ XUẤT

1. **Rủi ro vòng lặp chuyển hướng (Redirect Loop)**:
   - *Mô tả*: Luồng xác thực phụ thuộc vào việc cấp và xác minh Firebase Session Cookie nhất quán giữa controller và middleware.
   - *Biện pháp giảm thiểu*: Kiểm tra cookie `poke.sid`, trạng thái thu hồi Firebase session và hợp đồng `/api/auth/me` bằng test phù hợp với môi trường Emulator.
2. **Rủi ro vỡ tỷ lệ khung hình Viewport Responsive**:
   - *Mô tả*: Trang đăng nhập/đăng ký có thể bị ảnh hưởng bởi CSS scale `setupViewportManager` trong `boot.js` (tỷ lệ 272:240).
   - *Biện pháp giảm thiểu*: Tách biệt giao diện HTML của trang Login/Register độc lập hoàn toàn với container `#game` và `#level`, chỉ áp dụng scale viewport khi đã vào màn hình game chính.
3. **Rủi ro xung đột dữ liệu LocalStorage cũ**:
   - *Mô tả*: Nếu trình duyệt của lập trình viên đã có sẵn dữ liệu `character` cũ trong `localStorage` khác với nhân vật vừa chọn trong form đăng ký mới, client có thể hiển thị sai sprite.
   - *Biện pháp giảm thiểu*: Ưu tiên dữ liệu nhân vật trả về từ server session, chỉ coi `localStorage` là giải pháp dự phòng offline.

---
**KẾT THÚC BÁO CÁO KIỂM TOÁN HIỆN TRẠNG – SẴN SÀNG CHỜ Ý KIẾN CHỈ ĐẠO TỪ CHỦ DỰ ÁN**
