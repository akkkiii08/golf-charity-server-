const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authenticate } = require('../middleware/auth');

// GET /api/subscriptions/my
router.get('/my', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) return res.status(500).json({ error: 'Failed to fetch subscriptions' });
  res.json(data);
});

module.exports = router;
