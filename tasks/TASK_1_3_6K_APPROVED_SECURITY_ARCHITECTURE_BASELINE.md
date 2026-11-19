# Task 1.3.6K – Approved Security Architecture Baseline

**Dự án:** Poké-Engine  
**Loại:** Baseline thiết kế được owner duyệt và đặc tả PoC, DESIGN ONLY  
**Ngày:** 2026-11-09  
**Kết luận:** **READY FOR POC DESIGN REVIEW**  
**Owner decisions:** APPROVED theo chỉ thị Task K, chỉ cho architecture.  
**PoC:** NOT EXECUTED. **Implementation:** NOT AUTHORIZED.

## 1. Executive Summary

K ghi nhận OWNER-I-1 đến OWNER-I-7 đã được chủ dự án chấp thuận theo khuyến nghị J. Approval này không cấp quyền cài SDK, sửa code, chạy PoC hoặc triển khai.

Baseline bảo mật:
- accountControls là nguồn quyết định lifecycle. authSessions là trạng thái từng thiết bị/session và generation. deletionJobs là intent/recovery. Thiếu hoặc mâu thuẫn dữ liệu thì deny.
- Deletion lock transaction commit làm DELETING có hiệu lực ngay cho HTTP, socket sender, socket recipient và reconnect. Không chờ worker revoke/disconnect. Physical disconnect là cleanup.
- Mọi gameplay event cần sender và recipient authorization. Room chỉ tạo candidate list; gửi targeted emit sau khi recipient gate qua. Snapshot authorization được owner chấp nhận: event được gate trước logout có thể hoàn tất/gửi trễ. Không có strict logout barrier.
- Deletion ACTIVE phải đọc session/control/job và ghi DELETING + job trong cùng transaction. Commit order quyết định race với logout.
- Job statuses giữ PENDING/PROCESSING/FAILED/COMPLETED. reviewRequired là flag, không phải status. COMPLETED chỉ khi cleanup/Auth evidence đủ và cùng final transaction ghi control DELETED.
- Lease expiry chỉ mở takeover; fencing thật khi takeover transaction commit epoch/token mới. Không claim hard deadline tại lockedUntil.
- Local Node được kiểm tra v22.14.0; không chứng minh production runtime. Firebase SDK chưa cài/pin; Node 22+ là điều kiện candidate, không phải lựa chọn version.
- Không chạy test, PoC, emulator, benchmark, Auth, Firestore hay MongoDB.

## 2. Approved Owner Decision Register

Theo chỉ thị Task K, các quyết định dưới đây được ghi APPROVED ở mức kiến trúc; không đồng nghĩa implementation được duyệt.

| ID | Quyết định đã duyệt | Baseline áp dụng |
|---|---|---|
| OWNER-I-1 | Chấp nhận snapshot authorization. Event đã được cấp quyền trước logout có thể hoàn tất/gửi sau response. Strict barrier không thuộc scope. | Không tuyên bố logout thu hồi event đã admitted. |
| OWNER-I-2 | Mọi authenticated gameplay event có sender + recipient authorization. Room không cấp quyền; ưu tiên targeted emit. | Gate mỗi recipient/session. |
| OWNER-I-3 | Firestore lỗi/timeout/missing/unknown state thì deny; không room broadcast fallback, không TTL cache. | Fail closed mọi HTTP/socket authorization. |
| OWNER-I-4 | Lease expiry chỉ cho phép takeover; fencing khi takeover epoch/token commit. | Không claim worker cũ bị vô hiệu ngay tại lockedUntil. |
| OWNER-I-5 | Transaction commit order quyết định logout/deletion. Deletion-first tiếp tục; logout-first làm deletion kiểm lại và abort. | Session/control/job được đọc trong cùng deletion transaction. |
| OWNER-I-6 | Firebase Admin Node SDK là candidate đầu; chưa pin/cài. | Xác minh runtime, compatibility và PoC trước chọn version. |
| OWNER-I-7 | Logout thành công sau durable revocation commit; không chờ disconnect. | Phân biệt revoke với packet đã admitted/đang transit. |

