const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { parse: parseCsv } = require("csv-parse/sync");
const { requireRole } = require("../middleware/auth");

const saltRounds = 10;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^[0-9]{7,15}$/;
const nameRegex = /^[A-Za-z][A-Za-z\s'-]{0,49}$/;
const dobRegex = /^\d{4}-\d{2}-\d{2}$/;

// Multer configurations for PDF uploads
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

// Multer configuration for CSV uploads
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB cap
  fileFilter: (req, file, cb) => {
    const isCsvExt = path.extname(file.originalname).toLowerCase() === ".csv";
    cb(null, isCsvExt);
  },
});

let fileTypeFromFile;

// Helper to notify faculty of leave request decisions
async function notifyFacultyLeaveDecision(db, io, leaveId, decision) {
  const [rows] = await db.query(
    `SELECT f.user_Id, f.first_name, f.last_name
     FROM Faculty_Leave fl
     JOIN Faculty f ON fl.faculty_Id = f.faculty_Id
     WHERE fl.leave_Id = ?`,
    [leaveId],
  );

  if (rows.length === 0) return;

  const { user_Id, first_name } = rows[0];

  const title = `Leave Request ${decision}`;
  const message = `Hi ${first_name}, your leave request has been ${decision.toLowerCase()} by the admin.`;
  const target = `user_${user_Id}`;

  await db.query(
    "INSERT INTO notifications (title, message, target) VALUES (?, ?, ?)",
    [title, message, target],
  );

  if (io) {
    io.to(target).emit("new notification", { title, message, target });
    io.to(target).emit("new_notification", { title, message, target });
  }
}

