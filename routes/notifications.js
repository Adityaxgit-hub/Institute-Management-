const express = require('express');
const router = express.Router();

//Admin sends a notification
router.post('/send', async(req, res) => {
    const { title, message, target} = req.body;
    const db= req.app.get('db');
    const io = req.app.get('io');

    try {
        await db.query(
            'INSERT INTO notifications (title, message, target) VALUES (?, ?, ?)',
            [title, message, target]
        );

        io.to(target).emit('new notification', {title, message, target});
        io.to(target).emit('new_notification', {title, message, target});

        res.json({ success: true});
    } catch(err) {
        console.log(err);
        res.status(500).json({error: 'Failed to send notification'});   
    }
});

router.get('/unread-count', async (req, res) => {
  const db = req.app.get('db');
  const role = req.query.role;
  const userId = req.query.userId;
  const personalTarget = userId ? `user_${userId}` : null;

  if (!role) return res.json({ count: 0 });

  const [rows] = await db.query(
    `SELECT COUNT(*) AS count 
     FROM notifications 
     WHERE is_read = 0 
     AND (target = ? OR target = 'all' OR target = ?)`,
    [role, personalTarget]
  );
  res.json({ count: rows[0].count });
});

router.get('/all', async (req, res) => {
  const db = req.app.get('db');
  const role = req.query.role;
  const userId = req.query.userId;
  const personalTarget = userId ? `user_${userId}` : null;

  if (!role) return res.json([]);

  const [rows] = await db.query(
    `SELECT * FROM notifications 
     WHERE (target = ? OR target = 'all' OR target = ?)
     ORDER BY created_at DESC 
     LIMIT 20`,
    [role, personalTarget]
  );
  res.json(rows);
});

router.post('/mark-read', async (req, res) => {
    const db = req.app.get('db');
    const role = (req.body ? req.body.role : null) || req.query.role;
    const userId = (req.body ? req.body.userId : null) || req.query.userId;
    const personalTarget = userId ? `user_${userId}` : null;
    if (!role) return res.status(400).json({ error: 'role required' });

    await db.query(
      `UPDATE notifications SET is_read = 1 WHERE target = ? OR target = 'all' OR target = ?`,
      [role, personalTarget]
    );
    res.json({ success: true });
});

module.exports = router;