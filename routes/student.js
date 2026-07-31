const express = require("express");
const router = express.Router();
const { requireRole } = require("../middleware/auth");

// ---------------- STUDENT DASHBOARD ----------------
router.get("/student/:userId", requireRole("student"), async (req, res) => {
  const userId = req.params.userId;
  const db = req.app.get("db");

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
             CONCAT(f.first_name,' ',f.last_name) AS faculty_name,
             e.semester,
             e.year
      FROM Enrollments e
      JOIN Courses c ON e.course_Id = c.course_Id
      LEFT JOIN Teaches t ON c.course_Id = t.course_Id AND e.semester = t.semester AND e.year = t.year
      LEFT JOIN Faculty f ON t.faculty_Id = f.faculty_Id
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
router.get("/student/:userId/semesters", requireRole("student"), async (req, res) => {
  const { userId } = req.params;
  const db = req.app.get("db");

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

    const [semesters] = await db.query(
      `SELECT DISTINCT semester, year
       FROM Enrollments
       WHERE student_Id = ?
       ORDER BY year DESC, semester DESC`,
      [studentId]
    );

    res.json(semesters);
  } catch (err) {
    console.error("GET /student/:userId/semesters error:", err);
    res.status(500).json({ error: "Unable to load semesters." });
  }
});

router.get("/student/:userId/attendance-summary", requireRole("student"), async (req, res) => {
  const { userId } = req.params;
  const db = req.app.get("db");

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
    const { semester, year } = req.query;

    let overallQuery = `
      SELECT
         c.course_Id,
         c.course_name,
         CONCAT(f.first_name, ' ', f.last_name) AS faculty_name,
         SUM(CASE WHEN a.Status = 'P' THEN 1 ELSE 0 END) AS present_days,
         COUNT(a.Attd_Id) AS total_days
       FROM Enrollments e
       JOIN Courses c ON e.course_Id = c.course_Id
       LEFT JOIN Teaches t ON c.course_Id = t.course_Id AND e.semester = t.semester AND e.year = t.year
       LEFT JOIN Faculty f ON t.faculty_Id = f.faculty_Id
       LEFT JOIN Attendance a ON a.course_Id = c.course_Id AND a.student_Id = e.student_Id
       WHERE e.student_Id = ?
    `;
    const params = [studentId];

    if (semester && year) {
      overallQuery += ` AND e.semester = ? AND e.year = ?`;
      params.push(Number(semester), Number(year));
    }

    overallQuery += ` GROUP BY c.course_Id, c.course_name, f.first_name, f.last_name`;

    const [overall] = await db.query(overallQuery, params);

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
    res.status(500).json({ error: "Unable to load attendance summary." });
  }
});

// STUDENT - VIEW OWN MARKS
router.get("/student/:userId/marks", requireRole("student"), async (req, res) => {
  const { userId } = req.params;
  const db = req.app.get("db");

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

module.exports = router;