// ------------- STUDENTS CRUD -------------
router.get("/admin/students", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
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

router.get("/admin/students/export", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  try {
    const [rows] = await db.query(
      `SELECT student_Id, first_name, last_name, email, phone, DOB, admission_date, dept_Id
       FROM Students ORDER BY student_Id`,
    );

    const header = "student_Id,first_name,last_name,email,phone,DOB,admission_date,dept_Id";

    const csvEscape = (val) => {
      if (val === null || val === undefined) return "";
      let str = String(val);
      if (/^[=+\-@]/.test(str)) {
        str = "'" + str;
      }
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

router.post(
  "/admin/students/import",
  requireRole("admin"),
  csvUpload.single("file"),
  async (req, res) => {
    const db = req.app.get("db");
    if (!req.file) {
      return res.status(400).json({ error: "No CSV file uploaded, or file must be .csv" });
    }

    const { isUtf8 } = require("buffer");
    if (!isUtf8(req.file.buffer)) {
      return res.status(400).json({ error: "File content is not valid UTF-8 text." });
    }

    const fileContent = req.file.buffer.toString("utf-8");
    if (fileContent.includes("\0")) {
      return res.status(400).json({ error: "File content contains binary characters." });
    }

    try {
      let records;
      try {
        records = parseCsv(fileContent, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });
      } catch (parseErr) {
        return res.status(400).json({ error: "Failed to parse CSV. Please check the file format." });
      }

      if (records.length === 0) {
        return res.status(400).json({ error: "CSV file is empty." });
      }
      if (records.length > 500) {
        return res.status(400).json({ error: "Import limited to 500 rows per file." });
      }

      const [depts] = await db.query("SELECT dept_Id, dept_name FROM Department");
      const deptIdSet = new Set(depts.map((d) => String(d.dept_Id)));
      const deptNameMap = new Map(depts.map((d) => [d.dept_name.trim().toLowerCase(), d.dept_Id]));

      const [existingStudents] = await db.query("SELECT student_Id, email, phone FROM Students");
      const existingIds = new Set(existingStudents.map((s) => s.student_Id));
      const existingEmails = new Set(existingStudents.map((s) => (s.email || "").toLowerCase()));
      const existingPhones = new Set(existingStudents.map((s) => s.phone));

      const seenIdsInFile = new Set();
      const seenEmailsInFile = new Set();
      const seenPhonesInFile = new Set();

      const validRows = [];
      const errors = [];

      records.forEach((row, idx) => {
        const rowNum = idx + 2;
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

router.post("/admin/students", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  try {
    const { student_Id, first_name, last_name, email, phone, DOB, dept_Id } = req.body;

    if (!student_Id || student_Id.trim().length > 15) {
      return res.status(400).json({ error: "Invalid or missing student_Id (max 15 chars)." });
    }
    if (!first_name || !nameRegex.test(first_name.trim())) {
      return res.status(400).json({ error: "Invalid or missing first_name." });
    }
    if (!last_name || !nameRegex.test(last_name.trim())) {
      return res.status(400).json({ error: "Invalid or missing last_name." });
    }
    if (!email || !emailRegex.test(email.trim())) {
      return res.status(400).json({ error: "Invalid or missing email." });
    }
    if (!phone || !phoneRegex.test(phone.trim())) {
      return res.status(400).json({ error: "Invalid or missing phone (7-15 digits)." });
    }
    if (!DOB || !dobRegex.test(DOB.trim()) || new Date(DOB) > new Date()) {
      return res.status(400).json({ error: "Invalid DOB or cannot be in the future (expected YYYY-MM-DD)." });
    }
    if (!dept_Id) {
      return res.status(400).json({ error: "Missing dept_Id." });
    }

    const username = first_name.trim().concat(last_name.trim()).toLowerCase().replace(/[^a-z0-9]/g, "");
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
        [student_Id.trim(), first_name.trim(), last_name.trim(), email.trim(), phone.trim(), DOB.trim(), dept_Id, newUserId],
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
    console.error("POST /admin/students error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.delete("/admin/students/:id", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  try {
    const { id } = req.params;

    const [result] = await db.query(
      "SELECT user_Id FROM Students WHERE student_Id=?",
      [id],
    );

    if (result.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    const userId = result[0].user_Id;

    await db.query("DELETE FROM Students WHERE student_Id=?", [id]);
    await db.query("DELETE FROM Users WHERE user_Id=?", [userId]);

    res.json({ message: "Student and linked User deleted successfully!" });
  } catch (err) {
    console.error("DELETE /admin/students error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.put("/admin/students/:id", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
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

// ------------- FACULTY CRUD -------------
router.get("/admin/faculty", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
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

router.post("/admin/faculty", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  try {
    const { first_name, last_name, email, phone, designation, dept_Id } = req.body;

    if (!first_name || !nameRegex.test(first_name.trim())) {
      return res.status(400).json({ error: "Invalid or missing first_name." });
    }
    if (!last_name || !nameRegex.test(last_name.trim())) {
      return res.status(400).json({ error: "Invalid or missing last_name." });
    }
    if (!email || !emailRegex.test(email.trim())) {
      return res.status(400).json({ error: "Invalid or missing email." });
    }
    if (!phone || !phoneRegex.test(phone.trim())) {
      return res.status(400).json({ error: "Invalid or missing phone (7-15 digits)." });
    }
    if (!designation || !designation.trim()) {
      return res.status(400).json({ error: "Invalid or missing designation." });
    }
    if (!dept_Id) {
      return res.status(400).json({ error: "Missing dept_Id." });
    }

    const username = (first_name.trim() + last_name.trim()).toLowerCase().replace(/[^a-z0-9]/g, "");
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
        [first_name.trim(), last_name.trim(), email.trim(), phone.trim(), designation.trim(), dept_Id, newUserId],
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
    console.error("POST /admin/faculty error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.delete("/admin/faculty/:id", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  try {
    const { id } = req.params;

    const [result] = await db.query(
      "SELECT user_Id FROM Faculty WHERE faculty_Id=?",
      [id],
    );

    if (result.length === 0) {
      return res.status(404).json({ error: "Faculty not found" });
    }

    const [teaches] = await db.query("SELECT teach_Id FROM Teaches WHERE faculty_Id = ?", [id]);
    const [leaves] = await db.query("SELECT leave_Id FROM Faculty_Leave WHERE faculty_Id = ?", [id]);
    if (teaches.length > 0 || leaves.length > 0) {
      return res.status(409).json({
        error: "Cannot delete: faculty member has active teaching assignments or leave records.",
      });
    }

    const userId = result[0].user_Id;

    await db.query("DELETE FROM Faculty WHERE faculty_Id=?", [id]);
    await db.query("DELETE FROM Users WHERE user_Id=?", [userId]);

    res.json({ message: "Faculty and linked User deleted successfully!" });
  } catch (err) {
    console.error("DELETE /admin/faculty error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.put("/admin/faculty/:id", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
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

// ------------- COURSES CRUD -------------
router.get("/admin/courses", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
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

router.post("/admin/courses", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  try {
    const { course_Id, course_name, credits, dept_Id } = req.body;

    await db.query(
      `INSERT INTO Courses
       (course_Id, course_name, credits, dept_Id)
       VALUES (?, ?, ?, ?)`,
      [course_Id, course_name, credits, dept_Id],
    );

    res.json({ message: "Course added successfully" });
  } catch (err) {
    console.error("POST /admin/courses error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.delete("/admin/courses/:id", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  try {
    const { id } = req.params;

    const [teaches] = await db.query("SELECT teach_Id FROM Teaches WHERE course_Id = ?", [id]);
    const [enrollments] = await db.query("SELECT enroll_Id FROM Enrollments WHERE course_Id = ?", [id]);
    if (teaches.length > 0 || enrollments.length > 0) {
      return res.status(409).json({
        error: "Cannot delete: course has active teaching assignments or enrollments.",
      });
    }

    await db.query("DELETE FROM Courses WHERE course_Id=?", [id]);
    res.json({ message: "Course deleted successfully" });
  } catch (err) {
    console.error("DELETE /admin/courses error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.put("/admin/courses/:id", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
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

// ------------- DEPARTMENTS -------------
router.get("/admin/departments", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  try {
    const [rows] = await db.query("SELECT dept_Id, dept_name FROM Department");
    res.json(rows);
  } catch (err) {
    console.error("GET /admin/departments error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.get("/admin/departments/full", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
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
    console.error("GET /admin/departments/full error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/admin/departments", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  try {
    const { dept_name } = req.body;
    if (!dept_name)
      return res.status(400).json({ error: "dept_name required" });
    await db.query("INSERT INTO Department (dept_name) VALUES (?)", [dept_name]);
    res.json({ message: "Department created successfully" });
  } catch (err) {
    console.error("POST /admin/departments error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.put("/admin/departments/:id/hod", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  try {
    const { id } = req.params;
    const { hod_Id } = req.body;
    await db.query("UPDATE Department SET HOD_Id = ? WHERE dept_Id = ?", [
      hod_Id || null,
      id,
    ]);
    res.json({ message: "HOD updated successfully" });
  } catch (err) {
    console.error("PUT /admin/departments/:id/hod error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.delete("/admin/departments/:id", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  try {
    const { id } = req.params;
    await db.query("DELETE FROM Department WHERE dept_Id = ?", [id]);
    res.json({ message: "Department deleted successfully" });
  } catch (err) {
    console.error("DELETE /admin/departments error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ------------- ENROLLMENTS -------------
router.get("/admin/enrollments", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
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
    console.error("GET /admin/enrollments error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/admin/enrollments", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  try {
    const { student_Id, course_Id, semester, year } = req.body;
    if (!student_Id || !course_Id || !semester || !year)
      return res.status(400).json({ error: "All fields required" });

    const [existing] = await db.query(
      "SELECT enroll_Id FROM Enrollments WHERE student_Id=? AND course_Id=?",
      [student_Id, course_Id],
    );
    if (existing.length > 0)
      return res.status(409).json({ error: "Student already enrolled in this course" });

    await db.query(
      "INSERT INTO Enrollments (student_Id, course_Id, semester, year) VALUES (?,?,?,?)",
      [student_Id, course_Id, semester, year],
    );
    res.json({ message: "Student enrolled successfully" });
  } catch (err) {
    console.error("POST /admin/enrollments error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.delete("/admin/enrollments/:id", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  try {
    await db.query("DELETE FROM Enrollments WHERE enroll_Id=?", [req.params.id]);
    res.json({ message: "Enrollment removed successfully" });
  } catch (err) {
    console.error("DELETE /admin/enrollments error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ------------- TEACHES -------------
router.get("/admin/teaches", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
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
    console.error("GET /admin/teaches error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/admin/teaches", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
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
    console.error("POST /admin/teaches error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.delete("/admin/teaches/:id", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  try {
    await db.query("DELETE FROM Teaches WHERE teach_Id=?", [req.params.id]);
    res.json({ message: "Teaching assignment removed successfully" });
  } catch (err) {
    console.error("DELETE /admin/teaches error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ------------- LEAVES APPROVALS -------------
router.get("/admin/faculty-leaves", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
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
    console.error("GET /admin/faculty-leaves error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.put("/admin/faculty-leaves/:id/approve", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  const io = req.app.get("io");
  try {
    await db.query(
      `UPDATE Faculty_Leave SET status='Approved' WHERE leave_Id=?`,
      [req.params.id],
    );

    await notifyFacultyLeaveDecision(db, io, req.params.id, "Approved");
    res.json({ message: "Leave Approved Successfully" });
  } catch (err) {
    console.error("PUT /admin/faculty-leaves/approve error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.put("/admin/faculty-leaves/:id/reject", requireRole("admin"), async (req, res) => {
  const db = req.app.get("db");
  const io = req.app.get("io");
  try {
    await db.query(
      `UPDATE Faculty_Leave SET status='Rejected' WHERE leave_Id=?`,
      [req.params.id],
    );

    await notifyFacultyLeaveDecision(db, io, req.params.id, "Rejected");
    res.json({ message: "Leave Rejected Successfully" });
  } catch (err) {
    console.error("PUT /admin/faculty-leaves/reject error:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// ------------- FILE UPLOADS -------------
router.post(
  "/admin/upload-pdf",
  requireRole("admin"),
  upload.single("pdf"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No PDF uploaded" });

    try {
      if (!fileTypeFromFile) {
        const ft = await import("file-type");
        fileTypeFromFile = ft.fileTypeFromFile;
      }
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

module.exports = router;
