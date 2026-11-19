# THIẾT KẾ KỸ THUẬT CHI TIẾT: CHUYỂN ĐỔI BACKEND SANG FIREBASE (TASK 1.4.2)
## POKÉ-ENGINE — AUTHENTICATION & FIRESTORE ARCHITECTURE SPECIFICATION (REVISION R3 — FINAL SURGICAL FIX)

---

- **Mã tài liệu**: `TASK-1.4.2-DESIGN-AUTH-FIRESTORE-R3-FINAL`
- **Dự án**: Poké-Engine
- **Phiên bản**: **Revision R3 — Final Surgical Fix** (Xử lý dứt điểm các ca biên Saga Lease Expiration, Auth in-flight, Reconciliation và Ánh xạ Idempotency)
- **Trạng thái**: **`DESIGN READY FOR FINAL APPROVAL`**
- **Loại tài liệu**: Thiết kế kỹ thuật chi tiết (Technical Specification & Architecture Design). **TUYỆT ĐỐI CHƯA SỬA SOURCE CODE, CHƯA MUTATION GIT.**
- **Ngày lập**: 12/11/2026
- **Tác giả / Vai trò**: Technical Lead & Senior Game Architect

---

## 1. TỔNG QUAN VÀ MỤC TIÊU BẢN REVISION R3 (SURGICAL FIX)

Bản thiết kế Revision R3 hoàn thiện và khắc phục triệt để các vấn đề kiến trúc then chốt:
1. **Saga Crash Recovery với Fencing Lease & Synthetic Email Reconciliation**: Loại bỏ hoàn toàn giả định ngây thơ về việc lease hết hạn đồng nghĩa với an toàn giải phóng; thiết lập cơ chế Fencing Lease Epoch ngăn chặn request cũ ghi đè request mới, và bắt buộc thực hiện Reconciliation qua `admin.auth().getUserByEmail()` trước khi giải phóng reservation để xử lý triệt để các ca `createUser()` hoàn tất muộn hoặc server sập trước khi lưu UID.
2. **Bảo vệ Tuyệt đối Username ACTIVE**: Quy định bất biến: username đã ở trạng thái `ACTIVE` là vĩnh viễn, không có khái niệm hết hạn lease, ngăn chặn mọi hành vi tiếp quản trái phép.
3. **Ánh xạ và Xử lý Idempotency Chặt chẽ**: Ánh xạ 1-1 trực tiếp `idempotencyKey` làm Document ID của `registrationOperations/{idempotencyKey}`, sử dụng `transaction.create()` để loại bỏ hoàn toàn race condition khi hai request đồng thời gửi cùng một key.
4. **Cơ chế Ngắt Kết nối Socket.IO Thực tế khi Logout-All**: Sửa chữa nhận định sai lầm rằng `revokeRefreshTokens` tự động ngắt kết nối WebSocket; thiết lập bảng theo dõi Socket chủ động phía server (`activeSocketsByUid`), cơ chế cưỡng chế ngắt transport `socket.disconnect(true)` và xử lý khi server khởi động lại.
5. **Thiết kế CSRF HMAC-Signed Session-Bound**: Chuyển đổi từ Unsigned Double-Submit Cookie sang **HMAC-SHA256 Signed CSRF Token ràng buộc chặt chẽ với Session và UID** của người dùng, giải quyết hoàn toàn nguy cơ Cross-Account Token Injection mà không cần server-side session storage.
6. **Phân loại Minh bạch Chứng cứ Synthetic Email**: Đính chính rõ ràng rằng `validator.isEmail(...) === true` chỉ chứng minh cú pháp thư viện, chuyển trạng thái chấp thuận của Firebase Auth sang **`PENDING` (Giả thuyết kỹ thuật chờ kiểm chứng qua Integration Test trên Emulator)**, và cung cấp đặc tả kịch bản test 9 bước độc lập.

---

## 2. HIỆN TRẠNG CONTRACT XÁC THỰC (VERIFIED SOURCE CODE REALITY)

