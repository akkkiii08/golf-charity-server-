const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');
const { authenticate } = require('../middleware/auth');

// GET /api/users/profile
router.get('/profile', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, charity_id, charity_percent, created_at')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(500).json({ error: 'Failed to fetch profile' });
  res.json(data);
});

// PATCH /api/users/profile
router.patch('/profile', authenticate, async (req, res) => {
  const { full_name, charity_id, charity_percent } = req.body;
  const updates = {};
  if (full_name) updates.full_name = full_name;
  if (charity_id !== undefined) updates.charity_id = charity_id;
  if (charity_percent !== undefined) {
    const pct = Number(charity_percent);
    if (pct < 10 || pct > 100) return res.status(400).json({ error: 'Charity percent must be 10–100' });
    updates.charity_percent = pct;
  }

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', req.user.id)
    .select('id, email, full_name, charity_id, charity_percent')
    .single();

  if (error) return res.status(500).json({ error: 'Failed to update profile' });
  res.json(data);
});

// PATCH /api/users/password
router.patch('/password', authenticate, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Both current and new password required' });
  }

  const { data: user } = await supabase
    .from('users')
    .select('password_hash')
    .eq('id', req.user.id)
    .single();

  const valid = await bcrypt.compare(current_password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password incorrect' });

  const password_hash = await bcrypt.hash(new_password, 12);
  await supabase.from('users').update({ password_hash }).eq('id', req.user.id);
  res.json({ message: 'Password updated' });
});

// GET /api/users/dashboard-stats — aggregated stats for user dashboard
router.get('/dashboard-stats', authenticate, async (req, res) => {
  const userId = req.user.id;

  const [scoresRes, subsRes, winsRes, drawsRes] = await Promise.all([
    supabase.from('scores').select('*').eq('user_id', userId).order('played_at', { ascending: false }).limit(5),
    supabase.from('subscriptions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).single(),
    supabase.from('winners').select('prize_amount, match_type, payment_status, verification').eq('user_id', userId),
    supabase.from('draws').select('id, draw_month, status, winning_numbers').eq('status', 'published').order('draw_month', { ascending: false }).limit(5),
  ]);

  const totalWon = (winsRes.data || []).reduce((s, w) => s + (w.prize_amount || 0), 0);

  res.json({
    scores: scoresRes.data || [],
    subscription: subsRes.data || null,
    winnings: winsRes.data || [],
    totalWonPence: totalWon,
    recentDraws: drawsRes.data || [],
  });
});

module.exports = router;
