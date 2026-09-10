const { db, createUser, deleteUser, loginAgent, getCsrfToken } = require("./helpers");

describe("Grading routes", () => {
  const suffix = Date.now();
  const facultyUsername = `test_grf_${suffix}`;
  const outsiderUsername = `test_grf2_${suffix}`;
  const studentUsername = `test_gst_${suffix}`;
  const password = "Test@1234";
  const courseId = `TG${String(suffix).slice(-6)}`;
  const studentId = `TS${String(suffix).slice(-6)}`;
  const semester = 4;
  const year = 2025;
  let facultyUserId, facultyId, outsiderUserId, outsiderFacultyId, studentUserId;

  beforeAll(async () => {
    // Course-owning faculty
    facultyUserId = await createUser({ username: facultyUsername, password, role: "faculty" });
    const [facResult] = await db.query(
      `INSERT INTO Faculty (first_name, last_name, email, phone, designation, join_date, dept_Id, user_Id)
       VALUES ('Grade', 'Owner', ?, ?, 'Professor', CURDATE(), 1, ?)`,
      [`${facultyUsername}@test.edu`, `7${suffix}`.slice(0, 10), facultyUserId],
    );
    facultyId = facResult.insertId;

    // A second faculty who does NOT teach this course — used to test the ownership check
    outsiderUserId = await createUser({ username: outsiderUsername, password, role: "faculty" });
    const [outsiderResult] = await db.query(
      `INSERT INTO Faculty (first_name, last_name, email, phone, designation, join_date, dept_Id, user_Id)
       VALUES ('Grade', 'Outsider', ?, ?, 'Professor', CURDATE(), 1, ?)`,
      [`${outsiderUsername}@test.edu`, `6${suffix}`.slice(0, 10), outsiderUserId],
    );
    outsiderFacultyId = outsiderResult.insertId;

    await db.query(
      "INSERT INTO Courses (course_Id, course_name, credits, dept_Id) VALUES (?, 'Test Grading Course', 3, 1)",
      [courseId],
    );

    studentUserId = await createUser({ username: studentUsername, password, role: "student" });
    await db.query(
      `INSERT INTO Students (student_Id, first_name, last_name, email, phone, DOB, admission_date, dept_Id, user_Id)
       VALUES (?, 'Grade', 'Student', ?, ?, '2003-01-01', CURDATE(), 1, ?)`,
      [studentId, `${studentUsername}@test.edu`, `5${suffix}`.slice(0, 10), studentUserId],
    );

    await db.query(
      "INSERT INTO Enrollments (student_Id, course_Id, semester, year) VALUES (?, ?, ?, ?)",
      [studentId, courseId, semester, year],
    );
    await db.query(
      "INSERT INTO Teaches (faculty_Id, course_Id, semester, year, section) VALUES (?, ?, ?, ?, 'A')",
      [facultyId, courseId, semester, year],
    );
  });

  afterAll(async () => {
    await db.query("DELETE FROM Marks WHERE course_Id = ?", [courseId]);
    await db.query("DELETE FROM Teaches WHERE course_Id = ?", [courseId]);
    await db.query("DELETE FROM Enrollments WHERE course_Id = ?", [courseId]);
    await db.query("DELETE FROM Students WHERE student_Id = ?", [studentId]);
    await db.query("DELETE FROM Courses WHERE course_Id = ?", [courseId]);
    await db.query("DELETE FROM Faculty WHERE faculty_Id IN (?, ?)", [facultyId, outsiderFacultyId]);
    await deleteUser(studentUserId);
    await deleteUser(outsiderUserId);
    await deleteUser(facultyUserId);
  });

  test("blocks a faculty member who does not teach the course", async () => {
    const { agent } = await loginAgent(outsiderUsername, password);
    const token = await getCsrfToken(agent);

    const res = await agent
      .post("/faculty/marks")
      .set("CSRF-Token", token)
      .send({ courseId, semester, year, marks: [{ studentId, assignment1: 90 }] });

    expect(res.status).toBe(403);
  });

  test("rejects out-of-range marks", async () => {
    const { agent } = await loginAgent(facultyUsername, password);
    const token = await getCsrfToken(agent);

    const res = await agent
      .post("/faculty/marks")
      .set("CSRF-Token", token)
      .send({ courseId, semester, year, marks: [{ studentId, assignment1: 150 }] });

    expect(res.status).toBe(400);
  });

  test("the course-owning faculty can save valid marks", async () => {
    const { agent } = await loginAgent(facultyUsername, password);
    const token = await getCsrfToken(agent);

    const saveRes = await agent
      .post("/faculty/marks")
      .set("CSRF-Token", token)
      .send({
        courseId,
        semester,
        year,
        marks: [
          {
            studentId,
            assignment1: 18,
            mid_exam: 25,
            assignment2: 19,
            end_sem: 55,
            internal_viva: 9,
            external_viva: 14,
          },
        ],
      });

    expect(saveRes.status).toBe(200);

    const getRes = await agent.get(
      `/faculty/course/${courseId}/marks?semester=${semester}&year=${year}`,
    );
    expect(getRes.status).toBe(200);
    expect(getRes.body.length).toBe(1);
    expect(Number(getRes.body[0].assignment1)).toBe(18);
  });

  test("the student can see their own saved marks", async () => {
    const { agent } = await loginAgent(studentUsername, password);
    const res = await agent.get(`/student/${studentUserId}/marks`);

    expect(res.status).toBe(200);
    const courseRow = res.body.find((r) => r.course_Id === courseId);
    expect(courseRow).toBeDefined();
    expect(Number(courseRow.mid_exam)).toBe(25);
  });
});