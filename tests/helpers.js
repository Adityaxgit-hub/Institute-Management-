const request = require("supertest");
const bcrypt = require("bcrypt");
const { app, db } = require("../server");

async function getCsrfToken(agent) {
  const res = await agent.get("/csrf-token");
  return res.body.csrfToken;
}

async function createUser({ username, password, role, mustReset = 0 }) {
  const hashed = await bcrypt.hash(password, 10);
  const [result] = await db.query(
    "INSERT INTO Users (username, password, role, must_reset_password) VALUES (?, ?, ?, ?)",
    [username, hashed, role, mustReset],
  );
  return result.insertId;
}

async function deleteUser(userId) {
  if (!userId) return;
  await db.query("DELETE FROM Users WHERE user_Id = ?", [userId]);
}

async function loginAgent(username, password) {
  const agent = request.agent(app);
  const token = await getCsrfToken(agent);
  const res = await agent
    .post("/login")
    .set("CSRF-Token", token)
    .send({ username, password });
  return { agent, res };
}

module.exports = { app, db, getCsrfToken, createUser, deleteUser, loginAgent };