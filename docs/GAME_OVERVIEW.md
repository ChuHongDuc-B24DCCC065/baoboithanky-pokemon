# TỔNG QUAN DỰ ÁN & VÒNG LẶP GAMEPLAY (GAME_OVERVIEW.MD)

*Tài liệu tổng quan dự án Poké-Engine — Cập nhật ngày: 12/11/2026.*  
Tài liệu này xác định mục tiêu tổng thể, hiện trạng đã được kiểm chứng từ mã nguồn thực tế, vòng lặp gameplay định hướng và phạm vi phát triển của dự án **Poké-Engine**.

---

## 1. MỤC TIÊU DỰ ÁN

* **Định nghĩa sản phẩm**: Poké-Engine là một tựa game nhập vai phiêu lưu bắt thú 2D (Classic 2D Monster-Taming RPG) hoạt động trực tiếp trên nền tảng trình duyệt web (HTML5, CSS3, JavaScript ES6).
* **Định hướng kiến trúc cốt lõi**:
  - **Ưu tiên trải nghiệm chơi đơn (Single-player First)**: Tập trung hoàn thiện toàn bộ cơ chế gameplay chơi đơn cốt lõi trước khi mở rộng.
    - *Lưu ý về khả năng ngoại tuyến (Offline)*: Hiện tại mã nguồn client đang nạp các thư viện bên thứ ba (jQuery 3.1.1, Async.js 2.6.2) trực tiếp từ CDN bên ngoài (`cdnjs.cloudflare.com`). Do đó, **khả năng chạy offline hoàn toàn hiện chưa được xác nhận ở trạng thái hiện tại**. Việc tải các thư viện CDN về lưu trữ cục bộ để game vận hành offline hoàn chỉnh là **mục tiêu tương lai**.
  - **Bảo tồn nền tảng Multiplayer**: Giữ nguyên nền tảng WebSocket (Socket.io) hiện có trong mã nguồn (`server/core/index.js`, `server/core/move.js`, `public/js/engine/online.js`) như một cơ chế mở rộng tiềm năng. Không xóa code mạng nhưng tạm thời chưa phát triển thêm tính năng multiplayer trong các giai đoạn đầu.
  - **Công nghệ hiển thị**: Duy trì cơ chế render bản đồ và di chuyển bằng DOM/CSS hiện tại. Công nghệ Canvas 2D chỉ là đề xuất tiềm năng cho phân cảnh chiến đấu (Battle Scene) trong tương lai và chưa được triển khai ở thời điểm này.
  - **Quản lý danh tính & Phiên**: Tích hợp Firebase Authentication, Firebase Session Cookie và Cloud Firestore; `/api/auth/me` trả thông tin người chơi đã xác thực.

---

## 2. HIỆN TRẠNG MÃ NGUỒN (XÁC MINH TỪ SOURCE CODE THỰC TẾ)

Dựa trên việc đọc và kiểm tra trực tiếp các file mã nguồn của dự án tại thời điểm cập nhật, hiện trạng thực tế được phân loại như sau:

### A. Những tính năng ĐÃ CÓ trong mã nguồn (Verified Facts)

1. **Khung hiển thị thế giới (World & Viewport)**:
   - Bản đồ dạng lưới tile kích thước 16x16 pixel (`tileSize = 16`).
   - Màn hình hiển thị game cố định kích thước 272x240 pixel, phóng to linh hoạt theo tỷ lệ màn hình qua CSS `transform: scale(var(--game-scale, 2))`.
   - Bản đồ test kích thước 30x20 ô, sử dụng ảnh nền `test.png` và ảnh lớp phủ `test_overlay.png`.
2. **Hệ thống va chạm cơ bản (Collision Grid)**:
   - Đọc dữ liệu từ lớp `collision` trong file JSON xuất từ Tiled (`public/res/test.json`).
   - Phân loại ô: `1` là ô bị chặn (block), `2` là ô đi được, `3` là ô dịch chuyển (`teleport: true` trong cấu hình `gamedata.js`).
3. **Di chuyển nhân vật (Character Movement)**:
   - Điều khiển nhân vật di chuyển 4 hướng bằng bàn phím (Phím mũi tên hoặc phím WASD).
   - Cơ chế bước đi chia nhỏ thành 4 frame (mỗi frame 4 pixel, tổng cộng 16 pixel/tile) phối hợp đổi class CSS tạo hoạt ảnh bước chân.
