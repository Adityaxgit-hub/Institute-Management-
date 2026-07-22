require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const notificationsRoutes = require("./routes/notifications");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");

// Server configuration setup (reloaded)
const app = express();

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
const saltRounds = 10;
const multer = require("multer");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

app.use(cors({
  origin: process.env.APP_BASE_URL || "http://localhost:5000",
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 60 * 60 * 1000 },
  }),
); // session configuration

const csrf = require("csurf");
const csrfProtection = csrf({ cookie: false });
app.use(csrfProtection);
app.use(express.static("public"));

app.get("/csrf-token", csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ message: "Please log in." });
  }
  if (req.session.user.mustReset) {
    return res.status(403).json({ message: "Password reset required.", code: "MUST_RESET" });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ message: "Please log in." });
    }
    if (req.session.user.mustReset) {
      return res.status(403).json({ message: "Password reset required.", code: "MUST_RESET" });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ message: "Not authorized." });
    }
    next();
  };
}

// General API limiter — protects everything by default
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again later." },
});
app.use(generalLimiter);

// Strict limiter for login — the main brute-force target
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
});

// Strict limiter for password reset / signup — prevents email-bombing & enumeration
const sensitiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Please try again in an hour." },
});

// ---------------- DATABASE CONNECTION ----------------
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

db.getConnection()
  .then(() => console.log("Connected to MySQL Database"))
  .catch((err) => console.error("Database connection failed:", err));

db.query(`
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

app.set("db", db);
app.set("io", io);
app.use(["/notifications", "/api/notifications"], notificationsRoutes);

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

// ---------------- NOTIFICATIONS pdf----------------
const { fileTypeFromFile } = require("file-type");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "./public/uploads/pdfs";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.pdf`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB cap
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed"));
    }
    cb(null, true);
  },
});

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB cap
  fileFilter: (req, file, cb) => {
    const isCsvExt = path.extname(file.originalname).toLowerCase() === ".csv";
    cb(null, isCsvExt);
  },
});

const { parse: parseCsv } = require("csv-parse/sync");

// ---------------- LOGIN ----------------
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

app.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  try {
    const [results] = await db.query("SELECT * FROM Users WHERE username=?", [
      username,
    ]);

    if (results.length === 0) {
      return res.status(401).json({
        message: "Invalid username",
        error: `No user found for username: ${username}`,
      });
    }

    const user = results[0];

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesLeft = Math.ceil(
        (new Date(user.locked_until) - new Date()) / 60000,
      );
      return res.status(423).json({
        message: `Account locked due to too many failed attempts. Try again in ${minutesLeft} minute(s).`,
      });
    }

    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      const newAttempts = user.failed_attempts + 1;

      if (newAttempts >= MAX_ATTEMPTS) {
        const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
        await db.query(
          "UPDATE Users SET failed_attempts = ?, locked_until = ? WHERE user_Id = ?",
          [newAttempts, lockedUntil, user.user_Id],
        );
        return res.status(423).json({
          message: "Too many failed attempts. Account locked for 15 minutes.",
        });
      }

      await db.query(
        "UPDATE Users SET failed_attempts = ? WHERE user_Id = ?",
        [newAttempts, user.user_Id],
      );

      return res.status(401).json({
        message: "Invalid password",
        error: `${MAX_ATTEMPTS - newAttempts} attempt(s) remaining before lockout.`,
      });
    }

    // Successful login — reset counters
    await db.query(
      "UPDATE Users SET failed_attempts = 0, locked_until = NULL WHERE user_Id = ?",
      [user.user_Id],
    );

    req.session.user = {
      id: user.user_Id,
      name: user.username,
      role: user.role,
      mustReset: !!user.must_reset_password,
    };

    res.json({ user }); 
  } catch (err) {
    console.error("Login failed:", err);
    res.status(500).json({
      message: "Database error",
      error: err.message,
    });
  }
});

const otpRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { message: "Too many OTP requests. Please try again later." },
});