Owner approval trong yêu cầu K chỉ chốt các policy này. PoC pass và implementation vẫn chưa được cấp phép.

## 3. Consolidated Architecture

### 3.1 Authority documents

- accountControls/{uid}: lifecycle status; chỉ ACTIVE được game access. Missing, DELETING, DELETED hoặc mismatch đều deny.
- authSessions/{sessionHash}: UID, session status, expiry, generation theo từng phiên.
- deletionJobs/{uid}: workflow/checkpoint/lease. Job tồn tại hoặc bất thường thì fail-closed.
- Profile/username không thay thế account control; profile có thể thiếu nhưng deletion intent vẫn bền vững.
- Firebase Admin SDK là server trust boundary; Admin writes phải qua narrow services và fenced transactions. Security Rules không bảo vệ nhầm lẫn từ Admin SDK.
- Theo D và repository, Firebase Auth/Firestore/deletion worker chưa được triển khai; nội dung này là thiết kế.

### 3.2 Common authorization invariant

Mọi HTTP mutation, socket sender, socket recipient, handshake và reconnect phải kiểm:
1. Identity do server xác minh, không lấy UID/session/generation từ client payload.
2. Session ACTIVE, sessionHash và UID đúng, chưa hết hạn theo server-side policy.
3. Session generation bằng accountControls.sessionGeneration.
4. Account control tồn tại và ACTIVE.
5. Không có deletion job hoặc unresolved state mismatch.
6. Dependency lỗi/timeout/unknown semantics thì deny.

Durable write phải lặp lại control/job check trong transaction commit cùng mutation. Middleware, handshake, event preflight và disconnect chỉ từ chối sớm/dọn kết nối; không thay commit fence.

### 3.3 State transitions

- Bootstrap Bearer sau email verification: PROVISIONING → ACTIVE chỉ qua finalize transaction profile+username+control.
- Deletion lock: ACTIVE/PROVISIONING/missing theo credential path hợp lệ → DELETING + job cùng transaction.
- Final verify: DELETING → DELETED và job → COMPLETED cùng final transaction.
- Không có DELETED → ACTIVE.
- Job chỉ PENDING, PROCESSING, FAILED, COMPLETED. reviewRequired/errorCode là metadata; FAILED vẫn khóa account.

## 4. Immediate Revocation Design

Deletion lock transaction đọc account control, job, và với ACTIVE account session; predicate kiểm tra UID/hash/status/generation/session freshness/control ACTIVE/job absent. Trong cùng transaction, đặt control DELETING, tăng sessionGeneration/lifecycle fence theo schema, tạo job PENDING và cập nhật profile DELETING nếu profile tồn tại. Không có Auth/network/socket call trong callback.

Sau khi transaction commit:
- **HTTP:** middleware đọc control để reject sớm. Mọi durable HTTP transaction đọc cùng control/job và chỉ ghi khi ACTIVE. Write commit trước lock nằm trước lock theo serialization và cần được cleanup; write cạnh tranh retry sau lock thì thấy DELETING và abort.
- **Socket sender:** gate snapshot sau lock thấy DELETING/generation mismatch/job và drop.
- **Socket recipient:** gate snapshot sau lock loại socket khỏi allow-list.
- **New handshake/reconnect:** kiểm tra registry + control + generation + job lại; cookie hợp lệ một mình không đủ.
- **Disconnect/Auth revoke:** thực hiện sau lock, best effort. Failure không mở lại quyền.

Logical revocation là state decision tại transaction/snapshot; physical socket disconnection là cleanup. Event gate trước lock có thể được gửi trễ theo OWNER-I-1.

## 5. Socket Sender/Recipient Authorization