4. **Camera bám theo người chơi (Camera Follow)**:
   - Sử dụng hàm cuộn của jQuery để dịch chuyển phần tử `#world`, giữ người chơi ở vị trí trung tâm màn hình trừ khi chạm biên bản đồ (`public/js/engine/camera.js`).
5. **Nạp & Đồng bộ dữ liệu người chơi**:
   - Đọc tọa độ xuất phát (`x`, `y`), hướng nhìn (`facing`), skin nhân vật (`character`), tên bản đồ (`map`) từ cấu hình lưu trữ kết hợp xác thực danh tính qua `/api/auth/me`.
6. **Đồng bộ vị trí Multiplayer sơ khai**:
   - Client gửi sự kiện `PLAYER_MOVE` kèm tọa độ lên server Node.js; server broadcast tọa độ cho các client khác để vẽ nhân vật từ xa (`div[online]`).
7. **Hệ thống NPC & Khung hội thoại (NPC & Dialogue System)**:
   - **Nạp dữ liệu NPC từ bản đồ**: Hàm `setupNpcs(layers)` trong `public/js/engine/map.js` đọc dữ liệu lớp `objectgroup` từ `test.json`, hỗ trợ cả 2 format properties (Object và Tiled Array). NPC Guide Leaf được đặt tại pixel `(48, 16)` ứng với tile `(3, 1)`.
   - **Va chạm NPC (Hitbox)**: Lớp `NPC` kế thừa `Character`. Hàm `execCollision()` kiểm tra `getNpcAt(x, y)` và chặn đứng người chơi khi ô đích có NPC, không thể đi xuyên qua.
   - **Tương tác hướng & Tự động xoay mặt**: Người chơi chỉ có thể tương tác khi đứng ở ô liền kề và quay mặt trực diện vào NPC (`getNpcInFront()`). NPC tự động xoay mặt đối diện người chơi khi hội thoại bắt đầu (`npc.setFacing()`).
   - **Giao diện hội thoại (Dialogue Box)**: Khung thoại pixel-art đặt ở đáy màn hình `#level`, hỗ trợ phím `Space` và `Enter`, có mũi tên đỏ nhấp nháy `▼` báo hiệu còn câu tiếp theo.
   - **Khóa trạng thái & Chống lặp phím**: Trạng thái `state = "DIALOGUE"` khóa toàn bộ phím di chuyển trong `update()`, xóa buffer phím, ngăn phát sinh gói tin di chuyển ngoài ý muốn. Có chốt chặn `e.repeat` chống việc đè giữ phím làm trôi toàn bộ câu thoại.
   - **Mức độ xác minh (Verification Level)**:
     - *Đã xác minh qua Node.js Runtime Simulation & Static Check (PASS)*: Toàn bộ dữ liệu bản đồ, tính nhất quán hệ đơn vị (Tile), va chạm NPC, chuỗi câu thoại, máy trạng thái và cơ chế chống nhân đôi khi reload map đã được kiểm chứng thực tế bằng script chạy máy ảo Node.js; cú pháp đạt `node -c` exit code 0.
     - *Kiểm thử trên trình duyệt đồ họa người dùng (Live Browser UI: NOT RUN)*: Chưa khởi chạy phiên kiểm thử trực quan trên giao diện trình duyệt live trong phiên tự động; cần người dùng mở trình duyệt để xác nhận hiển thị thị giác cuối cùng.

---

### B. Các tính năng CHƯA CÓ trong mã nguồn (Mục tiêu tương lai)

Dựa trên khảo sát source code thực tế, các hệ thống sau **hoàn toàn chưa có mã nguồn logic** và được xếp vào danh mục **Mục tiêu tương lai (Future Goals)**:

* **Hệ thống Dữ liệu Pokémon & Đội hình (Pokémon Data & Party)**: *(Chưa có)*
  - Chưa có cấu trúc dữ liệu cho Pokémon (loài, hệ, chỉ số Base HP/Attack/Defense, IV/EV, cấp độ, bộ 4 chiêu thức).
  - Chưa có mảng lưu trữ đội hình (Party tối đa 6 Pokémon) hay kho lưu trữ (PC Box).