// STEP 1: request an OTP to prove the person controls that institute email
app.post("/signup/request-otp", otpRequestLimiter, async (req, res) => {
  const { email, role } = req.body;

  if (!email || !role || !["student", "faculty"].includes(role)) {
    return res.status(400).json({
      success: false,
      message: "Valid email and role (student/faculty) are required.",
    });
  }

  try {
    const lookupQuery =
      role === "student"
        ? "SELECT student_Id AS recordId, user_Id FROM Students WHERE email = ?"
        : "SELECT faculty_Id AS recordId, user_Id FROM Faculty WHERE email = ?";

    const [records] = await db.query(lookupQuery, [email]);

    // Always return the same generic message whether or not the email exists —
    // prevents attackers from using this endpoint to enumerate valid institute emails
    const genericResponse = {
      success: true,
      message: "If this email is on record and unclaimed, a verification code has been sent.",
    };

    if (records.length === 0 || records[0].user_Id) {
      return res.json(genericResponse); // no record, or already claimed — say nothing more
    }

    const otp = crypto.randomInt(100000, 999999).toString(); // 6-digit OTP
    const otpHash = await bcrypt.hash(otp, saltRounds);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Invalidate any previous unused OTPs for this email
    await db.query("UPDATE signup_otps SET used = 1 WHERE email = ? AND used = 0", [email]);

    await db.query(
      "INSERT INTO signup_otps (email, otp_hash, role, record_id, expires_at) VALUES (?, ?, ?, ?, ?)",
      [email, otpHash, role, records[0].recordId, expiresAt],
    );

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: `"Institute Portal" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Your Signup Verification Code",
      html: `
        <div style="font-family: Inter, sans-serif; max-width: 480px; margin: auto; padding: 30px; border: 1px solid #dbe3ef; border-radius: 16px;">
          <h2 style="color: #1d4ed8;">Verify Your Email</h2>
          <p>Use the code below to complete your account signup:</p>
          <p style="font-size: 2rem; font-weight: 800; letter-spacing: 0.2em; color: #0f172a;">${otp}</p>
          <p style="color: #64748b; font-size: 0.9rem;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
        </div>
      `,
    });

    res.json(genericResponse);
  } catch (err) {
    console.error("OTP request failed:", err);
    res.status(500).json({ success: false, message: "Unable to send verification code." });
  }
});

// STEP 2: verify OTP + create the account (replaces old /signup route)
app.post("/signup", sensitiveLimiter, async (req, res) => {
  const { username, password, role, email, otp } = req.body;

  if (!username || !password || !role || !email || !otp) {
    return res.status(400).json({
      success: false,
      message: "Please provide username, password, role, email, and verification code.",
    });
  }

  if (!["student", "faculty"].includes(role)) {
    return res.status(400).json({
      success: false,
      message: "Role must be either student or faculty.",
    });
  }

  try {
    const [otpRows] = await db.query(
      `SELECT * FROM signup_otps
       WHERE email = ? AND role = ? AND used = 0 AND expires_at > NOW()
       ORDER BY id DESC LIMIT 1`,
      [email, role],
    );

    if (otpRows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Verification code expired or not found. Please request a new one.",
      });
    }

    const otpRecord = otpRows[0];

    if (otpRecord.attempts >= 5) {
      return res.status(429).json({
        success: false,
        message: "Too many incorrect attempts. Please request a new code.",
      });
    }

    const otpMatch = await bcrypt.compare(otp, otpRecord.otp_hash);

    if (!otpMatch) {
      await db.query("UPDATE signup_otps SET attempts = attempts + 1 WHERE id = ?", [otpRecord.id]);
      return res.status(400).json({ success: false, message: "Incorrect verification code." });
    }

    // OTP is valid — re-check the record hasn't been claimed since (race condition guard)
    const recordTable = role === "student" ? "Students" : "Faculty";
    const idColumn = role === "student" ? "student_Id" : "faculty_Id";

    const [currentRecord] = await db.query(
      `SELECT user_Id FROM ${recordTable} WHERE ${idColumn} = ?`,
      [otpRecord.record_id],
    );

    if (currentRecord.length === 0 || currentRecord[0].user_Id) {
      return res.status(409).json({
        success: false,
        message: "This record is no longer available for signup.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);
    const [userResult] = await db.query(
      "INSERT INTO Users (username, password, role) VALUES (?, ?, ?)",
      [username, hashedPassword, role],
    );
    const newUserId = userResult.insertId;

    try {
      await db.query(
        `UPDATE ${recordTable} SET user_Id=? WHERE ${idColumn}=?`,
        [newUserId, otpRecord.record_id],
      );

      await db.query("UPDATE signup_otps SET used = 1 WHERE id = ?", [otpRecord.id]);

      res.json({ success: true, message: "Account created successfully." });
    } catch (linkErr) {
      await db.query("DELETE FROM Users WHERE user_Id=?", [newUserId]);
      throw linkErr;
    }
  } catch (err) {
    console.error("Signup failed:", err);
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ success: false, message: "Username already exists." });
    }
    res.status(500).json({ success: false, message: "Database error creating account." });
  }
});

// ---------------- STUDENT DASHBOARD ----------------
app.get("/student/:userId", requireRole("student"), csrfProtection, async (req, res) => {
  const userId = req.params.userId;

  if (String(req.session.user.id) !== String(userId)) {
    return res.status(403).json({ message: "Not authorized." });
  }

  try {
    const studentQuery = `
      SELECT s.student_Id, s.first_name, s.last_name,
             s.email, s.phone, s.DOB, d.dept_name, s.dept_Id
      FROM Students s
      JOIN Department d ON s.dept_Id = d.dept_Id
      WHERE s.user_Id = ?;
    `;

    const [studentResults] = await db.query(studentQuery, [userId]);

    if (studentResults.length === 0) {
      return res.status(404).json({
        message: "Student not found",
      });
    }

    const student = studentResults[0];

    const coursesQuery = `
      SELECT c.course_Id,
             c.course_name,
             CONCAT(f.first_name,' ',f.last_name) AS faculty_name
      FROM Enrollments e
      JOIN Courses c ON e.course_Id = c.course_Id
      JOIN Teaches t ON c.course_Id = t.course_Id
      JOIN Faculty f ON t.faculty_Id = f.faculty_Id
      WHERE e.student_Id = ?;
    `;

    const [courses] = await db.query(coursesQuery, [student.student_Id]);

    const attendanceQuery = `
      SELECT Attd_Date,
             course_Id,
             CASE WHEN Status='P'
                  THEN 'Present'
                  ELSE 'Absent'
             END AS Status
      FROM Attendance
      WHERE student_Id = ?;
    `;

    const [attendance] = await db.query(attendanceQuery, [student.student_Id]);

    res.json({
      student,
      courses,
      attendance,
    });
  } catch (err) {
    console.error("Student route error:", err);
    res.status(500).json({
      error: err.message,
    });
  }
});
// ---------------- STUDENT ATTENDANCE BY COURSE ----------------
app.get("/student/:userId/attendance-summary", requireRole("student"), csrfProtection, async (req, res) => {
  const { userId } = req.params;

  if (String(req.session.user.id) !== String(userId)) {
    return res.status(403).json({ message: "Not authorized." });
  }

  try {
    // 1. Find the student
    const [studentResults] = await db.query(
      "SELECT student_Id FROM Students WHERE user_Id = ?",
      [userId],
    );

    if (studentResults.length === 0) {
      return res.status(404).json({ message: "Student not found" });
    }

    const studentId = studentResults[0].student_Id;

    // 2. Overall attendance per course (present count, total count)
    const [overall] = await db.query(
      `SELECT
         c.course_Id,
         c.course_name,
         CONCAT(f.first_name, ' ', f.last_name) AS faculty_name,
         SUM(CASE WHEN a.Status = 'P' THEN 1 ELSE 0 END) AS present_days,
         COUNT(a.Attd_Id) AS total_days
       FROM Enrollments e
       JOIN Courses c ON e.course_Id = c.course_Id
       LEFT JOIN Teaches t ON c.course_Id = t.course_Id
       LEFT JOIN Faculty f ON t.faculty_Id = f.faculty_Id
       LEFT JOIN Attendance a ON a.course_Id = c.course_Id AND a.student_Id = e.student_Id
       WHERE e.student_Id = ?
       GROUP BY c.course_Id, c.course_name, f.first_name, f.last_name`,
      [studentId],
    );

    // 3. Current-month attendance per course
    const [monthly] = await db.query(
      `SELECT
         a.course_Id,
         SUM(CASE WHEN a.Status = 'P' THEN 1 ELSE 0 END) AS present_days,
         COUNT(a.Attd_Id) AS total_days
       FROM Attendance a
       WHERE a.student_Id = ?
         AND MONTH(a.Attd_Date) = MONTH(CURDATE())
         AND YEAR(a.Attd_Date) = YEAR(CURDATE())
       GROUP BY a.course_Id`,
      [studentId],
    );

    // 4. Merge monthly data into the overall list, keyed by course_Id
    const monthlyMap = {};
    monthly.forEach((m) => {
      monthlyMap[m.course_Id] = m;
    });

    const result = overall.map((course) => {
      const total = Number(course.total_days) || 0;
      const present = Number(course.present_days) || 0;
      const overallPct = total > 0 ? (present / total) * 100 : 0;

      const m = monthlyMap[course.course_Id];
      const mTotal = m ? Number(m.total_days) : 0;
      const mPresent = m ? Number(m.present_days) : 0;
      const monthlyPct = mTotal > 0 ? (mPresent / mTotal) * 100 : 0;

      return {
        course_Id: course.course_Id,
        course_name: course.course_name,
        faculty_name: course.faculty_name,
        present_days: present,
        total_days: total,
        overall_percentage: Math.round(overallPct * 100) / 100,
        monthly_present: mPresent,
        monthly_total: mTotal,
        monthly_percentage: Math.round(monthlyPct * 100) / 100,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("Attendance summary error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- FACULTY DASHBOARD ----------------
app.get("/faculty/:userId", requireRole("faculty"), csrfProtection, async (req, res) => {
  const { userId } = req.params;
  if (String(req.session.user.id) !== String(userId)) {
    return res.status(403).json({ message: "Not authorized." });
  }
  try {
    const [faculty] = await db.query(
      `SELECT f.faculty_Id, f.first_name, f.last_name, f.email, f.phone, f.designation, f.join_date, d.dept_name, f.dept_Id
       FROM Faculty f
       JOIN Department d ON f.dept_Id = d.dept_Id
       WHERE f.user_Id = ?`,
      [userId],
    );

    if (faculty.length === 0)
      return res.status(404).json({ message: "Faculty not found" });

    const facultyId = faculty[0].faculty_Id;

    const [teaches] = await db.query(
      `SELECT t.course_Id, c.course_name, t.section, t.semester, t.year
       FROM Teaches t
       JOIN Courses c ON t.course_Id = c.course_Id
       WHERE t.faculty_Id = ?`,
      [facultyId],
    );

    res.json({ faculty: faculty[0], teaches });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching faculty details" });
  }
});

// ADMIN DASHBOARD ROUTES (Students / Faculty / Courses)
// ------------- STUDENTS -------------
app.get("/admin/students", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const deptId = req.query.dept_Id || "";
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];

    if (search) {
      where.push("(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR student_Id LIKE ?)");
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    if (deptId) {
      where.push("dept_Id = ?");
      params.push(deptId);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM Students ${whereSql}`, params);
    const total = countRows[0].total;

    const [rows] = await db.query(
      `SELECT * FROM Students ${whereSql} ORDER BY student_Id LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({
      data: rows,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error("GET /admin/students error:", err);
    res.status(500).json({ error: "Unable to load students." });
  }
});

app.get("/admin/students/export", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT student_Id, first_name, last_name, email, phone, DOB, admission_date, dept_Id
       FROM Students ORDER BY student_Id`,
    );

    const header = "student_Id,first_name,last_name,email,phone,DOB,admission_date,dept_Id";

    const csvEscape = (val) => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const lines = rows.map((r) =>
      [
        r.student_Id,
        r.first_name,
        r.last_name,
        r.email,
        r.phone,
        r.DOB ? new Date(r.DOB).toISOString().split("T")[0] : "",
        r.admission_date ? new Date(r.admission_date).toISOString().split("T")[0] : "",
        r.dept_Id,
      ]
        .map(csvEscape)
        .join(","),
    );

    const csv = [header, ...lines].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=students_export.csv");
    res.send(csv);
  } catch (err) {
    console.error("GET /admin/students/export error:", err);
    res.status(500).json({ error: "Unable to export students." });
  }
});