### 5.1 Mapping

Server gắn identity immutable sau handshake:
- socketId → UID + sessionHash + sessionGeneration;
- sessionHash → một hoặc nhiều socket IDs;
- UID → một hoặc nhiều sessions/sockets.

Một UID nhiều thiết bị có nhiều session; một session có thể nhiều tab/socket. Mapping chỉ tìm candidate/cleanup, không phải authority. Client không gửi identity để server tin.

### 5.2 Flow

1. Sender gửi action/payload.
2. Sender authorization kiểm session/control/generation/job.
3. Room/game scope tạo candidate recipients, nhưng room membership không cấp quyền.
4. Server lấy UID/sessionHash/socketId tuples từ registry có thẩm quyền đủ tin cậy. Registry lỗi/thiếu thì không gửi.
5. Một authorization snapshot gate đánh giá sender và recipients: session ACTIVE, owner/hash/generation khớp, control ACTIVE, no job, session chưa expired.
6. Tạo allow-list socket IDs đã qua gate.
7. Targeted emit tới allow-list; không dùng room-wide broadcast làm fallback.
8. Lỗi Firestore, timeout, batch timeout, unknown state: drop batch/recipient. Không reuse cache TTL.
9. Authorization decision không phải transport delivery acknowledgement. Snapshot hợp lệ trước logout có thể tới trễ.

Một session revoked làm mọi sockets mang sessionHash đó deny. Session khác của UID được kiểm độc lập. Global generation bump/deletion chặn mọi session cũ.

### 5.3 Multi-instance/Socket.IO

Package lock xác minh socket.io 2.3.0; không nâng cấp trong baseline. Adapter hoặc distributed registry chỉ vận chuyển candidate/target/disconnect, không cấp quyền. Adapter/registry unavailable thì không broadcast fallback. Exact adapter release/API, remote targeted emit/disconnect, sticky-session và multi-instance behavior phải test trên Socket.IO 2.3.0; hiện UNVERIFIED. Không suy API v3/v4 sang v2.

## 6. Deletion and Logout Atomicity

### 6.1 Active deletion

ID/session verification, reauthentication, CSRF/Origin, email checks thực hiện ngoài Firestore transaction; đây là xác thực request, không thay atomic session recheck.

Deletion transaction đọc trước mọi write:
- authSessions/{sessionHash};
- accountControls/{uid};
- deletionJobs/{uid};
- profile nếu cần đổi status.

Predicate: session tồn tại, UID đúng, backend tính đúng hash/path, status ACTIVE, session generation khớp control, còn hạn theo server-side policy; control ACTIVE, không globalRevokePending; job vắng mặt. Profile absence không cản delete intent nếu account path hợp lệ.

Cùng transaction: control → DELETING, tăng generation fence, job → PENDING, profile → DELETING nếu tồn tại. Lock commit là deletion acceptance boundary.

### 6.2 Logout race

| Transaction commit trước | Kết quả |
|---|---|
| Logout revoke session | Deletion txn retry thấy REVOKED/generation mismatch; abort, không tạo job. |
| Deletion lock + job | Deletion được khởi tạo khi session hợp lệ tại ordering point; tiếp tục workflow. Logout vẫn revoke idempotently và clear cookie. |
| Conflict/retry exhaustion/Firestore unavailable | Fail closed; không báo deletion accepted nếu lock chưa commit. Không dùng preflight cũ. |
| Job đã tồn tại/control đã DELETING | Idempotent status nếu cùng UID/job; không duplicate, không mở ACTIVE. Mismatch → FAILED + reviewRequired + audit. |

### 6.3 Logout semantics

