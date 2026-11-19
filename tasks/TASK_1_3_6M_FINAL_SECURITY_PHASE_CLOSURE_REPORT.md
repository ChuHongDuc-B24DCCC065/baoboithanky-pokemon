# Task 1.3.6M — Final Security Phase Closure Audit

**Phạm vi:** Đối chiếu tài liệu K, L, L.1 và OWNER-I-1 đến OWNER-I-7.  
**Loại rà soát:** Chỉ đọc tài liệu; không chạy kiểm thử, không xem lại toàn bộ source, không thay đổi các báo cáo đầu vào.  
**Kết luận đề xuất:** Có thể đóng **giai đoạn thiết kế và hardening harness PoC**, với các giới hạn bên dưới được giữ nguyên. Không thể gọi toàn bộ Task 1.3.6 là “security completed”, cũng chưa đủ bằng chứng để triển khai production.

## 1. Tóm tắt tiến trình Task 1.3.6

- Các báo cáo 1.3.6B–I lần lượt rà soát tính toàn vẹn xóa tài khoản, auth/session, race condition, socket, bootstrap và các trường hợp bảo mật còn thiếu. Chúng cung cấp đầu vào thiết kế, không phải bằng chứng implementation trên Firebase.
- Task J tổng hợp các lựa chọn OWNER-I-1 đến OWNER-I-7 và kế hoạch PoC. Tại thời điểm tài liệu J, các quyết định còn ghi `PENDING_OWNER_APPROVAL`.
- Task K ghi nhận owner đã chấp thuận bảy quyết định **ở cấp kiến trúc**, làm baseline cho PoC; K nêu rõ sự chấp thuận đó không tự cấp quyền implementation hay triển khai.
- Task L báo cáo PoC ban đầu. Tuy nhiên, các PASS trong L có phần dựa trên logic harness mô phỏng; một số diễn giải vượt quá bằng chứng được ghi trong báo cáo/evidence. Không dùng các PASS này như xác nhận Firebase, Firestore hoặc tính nguyên tử thực.
- Task L.1 harden harness, thay kết quả PASS gán sẵn bằng assertion và phân loại lại giới hạn. Hai lần chạy thường kết thúc mã 0 với 17 `SIMULATION_PASS`, 2 `BLOCKED`, 1 `UNVERIFIED`; lần chèn lỗi có chủ đích kết thúc mã 1. Kiểm tra Firebase Emulator và Socket.IO loopback không chạy được, Redis đa instance chưa được kiểm chứng.

Các trạng thái trên được tổng hợp từ tài liệu. Báo cáo này không chạy lại test và không xác nhận hành vi runtime mới.

## 2. Đối chiếu quyết định OWNER-I-1 đến OWNER-I-7

K là nguồn baseline cuối cùng cho trạng thái phê duyệt; các nhãn `PENDING_OWNER_APPROVAL` trong J là trạng thái tại thời điểm lập kế hoạch và đã được K cập nhật.

| Quyết định | Thiết kế được owner chấp thuận theo K | Mức bằng chứng hiện có sau L.1 |
|---|---|---|
| **I-1 — Snapshot authorization** | Event đã qua authorization trước logout có thể hoàn tất hoặc tới sau response; không cam kết strict logout barrier. | `SIMULATION_PASS` không chứng minh ordering/transport thật. Hành vi packet đã admitted rồi giao trễ vẫn là giới hạn thiết kế; chưa được xác minh runtime. |
| **I-2 — Sender và recipient gate** | Mọi gameplay event đã xác thực phải kiểm sender và từng recipient; room chỉ dùng tìm candidate, không cấp quyền; gửi targeted emit. | Logic gate có assertion mô phỏng. Socket.IO loopback bị `BLOCKED`; Redis/multi-instance `UNVERIFIED`. |
| **I-3 — Fail closed** | Firestore lỗi, timeout, thiếu/unknown state thì deny; không TTL cache hoặc room broadcast fallback. | Một số nhánh fail-closed được mô phỏng. Chưa có Firebase/Firestore Emulator để chứng minh lỗi đọc, timeout, transaction hoặc fallback thật. |
| **I-4 — Lease fencing** | Hết lease chỉ cho phép takeover; fencing có hiệu lực khi transaction takeover commit epoch/token mới. Không tuyên bố hard fence chỉ vì đồng hồ qua `lockedUntil`. | Takeover/token và stale-write được mô phỏng trong Map. Chưa chứng minh transaction contention/retry, commit fencing hoặc worker chạy song song thật. |
| **I-5 — Logout/deletion race** | Thứ tự commit quyết định kết quả: deletion lock trước thì workflow tiếp tục; logout trước thì deletion phải đọc lại và abort. Cùng transaction kiểm session/control/job khi khóa xóa. | Chưa chạy Firestore transaction race. Harness tuần tự không chứng minh serialization hay retry semantics. |
| **I-6 — SDK** | Firebase Admin Node SDK là candidate đầu tiên; chưa chọn/pin/cài version cho dự án. Runtime, compatibility và PoC phải được xác minh trước. | Chưa có SDK Firebase trong harness, production Node target chưa xác minh. Không có cơ sở tuyên bố SDK/runtime tương thích. |
| **I-7 — Logout completion boundary** | Logout thành công sau durable revocation commit, không đợi socket disconnect; phân biệt revocation với event đã admitted/đang transit. | Có mô phỏng trạng thái gate; chưa kiểm chứng durable revoke hoặc failure/retry giữa Auth, Firestore và socket trong runtime. |

