const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const cors = require("cors");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const notificationsRoutes = require("./routes/notifications");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const saltRounds = 10;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// ---------------- DATABASE CONNECTION ----------------
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "niku@enduku",
  database: "institute",
});

db.connect((err) => {
  if (err) console.error("Database connection failed:", err);
  else console.log("Connected to MySQL Database");
});

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
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// ---------------- LOGIN ----------------
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  db.query(
    "SELECT * FROM Users WHERE username=?",
    [username],
    async (err, results) => {
      if (err) {
        console.error("Login query failed:", err.sqlMessage || err.message);
        return res.status(500).json({ message: "Database error", error: err.message });
      }
      if (results.length === 0) {
        return res.status(401).json({
          message: "Invalid username",
          error: `No user found for username: ${username}`,
        });
      }

      const match = await bcrypt.compare(password, results[0].password);
      if (!match) {
        return res.status(401).json({
          message: "Invalid password",
          error: `Password does not match for username: ${username}`,
        });
      }

      res.json({ user: results[0] });
    }
  );
});

app.post("/signup", async (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ success: false, message: "Please provide username, password, and role." });
  }

  if (!["student", "faculty"].includes(role)) {
    return res.status(400).json({ success: false, message: "Role must be either student or faculty." });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    db.query(
      "INSERT INTO Users (username, password, role) VALUES (?, ?, ?)",
      [username, hashedPassword, role],
      (err) => {
        if (err) {
          console.error("Signup failed:", err.sqlMessage || err.message);
          if (err.code === "ER_DUP_ENTRY" || err.errno === 1062) {
            return res.status(409).json({ success: false, message: "Username already exists." });
          }
          return res.status(500).json({ success: false, message: "Database error creating account." });
        }
        res.json({ success: true, message: "Account created successfully." });
      }
    );
  } catch (hashError) {
    console.error("Password hashing failed:", hashError.message);
    res.status(500).json({ success: false, message: "Unable to create account." });
  }
});

// ---------------- STUDENT DASHBOARD ----------------
app.get("/student/:userId", (req, res) => {
  const userId = req.params.userId;
  const studentQuery = `
    SELECT s.student_Id, s.first_name, s.last_name, s.email, s.phone, s.DOB, d.dept_name
    FROM Students s
    JOIN Department d ON s.dept_Id = d.dept_Id
    WHERE s.user_Id = ?;
  `;
  db.query(studentQuery, [userId], (err, studentResults) => {
    if (err) return res.status(500).json({ error: err.message });
    if (studentResults.length === 0)
      return res.status(404).json({ message: "Student not found" });

    const student = studentResults[0];

    const coursesQuery = `
      SELECT c.course_Id, c.course_name, CONCAT(f.first_name, ' ', f.last_name) AS faculty_name
      FROM Enrollments e
      JOIN Courses c ON e.course_Id = c.course_Id
      JOIN Teaches t ON c.course_Id = t.course_Id
      JOIN Faculty f ON t.faculty_Id = f.faculty_Id
      WHERE e.student_Id = ?;
    `;
    db.query(coursesQuery, [student.student_Id], (err, courses) => {
      if (err) return res.status(500).json({ error: err.message });

      const attendanceQuery = `
        SELECT Attd_Date, course_Id,
               CASE WHEN Status='P' THEN 'Present' ELSE 'Absent' END AS Status
        FROM Attendance
        WHERE student_Id = ?;
      `;
      db.query(attendanceQuery, [student.student_Id], (err, attendance) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ student, courses, attendance });
      });
    });
  });
});

