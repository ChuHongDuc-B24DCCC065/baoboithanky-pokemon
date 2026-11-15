require("dotenv").config();

const path = require("path");
const fs = require("fs");

const 
    express = require("express"),
    app = express(),
    http = require("http").createServer(app),
    io = require("socket.io")(http);

const authRoutes = require("./server/routes/authRoutes");
const { requireAuth, requireGuest } = require("./server/middleware/authMiddleware");
const { ensureCsrfCookie, extractCookie } = require("./server/middleware/csrfMiddleware");
const { registerSocket, unregisterSocket } = require("./server/socket/activeSockets");
const { verifySessionCookie } = require("./server/services/firebaseAuthService");
const { getFirestore } = require("./server/config/firebase");
const Core = require("./server/core");

app.set("port", process.env.PORT || 3000);

// Bảo tồn nguyên vẹn Socket.io 2.3.0 và hệ thống movement relay
// Kết hợp theo dõi Active Sockets cho người dùng phục vụ Logout-All
const core = new Core();
io.on("connection", (socket) => {
    if (socket.userId) {
        registerSocket(socket.userId, socket);
        socket.once("disconnect", () => {
            unregisterSocket(socket.userId, socket);
        });
    }
    core.conn(socket);
});

let isShuttingDown = false;

/**
 * Đóng Socket.io và HTTP Server an toàn dựa trên http.listening thực tế
 * @returns {Promise<void>}
 */
const closeSocketAndHttp = () => {
    return new Promise((resolve) => {
        if (!http.listening) {
            return resolve();
        }

        // Trong Socket.io 2.3.0: io.close() tự động ngắt kết nối client,
        // đóng engine.io và đóng luôn httpServer đi kèm.
        io.close((err) => {
            if (err) {
                console.error("[Server Error] Error closing Socket.io / HTTP:", err.message);
            } else {
                console.log("[Server] Socket.io and HTTP server closed cleanly.");
            }
            resolve();
        });
    });
};

/**
 * Xử lý Graceful Shutdown đồng bộ cho toàn bộ tiến trình
 * @param {string} signal
 */
const gracefulShutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n[Server] Received ${signal}. Starting graceful shutdown...`);

    // Fallback: Ép buộc dừng sau 10s nếu có socket/I/O bị treo
    const forceExitTimer = setTimeout(() => {
        console.error("[Server Error] Graceful shutdown timed out (10s). Forcing exit.");
        process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    try {
        // 1. Chờ tiến trình khởi động đang chạy dở hoàn tất trước để tránh race condition
        await startPromise.catch(() => {});

        // 2. Đóng Socket.io và HTTP Server nếu HTTP server thực sự đang mở cổng
        await closeSocketAndHttp();

        console.log("[Server] Graceful shutdown completed.");
        process.exit(0);
    } catch (err) {
        console.error("[Server Error] Error during graceful shutdown:", err.message);
        process.exit(1);
    }
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Xử lý lỗi runtime của HTTP server sau khi khởi động thành công
http.on("error", (err) => {
    if (!isShuttingDown) {
        console.error("[Server Runtime Error]:", err.message);
    }
});

/**
 * Đóng gói việc mở cổng HTTP thành Promise để bắt trọn vẹn sự kiện error (EADDRINUSE)
 * @param {number|string} port
 * @returns {Promise<void>}
 */
const listenHttpServer = (port) => {
    return new Promise((resolve, reject) => {
        const onError = (err) => {
            http.removeListener("listening", onListening);
            reject(err);
        };

        const onListening = () => {
            http.removeListener("error", onError);
            resolve();
        };

        http.once("error", onError);
        http.once("listening", onListening);
        http.listen(port);
    });
};

/**
 * Khởi động server tuần tự và an toàn
 */
const startServer = async () => {
    try {
        if (isShuttingDown) return;

        // 1. Cấu hình Body Parsers
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));

        // 2. Nhận diện sớm Firebase Session Cookie cho các HTTP request
        // Giúp ensureCsrfCookie nhận biết chính xác trạng thái đã đăng nhập (scope = UID)
        app.use(async (req, res, next) => {
            const sessionCookie = extractCookie(req, "poke.sid");
            if (!sessionCookie) {
                req.user = null;
                return next();
            }

            try {
                const decoded = await verifySessionCookie(sessionCookie, true);
                req.user = {
                    uid: decoded.uid,
                    id: decoded.uid
                };
            } catch (err) {
                const isInfra = err && (
                    err.code === "ECONNREFUSED" ||
                    err.code === "ETIMEDOUT" ||
                    err.code === "ENOTFOUND" ||
                    err.code === "auth/internal-error"
                );

                if (isInfra) {
                    req.user = undefined;
                    req.authFailure = { type: "INFRASTRUCTURE_ERROR", code: err.code };
                } else {
                    res.clearCookie("poke.sid", {
                        path: "/",
                        httpOnly: true,
                        secure: process.env.NODE_ENV === "production",
                        sameSite: "lax"
                    });
                    req.user = null;
                }
            }
            return next();
        });

        // 3. Cấu hình Socket.IO Handshake Authentication Middleware (Thuần Firebase Session Cookie)
        io.use(async (socket, next) => {
            const req = socket.request;
            const sessionCookie = extractCookie(req, "poke.sid");

            if (!sessionCookie) {
                return next(new Error("UNAUTHORIZED"));
            }

            try {
                const decoded = await verifySessionCookie(sessionCookie, true);
                const db = getFirestore();
                const userDoc = await db.collection("users").doc(decoded.uid).get();

                if (!userDoc.exists) {
                    return next(new Error("UNAUTHORIZED"));
                }

                const userData = userDoc.data() || {};
                if (userData.isActive === false) {
                    return next(new Error("ACCOUNT_DISABLED"));
                }

                socket.userId = decoded.uid;
                socket.username = userData.username;
                socket.character = userData.character || "red";
                return next();
            } catch (firebaseErr) {
                return next(new Error("UNAUTHORIZED"));
            }
        });

        // 4. Tự động cấp phát hoặc làm mới CSRF Cookie cho các yêu cầu
        app.use(ensureCsrfCookie);

        // 5. Gắn Auth API routes
        app.use("/api/auth", authRoutes);

        // 6. Protected Page Routes (Bảo vệ màn hình Game)
        const publicDirectory = path.join(__dirname, "public");

        app.get("/", requireAuth, (req, res) => {
            res.sendFile(path.join(publicDirectory, "index.html"));
        });

        app.get("/index.html", requireAuth, (req, res) => {
            res.sendFile(path.join(publicDirectory, "index.html"));
        });

        // Guest Page Routes (Chuẩn bị sẵn sàng cho Task Frontend)
        app.get("/login", requireGuest, (req, res) => {
            const loginPath = path.join(publicDirectory, "login.html");
            if (fs.existsSync(loginPath)) {
                return res.sendFile(loginPath);
            }
            res.status(200).send("Trang đăng nhập (login.html) sẽ được tích hợp giao diện ở Task tiếp theo. Hiện tại bạn có thể sử dụng API POST /api/auth/login.");
        });

        app.get("/register", requireGuest, (req, res) => {
            const registerPath = path.join(publicDirectory, "register.html");
            if (fs.existsSync(registerPath)) {
                return res.sendFile(registerPath);
            }
            res.status(200).send("Trang đăng ký (register.html) sẽ được tích hợp giao diện ở Task tiếp theo. Hiện tại bạn có thể sử dụng API POST /api/auth/register.");
        });

        // 7. Phục vụ Public Static Assets (CSS, JS, Sprites, Images) với index: false
        app.use(express.static(publicDirectory, {
            index: false
        }));

        // 8. Mở cổng HTTP an toàn với cơ chế bắt lỗi EADDRINUSE
        await listenHttpServer(app.get("port"));
        console.log("Server listening on :" + app.get("port"));
    } catch (err) {
        // Nếu đang trong quá trình shutdown thì bỏ qua báo lỗi khởi động (tránh đúp log)
        if (isShuttingDown) {
            return;
        }
        console.error("[Startup Error] Could not start server:", err.message);
        process.exit(1);
    }
};

// Khởi chạy và lưu Promise để đồng bộ hóa vòng đời
const startPromise = startServer();