Kiểm tra đối chiếu trực tiếp mã nguồn của toàn bộ các file liên quan:
- Model: [server/models/User.js](file:///d:/cc/Poke-Engine/server/models/User.js)
- Controller: [server/controllers/authController.js](file:///d:/cc/Poke-Engine/server/controllers/authController.js)
- Middleware: [server/middleware/authMiddleware.js](file:///d:/cc/Poke-Engine/server/middleware/authMiddleware.js)
- Session Config: [server/config/session.js](file:///d:/cc/Poke-Engine/server/config/session.js)
- HTML UI: [public/login.html](file:///d:/cc/Poke-Engine/public/login.html), [public/register.html](file:///d:/cc/Poke-Engine/public/register.html)
- Client Script: [public/js/auth/login.js](file:///d:/cc/Poke-Engine/public/js/auth/login.js), [public/js/auth/register.js](file:///d:/cc/Poke-Engine/public/js/auth/register.js)
- Engine Boot Loader: [public/js/engine/load.js](file:///d:/cc/Poke-Engine/public/js/engine/load.js)
- Main Server: [app.js](file:///d:/cc/Poke-Engine/app.js)

### Bảng Đối chiếu Hiện trạng Contract
1. **Giao diện đăng ký**: [public/register.html#L20-L100](file:///d:/cc/Poke-Engine/public/register.html#L20-L100) yêu cầu 4 trường: `username` (3-20 ký tự, regex `^[a-zA-Z0-9_]+$`), `password` (>= 6 ký tự), `confirmPassword` (kiểm tra khớp), `character` (enum: red, leaf, brendan, ethan). **Hoàn toàn KHÔNG có trường `email`**.
2. **Giao diện đăng nhập**: [public/login.html#L20-L55](file:///d:/cc/Poke-Engine/public/login.html#L20-L55) sử dụng **100% USERNAME**, không dùng email. Form chỉ có 2 trường: `username` ("Tên đăng nhập") và `password` ("Mật khẩu").
3. **MongoDB hiện lưu**:
   - `users`: `_id`, `username` (unique, lowercase), `password` (bcrypt hash, 10 salt rounds), `character` (enum 9 nhân vật), `isActive` (boolean, default true), `createdAt`, `updatedAt`.
   - `sessions`: `_id`, `session` (JSON chứa `cookie` và `userId`), `expires` (thời hạn 7 ngày = 604,800 giây).
4. **Cơ chế định danh mục tiêu trong Firebase**: Định danh chính là chuỗi **`uid`**. Phương thức xác thực mật khẩu của Firebase Auth yêu cầu địa chỉ email hợp lệ theo RFC 5322 (`local-part@domain`).
5. **Giải pháp tương thích**: Áp dụng **Synthetic Internal Email Mapping**: Khi nhận `username`, server tự động chuẩn hóa: `normalizedUsername = username.trim().toLowerCase()` và tạo email nội bộ xác định: `internalEmail = `${normalizedUsername}@player.poke-engine.internal``.
6. **Đánh giá Email thật**: Giữ nguyên UI hiện tại. Không thêm trường email vào giao diện ở giai đoạn này để tránh phá vỡ giao diện retro và bảo vệ 17 file tracked.

---

## 3. SAGA CRASH RECOVERY VÀ MÁY TRẠNG THÁI BỀN VỮNG (DURABLE OPERATION STATE MACHINE)

> [!WARNING]
> **BẤT BIẾN KIẾN TRÚC PHÂN TÁN & NGUYÊN TẮC FAIL-CLOSED**:  
> 1. Firebase Authentication và Cloud Firestore là hai hệ thống phân tán độc lập. **Firestore Transaction KHÔNG THỂ bao trùm hoặc rollback một thao tác trong Firebase Auth**.  
> 2. Chính sách Firestore TTL (Time-To-Live) chỉ là cơ chế dọn dẹp bất đồng bộ ở tầng hạ tầng, **TUYỆT ĐỐI KHÔNG ĐƯỢC COI LÀ CƠ CHẾ BẢO ĐẢM TÍNH ĐÚNG ĐẮN CHO ỨNG DỤNG** (Application Correctness).  
> 3. **Loại bỏ hoàn toàn giả định về thời gian an toàn (không có mốc 45 giây hay bất kỳ timeout nào)**: Client disconnect hay HTTP/TCP timeout chỉ là sự kiện phía máy chủ cục bộ, **KHÔNG PHẢI LÀ BẰNG CHỨNG RẰNG FIREBASE AUTH ĐÃ HỦY LỆNH `createUser()`**.  
> 4. **`auth/user-not-found` tại một thời điểm KHÔNG PHẢI LÀ BẰNG CHỨNG CHẮC CHẮN** rằng một lệnh `createUser()` đang chạy từ request cũ sẽ không hoàn tất sau đó trên hạ tầng Firebase.  
> 5. **Khi kết quả `createUser()` chưa xác định**: Hệ thống bắt buộc phải giữ reservation ở trạng thái **`RECONCILIATION_REQUIRED`** và **FAIL-CLOSED**. **TUYỆT ĐỐI KHÔNG CHO PHÉP request mới tiếp quản username** khi operation cũ vẫn có khả năng hoàn tất muộn.

---

### 3.1. Cấu trúc Document `registrationOperations/{idempotencyKey}`
Hệ thống sử dụng trực tiếp **`idempotencyKey` đã qua kiểm tra hợp lệ làm Document ID** của collection `registrationOperations`:
```json
{
  "idempotencyKey": "8f3a1b2c-4d5e-6f7a-8b9c-0d1e2f3a4b5c",
  "operationId": "op_9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "normalizedUsername": "ash_ketchum",
  "syntheticEmail": "ash_ketchum@player.poke-engine.internal",
  "payloadFingerprint": "9a0f3d... (HMAC-SHA256 hex với IDEMPOTENCY_SECRET)",
  "ownerToken": "lease_token_serverA_pid1234_1700000000_xyz",
  "leaseEpoch": 1,
  "status": "PENDING",
  "firebaseUid": null,
  "character": "red",
  "createdAt": "2026-11-12T16:00:00.000Z (Firestore Timestamp)",
  "authRequestedAt": null,
  "leaseExpiresAt": "2026-11-12T16:00:30.000Z (Firestore Timestamp, now + 30s)",
  "retryCount": 0,
  "lastError": null
}
```

#### Quy định Kiểm tra Tính Hợp lệ của Idempotency Key
- Trước khi sử dụng làm Firestore Document ID, `idempotencyKey` (từ header `x-idempotency-key`) bắt buộc phải được kiểm tra qua regex an toàn:
  - Định dạng UUID v4: `/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/`
  - Hoặc chuỗi URL-safe: `/^[a-zA-Z0-9_-]{16,64}$/`
- Nếu header bị thiếu, rỗng, chứa ký tự cấm (như dấu `/`, khoảng trắng, dấu chấm đơn/kép `.`/`..`, ký tự điều khiển) hoặc không khớp định dạng: Server lập tức từ chối với **HTTP 400 Bad Request** (`INVALID_IDEMPOTENCY_KEY`).

#### Bảo vệ Payload Fingerprint bằng HMAC-SHA256 Phía Server
1. **Yêu cầu Secret Riêng Biệt Phía Server (Zero Firestore/Git Exposure)**:
   - Secret được cấu hình độc quyền qua biến môi trường: `process.env.IDEMPOTENCY_SECRET`.
   - **Bảo mật tuyệt đối**: Chuỗi bí mật này có độ dài tối thiểu 32 ký tự (256-bit entropy). **TUYỆT ĐỐI KHÔNG ĐƯỢC LƯU trong Firestore, Git hay gửi về Client**. Chỉ tồn tại trong biến môi trường của tiến trình server.
   - **Quy tắc Fail-Closed khi Thiếu Secret**:
     Nếu `process.env.IDEMPOTENCY_SECRET` bị thiếu, rỗng, hoặc có độ dài < 32 ký tự:
     Server lập tức ném lỗi cấu hình bảo mật `Error("[Security Config] IDEMPOTENCY_SECRET is missing or insufficient length (min 32 chars).")` và từ chối xử lý với HTTP 500.
     **TUYỆT ĐỐI KHÔNG FALLBACK sang SHA256 không khóa hoặc bất kỳ thuật toán băm yếu nào**.
2. **Tính toán Dấu Vân Tay (Keyed HMAC-SHA256 Fingerprint)**:
   - Chuẩn hóa: `normalizedUsername = username.trim().toLowerCase()`, `normalizedCharacter = (character || "red").trim().toLowerCase()`.
   - Tạo fingerprint bằng HMAC-SHA256 có khóa bí mật:
     ```javascript
     const hmac = crypto.createHmac("sha256", process.env.IDEMPOTENCY_SECRET.trim());
     hmac.update(`${normalizedUsername}:${password}:${normalizedCharacter}`);
     const payloadFingerprint = hmac.digest("hex");
     ```
   - Nhờ có secret bảo mật chỉ nằm trên server, ngay cả khi cơ sở dữ liệu Firestore bị đọc trái phép, kẻ tấn công hoàn toàn không thể sử dụng Dictionary Attack hay Rainbow Table để giải mã hay kiểm tra dò mật khẩu của người chơi từ `payloadFingerprint`.
3. **Cơ chế Xử lý Payload Mismatch**:
   - Khi nhận request có `idempotencyKey` đã tồn tại trong Firestore:
   - Server tính toán `currentPayloadFingerprint` của request hiện tại và đối chiếu với `existingOp.payloadFingerprint`.
   - **Nếu Fingerprint KHÁC NHAU (Payload Mismatch)**:
     - Bất kể operation cũ đang ở trạng thái nào, server **LẬP TỨC TỪ CHỐI** với **HTTP 409 Conflict**:
       ```json
       {
         "success": false,
         "code": "IDEMPOTENCY_KEY_REUSED",
         "message": "Idempotency key này đã được sử dụng cho một yêu cầu đăng ký khác với nội dung khác."
       }
       ```
     - Tuyệt đối không thực thi tiếp, không ghi đè và không trả kết quả của operation cũ.
   - **Nếu Fingerprint TRÙNG NHAU (Cùng Key + Cùng Payload)**:
     - Nếu `status === "ACTIVE"`: Trả về ngay HTTP 201 Created cùng dữ liệu profile `{ success: true, data: { user: profile } }` đã lưu (Idempotent Replay, không tạo lại tài khoản).
     - Nếu `status` đang là `PENDING`, `AUTH_SUBMITTED`, hoặc `AUTH_CREATED`: Trả về HTTP 409 Conflict hoặc 429 `{ code: "OPERATION_IN_PROGRESS", message: "Yêu cầu đăng ký đang được xử lý, vui lòng chờ." }`.
     - Nếu `status === "FAILED"`: Trả về mã lỗi dứt điểm từ `lastError`.

---

### 3.2. Định nghĩa Máy Trạng thái và Điều kiện Chuyển đổi (State Transitions)

```
        ┌────────────────────────────────────────────────────────────────────────────────┐
        │                                                                                │
        ▼                                                                                │
    [PENDING] ────► [AUTH_SUBMITTED] ────► [AUTH_CREATED] ────► [ACTIVE] (Hoàn tất)      │ (Rollback / Cleanup)
        │                  │                      │                                      │
        │ (Lỗi Validate)   │ (Lỗi Auth)           │ (Lỗi Firestore)                      │
        ▼                  ▼                      ▼                                      │
    [FAILED] ◄───────────────────────── [COMPENSATION_REQUIRED] ─────────────────────────┘
```

1. **`PENDING` (Khởi tạo Giữ chỗ & Thuê quyền - Lease Acquired)**:
   - *Yêu cầu Transaction Firestore*: **BẮT BUỘC**.
   - *Logic*: Transaction đọc đồng thời `usernames/{normalizedUsername}` và `registrationOperations/{idempotencyKey}`.
   - *Bảo vệ Tuyệt đối Trạng thái `ACTIVE`*:
     - **BẤT BIẾN**: Nếu `usernames/{normalizedUsername}` đã tồn tại và có `status === "ACTIVE"`, username này là **VĨNH VIỄN KHÔNG THỂ THAY ĐỔI**. Tuyệt đối không bao giờ được coi `ACTIVE` là hết hạn lease! Bất kỳ request nào thấy `status === "ACTIVE"` đều lập tức bị từ chối với **HTTP 409 Conflict** (`USERNAME_ALREADY_EXISTS`).
   - *Xử lý Hai Request Đồng thời cùng một Idempotency Key*:
     - Thao tác `transaction.create(db.collection("registrationOperations").doc(idempotencyKey), { ... })` đảm bảo tính nguyên tử: chỉ duy nhất 1 request tạo thành công document. Request thứ hai đến cùng thời điểm sẽ nhận lỗi `ALREADY_EXISTS` từ Firestore và chuyển sang nhánh đọc/chờ an toàn.

2. **`AUTH_SUBMITTED` (Đã Phát Lệnh Tạo Tài khoản sang Firebase Auth)**:
   - *Yêu cầu Transaction Firestore*: **BẮT BUỘC trước khi gọi `createUser()`**.
   - Server cập nhật `registrationOperations/{idempotencyKey}` sang `status: "AUTH_SUBMITTED"`, ghi nhận `authRequestedAt: serverTimestamp()`.
   - Mục đích: Đánh dấu rõ ràng rằng một request mạng ra Firebase Auth đang in-flight!

3. **`AUTH_CREATED` (Tài khoản Firebase Auth đã được tạo)**:
   - *Không nằm trong transaction* (Gọi mạng ra Firebase Auth với timeout client cố định: `timeout: 15000ms`).
   - Server gọi: `admin.auth().createUser({ email: syntheticEmail, password, displayName: normalizedUsername })`.
   - Khi nhận `userRecord.uid`:
     - Server thực hiện Firestore Transaction cập nhật `registrationOperations/{idempotencyKey}`:
       - Điều kiện Fencing: `ownerToken == myToken && leaseEpoch == myEpoch && status == "AUTH_SUBMITTED"`.
       - Dữ liệu cập nhật: `status: "AUTH_CREATED"`, `firebaseUid: userRecord.uid`, gia hạn lease: `leaseExpiresAt: now + 30s`.
   - **Xử lý Ca Biên: Late Response của Request Cũ khi Lease đã Bị Tiếp Quản**:
     - Nếu mạng bị trễ và `createUser()` trả về kết quả sau khi lease đã bị Recovery Worker tiếp quản hoặc huỷ bỏ (leaseEpoch đã tăng hoặc status không còn là `AUTH_SUBMITTED`):
     - Bước commit Fencing ở trên sẽ bị **REJECT (Thất bại)**!
     - Tiến trình server cũ phát hiện mình đã mất quyền sở hữu (stale worker):
       - **TUYỆT ĐỐI KHÔNG ĐƯỢC CHẠM VÀO `usernames` HOẶC `users`**, vì username đó có thể đang được request khác sử dụng hoặc đang ở trạng thái cách ly.
       - Tiến trình cũ CHỈ ĐƯỢC PHÉP tự tiêu hủy chính `userRecord.uid` mà nó vừa nhận được từ response: gọi ngay `admin.auth().deleteUser(userRecord.uid)`.
       - Cơ chế này đảm bảo request cũ không bao giờ xóa tài khoản hay ghi đè dữ liệu của operation mới!

4. **`ACTIVE` (Kích hoạt Hồ sơ và Chốt Quyền Sở hữu Username)**:
   - *Yêu cầu Transaction Firestore*: **BẮT BUỘC**.
   - *Logic*:
     - Kiểm tra Fencing: `registrationOperations/{idempotencyKey}.ownerToken == myToken && leaseEpoch == myEpoch && status == "AUTH_CREATED"`.
     - Ghi document `users/{firebaseUid}` chứa toàn bộ thông tin profile (`{ uid: firebaseUid, username: normalizedUsername, character, isActive: true, createdAt, updatedAt }`).
     - Cập nhật `usernames/{normalizedUsername}` sang `{ status: "ACTIVE", uid: firebaseUid, idempotencyKey }` (Xóa bỏ toàn bộ các trường lease, chuyển thành mapping vĩnh viễn).
     - Cập nhật `registrationOperations/{idempotencyKey}` sang `status: "ACTIVE"`, xóa `ownerToken`.
   - Hoàn tất Saga. Trả về HTTP 201 Created cho client.

5. **`COMPENSATION_REQUIRED` & `FAILED`**:
   - Nếu Bước 4 thất bại, chuyển sang `COMPENSATION_REQUIRED` để dọn dẹp `firebaseUid` qua `admin.auth().deleteUser(firebaseUid)`. Sau khi dọn xong, giải phóng `usernames` và đánh dấu `FAILED`.

---

### 3.3. Cơ chế Xử lý In-Flight Race Condition và Đối soát An toàn (Safe Reconciliation)

> [!CRITICAL]
> **NGUYÊN TẮC FAIL-CLOSED TRƯỚC TÌNH TRẠNG CHƯA XÁC ĐỊNH**:  
> 1. **Loại bỏ hoàn toàn giả định về thời gian an toàn (không có mốc 45s hay bất kỳ timeout nào)**: Client disconnect hay HTTP/TCP timeout chỉ là sự kiện phía máy chủ cục bộ, **KHÔNG PHẢI LÀ BẰNG CHỨNG RẰNG FIREBASE AUTH ĐÃ HỦY LỆNH `createUser()`**!  
> 2. **`auth/user-not-found` tại một thời điểm KHÔNG PHẢI LÀ BẰNG CHỨNG CHẮC CHẮN** rằng một lệnh `createUser()` đang chạy từ request cũ sẽ không hoàn tất sau đó trên hạ tầng phân tán của Firebase.  
> 3. **Khi kết quả `createUser()` chưa xác định**: Hệ thống bắt buộc phải giữ reservation ở trạng thái **`RECONCILIATION_REQUIRED`** và **FAIL-CLOSED**. **TUYỆT ĐỐI KHÔNG CHO PHÉP request mới tiếp quản username** khi operation cũ vẫn có khả năng hoàn tất muộn! Mọi request xin cấp username này đều bị từ chối với **HTTP 409 Conflict** (`USERNAME_RESERVATION_LOCKED`).

#### Quy trình Đối soát & Điều Kiện Giải Phóng An Toàn:
Khi Recovery Worker hoặc hệ thống phát hiện một operation ở trạng thái `AUTH_SUBMITTED` nhưng lease đã hết hạn:

1. **Khóa Chặt Trạng thái (Lock down to `RECONCILIATION_REQUIRED`)**:
   - Chuyển `registrationOperations/{idempotencyKey}` sang `status: "RECONCILIATION_REQUIRED"`.
   - Cập nhật `usernames/{normalizedUsername}` sang `status: "RESERVATION_LOCKED"`, `reason: "RECONCILIATION_REQUIRED"`.
   - **Chặn Đứng Toàn Bộ Request Mới**: Mọi request đăng ký mới xin cấp `normalizedUsername` này đều bị từ chối với **HTTP 409 Conflict** (`USERNAME_RESERVATION_LOCKED`).

2. **Quy tắc Đối soát Thực tế (Reconciliation Logic)**:
   - Worker gọi tra cứu tài khoản:
     ```javascript
     let existingAuthUser = null;
     try {
         existingAuthUser = await admin.auth().getUserByEmail(syntheticEmail);
     } catch (err) {
         if (err.code !== "auth/user-not-found") {
             // Lỗi mạng thật (ECONNREFUSED / gRPC unavailable) -> FAIL-CLOSED!
             // Giữ nguyên trạng thái RESERVATION_LOCKED, không được giải phóng!
             console.error("[Reconciliation Network Error]:", err.message);
             return;
         }
     }
     ```
   - **Trường hợp A: Tìm thấy `existingAuthUser` TỒN TẠI trong Firebase Auth**:
     - *Kết quả đã xác định chắc chắn 100%*: Tài khoản Auth đã thực sự được tạo thành công!
     - Worker kiểm tra document `users/{existingAuthUser.uid}`:
       - Nếu profile đã có: Worker chuyển `usernames` sang `ACTIVE` và chốt operation `ACTIVE` (Forward Recovery thành công).
       - Nếu profile CHƯA có: Đây là tài khoản mồ côi (Orphan User). Worker tiến hành bồi hoàn dứt điểm:
         1. Gọi `await admin.auth().deleteUser(existingAuthUser.uid)` để tiêu hủy tài khoản rác cụ thể này.
         2. Gọi lại `getUserByEmail(syntheticEmail)` để xác nhận chắc chắn 100% tài khoản đã bị xóa sạch khỏi Firebase Auth.
         3. Chỉ sau khi có bằng chứng xác thực tài khoản mồ côi đã bị tiêu hủy hoàn toàn, Transaction Firestore mới được phép giải phóng `usernames/{normalizedUsername}` và đánh dấu operation cũ là `FAILED`.
   - **Trường hợp B: `getUserByEmail` trả về `auth/user-not-found`**:
     - *Chưa thể khẳng định an toàn ngay lập tức*: Không thể loại trừ khả năng lệnh `createUser()` cũ vẫn đang được xử lý trễ trên cụm máy chủ phân tán của Firebase.
     - **Nguyên tắc An Toàn**: Hệ thống **KHÔNG ĐƯỢC PHÉP GIẢI PHÓNG RESERVATION NGAY**.
     - Worker ghi nhận `reconciliationAttempts = attempts + 1`.
     - Chỉ cho phép giải phóng reservation khi có cơ sở xác định an toàn tuyệt đối:
       - Khi trải qua nhiều chu kỳ đối soát độc lập kéo dài cách nhau nhiều phút mà trạng thái vẫn liên tục là `auth/user-not-found` VÀ tiến trình server gốc đã được xác nhận kết thúc hoàn toàn (hoặc có sự xác nhận an toàn từ quản trị viên hệ thống qua admin tooling).
       - **Nếu có bất kỳ nghi ngờ nào hoặc không thể xác định an toàn**: Hệ thống **GIỮ FAIL-CLOSED VĨNH VIỄN** (`RESERVATION_LOCKED`), bảo vệ tính toàn vẹn của hệ thống, không tự ý giải phóng.

3. **Bảo đảm Request Cũ Không Xóa Tài Khoản của Operation Khác**:
   - Khi bất kỳ tiến trình nào thực hiện thao tác xóa user bồi hoàn (`admin.auth().deleteUser(targetUid)`):
   - **BẮT BUỘC chỉ được truyền chính xác chuỗi `targetUid` duy nhất** (chuỗi UUID toàn cầu) do chính operation đó sở hữu hoặc do reconciliation xác định.
   - **TUYỆT ĐỐI KHÔNG BAO GIỜ XÓA TÀI KHOẢN THEO EMAIL HOẶC USERNAME**.
   - Do mỗi tài khoản Firebase Auth có một `uid` độc nhất vô nhị, việc xóa `targetUid` của request cũ tuyệt đối không thể xóa nhầm tài khoản của một operation khác (kể cả khi chúng sử dụng cùng một username hay email nội bộ).
   - Đồng thời, cơ chế Fencing Lease Epoch chặn đứng request cũ ở tầng Firestore, ngăn không cho request cũ ghi đè profile hay can thiệp vào `usernames/{normalizedUsername}` của operation mới.

4. **Thừa nhận Giới hạn Phân tán (Honest Distributed System Limitation)**:
   - Trong môi trường phân tán không có Two-Phase Commit (2PC) giữa Firebase Auth và Firestore, việc một tác vụ ghi mạng bị trôi nổi là một giới hạn khách quan của hạ tầng đám mây.
   - Hệ thống Poké-Engine chọn triết lý **An Toàn Tuyệt Đối (Safety / Consistency over Availability)**: Thà tạm thời khóa một username nghi ngờ để đối soát (FAIL-CLOSED) còn hơn cho phép đăng ký đè dẫn đến xung đột hoặc rò rỉ dữ liệu. Hệ thống không tuyên bố bảo đảm tuyệt đối mà luôn minh bạch ghi nhận giới hạn này trong tài liệu kỹ thuật.

---

---

## 4. QUẢN LÝ SOCKET VÀ NGẮT KẾT NỐI CHỦ ĐỘNG KHI LOGOUT-ALL

> [!IMPORTANT]
> **ĐÍNH CHÍNH QUAN TRỌNG VỀ WEBSOCKET & SOCKET.IO**:  
> Khác với HTTP Request-Response, WebSocket là kết nối hai chiều duy trì trạng thái liên tục (persistent connection).  
> Khi `admin.auth().revokeRefreshTokens(uid)` được gọi trên Firebase Auth, Firebase **KHÔNG TỰ ĐỘNG ngắt kết nối WebSocket/Socket.IO đang mở**.  
> Socket.IO server chỉ chạy hàm middleware `io.use()` một lần duy nhất lúc Handshake, không kiểm tra lại cookie trên từng gói tin `PLAYER_MOVE`.  
> Do đó, Server bắt buộc phải chủ động theo dõi và ngắt kết nối vật lý (Physical Disconnection).

### 4.1. Bảng Theo dõi Socket Đang Hoạt động (Active Socket Registry)
Phía Express Server, duy trì một bảng tra cứu trong bộ nhớ tiến trình (In-Memory Registry):
```javascript
// Map ánh xạ từ Firebase UID sang tập hợp các Socket instances đang kết nối
const activeSocketsByUid = new Map(); // Map<string, Set<Socket>>
```

1. **Khi Handshake hoàn tất trong `io.use()`**:
   - Gắn danh tính đã xác minh vào `socket`: `socket.userId = decoded.uid; socket.username = userDoc.data().username;`.
2. **Khi Socket kết nối thành công (`io.on("connection")`)**:
   ```javascript
   if (!activeSocketsByUid.has(socket.userId)) {
       activeSocketsByUid.set(socket.userId, new Set());
   }
   activeSocketsByUid.get(socket.userId).add(socket);

   // Khi socket ngắt kết nối (tự đóng tab, mất mạng)
   socket.on("disconnect", () => {
       const userSockets = activeSocketsByUid.get(socket.userId);
       if (userSockets) {
           userSockets.delete(socket);
           if (userSockets.size === 0) {
               activeSocketsByUid.delete(socket.userId);
           }
       }
   });
   ```

### 4.2. Quy trình Cưỡng chế Ngắt Kết nối khi `POST /api/auth/logout-all`
```mermaid
sequenceDiagram
    autonumber
    actor Player as Huấn luyện viên (Thiết bị A)
    participant Server as Express Server (HTTP Route)
    participant SocketRegistry as Active Socket Registry (In-Memory)
    participant FirebaseAuth as Firebase Auth (Admin SDK)
    participant SocketB as Socket.IO Client (Thiết bị B)

    Player->>Server: POST /api/auth/logout-all (Kèm Cookie poke.sid & CSRF Token)
    Note over Server: 1. Xác thực Session Cookie & CSRF Token -> Lấy decoded.uid
    
    Server->>FirebaseAuth: 2. admin.auth().revokeRefreshTokens(decoded.uid)
    Note over FirebaseAuth: Cập nhật validSince của UID -> Vô hiệu hóa cookie cũ
    
    Server->>SocketRegistry: 3. activeSocketsByUid.get(decoded.uid)
    alt Có các Socket đang kết nối cho UID này
        loop Từng socket đang hoạt động
            Server->>SocketB: socket.emit("AUTH_REVOKED", { message: "Phiên đăng nhập đã bị thu hồi từ xa." })
            Server->>SocketB: socket.disconnect(true) // Cưỡng chế ngắt kết nối TCP/Transport
        end
        Note over SocketRegistry: Xóa UID khỏi registry
    end

    Server->>Player: 4. Set-Cookie: poke.sid=; Max-Age=0 + HTTP 200 OK
```

### 4.3. Xử lý khi Client Cố gắng Kết nối lại (Reconnection Handling)
- Khi bị ngắt kết nối bằng `socket.disconnect(true)`, client Socket.IO theo mặc định sẽ kích hoạt cơ chế tự động kết nối lại (Auto-reconnect).
- Lần kết nối lại này bắt buộc phải thực hiện lại quy trình Handshake `io.use()`.
- Trong `io.use()`: Server gọi `admin.auth().verifySessionCookie(sessionCookie, true /* checkRevoked */)`.
- Do `revokeRefreshTokens` đã cập nhật mốc `validSince`, Firebase Admin SDK lập tức ném lỗi:
  `auth/session-cookie-revoked: The Firebase session cookie has been revoked.`
- Middleware `io.use()` bắt lỗi này và từ chối handshake: `return next(new Error("UNAUTHORIZED"))`. Kết nối bị chặn đứng hoàn toàn.

### 4.4. Hành vi khi Server Khởi động lại (Server Restart) & Cân nhắc Đa Thực thể (Multi-Instance)
1. **Khi Server khởi động lại (Server Restart)**:
   - Bảng `activeSocketsByUid` trong bộ nhớ bị xóa sạch.
   - Toàn bộ kết nối Socket hiện có đều bị ngắt do tiến trình node.js dừng lại.
   - Khi client tự động kết nối lại vào server mới, handshake `io.use()` kiểm tra cookie. Do trạng thái revoked được lưu bền vững trên Firebase Auth (`validSince`), cookie bị thu hồi trước khi server restart vẫn tiếp tục bị từ chối 100%.
2. **Kiến trúc Đa Thực thể (Clustered / Multi-Instance Architecture)**:
   - Hiện tại, Poké-Engine là ứng dụng chạy trên một tiến trình Express duy nhất (Single-Process on Port 3000). Cơ chế In-Memory Registry `activeSocketsByUid` đảm bảo chính xác 100% mà không cần thêm phụ thuộc bên ngoài.
   - *Định hướng mở rộng tương lai*: Nếu triển khai nhiều server instance chạy song song phía sau Load Balancer, một sự kiện `logout-all` trên Instance A cần ngắt socket trên Instance B. Lúc đó, giải pháp chuẩn là sử dụng kênh Pub/Sub của Redis (Redis Pub/Sub) hoặc `socket.io-redis` adapter để phát lệnh ngắt socket xuyên instance. **Tuyệt đối không chuyển Socket.IO sang Firebase**.

---

## 5. THIẾT KẾ CSRF BẢO MẬT: HMAC-SIGNED SESSION-BOUND CSRF TOKEN

> [!IMPORTANT]
> **ĐÁNH GIÁ LỰA CHỌN MÔ HÌNH CSRF**:  
> - **Mô hình A (Synchronizer Token gắn với Server Session DB)**: Đòi hỏi server phải lưu trữ bảng session trên DB/Redis. Điều này đi ngược lại mục tiêu chuyển sang Firebase Stateless Session Cookie.  
> - **Mô hình B (HMAC-SHA256 Signed Double-Submit Cookie gắn với Session/UID)**: Hoàn toàn phi trạng thái (Stateless), an toàn tuyệt đối trước nguy cơ giả mạo token và tấn công chéo tài khoản (Cross-Account Token Injection).  
> 👉 **QUYẾT ĐỊNH**: Áp dụng **Mô hình B (HMAC-Signed Session-Bound CSRF Token)**.

### 5.1. Cấu trúc và Thuật toán Ký Token CSRF
Token CSRF được cấu tạo từ 4 phần phân tách bởi dấu chấm (`.`):
```
csrfToken = `${nonce}.${timestamp}.${scope}.${signature}`
```
- `nonce`: Chuỗi ngẫu nhiên 16 bytes hex sinh từ `crypto.randomBytes(16).toString('hex')`.
- `timestamp`: Thời điểm phát hành token (Epoch ms).
- `scope`:
  - Với người dùng đã đăng nhập: `uid` của người dùng (ràng buộc chặt chẽ với Session Cookie `poke.sid`).
  - Với khách chưa đăng nhập (trên trang Login/Register): chuỗi `"anon"`.
- `signature`: Chữ ký mật mã HMAC-SHA256:
  ```javascript
  signature = crypto
      .createHmac("sha256", process.env.CSRF_SECRET)
      .update(`${nonce}:${timestamp}:${scope}`)
      .digest("hex");
  ```

### 5.2. Quy trình Xác minh Token CSRF (Verification Algorithm)
Khi nhận một request thay đổi trạng thái (`POST`, `PUT`, `DELETE`):
1. **Kiểm tra Origin / Referer (Lớp 1)**:
   - Đọc header `Origin` (hoặc `Referer`). So khớp với danh sách Whitelist Allowed Origins (`http://localhost:3000`, `http://127.0.0.1:3000`). Nếu không khớp hoặc bị thiếu -> Từ chối với **HTTP 403 Forbidden** (`CSRF_ORIGIN_INVALID`).
2. **Kiểm tra Token CSRF (Lớp 2)**:
   - Đọc cookie `poke.csrf` và header tùy biến `x-csrf-token`.
   - Cả hai giá trị bắt buộc phải tồn tại và **phải bằng nhau từng ký tự** (Double-Submit Check).
   - Tách token thành `nonce`, `timestamp`, `scope`, `signature`.
   - Kiểm tra hạn sử dụng: `Date.now() - parseInt(timestamp, 10) < 24 * 60 * 60 * 1000` (Token có hiệu lực tối đa 24 giờ).
   - Tính toán lại chữ ký HMAC kỳ vọng với `process.env.CSRF_SECRET` và so sánh an toàn thời gian cố định: `crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedSignature, 'hex'))`.
   - **Ràng buộc danh tính (Session-Binding Check)**:
     - Với các request có xác thực (mang session cookie `poke.sid`): Giải mã `poke.sid` lấy `decoded.uid`.
     - Bắt buộc `scope === decoded.uid`.
     - **Tác dụng bảo mật**: Kẻ tấn công không thể lấy token CSRF của tài khoản A để chèn vào request của tài khoản B (ngăn chặn 100% Cookie Tossing / Cross-Account CSRF).

### 5.3. Xử lý Login CSRF và Logout CSRF
1. **Login & Register CSRF**:
   - Khi chưa đăng nhập, client nhận token CSRF có `scope = "anon"`.
   - Khi gửi `POST /api/auth/login` hoặc `POST /api/auth/register`, client gửi kèm header `x-csrf-token`.
   - Middleware xác minh chữ ký HMAC với `scope = "anon"`, đảm bảo form đăng nhập không bị tự động submit từ một website độc hại bên thứ ba (Login CSRF Protection).
   - Sau khi đăng nhập thành công, server lập tức **xoay vòng token (Token Rotation)**: phát hành token CSRF mới mang `scope = user.uid`.
2. **Logout CSRF**:
   - `POST /api/auth/logout` và `POST /api/auth/logout-all` bắt buộc phải vượt qua kiểm tra Origin và CSRF Token mang `scope = user.uid`. Ngăn chặn website độc hại lừa trình duyệt người chơi gửi request đăng xuất ngoài ý muốn.

### 5.4. Cookie Flags
- `poke.sid` (Session Cookie): `httpOnly: true`, `secure: process.env.NODE_ENV === "production"`, `sameSite: "lax"`, `path: "/"`, `maxAge: 7 ngày`.
- `poke.csrf` (CSRF Cookie): `httpOnly: false` (cho phép script client đọc để gắn vào header `x-csrf-token`), `secure: process.env.NODE_ENV === "production"`, `sameSite: "lax"`, `path: "/"`, `maxAge: 7 ngày`.

---

## 6. PHÂN LOẠI CHỨNG CỨ SYNTHETIC EMAIL VÀ ĐẶC TẢ KIỂM THỬ TRÊN EMULATOR

> [!CAUTION]
> **ĐÍNH CHÍNH TÍNH TRUNG THỰC CỦA CHỨNG CỨ (EVIDENCE CORRECTION)**:  
> Kết quả kiểm tra ở bản trước `validator.isEmail("tester01@player.poke-engine.internal") === true` chỉ chứng minh rằng chuỗi ký tự thỏa mãn regex cú pháp trong mã nguồn thư viện Firebase Admin.  
> **Điều này CHƯA CHỨNG MINH rằng dịch vụ Firebase Authentication và Auth Emulator chấp nhận tạo tài khoản và cho phép đăng nhập bằng domain `.internal`**.  
> Do đó, tính chấp thuận của domain synthetic email hiện được phân loại chính xác là:  
> **`PENDING (GIẢ THUYẾT KỸ THUẬT CHỜ XÁC MINH QUA INTEGRATION TEST TRÊN EMULATOR)`**.

### 6.1. Kịch bản Kiểm thử Tích hợp 9 Bước trên Firebase Auth Emulator
Kịch bản này bắt buộc phải chạy thật trong Giai đoạn 2 (Phase 2 Integration Testing) để chứng minh giả thuyết:

```javascript
/**
 * Kịch bản kiểm thử: test_synthetic_email_emulator_integration.js
 * Môi trường: Bắt buộc cô lập 100% trên Loopback Emulator
 */
```
1. **Bước 1 (Loopback Setup)**: Thiết lập `process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099"`. Xác minh cổng 9099 đang lắng nghe trên loopback cục bộ.
2. **Bước 2 (Create Synthetic User)**: Gọi `admin.auth().createUser({ email: "tester01@player.poke-engine.internal", password: "Password123!" })`. Ghi nhận `uid`.
3. **Bước 3 (Verify User Exists)**: Gọi `admin.auth().getUser(uid)`, kiểm tra `userRecord.email === "tester01@player.poke-engine.internal"`.
4. **Bước 4 (REST API Sign-In)**: Gửi HTTP POST tới `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-api-key` với body `{ email: "tester01@player.poke-engine.internal", password: "Password123!", returnSecureToken: true }`.
5. **Bước 5 (Receive ID Token)**: Kiểm tra HTTP response status 200, trích xuất `idToken` và `localId === uid`.
6. **Bước 6 (Verify ID Token)**: Gọi `admin.auth().verifyIdToken(idToken)`, kiểm tra `decoded.uid === uid`.
7. **Bước 7 (Create Session Cookie)**: Gọi `admin.auth().createSessionCookie(idToken, { expiresIn: 604800000 })`. Nhận `sessionCookie`.
8. **Bước 8 (Verify Session Cookie)**: Gọi `admin.auth().verifySessionCookie(sessionCookie, true)`, xác nhận cookie hợp lệ và không bị thu hồi.
9. **Bước 9 (Cleanup)**: Gọi `admin.auth().deleteUser(uid)` để dọn dẹp môi trường test.

---

## 7. MA TRẬN TIÊU CHÍ NGHIỆM THU KIỂM THỬ (TEST ACCEPTANCE MATRIX)

Bảng ma trận phân biệt rõ ràng giữa các bài test **ĐÃ CHẠY THỰC TẾ (EXECUTED/PASS)** và các bài test **MỚI LÀ KẾ HOẠCH CHO GIAI ĐOẠN 2 (PLANNED/PENDING)**:

| Mã Test | Mô tả kịch bản kiểm thử | Dữ liệu đầu vào / Setup | Kết quả kỳ vọng & Trạng thái | Tiêu chí Đạt (PASS Criteria) | Tình trạng thực tế |
|---|---|---|---|---|---|
| **A1** | Kiểm tra phiên bản SDK & Node | SDK v14.5.0 trên Node v22.14.0 | Node Major 22, Admin SDK 14.5.0 | Khớp phiên bản, không ném cảnh báo không tương thích | **EXECUTED / PASS** (Exit 0) |
| **A2** | Singleton Lifecycle & Named App | `initializeFirebaseAdmin()` gọi 2 lần | Cùng 1 instance, named app cô lập | Trả về singleton reference giống nhau | **EXECUTED / PASS** (Exit 0) |
| **A6** | Offline Fail-Closed Behavior | Cổng giả lập offline `127.0.0.1:59123` | ECONNREFUSED và gRPC code 14 | Bắt trọn vẹn lỗi mạng thật, không dùng timer giả | **EXECUTED / PASS** (Exit 0) |
| **A7** | Quét Secret & Gitignore | Quét `BEGIN PRIVATE KEY`, `.gitignore` | Không chứa secret hardcode | Chặn file serviceAccount*.json | **EXECUTED / PASS** (Exit 0) |
| **A8** | 7 Bất biến cách ly Production | Thử cấu hình sai host, thiếu Emulator | 7/7 kịch bản từ chối kết nối | Dừng ngay lập tức, không rò rỉ ra Google Cloud | **EXECUTED / PASS** (Exit 0) |
| **A9** | MongoDB Auth Behavioral Invariant | Schema validation User model | Schema User validation hoạt động | Username có ký tự đặc biệt bị từ chối | **EXECUTED / PASS** (Exit 0) |
| **T-SYN** | Cú pháp synthetic email SDK | `validator.isEmail(...)` | Trả về `true` | Regex thư viện chấp nhận `.internal` | **EXECUTED / PASS** |
| **S1** | Saga: Hai đăng ký đồng thời 1 username | 2 request đồng thời gửi `username: "ash"` | 1 thành công (201), 1 bị từ chối (409) | Transaction Firestore tuần tự hóa chặn race condition | **PLANNED / PENDING** |
| **S2** | Saga: Compensation khi Firestore lỗi | Stub lỗi Firestore ở Bước 3 | HTTP 500. Auth user bị xóa sạch | `admin.auth().deleteUser(uid)` dọn sạch user mồ côi | **PLANNED / PENDING** |
| **S3** | Saga: Crash Recovery với PENDING quá hạn | Doc `registrationOperations` quá hạn lease | Request mới chiếm lại được username | Fencing lease ghi đè reservation mồ côi thành công | **PLANNED / PENDING** |
| **S4** | Saga: Retry với Idempotency Key | 2 request cùng `x-idempotency-key` | Cả 2 nhận HTTP 201 cùng 1 UID duy nhất | Trả về kết quả cũ, không tạo tài khoản thứ hai | **PLANNED / PENDING** |
| **SK1** | Socket: Logout-all khi 1 socket kết nối | 1 socket đang kết nối, gọi logout-all | Socket nhận event AUTH_REVOKED và bị ngắt | `activeSocketsByUid` ngắt kết nối vật lý ngay lập tức | **PLANNED / PENDING** |
| **SK2** | Socket: Logout-all khi nhiều socket kết nối | 3 tabs cùng 1 UID đang kết nối | Toàn bộ 3 sockets đều bị ngắt | Toàn bộ Set sockets của UID đều bị disconnect | **PLANNED / PENDING** |
| **SK3** | Socket: Handshake bằng cookie đã thu hồi | Kết nối mới bằng cookie sau logout-all | Handshake bị từ chối `UNAUTHORIZED` | `verifySessionCookie(..., true)` ném lỗi revoked | **PLANNED / PENDING** |
| **SK4** | Socket: Server restart + Reconnect | Restart server, client cũ gửi cookie revoked | Handshake bị từ chối `UNAUTHORIZED` | Firebase Auth vẫn giữ mốc `validSince` bền vững | **PLANNED / PENDING** |
| **SK5** | Socket: Socket của UID khác không bị ảnh hưởng | UID A logout-all, UID B đang kết nối | Socket của B vẫn hoạt động bình thường | Chỉ ngắt socket thuộc UID của A | **PLANNED / PENDING** |
| **C1** | CSRF: Thiếu Header x-csrf-token | POST state-changing không có header | HTTP 403 Forbidden (`CSRF_TOKEN_INVALID`) | Chặn đứng request thiếu token | **PLANNED / PENDING** |
| **C2** | CSRF: Token sai chữ ký HMAC | Header `x-csrf-token` bị sửa đổi ký tự | HTTP 403 Forbidden (`CSRF_TOKEN_INVALID`) | TimingSafeEqual phát hiện chữ ký không khớp | **PLANNED / PENDING** |
| **C3** | CSRF: Token từ tài khoản khác (Cross-Account) | Lấy token của UID A gửi kèm cookie của B | HTTP 403 Forbidden (`CSRF_TOKEN_INVALID`) | Kiểm tra ràng buộc `scope === decoded.uid` chặn đứng | **PLANNED / PENDING** |
| **C4** | CSRF: Origin không nằm trong Whitelist | Header `Origin: http://evil-site.com` | HTTP 403 Forbidden (`CSRF_ORIGIN_INVALID`) | Origin Middleware chặn trước khi đọc body/token | **PLANNED / PENDING** |
| **E-INT**| Emulator Synthetic Email 9-Step Test | Kịch bản 9 bước mục 6.1 trên Emulator | 100% 9 bước PASS | Tạo, đăng nhập REST, cấp cookie và xác minh thành công | **PLANNED / PENDING** |

---

## 8. PHÂN TÍCH RỦI RO KỸ THUẬT VÀ PHƯƠNG ÁN KIỂM SOÁT

1. **Rủi ro Synthetic Email bị Auth Emulator từ chối trong Integration Test**:
   - *Đánh giá*: Dù cú pháp RFC 5322 hợp lệ, nếu Auth Emulator có bộ lọc TLD cứng cấm đuôi `.internal`.
   - *Phương án dự phòng (Contingency Plan)*: Nếu bài test `E-INT` thất bại vì đuôi `.internal`, giải pháp thay thế ngay lập tức là chuyển sang domain giả lập có TLD phổ biến nhưng không có thật trên internet: ví dụ `${normalizedUsername}@player.poke-engine.internal.net` hoặc `${normalizedUsername}@local.pokeengine.test`.
2. **Rủi ro Memory Leak trong Socket Registry**:
   - *Kiểm soát*: Bắt buộc đăng ký sự kiện `socket.on("disconnect")` để xóa socket instance khỏi Set. Khi Set rỗng, xóa luôn key UID khỏi Map `activeSocketsByUid`.
3. **Rủi ro xung đột Contract `/api/auth/me` với `load.js`**:
   - *Kiểm soát*: Giữ nguyên 100% định dạng JSON response:
     `{ success: true, data: { user: { id: uid, username: "...", character: "..." } } }`
     hoàn toàn tương thích từng byte với [public/js/engine/load.js#L275-L283](file:///d:/cc/Poke-Engine/public/js/engine/load.js#L275-L283).

---

## 9. KẾT LUẬN & TRẠNG THÁI NGHIỆM THU

**KẾT LUẬN THIẾT KẾ**: **`DESIGN READY FOR FINAL APPROVAL`**

> [!IMPORTANT]
> **CAM KẾT TUÂN THỦ AGENTS.MD CONSTITUTION**:
> - Tài liệu này được cập nhật độc lập tại `tasks/TASK_1_4_2_AUTHENTICATION_AND_FIRESTORE_DESIGN.md`.
> - **KHÔNG CÓ BẤT KỲ DÒNG SOURCE CODE HAY FILE CẤU HÌNH NÀO TRONG REPOSITORY BỊ THAY ĐỔI.**
> - **KHÔNG CÓ BẤT KỲ LỆNH GIT MUTATION NÀO ĐƯỢC CHẠY.**
> - AI đã dừng lại hoàn toàn và chờ người dùng phê duyệt thiết kế R3 trước khi tiến hành Phase 2!