## 3. Yêu cầu thiết kế đã được chốt

K cung cấp baseline thiết kế cho các điểm sau: authority tập trung ở account control/session/job; thiếu hoặc mâu thuẫn state thì deny; commit deletion lock tạo `DELETING` và job; các mutation bền vững phải kiểm tra lại tại commit, không chỉ dựa middleware; socket sender/recipient đều qua gate; targeted emit không broadcast fallback; logout/revocation khác physical disconnect; worker dùng lease cùng epoch/token; hoàn tất deletion cần xác minh Auth và toàn bộ dữ liệu Firestore đã catalog; Auth, Firestore và socket không được giả định là một transaction phân tán.

Đây là **quyết định thiết kế**, không chứng minh các luồng trên đã có trong ứng dụng.

## 4. Phân biệt thiết kế, PoC và production

| Lớp | Điều có thể kết luận | Điều không thể kết luận |
|---|---|---|
| **Kiến trúc được duyệt** | OWNER-I-1…7 được K ghi nhận là quyết định được owner chấp thuận ở mức kiến trúc. K xác định các bất biến và hướng xử lý lỗi/race. | Không đồng nghĩa phê duyệt implementation, không chứng minh giao thức/thư viện hoạt động đúng trong production. |
| **PoC/harness đã chạy** | L.1 ghi nhận các assertion mô phỏng thực chạy; 17 kết quả `SIMULATION_PASS`, hai `BLOCKED`, một `UNVERIFIED`; runner phát mã lỗi khác 0 khi assertion cố ý thất bại. | Map/set không phải Firestore/Auth; mô phỏng không chứng minh transaction atomicity, recursive deletion, distributed lease, hay production security. |
| **Production** | Theo baseline K và báo cáo L/L.1, Firebase Auth/Firestore/deletion worker chưa được triển khai; tài liệu K còn ghi MongoDB/Mongoose/connect-mongo trong source được khảo sát. | Không được tuyên bố Firebase security đã triển khai, production-ready, hay đã được xác nhận bằng runtime/integration tests. |

## 5. BLOCKED và UNVERIFIED

- **BLOCKED — Firebase Emulator/Firestore:** L.1 ghi harness không có Firebase SDK/emulator integration; vì vậy chưa kiểm chứng transaction, read/retry/freshness, Auth lifecycle, deletion cleanup hoặc race trên Firestore/Auth.
- **BLOCKED — Socket.IO loopback:** L.1 ghi client nhận `xhr poll error`/HTTP 503 trong môi trường chạy; test transport không được tính PASS. Các assertion gate độc lập dùng mock chỉ là mô phỏng.
- **UNVERIFIED — Redis/multi-instance:** Chưa có adapter/Redis cluster hay nhiều server instance; routing, remote disconnect và failure behavior chưa được xác minh.
- **UNVERIFIED — Production runtime và SDK:** Node production chưa xác định; Firebase Admin SDK chưa được chọn/pin; exact API/transaction semantics chưa chứng minh.
- **UNVERIFIED — Vận hành thời gian và dữ liệu:** NTP bounds, read freshness, đầy đủ catalog dữ liệu cần xóa, IAM/Rules, topology, tải/latency/chi phí chưa có bằng chứng production.
- **OPEN QUESTION — auth_time 330 giây:** Baseline K quy định tuổi tối đa 300 giây và future skew 30 giây riêng biệt. L.1 giữ nguyên baseline đó; 330 giây không phải ngưỡng được chấp thuận mới.

## 6. Chất lượng bằng chứng và điểm cần đọc thận trọng

