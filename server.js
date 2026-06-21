const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const notificationsRoutes = require("./routes/notifications");
const session = require("express-session");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const saltRounds = 10;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

app.use(
  session({
    secret: "InstitutePortal",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 60 * 60 * 1000 },
  }),
); // session configuration

// ---------------- DATABASE CONNECTION ----------------
const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "Gabbhii@18",
  database: "institute",
});

db.getConnection()
  .then(() => console.log("Connected to MySQL Database"))
  .catch(err => console.error("Database connection failed:", err));

db.query(`
  CREATE TABLE IF NOT EXISTS notifications (
    notification_Id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    target VARCHAR(50) NOT NULL,
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
      socket.join("all");
      console.log(`Socket ${socket.id} joined room: ${role} + all`);
    }
  });
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// ---------------- LOGIN ----------------
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    const [results] = await db.query(
      "SELECT * FROM Users WHERE username=?",
      [username]
    );

    if (results.length === 0) {
      return res.status(401).json({
        message: "Invalid username",
        error: `No user found for username: ${username}`,
      });
    }

    const match = await bcrypt.compare(
      password,
      results[0].password
    );

    if (!match) {
      return res.status(401).json({
        message: "Invalid password",
        error: `Password does not match for username: ${username}`,
      });
    }

    req.session.user = {
      id: results[0].user_Id,
      name: results[0].username,
      role: results[0].role,
    };

    res.json({ user: results[0] });

  } catch (err) {
    console.error("Login failed:", err);
    res.status(500).json({
      message: "Database error",
      error: err.message,
    });
  }
});

app.post("/signup", async (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({
      success: false,
      message: "Please provide username, password, and role.",
    });
  }

  if (!["student", "faculty"].includes(role)) {
    return res.status(400).json({
      success: false,
      message: "Role must be either student or faculty.",
    });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    await db.query(
      "INSERT INTO Users (username, password, role) VALUES (?, ?, ?)",
      [username, hashedPassword, role]
    );

    res.json({
      success: true,
      message: "Account created successfully.",
    });

  } catch (err) {
    console.error("Signup failed:", err);

    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Username already exists.",
      });
    }

    res.status(500).json({
      success: false,
      message: "Database error creating account.",
    });
  }
});


// ---------------- STUDENT DASHBOARD ----------------
app.get("/student/:userId", async (req, res) => {
  const userId = req.params.userId;

  try {
    const studentQuery = `
      SELECT s.student_Id, s.first_name, s.last_name,
             s.email, s.phone, s.DOB, d.dept_name
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

    const [courses] = await db.query(
      coursesQuery,
      [student.student_Id]
    );

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

    const [attendance] = await db.query(
      attendanceQuery,
      [student.student_Id]
    );

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
app.get("/student/:userId/attendance-summary", async (req, res) => {
  const { userId } = req.params;

  try {
    // 1. Find the student
    const [studentResults] = await db.query(
      "SELECT student_Id FROM Students WHERE user_Id = ?",
      [userId]
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
      [studentId]
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
      [studentId]
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
app.get("/faculty/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const [faculty] = await db.query(
      `SELECT f.faculty_Id, f.first_name, f.last_name, f.email, f.phone, f.designation, f.join_date, d.dept_name
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
app.get("/admin/students", async (req, res) => {
  try {
    const [result] = await db.query(
      "SELECT * FROM Students"
    );

    res.json(result);

  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

app.post("/admin/students", async (req, res) => {
  try {
    const {
      student_Id,
      first_name,
      last_name,
      email,
      phone,
      DOB,
      dept_Id,
    } = req.body;

    const username =
      first_name.concat(last_name).toLowerCase();

    const password =
      username + "123";

    const hashedPassword =
      await bcrypt.hash(password, saltRounds);

    const [userResult] = await db.query(
      "INSERT INTO Users (username, password, role) VALUES (?, ?, 'student')",
      [username, hashedPassword]
    );

    const newUserId = userResult.insertId;

    try {
      await db.query(
        `INSERT INTO Students
        (student_Id, first_name, last_name, email, phone, DOB,
         admission_date, dept_Id, user_Id)
         VALUES (?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
        [
          student_Id,
          first_name,
          last_name,
          email,
          phone,
          DOB,
          dept_Id,
          newUserId,
        ]
      );

      res.json({
        message:
          "Student and User created successfully!",
        login: { username, password },
      });

    } catch (studentErr) {

      await db.query(
        "DELETE FROM Users WHERE user_Id=?",
        [newUserId]
      );

      throw studentErr;
    }

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: err.message,
    });
  }
});

app.delete("/admin/students/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      "SELECT user_Id FROM Students WHERE student_Id=?",
      [id]
    );

    if (result.length === 0) {
      return res.status(404).json({
        error: "Student not found",
      });
    }

    const userId = result[0].user_Id;

    await db.query(
      "DELETE FROM Students WHERE student_Id=?",
      [id]
    );

    await db.query(
      "DELETE FROM Users WHERE user_Id=?",
      [userId]
    );

    res.json({
      message:
        "Student and linked User deleted successfully!",
    });

  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});


// FACULTY CRUD — auto user linking