// ---------------- FACULTY DASHBOARD ----------------
app.get("/faculty/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const [faculty] = await db.promise().query(
      `SELECT f.faculty_Id, f.first_name, f.last_name, f.email, f.phone, f.designation, f.join_date, d.dept_name
       FROM Faculty f
       JOIN Department d ON f.dept_Id = d.dept_Id
       WHERE f.user_Id = ?`,
      [userId]
    );

    if (faculty.length === 0)
      return res.status(404).json({ message: "Faculty not found" });

    const facultyId = faculty[0].faculty_Id;

    const [teaches] = await db.promise().query(
      `SELECT t.course_Id, c.course_name, t.section, t.semester, t.year
       FROM Teaches t
       JOIN Courses c ON t.course_Id = c.course_Id
       WHERE t.faculty_Id = ?`,
      [facultyId]
    );

    res.json({ faculty: faculty[0], teaches });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching faculty details" });
  }
});

// ======================================================
// 🔹 ADMIN DASHBOARD ROUTES (Students / Faculty / Courses)
// ======================================================

// ------------- STUDENTS -------------
app.get("/admin/students", (req, res) => {
  db.query("SELECT * FROM Students", (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

app.post("/admin/students", async (req, res) => {
  const {
    student_Id,
    first_name,
    last_name,
    email,
    phone,
    DOB,
    dept_Id
  } = req.body;

  // auto-generate login credentials
  const username = (first_name.concat(last_name)).toLowerCase(); 
  const password = (first_name.concat(last_name)).toLowerCase() + "123"; 
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  const userQuery = "INSERT INTO Users (username, password, role) VALUES (?, ?, 'student')";

  db.query(userQuery, [username, hashedPassword], (userErr, userResult) => {
    if (userErr) {
      console.error("User creation failed:", userErr.sqlMessage);
      return res.status(500).json({ error: "User creation failed: " + userErr.sqlMessage });
    }

    const newUserId = userResult.insertId;

    const studentQuery = `
      INSERT INTO Students (student_Id, first_name, last_name, email, phone, DOB, admission_date, dept_Id, user_Id)
      VALUES (?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)
    `;

    db.query(
      studentQuery,
      [student_Id, first_name, last_name, email, phone, DOB, dept_Id, newUserId],
      (studentErr) => {
        if (studentErr) {
          console.error("Student insert failed:", studentErr.sqlMessage);
          db.query("DELETE FROM Users WHERE user_Id = ?", [newUserId]);
          return res.status(500).json({ error: "Student insert failed: " + studentErr.sqlMessage });
        }

        res.json({
          message: "Student and User created successfully!",
          login: { username, password }
        });
      }
    );
  });
});

app.delete("/admin/students/:id", (req, res) => {
  const { id } = req.params;

  // Step 1: Get the user_Id linked to the student
  const findUser = "SELECT user_Id FROM Students WHERE student_Id = ?";
  db.query(findUser, [id], (findErr, result) => {
    if (findErr) {
      console.error("Find Error:", findErr.sqlMessage);
      return res.status(500).json({ error: findErr.sqlMessage });
    }

    if (result.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    const userId = result[0].user_Id;

    // Step 2: Delete the student first
    const deleteStudent = "DELETE FROM Students WHERE student_Id = ?";
    db.query(deleteStudent, [id], (delErr) => {
      if (delErr) {
        console.error("Student Delete Error:", delErr.sqlMessage);
        return res.status(500).json({ error: delErr.sqlMessage });
      }

      // Step 3: Delete the linked user
      const deleteUser = "DELETE FROM Users WHERE user_Id = ?";
      db.query(deleteUser, [userId], (userErr) => {
        if (userErr) {
          console.error("User Delete Error:", userErr.sqlMessage);
          return res.status(500).json({ error: userErr.sqlMessage });
        }

        res.json({
          message: "Student and linked User deleted successfully!"
        });
      });
    });
  });
});

// =====================================================
// FACULTY CRUD — auto user linking
// =====================================================

app.get("/admin/faculty", (req, res) => {
  db.query("SELECT * FROM Faculty", (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

// ---------------- ADD FACULTY ----------------
app.post("/admin/faculty", async (req, res) => {
  const { first_name, last_name, email, phone, designation, dept_Id } = req.body;

  // Step 1: Auto-generate username and password
  const username = (first_name + last_name).toLowerCase();
  const password = (first_name + last_name).toLowerCase() + "123";
  const hashedPassword = await bcrypt.hash(password, saltRounds); 
  
  // Step 2: Create new user in Users table
  const userQuery = "INSERT INTO Users (username, password, role) VALUES (?, ?, 'faculty')";
  db.query(userQuery, [username, hashedPassword], (userErr, userResult) => {
    if (userErr) {
      console.error("User creation failed:", userErr.sqlMessage);
      return res.status(500).json({ error: "User creation failed: " + userErr.sqlMessage });
    }

    const newUserId = userResult.insertId;

    // Step 3: Create Faculty record linked to that new user
    const facultyQuery = `
      INSERT INTO Faculty (first_name, last_name, email, phone, designation, join_date, dept_Id, user_Id)
      VALUES (?, ?, ?, ?, ?, CURDATE(), ?, ?)
    `;

    db.query(
      facultyQuery,
      [first_name, last_name, email, phone, designation, dept_Id, newUserId],
      (facultyErr) => {
        if (facultyErr) {
          console.error("Faculty insert failed:", facultyErr.sqlMessage);
          // rollback: delete user if faculty insert fails
          db.query("DELETE FROM Users WHERE user_Id = ?", [newUserId]);
          return res.status(500).json({ error: "Faculty insert failed: " + facultyErr.sqlMessage });
        }

        res.json({
          message: "Faculty and User created successfully!",
          login: { username, password }
        });
      }
    );
  });
});

// ---------------- DELETE FACULTY ----------------
app.delete("/admin/faculty/:id", (req, res) => {
  const { id } = req.params;

  // Step 1: Find linked user_Id
  const findUser = "SELECT user_Id FROM Faculty WHERE faculty_Id = ?";
  db.query(findUser, [id], (findErr, result) => {
    if (findErr) {
      console.error("Find Error:", findErr.sqlMessage);
      return res.status(500).json({ error: findErr.sqlMessage });
    }

    if (result.length === 0) {
      return res.status(404).json({ error: "Faculty not found" });
    }

    const userId = result[0].user_Id;

    // Step 2: Delete faculty entry
    const deleteFaculty = "DELETE FROM Faculty WHERE faculty_Id = ?";
    db.query(deleteFaculty, [id], (delErr) => {
      if (delErr) {
        console.error("Faculty Delete Error:", delErr.sqlMessage);
        return res.status(500).json({ error: delErr.sqlMessage });
      }

      // Step 3: Delete linked user
      const deleteUser = "DELETE FROM Users WHERE user_Id = ?";
      db.query(deleteUser, [userId], (userErr) => {
        if (userErr) {
          console.error("User Delete Error:", userErr.sqlMessage);
          return res.status(500).json({ error: userErr.sqlMessage });
        }

        res.json({
          message: "Faculty and linked User deleted successfully!"
        });
      });
    });
  });
});

// ------------- COURSES -------------
app.get("/admin/courses", (req, res) => {
  db.query("SELECT * FROM Courses", (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

app.post("/admin/courses", (req, res) => {
  const { course_Id, course_name, credits, dept_Id } = req.body;
  const sql = "INSERT INTO Courses (course_Id, course_name, credits, dept_Id) VALUES (?, ?, ?, ?)";
  db.query(sql, [course_Id, course_name, credits, dept_Id], (err) => {
    if (err) {
      console.error("SQL Error:", err.sqlMessage);
      return res.status(500).json({ error: err.sqlMessage });
    }
    res.json({ message: "Course added successfully" });
  });
});

app.delete("/admin/courses/:id", (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM Courses WHERE course_Id = ?", [id], (err) => {
    if (err) {
      console.error("SQL Error:", err.sqlMessage);
      return res.status(500).json({ error: err.sqlMessage });
    }
    res.json({ message: "Course deleted successfully" });
  });
});

// =====================================================
// FACULTY - GET STUDENTS OF A COURSE
// =====================================================
app.get("/faculty/course/:courseId/students", (req, res) => {
  const courseId = req.params.courseId;
  const sql = `
    SELECT s.student_Id, s.first_name, s.last_name
    FROM Enrollments e
    JOIN Students s ON e.student_Id = s.student_Id
    WHERE e.course_Id = ?
  `;

  db.query(sql, [courseId], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
});

// =====================================================
// FACULTY - SAVE ATTENDANCE
// =====================================================
app.post("/faculty/attendance", (req, res) => {
  const { courseId, date, attendance } = req.body;

  db.query(
    "SELECT * FROM Attendance WHERE course_Id=? AND Attd_Date=?",
    [courseId, date],
    (err, result) => {
      if (err) return res.status(500).json(err);

      if (result.length > 0) {
        return res.json({ message: "Attendance already marked for this date." });
      }

      const sql = "INSERT INTO Attendance (student_Id, course_Id, Attd_Date, Status) VALUES (?, ?, ?, ?)";

      attendance.forEach(student => {
        db.query(sql, [student.studentId, courseId, date, student.status]);
      });

      res.json({ message: "Attendance Saved Successfully" });
    }
  );
});

// =====================================================
// FACULTY - APPLY LEAVE
// =====================================================
app.post("/faculty/apply-leave", (req, res) => {
  const { facultyId, fromDate, toDate, reason } = req.body;

  if (!facultyId || !fromDate || !toDate || !reason) {
    return res.status(400).json({ message: "Missing leave application fields." });
  }

  const lookupSql = "SELECT faculty_Id FROM Faculty WHERE user_Id = ? OR faculty_Id = ? LIMIT 1";
  db.query(lookupSql, [facultyId, facultyId], (lookupErr, lookupResult) => {
    if (lookupErr) {
      console.error("Faculty lookup failed:", lookupErr);
      return res.status(500).json({ message: "Unable to verify faculty identity." });
    }

    if (!lookupResult || lookupResult.length === 0) {
      return res.status(404).json({ message: "Faculty record not found." });
    }

    const realFacultyId = lookupResult[0].faculty_Id;
    const sql = "INSERT INTO Faculty_Leave (faculty_Id, from_date, to_date, reason) VALUES (?, ?, ?, ?)";

    db.query(sql, [realFacultyId, fromDate, toDate, reason], (err) => {
      if (err) {
        console.error("Leave insert failed:", err);
        return res.status(500).json({ message: "Failed to Apply Leave." });
      }
      res.json({ message: "Leave Applied Successfully" });
    });
  });
});

// =====================================================
// ADMIN - PROCESS FACULTY LEAVE REQUESTS
// =====================================================
app.put("/admin/faculty-leaves/:id/approve", (req, res) => {
  const leaveId = req.params.id;
  db.query(
    "UPDATE Faculty_Leave SET status='Approved' WHERE leave_Id=?",
    [leaveId],
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Leave Approved Successfully" });
    }
  );
});

app.put("/admin/faculty-leaves/:id/reject", (req, res) => {
  const leaveId = req.params.id;
  db.query(
    "UPDATE Faculty_Leave SET status='Rejected' WHERE leave_Id=?",
    [leaveId],
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Leave Rejected Successfully" });
    }
  );
});

app.get("/admin/faculty-leaves", (req, res) => {
  const sql = `
    SELECT fl.leave_Id, fl.faculty_Id, f.first_name, f.last_name, 
           fl.from_date, fl.to_date, fl.reason, fl.status, fl.applied_on
    FROM Faculty_Leave fl
    JOIN Faculty f ON fl.faculty_Id = f.faculty_Id
    ORDER BY fl.applied_on DESC
  `;

  db.query(sql, (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json(err);
    }
    res.json(result);
  });
});

// ---------------- SERVER ----------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}/login.html`)
);