Không sử dụng các khẳng định mạnh trong L nếu bằng chứng chi tiết không hỗ trợ. Ví dụ, báo cáo L ghi B1 có hai socket được admit nhưng evidence nêu `deliveredPackets: 1`; L gọi C1/C8 là transaction atomic trong khi PoC dùng Map; và nhóm A trình bày PASS harness dù Firebase Emulator bị chặn. L.1 đã nêu lại ranh giới: kết quả harness là `SIMULATION_PASS`, Firebase và loopback là `BLOCKED`, Redis multi-instance là `UNVERIFIED`. Do đó L.1 là nguồn phù hợp hơn để mô tả trạng thái kiểm chứng hiện tại, còn K là baseline thiết kế.

## 7. Rủi ro còn tồn tại

1. Thiết kế commit-boundary fencing, deletion recovery và account state chưa được kiểm chứng trên Firestore/Auth thật hoặc Emulator.
2. Mô phỏng tuần tự không bao phủ transaction retries, contention, process crash, worker overlap hay các side effect ngoài transaction.
3. Socket recipient delivery, handshake/reconnect và đa instance chưa được kiểm chứng qua transport/adapter thực tế trong kết quả L.1.
4. Các giới hạn đã được owner chấp thuận vẫn có hiệu lực: event qua snapshot trước logout có thể tới sau response; không có strict barrier.
5. SDK/runtime, dữ liệu đầy đủ cần xóa, môi trường vận hành và chuyển đổi khỏi MongoDB vẫn chưa được chốt bằng bằng chứng triển khai.
6. Không có cơ sở để suy ra từ các kết quả PoC rằng toàn bộ bề mặt tấn công của sản phẩm đã được thẩm định.

Đây là danh sách rủi ro còn mở trong giai đoạn hiện tại, không phải đề xuất mở chuỗi task mới.

## 8. Quyết định đề xuất

### Có thể đóng giai đoạn thiết kế và harness PoC không?

**Có, có điều kiện về cách ghi trạng thái:** Có thể đóng giai đoạn thiết kế/harness như một mốc tài liệu, với K là baseline đã được duyệt và L.1 là kết quả harness có giới hạn rõ ràng. Việc đóng mốc này không nâng trạng thái BLOCKED/UNVERIFIED thành PASS.

### Những gì chưa được tuyên bố hoàn thành

- Không tuyên bố “Task 1.3.6 security completed” theo nghĩa bảo mật đã được kiểm chứng toàn diện.
- Không tuyên bố Firebase Auth/Firestore, transaction/write fencing, account deletion worker hoặc Socket.IO authorization đã triển khai trong production.
- Không tuyên bố PoC Firebase Emulator, Firestore concurrency, multi-instance Redis hoặc production readiness đã PASS.
- Không tuyên bố L chứng minh tính atomic hoặc delivery hoàn chỉnh; L.1 giới hạn bằng chứng ở mô phỏng assertion-backed và các phần thực sự chạy được.

### Điều kiện trước production implementation

Trước khi bắt đầu implementation, cần có phê duyệt riêng cho phạm vi triển khai và một tiêu chí review rõ ràng; xác định production Node/runtime cùng SDK/version tương thích; chốt các OPEN QUESTION ảnh hưởng policy (bao gồm cách xử lý tuổi `auth_time`); kiểm chứng transaction, fencing, deletion và Auth integration trên môi trường cô lập phù hợp; xác minh Socket.IO transport và cấu hình đa instance nếu sản phẩm dùng nhiều instance; cùng kế hoạch migration/coexistence và rollback cho dữ liệu MongoDB hiện hữu. Emulator PASS vẫn không thay thế xác nhận cấu hình IAM, vận hành và rollout production.

## 9. Trạng thái Git và phạm vi

Trước khi tạo báo cáo này, `git status --short --untracked-files=all` cho thấy nhiều file đã modified và untracked ở root, `docs/`, `server/`, `tasks/` và PoC L. Các thay đổi đó được bảo toàn; chúng không được xem là bằng chứng đã commit. Báo cáo này là file duy nhất được tạo trong Task M. Không chạy test và không thực hiện thao tác làm thay đổi Git metadata.

**Kết luận cuối:** Đề xuất đóng mốc **thiết kế + harness PoC** với các trạng thái và giới hạn được ghi rõ. Giữ các mục BLOCKED/UNVERIFIED như điều kiện chưa hoàn tất; không gọi toàn bộ Task 1.3.6 là hoàn tất bảo mật và không bắt đầu production implementation nếu chưa có phê duyệt riêng cùng bằng chứng cần thiết.