* **Bụi cỏ & Chạm trán Pokémon hoang dã (Tall Grass & Wild Encounters)**: *(Chưa có)*
  - Chưa có phân loại tile bụi cỏ che chân, chưa có bộ đếm bước (step counter) hay công thức xác suất RNG để kích hoạt chạm trán quái ngẫu nhiên.
* **Hệ thống Chiến đấu theo lượt (Turn-based Battle)**: *(Chưa có)*
  - Giao diện hiện tại chỉ có một thẻ rỗng `<div id="battle"></div>` trong `index.html`. Chưa có sàn đấu, thanh máu (HP bar), menu chọn lệnh (Fight/Bag/Pokemon/Run), công thức tính sát thương hay AI cho đối thủ.
* **Hệ thống Thu phục (Monster Catching)**: *(Chưa có)*
  - Chưa có cơ chế ném Pokéball, công thức tính tỷ lệ bắt (Catch Rate Formula) dựa trên HP còn lại và trạng thái của Pokémon.
* **Hệ thống Luyện cấp & Tiến hóa (Progression & Evolution)**: *(Chưa có)*
  - Chưa có hệ thống điểm kinh nghiệm (EXP), bảng đường cong kinh nghiệm, học chiêu thức mới khi lên cấp hay hoạt ảnh tiến hóa.
* **Hệ thống Túi đồ & Vật phẩm (Inventory & Items)**: *(Chưa có)*
  - Giao diện menu hiện chỉ có icon tĩnh. Chưa có màn hình túi đồ, danh mục phân loại vật phẩm (Items, Medicine, Pokeballs) hay hàm xử lý tác dụng của vật phẩm.
* **Hệ thống Nhiệm vụ (Quest System)**: *(Chưa có)*
  - **Lưu ý quan trọng**: Tuy dự án đã có NPC và Khung hội thoại, nhưng **chưa có Hệ thống Nhiệm vụ (Quest System)**. NPC hiện tại chỉ hiển thị hội thoại cố định một chiều, chưa có nhật ký nhiệm vụ (Quest Log), cờ trạng thái sự kiện (Story Flags) hay phân nhánh nhiệm vụ.

---

## 3. VÒNG LẶP GAMEPLAY MỤC TIÊU (CORE GAMEPLAY LOOP)

Vòng lặp trải nghiệm cốt lõi của người chơi được định hướng phát triển và phân biệt rõ trạng thái triển khai như sau:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. KHÁM PHÁ (Exploration)                                              │
│    • Di chuyển trên bản đồ, va chạm địa hình [ĐÃ TRIỂN KHAI CỐT LÕI]   │
│    • Tương tác NPC, xem hướng dẫn qua hộp thoại [ĐÃ TRIỂN KHAI CỐT LÕI]│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼ Đi vào bụi cỏ / Kích hoạt RNG
┌────────────────────────────────────────────────────────────────────────┐
│ 2. CHẠM TRÁN HOANG DÃ (Wild Encounter) [MỤC TIÊU TIẾP THEO]            │
│    Hiệu ứng nhấp nháy màn hình, chuyển cảnh vào giao diện chiến đấu    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼ Bắt đầu trận đấu
┌────────────────────────────────────────────────────────────────────────┐
│ 3. CHIẾN ĐẤU THEO LƯỢT (Turn-based Battle) [ĐỊNH HƯỚNG TƯƠNG LAI]      │
│    Ra lệnh chiêu thức, tính hệ tương khắc, giảm HP đối thủ             │
└─────────────────────┬────────────────────────────┬─────────────────────┘
                      │                            │
                      ▼ Chiến thắng                ▼ Ném Pokéball thành công
┌───────────────────────────────────┐┌───────────────────────────────────┐
│ 4A. TIẾN TRÌNH & NÂNG CẤP         ││ 4B. THU PHỤC & MỞ RỘNG BỘ SƯU TẬP │
│     [ĐỊNH HƯỚNG TƯƠNG LAI]        ││     [ĐỊNH HƯỚNG TƯƠNG LAI]        │
│     Nhận EXP, lên cấp, học skill  ││     Thêm Pokémon vào Party/PC Box │
└─────────────────────┬─────────────┘└─────────────────────┬─────────────┘
                      │                                    │
                      └──────────────────┬─────────────────┘
                                         │
                                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 5. QUẢN LÝ & LƯU GAME (Management & Save) [ĐỊNH HƯỚNG TƯƠNG LAI]       │