- **Current-device:** txn kiểm UID/session hash/control generation; đặt session REVOKED. Nếu đã revoked/missing/expired, trả idempotent clear-cookie response; không lộ account existence. Không tăng global generation. Durable commit trước success. Sau đó disconnect best effort.
- **Global:** tăng sessionGeneration và đặt globalRevokePending trong txn; mọi session cũ deny ngay. Firebase revokeRefreshTokens và disconnect sau đó. Auth failure giữ pending/gate đóng theo F.
- **Deletion:** DELETING + generation fence chặn mọi sessions; worker revoke/disconnect không phải điều kiện tức thời.
- Cookie browser clearing không phải global revoke. Disconnect failure không quyết định quyền.

## 7. Firebase Auth/Firestore Recovery

### 7.1 Transaction boundaries

**Trong Firestore transactions:** bootstrap finalize; durable game mutation fence; current logout registry revoke; global generation/pending; deletion lock/job; worker claim/renew/progress/chunk mutations; final COMPLETED+DELETED.

**Ngoài transactions:** Firebase token/session verification, getUser/email checks, credential reauth, recursive discovery queries, Firebase Auth revoke/delete, Socket disconnect/PubSub, logging/metrics, external time/health checks. Không có distributed ACID transaction Auth+Firestore và không side effect trong retriable callback.

### 7.2 Recovery checkpoints

| Phase | Công việc/evidence | Recovery |
|---|---|---|
| DISCOVER_DATA | Enumerate catalogued UID roots/subcollections/reservations; save phase/cursor | Requery/rescan idempotently |
| DELETE_GAME_DATA | Recursive bounded chunks | Chunk + lease validation + progress transaction; repeat safely |
| DELETE_PROFILE | Delete profile if present | Missing profile không chứng minh descendants sạch |
| RELEASE_USERNAMES | Paginate ownerUid, reread ownership before delete | Repeat until query and separate verification are empty |
| VERIFY_FIRESTORE_EMPTY | Verify every catalogued root/subcollection, profile absent, reservations zero | Unknown/incomplete root → FAILED + reviewRequired |
| REVOKE_SESSIONS_AND_SOCKETS | Auth revoke, session registry updates, disconnect | External/retryable; logical DELETING already protects |
| DELETE_AUTH_USER | Admin delete after Firestore cleanup | user-not-found idempotent for this job UID; record sanitized result |
| VERIFY_AND_COMPLETE | Auth absent + Firestore catalog empty + profile/reservations absent | Final txn writes job COMPLETED and control DELETED atomically |

Idempotency key: UID + jobId + phase + stable page/chunk identity; never credentials. Advance checkpoint only after corresponding Firestore transaction commits. Retry transient errors with bounded backoff; after cap FAILED. Unknown roots, ownership mismatch, inconsistent control/job or unprovable result → FAILED + reviewRequired. Admin retry requires verified role, actor/reason audit, cause resolved and no live lease.

Special recovery:
- Auth user already deleted, Firestore incomplete: trusted job UID continues cleanup; Auth absence alone is not completion.
- Partial Firestore cleanup/crash: re-read checkpoint or rescan; keep DELETING.
- Old/new worker overlap: every Firestore mutation verifies current token/epoch. After takeover commit old write aborts. Auth call in flight cannot be canceled; idempotent/reconcile.
- FAILED retains DELETING.
- COMPLETED/control mismatch is anomaly: deny, audit/reconcile; never ACTIVE.
- Username reservation removed/profile remains: continue profile cleanup.
- Profile absent/reservation remains: query ownerUid, paginated conditional deletion, verify zero.
- Lease expiry only takeover eligibility; epoch/token commit is fence point.

**COMPLETED evidence:** Auth user absent; all catalogued Firestore roots and descendants verified absent; profile absent; ownerUid reservation query verified empty; current lease valid; final transaction atomically changes job to COMPLETED and control to DELETED. Missing profile or first empty page is insufficient.

## 8. Session and Trusted Time

