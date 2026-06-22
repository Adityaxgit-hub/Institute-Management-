const express = require('express');
const router = express.Router();

//Admin sends a notification
router.post('/send', async (req, res) => {
  const { title, message, target, pdf_url, dept_Id } = req.body;
  const db = req.app.get('db');
  const io = req.app.get('io');

  try {
    await db.query(
      'INSERT INTO notifications (title, message, target, pdf_url, dept_Id) VALUES (?, ?, ?, ?, ?)',
      [title, message, target, pdf_url || null, dept_Id || null]
    );

    io.to(target).emit('new notification', { title, message, target, pdf_url });
    io.to(target).emit('new_notification', { title, message, target, pdf_url });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send notification' });
  }
});

router.get('/unread-count', async (req, res) => {
  const db = req.app.get('db');
  const role = req.query.role;
  const userId = req.query.userId;
  const deptIdInput = req.query.deptId;
  const deptId = (deptIdInput === 'null' || deptIdInput === 'undefined' || !deptIdInput) ? null : deptIdInput;
  const personalTarget = userId ? `user_${userId}` : null;

  if (!role) return res.json({ count: 0 });

  const [rows] = await db.query(
    `SELECT COUNT(*) AS count 
     FROM notifications 
     WHERE is_read = 0 
     AND (target = ? OR target = 'all' OR target = ?)
     AND (dept_Id IS NULL OR dept_Id = ?)`,
    [role, personalTarget, deptId || null]
  );
  res.json({ count: rows[0].count });
});

router.get('/all', async (req, res) => {
  const db = req.app.get('db');
  const role = req.query.role;
  const userId = req.query.userId;
  const deptIdInput = req.query.deptId;
  const deptId = (deptIdInput === 'null' || deptIdInput === 'undefined' || !deptIdInput) ? null : deptIdInput;
  const personalTarget = userId ? `user_${userId}` : null;

  if (!role) return res.json([]);

  const [rows] = await db.query(
    `SELECT * FROM notifications 
     WHERE (target = ? OR target = 'all' OR target = ?)
     AND (dept_Id IS NULL OR dept_Id = ?)
     ORDER BY created_at DESC 
     LIMIT 20`,
    [role, personalTarget, deptId || null]
  );
  res.json(rows);
});

router.post('/mark-read', async (req, res) => {
  const db = req.app.get('db');
  const role = (req.body?.role) || req.query.role;
  const userId = (req.body?.userId) || req.query.userId;
  const deptIdInput = (req.body?.deptId) || req.query.deptId;
  const deptId = (deptIdInput === 'null' || deptIdInput === 'undefined' || !deptIdInput) ? null : deptIdInput;
  const personalTarget = userId ? `user_${userId}` : null;

  if (!role) return res.status(400).json({ error: 'role required' });

  await db.query(
    `UPDATE notifications SET is_read = 1 
     WHERE (target = ? OR target = 'all' OR target = ?)
     AND (dept_Id IS NULL OR dept_Id = ?)`,
    [role, personalTarget, deptId || null]
  );
  res.json({ success: true });
});

module.exports = router;