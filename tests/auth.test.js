const { createUser, deleteUser, loginAgent } = require("./helpers");

describe("POST /login", () => {
  let userId;
  const username = `test_auth_${Date.now()}`;
  const password = "Test@1234";

  beforeAll(async () => {
    userId = await createUser({ username, password, role: "student" });
  });

  afterAll(async () => {
    await deleteUser(userId);
  });

  test("rejects an unknown username", async () => {
    const { res } = await loginAgent("no_such_user_xyz", "whatever");
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid username or password/i);
  });

  test("rejects a wrong password", async () => {
    const { res } = await loginAgent(username, "wrongpassword");
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid username or password/i);
  });

  test("logs in successfully with correct credentials", async () => {
    const { res } = await loginAgent(username, password);
    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(username);
    expect(res.body.user.role).toBe("student");
  });

  test("locks the account after 5 consecutive failed attempts", async () => {
    const lockUsername = `test_lock_${Date.now()}`;
    const lockUserId = await createUser({ username: lockUsername, password, role: "student" });

    try {
      let lastRes;
      for (let i = 0; i < 5; i++) {
        const { res } = await loginAgent(lockUsername, "wrongpassword");
        lastRes = res;
      }
      expect(lastRes.status).toBe(423);
      expect(lastRes.body.message).toMatch(/locked/i);

      // Even the CORRECT password must now be rejected while locked
      const { res: afterLock } = await loginAgent(lockUsername, password);
      expect(afterLock.status).toBe(423);
    } finally {
      await deleteUser(lockUserId);
    }
  });
});