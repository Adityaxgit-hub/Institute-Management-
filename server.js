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

const sessionStore = new MySQLStore({}, db);

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

app.get("/", (req, res) => {
  res.redirect("/login.html");
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

    // Auto-update incorrect/old seeded password hashes to their correct values
    const updates = [
      { username: "admin", oldHash: "$2b$10$7.LqrNVhrgufIQB8l0gd9e/6BlwgKIzy7QKaKAtzJF8NfTpd8q6uu", newHash: "$2b$10$6n8PTVRZjji6mPhYhFCC0.ZNcreZo7SsmCUXCugVUM7v9HN1MAS1S" },
      { username: "ravi.kumar", oldHash: "$2b$10$1mwsNX03ziDjGKiL9UYaUO1B9WYuSy3hvtqglQSfdxfKLIeSzswxK", newHash: "$2b$10$ACQYbx1qCXf5vcGb.wcsGudkA3exa1GOqFjnCOkUlrpNtfGcGWuCW" },
      { username: "anita.sharma", oldHash: "$2b$10$YMQ69oaI31rTAMZsVCjJjewG1kjHhC7tT5vcdNYXreqZRi2LQFpkO", newHash: "$2b$10$udsd3PEb7d7uqG3L2GB93On1DHxzoFG/433xrzet1FmDZNdfFf5ma" },
      { username: "vikram.patel", oldHash: "$2b$10$emJ.U6KKR8v9bBd6EYgb5eGw5ezxDHFSAg89xUGomDFdlBpbeFWvO", newHash: "$2b$10$3RwLArA9vAzQNyVsVpNZpegoJI3BszqOtzJpB2lolqkxpZH7a3iCm" },
      { username: "neha.verma", oldHash: "$2b$10$/EkBLucPxklDtMmk.I8VuepDZybf5kgYhJdtppTb7a3FO3d5RNgvm", newHash: "$2b$10$NgKt7k9yJUfYFjh8FDEZzeDGMOuTBbBzTRKmj.bPbzLRUpR76gyWS" },
      { username: "suresh.reddy", oldHash: "$2b$10$ivD3bPTBLwpT7Td6VDfq8upRE0pvIT.nERGVx5yxplPGfqwsQB6ha", newHash: "$2b$10$uToc.gYcAZSEgAHZngYemuG6bOq/atyRRtn7HxwZANschrNl1R9Dm" },
      { username: "abhiinay", oldHash: "$2b$10$UvDZMZu3xwhBjSu8NzTdKuP6/sDu4GUZL3Nbq5w94sQMrfkRzfFWu", newHash: "$2b$10$p/zl4NT.ClXasUr0zRnDtOv9qIStHkIK.nxhlHECLukGOY.0dZ2da" },
      { username: "aditya", oldHash: "$2b$10$2OhABy9d/VH2AcrKI5c2oezF9zT6JXcv/I7/r.9AQEocXD/qtuiEC", newHash: "$2b$10$uo9pkLq8dG7mWys6XqqPSukwGfejJpesCxXoP1e6sAzQjY1AKFQYi" },
      { username: "giridhar", oldHash: "$2b$10$l2d/o04ROU4fw1qfLZoNz.a1uNs4DZIeF5/SDzCBR1gx55PCnzJ8G", newHash: "$2b$10$2cdBvvaNdsmA/IKT1gMUI.ef4.yDfJHdNKUIs2UjkiuGm/DHW2aGa" },
      { username: "praveen", oldHash: "$2b$10$YooJXyZWDe4aIQlSxJW.ReLrguC550l8V3/jrNmF/TpMI9h6xruXm", newHash: "$2b$10$KW8EoPUlAU3a1/0yaKxr3.J2elap8qRmrsHO10JFigTPVR7rJvagO" },
      { username: "aardhya", oldHash: "$2b$10$NE4QytUfmIELAkZ.yeG7/ukUxc2uwmivHNXNHv34KMkRT3clRvcpm", newHash: "$2b$10$qyvjYs0P6vrQKqTNtLhlteYcOvNhJitD37XiNAyy3i0Yfx2rHcssm" },
      { username: "aditi", oldHash: "$2b$10$TWck11IVDbdZpWl7x5tYiun0FfqvVJb2EoF2XmyByZz1wJUBPmwl6", newHash: "$2b$10$DySYEG/gf6XNnVaBTNOzT.miAQqCTQk/FytwxZNjWf46bxgqNqqf6" },
      { username: "ananya", oldHash: "$2b$10$MCbaIYLbetUC8myAnupmJe2B/OzZ9nCrxZZPvkM1yfc3b.1W1geiG", newHash: "$2b$10$OZgeLdSE6nhNQ7OsAKgqpOMaU.Up71f9peyyt1uvtUVs3w5mALmYi" },
      { username: "ishitha", oldHash: "$2b$10$7FbtTas96hmaj5YAagoRJeK9h31.vgpAINqQ.R0CiZ0Ht1NOJ6B3y", newHash: "$2b$10$G7Sbst5t0iGk8tzqLyOWRuAOq5bSNuNS/tTgyCydBOgoZ6.WqM7FS" },
      { username: "diya", oldHash: "$2b$10$TlKGgrQee4x7.VxHHZtzb.H/FY/8c/Auz1C.tyb8GoZw8RB/LtOkW", newHash: "$2b$10$aeLlQYKy0dGTa2dobd9IFe7khQ6Ev5oB6hroMtUAotGX5HrdQlwse" },
      { username: "meera", oldHash: "$2b$10$n82imQ3FaH0d3Gz0YH14We8OBbRm.pav5OCcN3JgGjQI9qtbBW5Bm", newHash: "$2b$10$pGhhdikRiVwE.A9WvtwA5eFanr6eqd3nvJNqlqiJ4xlXHRSDN0YPC" }
    ];

    for (const item of updates) {
      try {
        const [rows] = await db.query("SELECT password FROM Users WHERE username = ?", [item.username]);
        if (rows.length > 0 && rows[0].password === item.oldHash) {
          await db.query("UPDATE Users SET password = ?, must_reset_password = 1 WHERE username = ?", [item.newHash, item.username]);
          console.log(`Successfully migrated password hash and reset must_reset_password flag for user: ${item.username}`);
        }
      } catch (dbErr) {
        console.error(`Failed to migrate password for user ${item.username}:`, dbErr);
      }
    }
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