app.get("/admin/faculty", async (req, res) => {
  try {
    const [result] =
      await db.query("SELECT * FROM Faculty");

    res.json(result);

  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

// ---------------- ADD FACULTY ----------------
app.post("/admin/faculty", async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      phone,
      designation,
      dept_Id,
    } = req.body;

    const username =
      (first_name + last_name).toLowerCase();

    const password =
      username + "123";

    const hashedPassword =
      await bcrypt.hash(password, saltRounds);

    const [userResult] = await db.query(
      "INSERT INTO Users (username, password, role) VALUES (?, ?, 'faculty')",
      [username, hashedPassword]
    );

    const newUserId = userResult.insertId;

    try {
      await db.query(
        `INSERT INTO Faculty
        (first_name, last_name, email, phone,
         designation, join_date, dept_Id, user_Id)
         VALUES (?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
        [
          first_name,
          last_name,
          email,
          phone,
          designation,
          dept_Id,
          newUserId,
        ]
      );

      res.json({
        message:
          "Faculty and User created successfully!",
        login: { username, password },
      });

    } catch (facultyErr) {

      await db.query(
        "DELETE FROM Users WHERE user_Id=?",
        [newUserId]
      );

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
app.delete("/admin/faculty/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await db.query(
      "SELECT user_Id FROM Faculty WHERE faculty_Id=?",
      [id]
    );

    if (result.length === 0) {
      return res.status(404).json({
        error: "Faculty not found",
      });
    }

    const userId = result[0].user_Id;

    await db.query(
      "DELETE FROM Faculty WHERE faculty_Id=?",
      [id]
    );

    await db.query(
      "DELETE FROM Users WHERE user_Id=?",
      [userId]
    );

    res.json({
      message:
        "Faculty and linked User deleted successfully!",
    });

  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

// ------------- COURSES -------------
app.get("/admin/courses", async (req, res) => {
  try {
    const [result] =
      await db.query("SELECT * FROM Courses");

    res.json(result);

  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

app.post("/admin/courses", async (req, res) => {
  try {
    const {
      course_Id,
      course_name,
      credits,
      dept_Id,
    } = req.body;

    await db.query(
      `INSERT INTO Courses
       (course_Id, course_name, credits, dept_Id)
       VALUES (?, ?, ?, ?)`,
      [
        course_Id,
        course_name,
        credits,
        dept_Id,
      ]
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

app.delete("/admin/courses/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      "DELETE FROM Courses WHERE course_Id=?",
      [id]
    );

    res.json({
      message: "Course deleted successfully",
    });

  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

// FACULTY - GET STUDENTS OF A COURSE
app.get("/faculty/course/:courseId/students", async (req, res) => {
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
      [courseId]
    );

    res.json(result);

  } catch (err) {
    res.status(500).json(err);
  }
});

// FACULTY - SAVE ATTENDANCE
app.post("/faculty/attendance", async (req, res) => {
  try {
    const { courseId, date, attendance } =
      req.body;

    const [existing] = await db.query(
      `SELECT *
       FROM Attendance
       WHERE course_Id=?
       AND Attd_Date=?`,
      [courseId, date]
    );

    if (existing.length > 0) {
      return res.json({
        message:
          "Attendance already marked for this date.",
      });
    }

    const sql =
      `INSERT INTO Attendance
       (student_Id, course_Id,
        Attd_Date, Status)
       VALUES (?, ?, ?, ?)`;

    for (const student of attendance) {
      await db.query(sql, [
        student.studentId,
        courseId,
        date,
        student.status,
      ]);
    }

    res.json({
      message:
        "Attendance Saved Successfully",
    });

  } catch (err) {
    console.error(err);

    res.status(500).json(err);
  }
});

// =====================================================
// FACULTY - APPLY LEAVE
// =====================================================
app.post("/faculty/apply-leave", async (req, res) => {
  try {
    const {
      facultyId,
      fromDate,
      toDate,
      reason,
    } = req.body;

    if (
      !facultyId ||
      !fromDate ||
      !toDate ||
      !reason
    ) {
      return res.status(400).json({
        message:
          "Missing leave application fields.",
      });
    }

    const [lookupResult] =
      await db.query(
        `SELECT faculty_Id
         FROM Faculty
         WHERE user_Id=?
         OR faculty_Id=?
         LIMIT 1`,
        [facultyId, facultyId]
      );

    if (lookupResult.length === 0) {
      return res.status(404).json({
        message:
          "Faculty record not found.",
      });
    }

    const realFacultyId =
      lookupResult[0].faculty_Id;

    await db.query(
      `INSERT INTO Faculty_Leave
       (faculty_Id, from_date,
        to_date, reason)
       VALUES (?, ?, ?, ?)`,
      [
        realFacultyId,
        fromDate,
        toDate,
        reason,
      ]
    );

    res.json({
      message:
        "Leave Applied Successfully",
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      message:
        "Failed to Apply Leave.",
    });
  }
});

// ADMIN - PROCESS FACULTY LEAVE REQUESTS
app.put(
  "/admin/faculty-leaves/:id/approve",
  async (req, res) => {
    try {
      await db.query(
        `UPDATE Faculty_Leave
         SET status='Approved'
         WHERE leave_Id=?`,
        [req.params.id]
      );

      res.json({
        message:
          "Leave Approved Successfully",
      });

    } catch (err) {
      res.status(500).json(err);
    }
  }
);

app.put(
  "/admin/faculty-leaves/:id/reject",
  async (req, res) => {
    try {
      await db.query(
        `UPDATE Faculty_Leave
         SET status='Rejected'
         WHERE leave_Id=?`,
        [req.params.id]
      );

      res.json({
        message:
          "Leave Rejected Successfully",
      });

    } catch (err) {
      res.status(500).json(err);
    }
  }
);

app.get("/admin/faculty-leaves", async (req, res) => {
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

// ---------------- SERVER ----------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}/login.html`),
);
