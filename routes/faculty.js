const express = require("express");
const router = express.Router();
const { requireRole } = require("../middleware/auth");

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

// ---------------- FACULTY DASHBOARD ----------------
router.get("/faculty/:userId", requireRole("faculty"), async (req, res) => {
  const { userId } = req.params;
  const db = req.app.get("db");

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

// FACULTY - GET STUDENTS OF A COURSE FOR ATTENDANCE
router.get("/faculty/course/:courseId/students", requireRole("faculty"), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { semester, year } = req.query;
    const db = req.app.get("db");

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

    const [result] = await db.query(
      `SELECT s.student_Id,
              s.first_name,
              s.last_name
       FROM Enrollments e
       JOIN Students s
       ON e.student_Id = s.student_Id
       WHERE e.course_Id=? AND e.semester=? AND e.year=?`,
      [courseId, semester, year],
    );

    res.json(result);
  } catch (err) {
    res.status(500).json(err);
  }
});

// FACULTY - SAVE ATTENDANCE
router.post("/faculty/attendance", requireRole("faculty"), async (req, res) => {
  try {
    const { courseId, date, attendance } = req.body;
    const db = req.app.get("db");

    if (!courseId) {
      return res.status(400).json({ error: "courseId is required" });
    }

    const [facultyRow] = await db.query(
      "SELECT faculty_Id FROM Faculty WHERE user_Id = ?",
      [req.session.user.id],
    );
    if (facultyRow.length === 0) {
      return res.status(404).json({ error: "Faculty record not found" });
    }

    const semester = req.body.semester || req.query.semester;
    const year = req.body.year || req.query.year;

    let ownsQuery = "SELECT teach_Id FROM Teaches WHERE faculty_Id=? AND course_Id=?";
    let queryParams = [facultyRow[0].faculty_Id, courseId];
    if (semester && year) {
      ownsQuery += " AND semester=? AND year=?";
      queryParams.push(semester, year);
    }

    const [owns] = await db.query(ownsQuery, queryParams);
    if (owns.length === 0) {
      return res.status(403).json({ error: "You do not teach this course offering." });
    }

    const [existing] = await db.query(
      `SELECT student_Id FROM Attendance WHERE course_Id=? AND Attd_Date=?`,
      [courseId, date],
    );
    const alreadyMarked = new Set(existing.map((r) => r.student_Id));

    const toInsert = (attendance || []).filter((s) => !alreadyMarked.has(s.studentId));

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
router.get("/faculty/course/:courseId/marks", requireRole("faculty"), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { semester, year } = req.query;
    const db = req.app.get("db");

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
});

// FACULTY - SAVE MARKS (bulk upsert)
router.post("/faculty/marks", requireRole("faculty"), async (req, res) => {
  try {
    const { courseId, semester, year, marks } = req.body;
    const db = req.app.get("db");

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

// FACULTY - APPLY LEAVE
router.post("/faculty/apply-leave", requireRole("faculty"), async (req, res) => {
  try {
    const { facultyId, fromDate, toDate, reason } = req.body;
    const db = req.app.get("db");

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

module.exports = router;