| Time | Source/use | Trust boundary |
|---|---|---|
| auth_time | Firebase signed ID token, Unix seconds; real credential sign-in/reauth | ≤300 seconds per H baseline, future skew ≤30s; server validates; not client input |
| iat | Firebase signed token issue time | Refresh can change iat without reauthentication; never replace auth_time |
| Session cookie exp | Firebase signed cookie | Admin verify; expiry distinct from revoke |
| authSessions.expiresAt | Firestore server timestamp/value | Registry expiry; exact SDK comparison/margin to verify |
| Firestore snapshot/readTime | Service snapshot for gates | Strong/current behavior must be proven in pinned SDK |
| Firestore commit time | Service transaction ordering | Authority for ordering; not callback wall time |
| Backend UTC clock | Host UTC + NTP for auth_time freshness | Monitor drift; outside bound, sensitive operation fails closed |
| Worker UTC clock | NTP worker for lease eligibility | Estimate, not Firestore server time; no hard fence at expiry |
| Monotonic clock | Duration/timeouts | Not persisted timestamp or auth age |
| Client time | UI | Never used for security decisions |

Session expiry, revocation, generation, account state, snapshot, commit, and worker lease are separate. Exact SDK snapshot-time exposure and production NTP bounds remain UNVERIFIED.

## 9. SDK/Runtime Compatibility

### 9.1 Repository facts

- package.json has no engines field and no firebase-admin/@google-cloud/firestore dependency.
- Local shell reports Node v22.14.0; this is verified only for this environment, not deployment.
- package-lock resolves socket.io/socket.io-client 2.3.0, mongoose 8.24.8, connect-mongo 5.1.0, express-session 1.19.0.
- Source uses CommonJS require, Mongo/Mongoose persistence and session store. Task D says Firebase Auth/Firestore not implemented.
- No Firebase configuration or live service was accessed.

### 9.2 Candidate

Firebase Admin Node SDK is the approved first candidate, not selected/pinned. Official setup docs currently require Node.js 22+. Official release notes list Firebase Admin Node 14.5.0 (23 Sep 2026); v14 dropped Node 18/20 and changed legacy namespace support. Exact compatibility with this CommonJS app, Admin Firestore wrapper read-only transaction and transitive @google-cloud/firestore behavior must be verified. Do not force a whole-project ESM conversion; test modular entrypoint use incrementally.

Version selection criteria:
1. Confirm production Node runtime and build/deploy target.
2. Select exact supported Admin release and inspect pinned transitive Firestore package.
3. Verify wrapper exposes the needed read-only transaction and document-get consistency.
4. Verify default readTime/freshness, callback retry semantics for read-only vs read-write, error mapping, emulator support.
5. Record lockfile reproducibility and maintenance/security update policy.

Socket.IO remains 2.3.0. Adapter exact version/API for multi-instance must be tested against that server version; do not use newer API by assumption. MongoDB remains until migration acceptance and rollback evidence.

