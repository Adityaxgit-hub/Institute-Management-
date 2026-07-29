const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { maybeLoginLimiter, sensitiveLimiter } = require("../middleware/auth");

const saltRounds = 10;
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const DUMMY_HASH = "$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeg6Lruj3vjPGga31lW";

// ---------------- LOGIN ----------------
router.post("/login", maybeLoginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const db = req.app.get("db");

  try {
    const [results] = await db.query("SELECT * FROM Users WHERE username=?", [
      username,
    ]);

    if (results.length === 0) {
      await bcrypt.compare(password || "", DUMMY_HASH);
      return res.status(401).json({
        message: "Invalid username or password",
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

    const match = await bcrypt.compare(password || "", user.password);

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
        message: "Invalid username or password",
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

// STEP 1: request an OTP
router.post("/signup/request-otp", sensitiveLimiter, async (req, res) => {
  const { email, role } = req.body;
  const db = req.app.get("db");

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

    // Generic response to avoid verification probing
    const genericResponse = {
      success: true,
      message: "If this email is on record and unclaimed, a verification code has been sent.",
    };

    if (records.length === 0 || records[0].user_Id) {
      return res.json(genericResponse);
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(otp, saltRounds);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

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

// STEP 2: verify OTP + create account
router.post("/signup", sensitiveLimiter, async (req, res) => {
  const { username, password, role, email, otp } = req.body;
  const db = req.app.get("db");

  if (!username || !password || !role || !email || !otp) {
    return res.status(400).json({
      success: false,
      message: "Please provide username, password, role, email, and verification code.",
    });
  }

  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters.",
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
      if (linkErr.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          success: false,
          message: "This record is no longer available for signup.",
        });
      }
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

// ---------------- FORGOT PASSWORD ----------------
router.post("/forgot-password", sensitiveLimiter, async (req, res) => {
  const { email } = req.body;
  const db = req.app.get("db");

  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  try {
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
      return res.json({
        message: "If this email is registered, a reset link has been sent.",
      });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresFormatted = new Date(Date.now() + 60 * 60 * 1000)
      .toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" })
      .replace("T", " ");

    await db.query(
      "UPDATE password_reset_tokens SET used = 1 WHERE user_Id = ?",
      [user.user_Id],
    );

    await db.query(
      "INSERT INTO password_reset_tokens (user_Id, token, expires_at) VALUES (?, ?, ?)",
      [user.user_Id, token, expiresFormatted],
    );

    const baseUrl =
      process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const resetLink = `${baseUrl}/reset-password.html?token=${token}`;

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
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

// ---------------- RESET PASSWORD ----------------
router.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  const db = req.app.get("db");

  if (!token || !newPassword) {
    return res.status(400).json({ message: "Token and new password are required." });
  }

  if (typeof newPassword !== "string" || newPassword.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters." });
  }

  try {
    const [validRows] = await db.query(
      `SELECT * FROM password_reset_tokens 
       WHERE token = ? AND used = 0 AND expires_at > NOW()`,
      [token],
    );

    if (validRows.length === 0) {
      return res.status(400).json({ message: "This reset link is invalid or has expired." });
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
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
});

// ---------------- FORCE RESET PASSWORD ----------------
router.post("/force-reset-password", async (req, res) => {
  const db = req.app.get("db");

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

module.exports = router;