app.post( "/admin/students/import",
  requireRole("admin"),
  csrfProtection,
  csvUpload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No CSV file uploaded, or file must be .csv" });
    }

    try {
      const records = parseCsv(req.file.buffer.toString("utf-8"), {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });

      if (records.length === 0) {
        return res.status(400).json({ error: "CSV file is empty." });
      }
      if (records.length > 500) {
        return res.status(400).json({ error: "Import limited to 500 rows per file." });
      }

      // Departments that actually exist — for dept_Id / department-name validation
      const [depts] = await db.query("SELECT dept_Id, dept_name FROM Department");
      const deptIdSet = new Set(depts.map((d) => String(d.dept_Id)));
      const deptNameMap = new Map(depts.map((d) => [d.dept_name.trim().toLowerCase(), d.dept_Id]));

      // Existing records — for uniqueness checks against the live DB
      const [existingStudents] = await db.query("SELECT student_Id, email, phone FROM Students");
      const existingIds = new Set(existingStudents.map((s) => s.student_Id));
      const existingEmails = new Set(existingStudents.map((s) => (s.email || "").toLowerCase()));
      const existingPhones = new Set(existingStudents.map((s) => s.phone));

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const phoneRegex = /^[0-9]{7,15}$/;
      const nameRegex = /^[A-Za-z][A-Za-z\s'-]{0,49}$/;
      const dobRegex = /^\d{4}-\d{2}-\d{2}$/;

      const seenIdsInFile = new Set();
      const seenEmailsInFile = new Set();
      const seenPhonesInFile = new Set();

      const validRows = [];
      const errors = [];

      records.forEach((row, idx) => {
        const rowNum = idx + 2; // +1 for header, +1 for 1-indexing
        const reasons = [];

        const student_Id = (row.student_Id || "").trim();
        const first_name = (row.first_name || "").trim();
        const last_name = (row.last_name || "").trim();
        const email = (row.email || "").trim();
        const phone = (row.phone || "").trim();
        const DOB = (row.DOB || "").trim();
        const deptInput = (row.dept_Id || row.department || "").trim();

        if (!student_Id) reasons.push("Missing student_Id (roll number)");
        else if (student_Id.length > 15) reasons.push("student_Id exceeds 15 characters");
        else if (existingIds.has(student_Id)) reasons.push("student_Id already exists in system");
        else if (seenIdsInFile.has(student_Id)) reasons.push("Duplicate student_Id within this file");

        if (!first_name || !nameRegex.test(first_name)) reasons.push("Invalid or missing first_name");
        if (!last_name || !nameRegex.test(last_name)) reasons.push("Invalid or missing last_name");

        if (!email || !emailRegex.test(email)) reasons.push("Invalid or missing email");
        else if (existingEmails.has(email.toLowerCase())) reasons.push("Email already exists in system");
        else if (seenEmailsInFile.has(email.toLowerCase())) reasons.push("Duplicate email within this file");

        if (!phone || !phoneRegex.test(phone)) reasons.push("Invalid or missing phone (7-15 digits)");
        else if (existingPhones.has(phone)) reasons.push("Phone already exists in system");
        else if (seenPhonesInFile.has(phone)) reasons.push("Duplicate phone within this file");

        if (!DOB || !dobRegex.test(DOB)) reasons.push("Invalid or missing DOB (expected YYYY-MM-DD)");
        else if (new Date(DOB) > new Date()) reasons.push("DOB cannot be in the future");

        let resolvedDeptId = null;
        if (!deptInput) {
          reasons.push("Missing dept_Id/department");
        } else if (deptIdSet.has(deptInput)) {
          resolvedDeptId = deptInput;
        } else if (deptNameMap.has(deptInput.toLowerCase())) {
          resolvedDeptId = deptNameMap.get(deptInput.toLowerCase());
        } else {
          reasons.push(`Department "${deptInput}" does not exist`);
        }

        if (reasons.length > 0) {
          errors.push({ row: rowNum, student_Id: student_Id || "(blank)", reasons });
          return;
        }

        seenIdsInFile.add(student_Id);
        seenEmailsInFile.add(email.toLowerCase());
        seenPhonesInFile.add(phone);

        validRows.push({ student_Id, first_name, last_name, email, phone, DOB, dept_Id: resolvedDeptId });
      });

      const created = [];

      for (const s of validRows) {
        const username = (s.first_name + s.last_name).toLowerCase().replace(/[^a-z0-9]/g, "");
        const password = crypto.randomBytes(6).toString("hex");
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        try {
          const [userResult] = await db.query(
            "INSERT INTO Users (username, password, role) VALUES (?, ?, 'student')",
            [username, hashedPassword],
          );
          const newUserId = userResult.insertId;

          try {
            await db.query(
              `INSERT INTO Students
              (student_Id, first_name, last_name, email, phone, DOB, admission_date, dept_Id, user_Id)
               VALUES (?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
              [s.student_Id, s.first_name, s.last_name, s.email, s.phone, s.DOB, s.dept_Id, newUserId],
            );
            created.push({ student_Id: s.student_Id, username, password });
          } catch (innerErr) {
            await db.query("DELETE FROM Users WHERE user_Id=?", [newUserId]);
            errors.push({ row: null, student_Id: s.student_Id, reasons: ["Database error inserting record"] });
          }
        } catch (userErr) {
          errors.push({ row: null, student_Id: s.student_Id, reasons: ["Failed to create login account (username may collide)"] });
        }
      }

      res.json({
        totalRows: records.length,
        insertedCount: created.length,
        failedCount: errors.length,
        created,
        errors,
      });
    } catch (err) {
      console.error("POST /admin/students/import error:", err);
      res.status(500).json({ error: "Unable to process CSV file. Check the file format." });
    }
  },
);

app.post("/admin/students", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const { student_Id, first_name, last_name, email, phone, DOB, dept_Id } = req.body;

    const username = first_name.concat(last_name).toLowerCase().replace(/[^a-z0-9]/g, "");

    const password = crypto.randomBytes(6).toString("hex");
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const [userResult] = await db.query(
      "INSERT INTO Users (username, password, role, must_reset_password) VALUES (?, ?, 'student', 1)",
      [username, hashedPassword],
    );

    const newUserId = userResult.insertId;

    try {
      await db.query(
        `INSERT INTO Students
        (student_Id, first_name, last_name, email, phone, DOB,
         admission_date, dept_Id, user_Id)
         VALUES (?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
        [student_Id, first_name, last_name, email, phone, DOB, dept_Id, newUserId],
      );

      res.json({
        message: "Student and User created successfully!",
        login: { username, password }, 
      });
    } catch (studentErr) {
      await db.query("DELETE FROM Users WHERE user_Id=?", [newUserId]);
      throw studentErr;
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/students/:id", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      "SELECT user_Id FROM Students WHERE student_Id=?",
      [id],
    );

    if (result.length === 0) {
      return res.status(404).json({
        error: "Student not found",
      });
    }

    const userId = result[0].user_Id;

    await db.query("DELETE FROM Students WHERE student_Id=?", [id]);

    await db.query("DELETE FROM Users WHERE user_Id=?", [userId]);

    res.json({
      message: "Student and linked User deleted successfully!",
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

app.put("/admin/students/:id", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, phone, DOB, dept_Id } = req.body;

    const [result] = await db.query(
      `UPDATE Students
       SET first_name=?, last_name=?, email=?, phone=?, DOB=?, dept_Id=?
       WHERE student_Id=?`,
      [first_name, last_name, email, phone, DOB || null, dept_Id, id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    res.json({ message: "Student updated successfully" });
  } catch (err) {
    console.error("PUT /admin/students error:", err);
    res.status(500).json({ error: "Unable to update student." });
  }
});

// FACULTY CRUD — auto user linking
app.get("/admin/faculty", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const deptId = req.query.dept_Id || "";
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];

    if (search) {
      where.push("(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR designation LIKE ?)");
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }
    if (deptId) {
      where.push("dept_Id = ?");
      params.push(deptId);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM Faculty ${whereSql}`, params);
    const total = countRows[0].total;

    const [rows] = await db.query(
      `SELECT * FROM Faculty ${whereSql} ORDER BY faculty_Id LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({
      data: rows,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error("GET /admin/faculty error:", err);
    res.status(500).json({ error: "Unable to load faculty." });
  }
});

// ---------------- ADD FACULTY ----------------
app.post("/admin/faculty", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const { first_name, last_name, email, phone, designation, dept_Id } =
      req.body;

    const username = (first_name + last_name).toLowerCase();

    const password = crypto.randomBytes(6).toString("hex");

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const [userResult] = await db.query(
      "INSERT INTO Users (username, password, role, must_reset_password) VALUES (?, ?, 'faculty', 1)",
      [username, hashedPassword],
    );

    const newUserId = userResult.insertId;

    try {
      await db.query(
        `INSERT INTO Faculty
        (first_name, last_name, email, phone,
         designation, join_date, dept_Id, user_Id)
         VALUES (?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
        [first_name, last_name, email, phone, designation, dept_Id, newUserId],
      );

      res.json({
        message: "Faculty and User created successfully!",
        login: { username, password },
      });
    } catch (facultyErr) {
      await db.query("DELETE FROM Users WHERE user_Id=?", [newUserId]);

      throw facultyErr;
    }
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

// ---------------- DELETE FACULTY ----------------
app.delete("/admin/faculty/:id", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      "SELECT user_Id FROM Faculty WHERE faculty_Id=?",
      [id],
    );

    if (result.length === 0) {
      return res.status(404).json({
        error: "Faculty not found",
      });
    }

    const userId = result[0].user_Id;

    await db.query("DELETE FROM Faculty WHERE faculty_Id=?", [id]);

    await db.query("DELETE FROM Users WHERE user_Id=?", [userId]);

    res.json({
      message: "Faculty and linked User deleted successfully!",
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

app.put("/admin/faculty/:id", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, phone, designation, dept_Id } = req.body;

    const [result] = await db.query(
      `UPDATE Faculty
       SET first_name=?, last_name=?, email=?, phone=?, designation=?, dept_Id=?
       WHERE faculty_Id=?`,
      [first_name, last_name, email, phone, designation, dept_Id, id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Faculty not found" });
    }

    res.json({ message: "Faculty updated successfully" });
  } catch (err) {
    console.error("PUT /admin/faculty error:", err);
    res.status(500).json({ error: "Unable to update faculty." });
  }
});

// ------------- COURSES -------------
app.get("/admin/courses", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const deptId = req.query.dept_Id || "";
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];

    if (search) {
      where.push("(course_name LIKE ? OR course_Id LIKE ?)");
      const like = `%${search}%`;
      params.push(like, like);
    }
    if (deptId) {
      where.push("dept_Id = ?");
      params.push(deptId);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM Courses ${whereSql}`, params);
    const total = countRows[0].total;

    const [rows] = await db.query(
      `SELECT * FROM Courses ${whereSql} ORDER BY course_Id LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    res.json({
      data: rows,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error("GET /admin/courses error:", err);
    res.status(500).json({ error: "Unable to load courses." });
  }
});

app.post("/admin/courses", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const { course_Id, course_name, credits, dept_Id } = req.body;

    await db.query(
      `INSERT INTO Courses
       (course_Id, course_name, credits, dept_Id)
       VALUES (?, ?, ?, ?)`,
      [course_Id, course_name, credits, dept_Id],
    );

    res.json({
      message: "Course added successfully",
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

app.delete("/admin/courses/:id", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;

    await db.query("DELETE FROM Courses WHERE course_Id=?", [id]);

    res.json({
      message: "Course deleted successfully",
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

app.put("/admin/courses/:id", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { course_name, credits, dept_Id } = req.body;

    const [result] = await db.query(
      `UPDATE Courses
       SET course_name=?, credits=?, dept_Id=?
       WHERE course_Id=?`,
      [course_name, credits, dept_Id, id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Course not found" });
    }

    res.json({ message: "Course updated successfully" });
  } catch (err) {
    console.error("PUT /admin/courses error:", err);
    res.status(500).json({ error: "Unable to update course." });
  }
});

// FACULTY - GET STUDENTS OF A COURSE
app.get("/faculty/course/:courseId/students", requireRole("faculty"), csrfProtection, async (req, res) => {
  try {
    const { courseId } = req.params;

    const [result] = await db.query(
      `SELECT s.student_Id,
              s.first_name,
              s.last_name
       FROM Enrollments e
       JOIN Students s
       ON e.student_Id = s.student_Id
       WHERE e.course_Id=?`,
      [courseId],
    );

    res.json(result);
  } catch (err) {
    res.status(500).json(err);
  }
});

// FACULTY - SAVE ATTENDANCE
app.post("/faculty/attendance", requireRole("faculty"), csrfProtection, async (req, res) => {
  try {
    const { courseId, date, attendance } = req.body;

    const [existing] = await db.query(
      `SELECT student_Id FROM Attendance WHERE course_Id=? AND Attd_Date=?`,
      [courseId, date],
    );
    const alreadyMarked = new Set(existing.map((r) => r.student_Id));

    const toInsert = attendance.filter((s) => !alreadyMarked.has(s.studentId));

    if (toInsert.length === 0) {
      return res.json({ message: "Attendance already marked for this date." });
    }

    const sql = `INSERT INTO Attendance (student_Id, course_Id, Attd_Date, Status) VALUES (?, ?, ?, ?)`;

    for (const student of toInsert) {
      await db.query(sql, [student.studentId, courseId, date, student.status]);
    }

    res.json({ message: "Attendance Saved Successfully" });
  } catch (err) {
    console.error(err);

    res.status(500).json(err);
  }
});

// FACULTY - GET STUDENTS + MARKS FOR A COURSE
app.get("/faculty/course/:courseId/marks",requireRole("faculty"),csrfProtection,
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { semester, year } = req.query;

      if (!semester || !year) {
        return res.status(400).json({ error: "semester and year are required" });
      }

      const [facultyRow] = await db.query(
        "SELECT faculty_Id FROM Faculty WHERE user_Id = ?",
        [req.session.user.id],
      );
      if (facultyRow.length === 0) {
        return res.status(404).json({ error: "Faculty record not found" });
      }

      const [owns] = await db.query(
        "SELECT teach_Id FROM Teaches WHERE faculty_Id=? AND course_Id=? AND semester=? AND year=?",
        [facultyRow[0].faculty_Id, courseId, semester, year],
      );
      if (owns.length === 0) {
        return res.status(403).json({ error: "You do not teach this course offering." });
      }

      const [rows] = await db.query(
        `SELECT s.student_Id, s.first_name, s.last_name,
                m.assignment1, m.mid_exam, m.assignment2,
                m.end_sem, m.internal_viva, m.external_viva
         FROM Enrollments e
         JOIN Students s ON e.student_Id = s.student_Id
         LEFT JOIN Marks m
           ON m.student_Id = e.student_Id
          AND m.course_Id = e.course_Id
          AND m.semester = e.semester
          AND m.year = e.year
         WHERE e.course_Id = ? AND e.semester = ? AND e.year = ?
         ORDER BY s.student_Id`,
        [courseId, semester, year],
      );

      res.json(rows);
    } catch (err) {
      console.error("GET /faculty/course/:courseId/marks error:", err);
      res.status(500).json({ error: "Unable to load marks." });
    }
  },
);

// FACULTY - SAVE MARKS (bulk upsert)
const MARK_FIELDS = [
  "assignment1",
  "mid_exam",
  "assignment2",
  "end_sem",
  "internal_viva",
  "external_viva",
];

function isValidMark(v) {
  if (v === null || v === undefined || v === "") return true; 
  const n = Number(v);
  return !Number.isNaN(n) && n >= 0 && n <= 100;
}

app.post("/faculty/marks", requireRole("faculty"), csrfProtection, async (req, res) => {
  try {
    const { courseId, semester, year, marks } = req.body;

    if (!courseId || !semester || !year || !Array.isArray(marks)) {
      return res.status(400).json({ error: "courseId, semester, year, and marks[] are required" });
    }

    const [facultyRow] = await db.query(
      "SELECT faculty_Id FROM Faculty WHERE user_Id = ?",
      [req.session.user.id],
    );
    if (facultyRow.length === 0) {
      return res.status(404).json({ error: "Faculty record not found" });
    }

    const [owns] = await db.query(
      "SELECT teach_Id FROM Teaches WHERE faculty_Id=? AND course_Id=? AND semester=? AND year=?",
      [facultyRow[0].faculty_Id, courseId, semester, year],
    );
    if (owns.length === 0) {
      return res.status(403).json({ error: "You do not teach this course offering." });
    }

    for (const row of marks) {
      for (const field of MARK_FIELDS) {
        if (!isValidMark(row[field])) {
          return res.status(400).json({
            error: `Invalid value for ${field} on student ${row.studentId}. Must be 0-100 or blank.`,
          });
        }
      }
    }

    const sql = `
      INSERT INTO Marks
        (student_Id, course_Id, semester, year,
         assignment1, mid_exam, assignment2, end_sem, internal_viva, external_viva, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        assignment1 = VALUES(assignment1),
        mid_exam = VALUES(mid_exam),
        assignment2 = VALUES(assignment2),
        end_sem = VALUES(end_sem),
        internal_viva = VALUES(internal_viva),
        external_viva = VALUES(external_viva),
        updated_by = VALUES(updated_by)
    `;

    for (const row of marks) {
      await db.query(sql, [
        row.studentId,
        courseId,
        semester,
        year,
        row.assignment1 || null,
        row.mid_exam || null,
        row.assignment2 || null,
        row.end_sem || null,
        row.internal_viva || null,
        row.external_viva || null,
        facultyRow[0].faculty_Id,
      ]);
    }

    res.json({ message: "Marks Saved Successfully" });
  } catch (err) {
    console.error("POST /faculty/marks error:", err);
    res.status(500).json({ error: "Unable to save marks." });
  }
});

// STUDENT - VIEW OWN MARKS (per enrolled course)
app.get("/student/:userId/marks", requireRole("student"), csrfProtection, async (req, res) => {
  const { userId } = req.params;

  if (String(req.session.user.id) !== String(userId)) {
    return res.status(403).json({ message: "Not authorized." });
  }

  try {
    const [studentResults] = await db.query(
      "SELECT student_Id FROM Students WHERE user_Id = ?",
      [userId],
    );
    if (studentResults.length === 0) {
      return res.status(404).json({ message: "Student not found" });
    }
    const studentId = studentResults[0].student_Id;

    const [rows] = await db.query(
      `SELECT e.course_Id, c.course_name, e.semester, e.year,
              m.assignment1, m.mid_exam, m.assignment2,
              m.end_sem, m.internal_viva, m.external_viva
       FROM Enrollments e
       JOIN Courses c ON e.course_Id = c.course_Id
       LEFT JOIN Marks m
         ON m.student_Id = e.student_Id
        AND m.course_Id = e.course_Id
        AND m.semester = e.semester
        AND m.year = e.year
       WHERE e.student_Id = ?`,
      [studentId],
    );

    res.json(rows);
  } catch (err) {
    console.error("GET /student/:userId/marks error:", err);
    res.status(500).json({ error: "Unable to load marks." });
  }
});

// FACULTY - APPLY LEAVE
app.post("/faculty/apply-leave",requireRole("faculty"), csrfProtection, async (req, res) => {
  try {
    const { facultyId, fromDate, toDate, reason } = req.body;

    if (!facultyId || !fromDate || !toDate || !reason) {
      return res.status(400).json({
        message: "Missing leave application fields.",
      });
    }

    const [lookupResult] = await db.query(
      `SELECT faculty_Id
         FROM Faculty
         WHERE user_Id=?
         OR faculty_Id=?
         LIMIT 1`,
      [facultyId, facultyId],
    );

    if (lookupResult.length === 0) {
      return res.status(404).json({
        message: "Faculty record not found.",
      });
    }

    const realFacultyId = lookupResult[0].faculty_Id;

    await db.query(
      `INSERT INTO Faculty_Leave
       (faculty_Id, from_date,
        to_date, reason)
       VALUES (?, ?, ?, ?)`,
      [realFacultyId, fromDate, toDate, reason],
    );

    res.json({
      message: "Leave Applied Successfully",
    });
  } catch (err) {
    console.error(err);

    res.status(500).json({
      message: "Failed to Apply Leave.",
    });
  }
});

// ADMIN - PROCESS FACULTY LEAVE REQUESTS

async function notifyFacultyLeaveDecision(leaveId, decision) {
  // decision is "Approved" or "Rejected"

  // 1. find the faculty's user_Id + name from the leave record
  const [rows] = await db.query(
    `SELECT f.user_Id, f.first_name, f.last_name
     FROM Faculty_Leave fl
     JOIN Faculty f ON fl.faculty_Id = f.faculty_Id
     WHERE fl.leave_Id = ?`,
    [leaveId],
  );

  if (rows.length === 0) return; // leave record not found, nothing to notify

  const { user_Id, first_name, last_name } = rows[0];

  const title = `Leave Request ${decision}`;
  const message = `Hi ${first_name}, your leave request has been ${decision.toLowerCase()} by the admin.`;
  const target = `user_${user_Id}`; // personal target, not a role

  // 2. store it so it shows up in their notification list / unread count
  await db.query(
    "INSERT INTO notifications (title, message, target) VALUES (?, ?, ?)",
    [title, message, target],
  );

  // 3. push it live to that faculty member's personal socket room
  io.to(target).emit("new notification", { title, message, target });
  io.to(target).emit("new_notification", { title, message, target });
}

app.put("/admin/faculty-leaves/:id/approve", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    await db.query(
      `UPDATE Faculty_Leave SET status='Approved' WHERE leave_Id=?`,
      [req.params.id],
    );

    await notifyFacultyLeaveDecision(req.params.id, "Approved");

    res.json({ message: "Leave Approved Successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json(err);
  }
});

app.put("/admin/faculty-leaves/:id/reject", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    await db.query(
      `UPDATE Faculty_Leave SET status='Rejected' WHERE leave_Id=?`,
      [req.params.id],
    );

    await notifyFacultyLeaveDecision(req.params.id, "Rejected");

    res.json({ message: "Leave Rejected Successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json(err);
  }
});

app.get("/admin/faculty-leaves", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const [result] = await db.query(`
      SELECT fl.leave_Id,
             fl.faculty_Id,
             f.first_name,
             f.last_name,
             fl.from_date,
             fl.to_date,
             fl.reason,
             fl.status,
             fl.applied_on
      FROM Faculty_Leave fl
      JOIN Faculty f
      ON fl.faculty_Id = f.faculty_Id
      ORDER BY fl.applied_on DESC
    `);

    res.json(result);
  } catch (err) {
    console.error(err);

    res.status(500).json(err);
  }
});

// -- ADMIN - UPLOAD PDF
app.post(
  "/admin/upload-pdf",
  requireRole("admin"),
  csrfProtection,
  upload.single("pdf"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });

    try {
      const detected = await fileTypeFromFile(req.file.path);

      if (!detected || detected.mime !== "application/pdf") {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: "File content is not a valid PDF" });
      }

      res.json({
        url: `/uploads/pdfs/${req.file.filename}`,
        name: req.file.originalname,
      });
    } catch (err) {
      console.error("PDF validation error:", err);
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ error: "Unable to process uploaded file" });
    }
  },
);

app.get("/admin/departments", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const [rows] = await db.query("SELECT dept_Id, dept_name FROM Department");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------- DEPARTMENTS -------------
app.get("/admin/departments/full", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const [result] = await db.query(`
      SELECT d.dept_Id, d.dept_name, d.HOD_Id,
             CONCAT(f.first_name,' ',f.last_name) AS hod_name
      FROM Department d
      LEFT JOIN Faculty f ON d.HOD_Id = f.faculty_Id
      ORDER BY d.dept_Id
    `);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/departments", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const { dept_name } = req.body;
    if (!dept_name)
      return res.status(400).json({ error: "dept_name required" });
    await db.query("INSERT INTO Department (dept_name) VALUES (?)", [
      dept_name,
    ]);
    res.json({ message: "Department created successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/admin/departments/:id/hod", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    const { hod_Id } = req.body;
    await db.query("UPDATE Department SET HOD_Id = ? WHERE dept_Id = ?", [
      hod_Id || null,
      id,
    ]);
    res.json({ message: "HOD updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/departments/:id", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const { id } = req.params;
    await db.query("DELETE FROM Department WHERE dept_Id = ?", [id]);
    res.json({ message: "Department deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------- ENROLLMENTS -------------
app.get("/admin/enrollments", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const [result] = await db.query(`
      SELECT e.enroll_Id,
             e.student_Id,
             CONCAT(s.first_name,' ',s.last_name) AS student_name,
             e.course_Id,
             c.course_name,
             e.semester,
             e.year
      FROM Enrollments e
      JOIN Students s ON e.student_Id = s.student_Id
      JOIN Courses c ON e.course_Id = c.course_Id
      ORDER BY e.enroll_Id DESC
    `);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/enrollments", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const { student_Id, course_Id, semester, year } = req.body;
    if (!student_Id || !course_Id || !semester || !year)
      return res.status(400).json({ error: "All fields required" });

    // Check duplicate
    const [existing] = await db.query(
      "SELECT enroll_Id FROM Enrollments WHERE student_Id=? AND course_Id=?",
      [student_Id, course_Id],
    );
    if (existing.length > 0)
      return res
        .status(409)
        .json({ error: "Student already enrolled in this course" });

    await db.query(
      "INSERT INTO Enrollments (student_Id, course_Id, semester, year) VALUES (?,?,?,?)",
      [student_Id, course_Id, semester, year],
    );
    res.json({ message: "Student enrolled successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/enrollments/:id", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    await db.query("DELETE FROM Enrollments WHERE enroll_Id=?", [
      req.params.id,
    ]);
    res.json({ message: "Enrollment removed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------- TEACHES, Assigning Courses to Faculty -------------
app.get("/admin/teaches", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const [result] = await db.query(`
      SELECT t.teach_Id,
             t.faculty_Id,
             CONCAT(f.first_name,' ',f.last_name) AS faculty_name,
             t.course_Id,
             c.course_name,
             t.section,
             t.semester,
             t.year
      FROM Teaches t
      JOIN Faculty f ON t.faculty_Id = f.faculty_Id
      JOIN Courses c ON t.course_Id = c.course_Id
      ORDER BY t.teach_Id DESC
    `);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/teaches", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    const { faculty_Id, course_Id, section, semester, year } = req.body;
    if (!faculty_Id || !course_Id || !section || !semester || !year)
      return res.status(400).json({ error: "All fields required" });

    const [existing] = await db.query(
      "SELECT teach_Id FROM Teaches WHERE faculty_Id=? AND course_Id=? AND semester=? AND year=?",
      [faculty_Id, course_Id, semester, year],
    );
    if (existing.length > 0)
      return res.status(409).json({
        error: "This faculty already teaches this course in that semester/year",
      });

    await db.query(
      "INSERT INTO Teaches (faculty_Id, course_Id, section, semester, year) VALUES (?,?,?,?,?)",
      [faculty_Id, course_Id, section, semester, year],
    );
    res.json({ message: "Teaching assignment created successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/teaches/:id", requireRole("admin"), csrfProtection, async (req, res) => {
  try {
    await db.query("DELETE FROM Teaches WHERE teach_Id=?", [req.params.id]);
    res.json({ message: "Teaching assignment removed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------- FORGOT PASSWORD ----------------
app.post("/forgot-password", sensitiveLimiter, csrfProtection, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  try {
    // 1. Find the user by email in Students or Faculty table
    const [studentRows] = await db.query(
      "SELECT u.user_Id, u.username FROM Users u JOIN Students s ON u.user_Id = s.user_Id WHERE s.email = ?",
      [email],
    );

    const [facultyRows] = await db.query(
      "SELECT u.user_Id, u.username FROM Users u JOIN Faculty f ON u.user_Id = f.user_Id WHERE f.email = ?",
      [email],
    );

    const user = studentRows[0] || facultyRows[0];

    if (!user) {
      // Don't reveal whether email exists for security
      return res.json({
        message: "If this email is registered, a reset link has been sent.",
      });
    }

    // 2. Generate a secure random token
    const token = crypto.randomBytes(32).toString("hex");

    // 3. Set expiry — 1 hour from now
    const expiresFormatted = new Date(Date.now() + 60 * 60 * 1000)
      .toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" })
      .replace("T", " ");

    // 4. Invalidate any existing tokens for this user
    await db.query(
      "UPDATE password_reset_tokens SET used = 1 WHERE user_Id = ?",
      [user.user_Id],
    );

    // 5. Save the new token
    await db.query(
      "INSERT INTO password_reset_tokens (user_Id, token, expires_at) VALUES (?, ?, ?)",
      [user.user_Id, token, expiresFormatted],
    );

    // 6. Build the reset link
    const baseUrl =
      process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const resetLink = `${baseUrl}/reset-password.html?token=${token}`;

    // 7. Send the email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });
    await transporter.sendMail({
      from: `"Institute Portal" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: "Password Reset Request",
      html: `
        <div style="font-family: Inter, sans-serif; max-width: 500px; margin: auto; padding: 30px; border: 1px solid #dbe3ef; border-radius: 16px;">
          <h2 style="color: #1d4ed8;">Reset Your Password</h2>
          <p>Hi <strong>${user.username}</strong>,</p>
          <p>We received a request to reset your password. Click the button below to proceed:</p>
          <a href="${resetLink}" style="display:inline-block; margin: 20px 0; padding: 14px 28px; background: linear-gradient(135deg,#1d4ed8,#1e3a8a); color: white; border-radius: 12px; text-decoration: none; font-weight: bold;">
            Reset Password
          </a>
          <p style="color: #64748b; font-size: 0.9rem;">This link expires in <strong>1 hour</strong>. If you didn't request this, ignore this email.</p>
        </div>
      `,
    });

    res.json({
      message: "If this email is registered, a reset link has been sent.",
    });
  } catch (err) {
    console.error("Forgot password error:", err);
    res
      .status(500)
      .json({ message: "Something went wrong. Please try again." });
  }
});

// ---------------- RESET PASSWORD ----------------
app.post("/reset-password", csrfProtection, async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res
      .status(400)
      .json({ message: "Token and new password are required." });
  }

  try {
    const [validRows] = await db.query(
      `SELECT * FROM password_reset_tokens 
       WHERE token = ? AND used = 0 AND expires_at > NOW()`,
      [token],
    );

    if (validRows.length === 0) {
      return res
        .status(400)
        .json({ message: "This reset link is invalid or has expired." });
    }

    const resetRecord = validRows[0];

    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    await db.query("UPDATE Users SET password = ? WHERE user_Id = ?", [
      hashedPassword,
      resetRecord.user_Id,
    ]);

    await db.query("UPDATE password_reset_tokens SET used = 1 WHERE id = ?", [
      resetRecord.id,
    ]);

    res.json({ message: "Password updated successfully! You can now log in." });
  } catch (err) {
    console.error("Reset password error:", err);
    res
      .status(500)
      .json({ message: "Something went wrong. Please try again." });
  }
});

app.post("/force-reset-password", csrfProtection, async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: "Please log in." });
  }

  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters." });
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    await db.query(
      "UPDATE Users SET password = ?, must_reset_password = 0 WHERE user_Id = ?",
      [hashedPassword, req.session.user.id],
    );
    req.session.user.mustReset = false;
    res.json({ message: "Password updated successfully." });
  } catch (err) {
    console.error("Force reset error:", err);
    res.status(500).json({ message: "Something went wrong." });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === "Only PDF files are allowed") {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// -- SERVER
const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}/login.html`),
);
