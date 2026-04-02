const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');

// All admin routes require auth + admin role
router.use(authenticate, requireAdmin);

// GET /api/admin/stats — dashboard overview
router.get('/stats', async (req, res) => {
  const [usersRes, subsRes, paymentsRes, winnersRes, charitiesRes] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact' }).eq('role', 'user'),
    supabase.from('subscriptions').select('id', { count: 'exact' }).eq('status', 'active'),
    supabase.from('payments').select('amount_pence, prize_pool_contrib, charity_contrib').eq('status', 'succeeded'),
    supabase.from('winners').select('prize_amount, payment_status'),
    supabase.from('charities').select('id', { count: 'exact' }).eq('is_active', true),
  ]);

  const payments = paymentsRes.data || [];
  const winners  = winnersRes.data || [];

  const totalRevenue   = payments.reduce((s, p) => s + (p.amount_pence || 0), 0);
  const totalPrizePool = payments.reduce((s, p) => s + (p.prize_pool_contrib || 0), 0);
  const totalDonations = payments.reduce((s, p) => s + (p.charity_contrib || 0), 0);
  const totalPaid      = winners.filter(w => w.payment_status === 'paid').reduce((s, w) => s + (w.prize_amount || 0), 0);

  res.json({
    totalUsers:         usersRes.count || 0,
    activeSubscribers:  subsRes.count || 0,
    activeCharities:    charitiesRes.count || 0,
    totalRevenuePence:  totalRevenue,
    totalPrizePoolPence: totalPrizePool,
    totalDonationsPence: totalDonations,
    totalPaidOutPence:   totalPaid,
  });
});

// GET /api/admin/users — paginated user list
router.get('/users', async (req, res) => {
  const page  = parseInt(req.query.page  || '1');
  const limit = parseInt(req.query.limit || '20');
  const from  = (page - 1) * limit;

  const { data, error, count } = await supabase
    .from('users')
    .select('id, email, full_name, role, is_active, created_at, charity_id, stripe_customer_id', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + limit - 1);

  if (error) return res.status(500).json({ error: 'Failed to fetch users' });
  res.json({ data, total: count, page, limit });
});

// PATCH /api/admin/users/:id — edit user
router.patch('/users/:id', async (req, res) => {
  const { full_name, role, is_active } = req.body;
  const { data, error } = await supabase
    .from('users')
    .update({ full_name, role, is_active })
    .eq('id', req.params.id)
    .select('id, email, full_name, role, is_active')
    .single();

  if (error) return res.status(500).json({ error: 'Failed to update user' });
  res.json(data);
});

// GET /api/admin/users/:id/scores — admin view user scores
router.get('/users/:id/scores', async (req, res) => {
  const { data, error } = await supabase
    .from('scores')
    .select('*')
    .eq('user_id', req.params.id)
    .order('played_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch scores' });
  res.json(data);
});

// PATCH /api/admin/scores/:id — admin edit a score
router.patch('/scores/:id', async (req, res) => {
  const { score, played_at } = req.body;
  if (score < 1 || score > 45) return res.status(400).json({ error: 'Score out of range' });

  const { data, error } = await supabase
    .from('scores')
    .update({ score, played_at })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Failed to update score' });
  res.json(data);
});

// GET /api/admin/draws — all draws
router.get('/draws', async (req, res) => {
  const { data, error } = await supabase
    .from('draws')
    .select('*')
    .order('draw_month', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch draws' });
  res.json(data);
});

// GET /api/admin/winners — all winners with user info
router.get('/winners', async (req, res) => {
  const { data, error } = await supabase
    .from('winners')
    .select('*, users(full_name, email), draws(draw_month, winning_numbers)')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch winners' });
  res.json(data);
});

// GET /api/admin/subscriptions — all subs
router.get('/subscriptions', async (req, res) => {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*, users(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return res.status(500).json({ error: 'Failed to fetch subscriptions' });
  res.json(data);
});

module.exports = router;
