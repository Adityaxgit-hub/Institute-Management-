const request = require("supertest");
const { app, db, createUser, deleteUser, loginAgent, getCsrfToken } = require("./helpers");

describe("POST /faculty/attendance", () => {
  const suffix = Date.now();
  const facultyUsername = `test_fac_${suffix}`;
  const password = "Test@1234";
  const courseId = `TC${String(suffix).slice(-6)}`;
  const studentId = `TS${String(suffix).slice(-6)}`;
  let facultyUserId, facultyId, studentUserId;

  beforeAll(async () => {
    facultyUserId = await createUser({ username: facultyUsername, password, role: "faculty" });
    const [facResult] = await db.query(
      `INSERT INTO Faculty (first_name, last_name, email, phone, designation, join_date, dept_Id, user_Id)
       VALUES ('Test', 'Faculty', ?, ?, 'Professor', CURDATE(), 1, ?)`,
      [`${facultyUsername}@test.edu`, `9${suffix}`.slice(0, 10), facultyUserId],
    );
    facultyId = facResult.insertId;

    await db.query(
      "INSERT INTO Courses (course_Id, course_name, credits, dept_Id) VALUES (?, 'Test Course', 3, 1)",
      [courseId],
    );

    studentUserId = await createUser({ username: `test_stu_${suffix}`, password, role: "student" });
    await db.query(
      `INSERT INTO Students (student_Id, first_name, last_name, email, phone, DOB, admission_date, dept_Id, user_Id)
       VALUES (?, 'Test', 'Student', ?, ?, '2003-01-01', CURDATE(), 1, ?)`,
      [studentId, `test_stu_${suffix}@test.edu`, `8${suffix}`.slice(0, 10), studentUserId],
    );

    await db.query(
      "INSERT INTO Enrollments (student_Id, course_Id, semester, year) VALUES (?, ?, 4, 2025)",
      [studentId, courseId],
    );
    await db.query(
      "INSERT INTO Teaches (faculty_Id, course_Id, semester, year, section) VALUES (?, ?, 4, 2025, 'A')",
      [facultyId, courseId],
    );
  });

  afterAll(async () => {
    await db.query("DELETE FROM Attendance WHERE course_Id = ?", [courseId]);
    await db.query("DELETE FROM Teaches WHERE course_Id = ?", [courseId]);
    await db.query("DELETE FROM Enrollments WHERE course_Id = ?", [courseId]);
    await db.query("DELETE FROM Students WHERE student_Id = ?", [studentId]);
    await db.query("DELETE FROM Courses WHERE course_Id = ?", [courseId]);
    await db.query("DELETE FROM Faculty WHERE faculty_Id = ?", [facultyId]);
    await deleteUser(studentUserId);
    await deleteUser(facultyUserId);
  });

  test("rejects unauthenticated requests", async () => {
    const agent = request.agent(app);
    const token = await getCsrfToken(agent);
    const res = await agent
      .post("/faculty/attendance")
      .set("CSRF-Token", token)
      .send({});
    expect(res.status).toBe(401);
  });

  test("saves attendance for an enrolled student", async () => {
    const { agent } = await loginAgent(facultyUsername, password);
    const token = await getCsrfToken(agent);

    const res = await agent
      .post("/faculty/attendance")
      .set("CSRF-Token", token)
      .send({
        courseId,
        date: "2025-08-01",
        attendance: [{ studentId, status: "P" }],
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Attendance Saved Successfully");

    const [rows] = await db.query(
      "SELECT * FROM Attendance WHERE student_Id = ? AND course_Id = ? AND Attd_Date = '2025-08-01'",
      [studentId, courseId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].Status).toBe("P");
  });

  test("does not duplicate attendance already marked for the same date", async () => {
    const { agent } = await loginAgent(facultyUsername, password);
    const token = await getCsrfToken(agent);

    const res = await agent
      .post("/faculty/attendance")
      .set("CSRF-Token", token)
      .send({
        courseId,
        date: "2025-08-01",
        attendance: [{ studentId, status: "A" }],
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/already marked/i);

    const [rows] = await db.query(
      "SELECT * FROM Attendance WHERE student_Id = ? AND course_Id = ? AND Attd_Date = '2025-08-01'",
      [studentId, courseId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].Status).toBe("P");
  });
});