│    Xem thông tin đội hình, dùng Potion hồi máu, lưu trạng thái hoàn hảo│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼ Tiếp tục vòng lặp
```

---

## 4. PHẠM VI & LỘ TRÌNH PHÁT TRIỂN (PROJECT SCOPE & ROADMAP)

Dự án kiên định theo đuổi định hướng **Single-player First**, áp dụng quy trình tái cấu trúc và mở rộng từng bước có kế hoạch (Incremental Refactoring), với lộ trình ưu tiên theo chuỗi phụ thuộc kỹ thuật hợp lý:

| Giai đoạn | Hạng mục phát triển | Trạng thái hiện tại | Mô tả trọng tâm kỹ thuật |
| :---: | :--- | :---: | :--- |
| **Giai đoạn 1** | **Exploration & NPC/Dialogue** | **HOÀN THÀNH CỐT LÕI** | Hoàn thành di chuyển, va chạm bản đồ, đọc NPC từ Tiled `objectgroup`, va chạm NPC, quay hướng tương tác và hộp thoại Game Boy. |
| **Giai đoạn 2** | **Bụi cỏ & Chạm trán quái ngẫu nhiên (Tall Grass & Wild Encounters)** | **Ưu tiên tiếp theo** | Khai báo tile loại cỏ (`grass`), lớp phủ bụi cỏ che chân, bộ đếm bước chân và công thức RNG tính xác suất gặp thú hoang, hiệu ứng màn hình chuyển cảnh. |
| **Giai đoạn 3** | **Cấu trúc Pokémon & Đội hình (Pokémon Data & Party)** | Định hướng tương lai | Xây dựng Schema dữ liệu Pokémon (chỉ số, loại, kỹ năng), quản lý mảng đội hình tối đa 6 thú cưng. |
| **Giai đoạn 4** | **Chiến đấu theo lượt (Turn-based Battle)** | Định hướng tương lai | Xây dựng giao diện sàn đấu (Canvas 2D hoặc DOM Overlay), hiển thị sprite trước/sau, thanh HP, menu lệnh 4 nút (Fight, Bag, Pokemon, Run) và vòng lặp lượt đánh. |
| **Giai đoạn 5** | **Cơ chế Thu phục (Catching System)** | Định hướng tương lai | Hoạt ảnh ném bóng, lắc bóng (1-3 nhịp), công thức tỷ lệ bắt Pokémon chuẩn Gen III. |
| **Giai đoạn 6** | **Túi đồ & Vật phẩm (Inventory & Items)** | Định hướng tương lai | Giao diện túi đồ (Bag UI), phân loại ngăn chứa, logic sử dụng Potion hồi máu và Pokéball trong/ngoài trận đấu. |
| **Giai đoạn 7** | **Luyện cấp, EXP & Tiến hóa (EXP, Level & Evolution)** | Định hướng tương lai | Tính toán điểm kinh nghiệm sau trận, tăng chỉ số khi lên cấp, học chiêu thức mới, màn hình tiến hóa khi đạt điều kiện. |
| **Giai đoạn 8** | **Hệ thống Lưu/Tải hoàn chỉnh (Save/Load)** | Định hướng tương lai | Lưu trữ toàn diện tọa độ, trạng thái bản đồ, danh sách đội hình và túi đồ vào cơ sở dữ liệu có xác thực toàn vẹn. |

---

## 5. TÌNH TRẠNG THAM CHIẾU CỦA CÁC TÀI NGUYÊN HIỆN CÓ

Bảng ghi nhận tình trạng tham chiếu thực tế của toàn bộ tài nguyên trong repository tại thời điểm cập nhật:

| Đường dẫn file | Tình trạng tham chiếu trong code | Ghi chú kỹ thuật & Hiện trạng |
| :--- | :--- | :--- |
| `app.js` | Điểm khởi chạy chính của Node.js | Nạp Express, Socket.IO, phục vụ thư mục `public/` và tích hợp router Firebase Auth + Firestore. |
| `server/core/index.js`, `move.js`, `events.json` | Được nạp bởi `app.js` | Quản lý kết nối Socket.io và sự kiện di chuyển `PLAYER_MOVE`. Giữ nguyên vẹn nền tảng multiplayer. |
| `public/index.html` | Điểm vào chính của giao diện Game | Nạp các stylesheet, cấu trúc viewport `#level`, `#world`, `#player`, `#dialogue-box` và các thẻ `<script>`. |
| `public/js/engine/index.js` | Khai báo trong `index.html` | Constructor `Game`, máy trạng thái (`NORMAL`/`DIALOGUE`), tương tác phím `Space`/`Enter`, quản lý vòng đời hội thoại. |
| `public/js/engine/map.js` | Khai báo trong `index.html` | Khởi tạo bản đồ `generateMapData`, tích hợp hàm `setupNpcs(layers)` đọc NPC từ Tiled `objectgroup`. |
| `public/js/engine/gameobjects.js` | Khai báo trong `index.html` | Định nghĩa class `Character`, `Player`, `NPC` (kế thừa `Character`), xử lý va chạm `execCollision` chặn người chơi đi xuyên qua NPC. |
| `public/js/engine/keyboard.js` | Khai báo trong `index.html` | Lắng nghe sự kiện bàn phím WASD / Mũi tên cho di chuyển. |
| `public/js/engine/camera.js` | Khai báo trong `index.html` | Xử lý camera bám theo tọa độ người chơi. |
| `public/js/engine/gamedata.js` | Khai báo trong `index.html` | Cấu hình hằng số `tileTypes`, `stepTime = 90`, `tileSize = 16`, danh mục bản đồ `maps`. |
| `public/js/engine/load.js` | Khai báo trong `index.html` | Nạp dữ liệu bản đồ qua AJAX, đồng bộ phiên đăng nhập qua `/api/auth/me`. |
| `public/js/engine/online.js` | Khai báo trong `index.html` | Đồng bộ hiển thị người chơi khác qua Socket.io. |
| `public/js/engine/boot.js` | Khai báo trong `index.html` | Khởi tạo Game instance, quản lý responsive scale `--game-scale`, xử lý đăng xuất. |
| `public/res/test.json` | Được nạp qua AJAX trong `load.js` | File bản đồ Tiled 30x20. Đã bổ sung object NPC `Guide Leaf` vào layer `objects` với tọa độ pixel `(48, 16)` -> tile `(3, 1)`. |
| `public/css/style.game.css` | Nạp trong `index.html` | Định dạng khung game 272x240, HUD huấn luyện viên, style cho class `.npc` và khung thoại `#dialogue-box`. |
| `public/css/character.game.css` | Nạp trong `index.html` | Chứa sprite sheet của các nhân vật (`red`, `leaf`, `brendan`...). |
| `public/css/battle.game.css` | **Đã tạm thời comment lại trong `index.html` (dòng 8)** | File CSS chưa tồn tại trên ổ đĩa. Đã được chú thích tạm ẩn để tránh lỗi HTTP 404 trên console trình duyệt. |
| `public/css/bar.game.css` | **Đã tạm thời comment lại trong `index.html` (dòng 9)** | File CSS chưa tồn tại trên ổ đĩa. Đã được chú thích tạm ẩn để tránh lỗi HTTP 404 trên console trình duyệt. |
| `public/js/engine/movement.js` | **Chưa thấy tham chiếu trong `index.html`** | File chứa logic di chuyển cũ. Giữ nguyên hiện trạng, không tự ý xóa khi chưa có phê duyệt. |
| `public/img/maps/test.txt` | **Chưa thấy tham chiếu trong mã nguồn** | File văn bản nằm trong thư mục bản đồ. Giữ nguyên hiện trạng, không tự ý xóa. |
| Thư viện CDN (`cdnjs.cloudflare.com`) | Nạp trong `index.html` (dòng 48-49) | jQuery 3.1.1 và Async.js 2.6.2. Cần mạng để tải; mục tiêu tương lai sẽ tải về máy cục bộ để hỗ trợ offline. |
