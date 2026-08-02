const express = require("express");
const router = express.Router();
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// S3 client for generating pre-signed download URLs (private bucket support)
const s3 = new S3Client({
  region: (process.env.B2_REGION || "us-east-005").trim(),
  endpoint: (process.env.B2_ENDPOINT || "https://s3.us-east-005.backblazeb2.com").trim(),
  credentials: {
    accessKeyId: (process.env.B2_KEY_ID || "").trim(),
    secretAccessKey: (process.env.B2_APPLICATION_KEY || "").trim(),
  },
  forcePathStyle: true,
});

const B2_BUCKET = (process.env.B2_BUCKET || "").trim();

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ message: "Please log in." });
  }
  if (req.session.user.mustReset) {
    return res.status(403).json({ message: "Password reset required.", code: "MUST_RESET" });
  }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ message: "Please log in." });
    }
    if (req.session.user.mustReset) {
      return res.status(403).json({ message: "Password reset required.", code: "MUST_RESET" });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ message: "Not authorized." });
    }
    next();
  };
}

router.use(requireAuth);

// Helper: parse deptId safely
function parseDeptId(val) {
  return val === "null" || val === "undefined" || !val ? null : val;
}

// Admin sends a notification
router.post("/send", requireRole("admin"), async (req, res) => {
  const { title, message, target, pdf_url, dept_Id } = req.body;
  const db = req.app.get("db");
  const io = req.app.get("io");

  try {
    await db.query(
      "INSERT INTO notifications (title, message, target, pdf_url, dept_Id) VALUES (?, ?, ?, ?, ?)",
      [title, message, target, pdf_url || null, dept_Id || null],
    );

    io.to(target).emit("new notification", { title, message, target, pdf_url });
    io.to(target).emit("new_notification", { title, message, target, pdf_url });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to send notification" });
  }
});

// Unread count — per user, using notification_reads join
router.get("/unread-count", async (req, res) => {
  const db = req.app.get("db");
  const role = req.session.user.role;
  const userId = req.session.user.id;
  const deptId = parseDeptId(req.query.deptId);
  const personalTarget = userId ? `user_${userId}` : null;

  if (!role || !userId) return res.json({ count: 0 });

  try {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS count
       FROM notifications n
       WHERE (n.target = ? OR n.target = 'all' OR n.target = ?)
         AND (n.dept_Id IS NULL OR n.dept_Id = ?)
         AND NOT EXISTS (
           SELECT 1 FROM notification_reads nr
           WHERE nr.notification_id = n.id AND nr.user_Id = ?
         )`,
      [role, personalTarget, deptId, userId],
    );
    res.json({ count: rows[0].count });
  } catch (err) {
    console.error("unread-count error:", err);
    res.json({ count: 0 });
  }
});

// Fetch all notifications for a user, with per-user is_read flag
router.get("/all", async (req, res) => {
  const db = req.app.get("db");
  const role = req.session.user.role;
  const userId = req.session.user.id;
  const deptId = parseDeptId(req.query.deptId);
  const personalTarget = userId ? `user_${userId}` : null;

  if (!role || !userId) return res.json([]);

  try {
    const [rows] = await db.query(
      `SELECT n.*,
              IF(nr.id IS NOT NULL, 1, 0) AS is_read
       FROM notifications n
       LEFT JOIN notification_reads nr
         ON nr.notification_id = n.id AND nr.user_Id = ?
       WHERE (n.target = ? OR n.target = 'all' OR n.target = ?)
         AND (n.dept_Id IS NULL OR n.dept_Id = ?)
       ORDER BY n.created_at DESC
       LIMIT 20`,
      [userId, role, personalTarget, deptId],
    );
    // Generate a 1-hour pre-signed URL for any notification that has a PDF key.
    // Legacy rows may contain a full public URL — pass those through unchanged.
    const withUrls = await Promise.all(
      rows.map(async (row) => {
        if (row.pdf_url && B2_BUCKET) {
          const isKey = !row.pdf_url.startsWith("http");
          if (isKey) {
            try {
              const cmd = new GetObjectCommand({ Bucket: B2_BUCKET, Key: row.pdf_url });
              row.pdf_url = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
            } catch {
              // If signing fails, omit the URL rather than crashing
              row.pdf_url = null;
            }
          }
        }
        return row;
      })
    );
    res.json(withUrls);
  } catch (err) {
    console.error("notifications/all error:", err);
    res.json([]);
  }
});

// Mark all visible notifications as read — per user only
router.post("/mark-read", async (req, res) => {
  const db = req.app.get("db");
  const role = req.session.user.role;
  const userId = req.session.user.id;
  const deptId = parseDeptId(req.body?.deptId || req.query.deptId);
  const personalTarget = userId ? `user_${userId}` : null;

  if (!role || !userId)
    return res.status(400).json({ error: "role and userId required" });

  try {
    // Find all notification IDs this user can see but hasn't read yet
    const [notifications] = await db.query(
      `SELECT n.id
       FROM notifications n
       WHERE (n.target = ? OR n.target = 'all' OR n.target = ?)
         AND (n.dept_Id IS NULL OR n.dept_Id = ?)
         AND NOT EXISTS (
           SELECT 1 FROM notification_reads nr
           WHERE nr.notification_id = n.id AND nr.user_Id = ?
         )`,
      [role, personalTarget, deptId, userId],
    );

    if (notifications.length > 0) {
      const values = notifications.map((n) => [n.id, userId]);
      await db.query(
        "INSERT IGNORE INTO notification_reads (notification_id, user_Id) VALUES ?",
        [values],
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("mark-read error:", err);
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

module.exports = router;
