const express = require('express');
const router = express.Router();

//Admin sends a notification
router.post('/send', async(req, res) => {
    const { title, message, target} = req.body;
    const db= req.app.get('db');
    const io = req.app.get('io');

    try {
        await db.promise().query(
            'INSERT INTO notifications (title, message, target) VALUES (?, ?, ?)',
            [title, message, target]
        );

        io.emit('new notification', {title, message, target});
        io.emit('new_notification', {title, message, target});

        res.json({ success: true});
    } catch(err) {
        console.log(err);
        res.status(500).json({error: 'Failed to send notification'});   
    }
});

router.get('/unread-count', async(req, res)=> {
    const db= req.app.get('db');
    const [rows] =await db.promise().query(
        'SELECT COUNT(*) AS unreadCount FROM notifications WHERE is_read = 0'
    );
    res.json({ unreadCount: rows[0].unreadCount });
});

router.get('/all', async(req, res) => {
    const db= req.app.get('db');
    const [rows]= await db.promise().query(
        'SELECT * FROM notifications ORDER BY created_at DESC LIMIT 20'
    );
    res.json(rows);
});

router.post('/mark-read', async(req, res) => {
    const db= req.app.get('db');
    await db.promise().query(
        'UPDATE notifications SET is_read =1'
    );
    res.json({ success: true });
});

module.exports = router;