Official references: [Firebase Admin setup](https://firebase.google.com/docs/admin/setup), [Admin Node release notes](https://firebase.google.com/support/release-notes/admin/node), [Admin Firestore API](https://firebase.google.com/docs/reference/admin/node/firebase-admin.firestore), [Firestore transaction isolation](https://firebase.google.com/docs/firestore/transaction-data-contention), [Socket.IO v2 documentation](https://socket.io/docs/v2/), [Socket.IO 2.x compatibility notes](https://socket.io/docs/v4/migrating-from-2-x-to-3-0).

## 10. Final Security Invariants

| # | Invariant | Enforcement | PoC |
|---:|---|---|---|
| 1 | No HTTP mutation is valid when account is DELETING/DELETED/missing | Middleware + commit-boundary write fence | A, C |
| 2 | No new socket sender event is authorized when DELETING | Sender gate | A, B |
| 3 | No recipient receives event if recipient auth denies | Recipient allow-list + targeted emit | B |
| 4 | Room membership never substitutes for authorization | Candidate discovery separated from gate | B |
| 5 | Logout success only after durable revoke commit | Logout transaction | A, B |
| 6 | Logout/deletion order follows transaction commit | Shared session/control/job read sets | A, C |
| 7 | Generation mismatch always denies | Shared auth predicate | A, B |
| 8 | Firestore failure/unknown state fails closed | Gate error handling, no cache/fallback | A, B |
| 9 | Worker old token cannot write after takeover fencing commit | Epoch/token check in every worker txn | C, D |
| 10 | COMPLETED requires evidence for Auth absence and all Firestore data cleanup | Verify-all + final transaction | C |
| 11 | Client timestamps never decide auth/expiry/lease | Firebase/Firestore/server clocks | D |
| 12 | Unverified SDK/API is never claimed verified | SDK selection gate + explicit status | A, D |

## 11. PoC Specification

**Tất cả PoC: NOT EXECUTED.** Chỉ chạy sau task authorization riêng trên Firebase Emulator và test harness cô lập. Không dùng production credential/service/database. Thu evidence đã sanitize; không lưu token/PII.

### PoC A — Firestore Authorization Snapshot

**Mục tiêu:** chứng minh exact Admin SDK version đọc session/control/job theo coherent snapshot và xử lý race/fail closed.

**Chuẩn bị:** emulator project; seed session ACTIVE/control ACTIVE/no job; test barriers để interleave reads và concurrent writes; pin package trong branch/task được duyệt sau này.

| Case | Bước thử | Expected | PASS evidence | FAIL |
|---|---|---|---|---|
| A1 ACTIVE | Gate đọc ba documents | Allow nếu mọi predicate true | SDK/version, transaction mode, sanitized reads | Missing state vẫn allow |
| A2 REVOKED | Đặt session REVOKED rồi gate | Deny | Current session state observed | Reuse result cũ |
| A3 DELETING | Commit deletion lock | HTTP/socket gate deny | Control/generation trace | Auth path vẫn allow |
| A4 Job exists | Job tồn tại/control mismatch | Deny | Job state trace | Ignore job |
| A5 Concurrent logout | Interleave gate và revoke commit | Sau-revoke snapshot deny; concurrent result đúng snapshot contract | Transaction order + attempt trace | Mixed snapshot |
| A6 Concurrent deletion | Gate/write/deletion races | Commit order rõ; write after lock abort | Commit/retry logs | Preflight bypass |
| A7 Retry/ABORTED | Tạo contention/retry exhaustion | Exact SDK policy bounded; exhaustion deny | Attempts/errors, no repeated side effect | Fail-open/reuse failed result |
| A8 Unavailable | Inject Firestore unavailable/timeout | Deny, no emit/write | Sanitized error and deny outcome | Cache/broadcast fallback |

PASS chỉ khi exact version/mode/readTime/retry behavior được xác minh. Unknown/stale semantics BLOCK.

### PoC B — Socket Recipient Authorization

**Mục tiêu:** chứng minh sender+recipient gate và targeted delivery.

**Chuẩn bị:** UIDs A/B/C; B có hai sessions và một session nhiều sockets; room với active/revoked recipients; Socket.IO 2.3.0; ít nhất hai instances khi adapter được test; fault injection cho disconnect/adapter.

| Case | Setup/action | Expected | PASS evidence | FAIL |
|---|---|---|---|---|
| B1 Active recipient | A gửi, B active | B targeted emit | Allow-list/socket IDs | Active bị bỏ sai |
| B2 Recipient logout | Revoke B rồi A gửi | B deny | No outbound to B after decision | Revoked nhận event mới |
| B3 Disconnect fail | Socket B còn connected sau revoke | Gate vẫn deny | Revocation + gate log | Security chỉ dựa disconnect |
| B4 Stale socket | Metadata/session cũ | Deny | sessionHash/generation trace | Stale socket accepted |
| B5 Generation mismatch | B generation cũ | Deny | Predicate evidence | Old generation receives |
| B6 Multiple devices | Revoke S1, S2 active | S1 deny, S2 xét riêng | Per-session decisions | UID shortcut permits wrong |
| B7 Multiple sockets/session | S1 có tab1/tab2 | Revoke S1 deny cả hai | Map + gate evidence | Một tab vẫn allow |
| B8 Multi-instance | B ở instance2, A ở instance1 | Candidate route dùng adapter verified, gate vẫn authoritative | Versioned adapter/node traces | Local map treated global |
| B9 Adapter unavailable | Pub/Sub/registry down | Drop; không room fallback | Error and zero emit | Uncontrolled broadcast |
| B10 Targeted emit | Room có active/revoked | Chỉ allow-list receives | Emit target trace | Room-wide emit |
| B11 Room changes | Socket join/leave trong xử lý | Routing change không grant auth; disconnected/uncertain deny | Candidate/gate trace | Room membership grants |
| B12 Reconnect old | Revoked cookie reconnects | Handshake deny, không join | Handshake result | Old cookie restores |
| B13 Firestore/batch timeout | Deadline exceeded | Drop batch/recipient | Error plus no emit | Partial stale allow |
| B14 Snapshot before logout | Gate B pass, logout commits before send | May send under approved snapshot policy | Timeline shows admitted-before-revoke | Claims absolute packet recall |

PASS nếu denied recipient không được targeted emit theo boundary; mọi failure fail closed. Tách authorization decision evidence khỏi transport ack. B14 là limitation được duyệt, không phải test yêu cầu barrier.

### PoC C — Deletion Recovery

**Mục tiêu:** kiểm tra crash recovery/idempotency và COMPLETED evidence cho split Firebase Auth/Firestore.

**Chuẩn bị:** Auth + Firestore emulator, synthetic UID data roots/profile/reservations, crash hooks mỗi phase, deterministic workers; không dùng credentials thật.

| Case | Thao tác | Expected | PASS evidence | FAIL |
|---|---|---|---|---|
| C1 Auth deleted, worker crash | Auth delete ok, crash trước progress | New worker continues Firestore cleanup; not complete | Job phase + Auth absent evidence | Complete while data remains |
| C2 Partial recursive cleanup | Crash sau một chunk | Resume/rescan xóa phần còn lại | Root/subcollection counts | Descendant skipped |
| C3 Takeover | Worker A lease; B takeover epoch/token mới | B tiến hành, A post-takeover writes abort | Epoch/token traces | Old worker overwrites |
| C4 Old worker resumes | Pause A, B takeover, resume A | A không ghi progress/data | Rejected tx evidence | Stale commit |
| C5 Idempotent checkpoint | Lặp chunk/page đã xử lý | Không duplicate/harmful effect | Stable idempotency key/state | Cursor skips or duplicates create |
| C6 Transient retries | Inject transient tới cap | FAILED nhưng control DELETING | Attempts/error codes | Auto unlock |
| C7 Review-required | Unknown root/ownership mismatch | FAILED + reviewRequired; no auto retry | Error/audit evidence | Blind cleanup |
| C8 Final transaction | All evidence gathered | job COMPLETED + control DELETED atomic | Same commit/document snapshots | Split final states |
| C9 Profile/reservation partial | Remove one but retain other | Cleanup finds remaining and verifies zero | ownerUid/page results | Missing profile skips reservation |
| C10 Auth unavailable/unknown | Admin call unavailable | Keep DELETING; retry/reconcile | sanitized failure | mark complete without proof |

PASS nếu crash/resume safe, no ACTIVE transition, and final invariant is atomic.

### PoC D — Trusted Time and Lease

**Mục tiêu:** kiểm tra freshness/expiry/clock boundaries và lease takeover semantics.

**Chuẩn bị:** fake clock unit harness + Firestore emulator concurrency barriers. Fake clock không chứng minh NTP thực tế; production clock monitoring cần evidence riêng.

| Case | Thao tác | Expected | PASS evidence | FAIL |
|---|---|---|---|---|
| D1 auth_time exactly 300s | Issue session at boundary | Allow only other checks pass | Signed claim + server-time calculation | Client timestamp used |
| D2 auth_time older | Claim >300s | RECENT_SIGN_IN_REQUIRED; reauth credential | Error, no cookie | Refresh iat bypass |
| D3 future skew | auth_time future ≤30s then >30s | Apply precise policy; beyond bound deny | Validator results | Unbounded future accepted |
| D4 session expiry boundary | Before/at/after expiresAt | Consistent server-side policy; expired deny | Timestamp and decision | Client clock controls |
| D5 worker clock drift | Inject clock outside monitored bound | Stop acquire/renew/cleanup, alert | Clock health evidence | Worker proceeds |
| D6 lease expired, no takeover | Advance past lockedUntil | Only takeover eligible; no false hard fence claim | Job/clock trace | Claims auto-fenced |
| D7 takeover commit | New worker increments epoch/token | Old writes after commit abort | Transaction results | Old token writes |
| D8 Auth call in flight | Auth delete starts, lease takeover | Call may finish; new worker reconciles; old cannot write after fence | External outcome + stale tx denied | Assumes cross-service atomicity |

PASS nếu không dùng client time, clock outside bound fail closed, and fencing claim begins only at takeover commit.

## 12. Remaining Unverified Items

- Production Node runtime/deployment; local v22.14.0 chỉ là môi trường hiện tại.
- Firebase Admin exact version, transitive Firestore version, read-only wrapper options, readTime freshness and retry semantics.
- Firebase/Auth/Firestore emulator setup, IAM, Security Rules, region, all UID data roots.
- Socket multi-instance topology, adapter exact package/API, sticky sessions and distributed registry.
- Real recipients/event, room size, event rates, latency and Firestore cost budget.
- NTP drift bounds, Firestore transaction latency and worker clock behavior.
- Runtime CSRF/email verification/session cookie policies.
- Transport arrival after logout: approved snapshot policy permits previously authorized event delivery after logout response.
- No PoC, test, benchmark, migration or production service call performed.

## 13. Implementation Readiness Assessment

- **Owner decisions:** APPROVED per Task K instruction for OWNER-I-1..7.
- **Design baseline:** consolidated and ready for PoC design review.
- **SDK selection:** Firebase Admin Node candidate; version not pinned. Local Node v22.14.0 verified; production runtime UNVERIFIED.
- **PoC:** NOT EXECUTED.
- **Implementation:** NOT AUTHORIZED.
- **Source state:** MongoDB/Mongoose/connect-mongo remains implementation according to D/current source. No Firebase behavior is claimed as deployed.

## 14. Recommended Next Task

**Task 1.3.6L – Emulator PoC Execution and Evidence Capture**, only after a separate execution authorization. Confirm production Node target, select and pin the SDK version in that authorized task, then execute PoC A–D only in isolated emulators. Record observed API semantics, test outcomes, errors, performance/cost and residual risks. Do not remove MongoDB or alter Socket.IO version as part of PoC. Reassess implementation authorization after evidence and independent review.

## Tài liệu kỹ thuật tham khảo

- [Firebase Admin setup and Node.js requirements](https://firebase.google.com/docs/admin/setup)
- [Firebase Admin Node release notes](https://firebase.google.com/support/release-notes/admin/node)
- [Firebase Admin Firestore API](https://firebase.google.com/docs/reference/admin/node/firebase-admin.firestore)
- [Firestore transaction isolation](https://firebase.google.com/docs/firestore/transaction-data-contention)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Socket.IO v2 documentation](https://socket.io/docs/v2/)
- [Socket.IO 2.x compatibility notes](https://socket.io/docs/v4/migrating-from-2-x-to-3-0)
