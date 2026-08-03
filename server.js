require("dotenv").config({
  path: process.env.NODE_ENV === "test" ? ".env.test" : ".env",
  override: true,
});

if (process.env.NODE_ENV === "production") {
  const requiredEnvVars = ["SESSION_SECRET", "DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`CRITICAL STARTUP ERROR: Environment variable ${envVar} is required in production!`);
    }
  }
}
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const mysql = require("mysql2/promise");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");
const csrf = require("csurf");
const notificationsRoutes = require("./routes/notifications");

// Load middlewares and routers
const { generalLimiter, isTestEnv } = require("./middleware/auth");
const authRouter = require("./routes/auth");
const studentRouter = require("./routes/student");
const facultyRouter = require("./routes/faculty");
const adminRouter = require("./routes/admin");

const app = express();

app.set("trust proxy", 1);

let cspHashes = { scriptHashes: [] };
try {
  const hashesPath = path.join(__dirname, "csp-hashes.json");
  if (fs.existsSync(hashesPath)) {
    cspHashes = JSON.parse(fs.readFileSync(hashesPath, "utf8"));
  }
} catch (err) {
  console.error("Failed to load CSP hashes:", err);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        scriptSrc: ["'self'", ...cspHashes.scriptHashes],
        imgSrc: ["'self'", "data:", "https://img.icons8.com"],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

const server = http.createServer(app);
const io = new Server(server);

app.use(
  cors({
    origin: process.env.APP_BASE_URL || "http://localhost:5000",
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || "DefaultSecret",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 1000,
    },
  }),
);

// NOTE: csurf is deprecated/unmaintained per npm and should be replaced with a maintained CSRF solution (e.g., csrf-csrf) in a future pass.
const csrfProtection = csrf({ cookie: false });

app.use((req, res, next) => {
  const session = req.session?.user
    ? { id: req.session.user.id, role: req.session.user.role }
    : null;
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${req.url} - session: ${JSON.stringify(session)}`
  );
  next();
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});
app.use(csrfProtection);

// Prevent caching of HTML files to avoid back-button exposure after logout
app.use((req, res, next) => {
  if (req.path.endsWith(".html") || req.path === "/") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  }
  next();
});

app.use(express.static("public"));

app.get("/csrf-token", csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

if (!isTestEnv) {
  app.use(generalLimiter);
}

// ---------------- DATABASE CONNECTION ----------------
const sslConfig =
  process.env.NODE_ENV === "production" || process.env.DB_HOST?.includes("aivencloud.com")
    ? {
        ca: process.env.DB_SSL_CA
          ? process.env.DB_SSL_CA.replace(/\\n/g, "\n")
          : undefined,
        rejectUnauthorized: false,
      }
    : undefined;

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 25577,
 ssl: {
    rejectUnauthorized: false
  }
});

(async () => {
  try {
    const connection = await db.getConnection();
    console.log("Connected to MySQL Database");
    connection.release();

    await db.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        target VARCHAR(50) NOT NULL,
        pdf_url VARCHAR(500) NULL,
        dept_Id INT NULL,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error("Database initialization failed:", err);
  }
})();

app.set("db", db);
app.set("io", io);

// Socket.io room joins
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);
  socket.on("join_room", (role) => {
    const allowed = ["student", "faculty", "admin"];
    if (allowed.includes(role)) {
      socket.join(role);
      console.log(`Socket ${socket.id} joined room: ${role}`);
    }
  });

  socket.on("join_user_room", (userId) => {
    if (userId) {
      socket.join(`user_${userId}`);
      console.log(`Socket ${socket.id} joined room: user_${userId}`);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// Mount modular routers
app.use(["/notifications", "/api/notifications"], notificationsRoutes);
app.use(authRouter);
app.use(studentRouter);
app.use(facultyRouter);
app.use(adminRouter);

// Error handler for Multer upload errors and CSRF / database errors
app.use((err, req, res, next) => {
  console.error(JSON.stringify({ time: new Date().toISOString(), error: err.stack || err.message }));

  if (err.name === "MulterError" || err.message === "Only PDF files are allowed") {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === "EBADCSRFTOKEN") {
    return res.status(403).json({ error: "Invalid CSRF token" });
  }
  res.status(500).json({ error: err.message || "Internal server error" });
});

// -- SERVER
const PORT = process.env.PORT || 5000;
const HOST = "0.0.0.0";

if (require.main === module) {
  server.listen(PORT, HOST, () =>
    console.log(`Server running on http://${HOST}:${PORT}/login.html`)
  );
}

module.exports = { app, db };
