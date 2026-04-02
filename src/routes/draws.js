const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { sendDrawResultEmail } = require('../utils/email');

// ── Draw Algorithm ────────────────────────────────────────

/**
 * Generate 5 winning numbers (1–45) randomly
 */
function generateRandomNumbers() {
  const numbers = new Set();
  while (numbers.size < 5) {
    numbers.add(Math.floor(Math.random() * 45) + 1);
  }
  return Array.from(numbers).sort((a, b) => a - b);
}

/**
 * Generate 5 numbers algorithmically:
 * Biased toward scores that appear most frequently across all users
 */
async function generateAlgorithmicNumbers() {
  const { data: scores } = await supabase
    .from('scores')
    .select('score');

  if (!scores || scores.length === 0) return generateRandomNumbers();

  // Count frequency of each score value
  const freq = {};
  scores.forEach(({ score }) => { freq[score] = (freq[score] || 0) + 1; });

  // Build weighted pool
  const pool = [];
  Object.entries(freq).forEach(([score, count]) => {
    for (let i = 0; i < count; i++) pool.push(Number(score));
  });

  // Pick 5 unique numbers from weighted pool
  const picked = new Set();
  let attempts = 0;
  while (picked.size < 5 && attempts < 500) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.add(pool[idx]);
    attempts++;
  }
  // Fill remaining with random if needed
  while (picked.size < 5) {
    picked.add(Math.floor(Math.random() * 45) + 1);
  }
  return Array.from(picked).sort((a, b) => a - b);
}

/**
 * Get user's entry numbers from their 5 scores
 */
function getUserNumbers(scores) {
  return scores.map(s => s.score).sort((a, b) => a - b);
}

/**
 * Count matches between user numbers and winning numbers
 */
function countMatches(userNums, winningNums) {
  const winSet = new Set(winningNums);
  return userNums.filter(n => winSet.has(n)).length;
}

/**
 * Calculate prize distribution from total pool
 * 5-match: 40% | 4-match: 35% | 3-match: 25%
 */
function calculatePrizePool(totalPence, rolloverPence = 0) {
  const jackpotBase = Math.floor(totalPence * 0.4) + rolloverPence;
  const fourMatch   = Math.floor(totalPence * 0.35);
  const threeMatch  = Math.floor(totalPence * 0.25);
  return { jackpotBase, fourMatch, threeMatch };
}

// ── Routes ────────────────────────────────────────────────

// GET /api/draws — list all draws (public summary)
router.get('/', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('draws')
    .select('id, draw_month, draw_type, status, winning_numbers, prize_pool_total, jackpot_amount, published_at')
    .order('draw_month', { ascending: false })
    .limit(12);

  if (error) return res.status(500).json({ error: 'Failed to fetch draws' });
  res.json(data);
});

// GET /api/draws/:id — single draw detail
router.get('/:id', authenticate, async (req, res) => {
  const { data: draw, error } = await supabase
    .from('draws')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !draw) return res.status(404).json({ error: 'Draw not found' });

  // Get user's entry for this draw
  const { data: entry } = await supabase
    .from('draw_entries')
    .select('*')
    .eq('draw_id', req.params.id)
    .eq('user_id', req.user.id)
    .single();

  res.json({ draw, userEntry: entry || null });
});

// POST /api/draws — Admin: create a new draw
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { draw_month, draw_type = 'random' } = req.body;
  if (!draw_month) return res.status(400).json({ error: 'draw_month required' });

  // Calculate prize pool from current month's payments
  const monthStart = new Date(draw_month);
  const monthEnd   = new Date(new Date(draw_month).setMonth(monthStart.getMonth() + 1));

  const { data: payments } = await supabase
    .from('payments')
    .select('prize_pool_contrib')
    .eq('status', 'succeeded')
    .gte('created_at', monthStart.toISOString())
    .lt('created_at', monthEnd.toISOString());

  const prizePoolTotal = (payments || []).reduce(
    (sum, p) => sum + (p.prize_pool_contrib || 0), 0
  );

  // Check for rollover from previous jackpot
  const { data: prevDraw } = await supabase
    .from('draws')
    .select('rollover_amount')
    .eq('status', 'published')
    .order('draw_month', { ascending: false })
    .limit(1)
    .single();

  const rolloverAmount = prevDraw?.rollover_amount || 0;

  const { data: draw, error } = await supabase
    .from('draws')
    .insert({
      draw_month,
      draw_type,
      status: 'pending',
      prize_pool_total: prizePoolTotal,
      rollover_amount: rolloverAmount,
      jackpot_amount: Math.floor(prizePoolTotal * 0.4) + rolloverAmount,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Failed to create draw' });
  res.status(201).json(draw);
});

// POST /api/draws/:id/simulate — Admin: simulate draw (no publish)
router.post('/:id/simulate', authenticate, requireAdmin, async (req, res) => {
  const { data: draw } = await supabase
    .from('draws')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (!draw) return res.status(404).json({ error: 'Draw not found' });

  const winningNumbers = draw.draw_type === 'algorithmic'
    ? await generateAlgorithmicNumbers()
    : generateRandomNumbers();

  // Compute entries without saving
  const { data: subscribers } = await supabase
    .from('users')
    .select('id, full_name, email')
    .eq('role', 'user')
    .eq('is_active', true);

  const preview = [];
  for (const user of (subscribers || [])) {
    const { data: scores } = await supabase
      .from('scores')
      .select('score')
      .eq('user_id', user.id)
      .order('played_at', { ascending: false })
      .limit(5);

    if (!scores || scores.length < 3) continue;
    const userNums = getUserNumbers(scores);
    const matched  = countMatches(userNums, winningNumbers);
    if (matched >= 3) {
      preview.push({ user: user.full_name, matched, numbers: userNums });
    }
  }

  res.json({ winningNumbers, preview, draw });
});

// POST /api/draws/:id/publish — Admin: run & publish draw
router.post('/:id/publish', authenticate, requireAdmin, async (req, res) => {
  const { data: draw } = await supabase
    .from('draws')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (!draw) return res.status(404).json({ error: 'Draw not found' });
  if (draw.status === 'published') return res.status(400).json({ error: 'Already published' });

  // Generate winning numbers
  const winningNumbers = draw.draw_type === 'algorithmic'
    ? await generateAlgorithmicNumbers()
    : generateRandomNumbers();

  const { jackpotBase, fourMatch, threeMatch } = calculatePrizePool(
    draw.prize_pool_total,
    draw.rollover_amount
  );

  // Get all active subscribers with scores
  const { data: subscribers } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('status', 'active');

  const winnersByTier = { '5-match': [], '4-match': [], '3-match': [] };
  const entries = [];

  for (const sub of (subscribers || [])) {
    const { data: scores } = await supabase
      .from('scores')
      .select('score')
      .eq('user_id', sub.user_id)
      .order('played_at', { ascending: false })
      .limit(5);

    if (!scores || scores.length < 3) continue;

    const userNums = getUserNumbers(scores);
    const matched  = countMatches(userNums, winningNumbers);

    entries.push({
      draw_id: draw.id,
      user_id: sub.user_id,
      numbers: userNums,
      matched: matched >= 3 ? matched : null,
    });

    if (matched === 5) winnersByTier['5-match'].push(sub.user_id);
    else if (matched === 4) winnersByTier['4-match'].push(sub.user_id);
    else if (matched === 3) winnersByTier['3-match'].push(sub.user_id);
  }

  // Upsert draw entries
  if (entries.length > 0) {
    await supabase.from('draw_entries').upsert(entries);
  }

  // Calculate per-winner prize amounts
  const prizePerWinner = (tier, pool, winners) =>
    winners.length > 0 ? Math.floor(pool / winners.length) : 0;

  const jackpotWinners  = winnersByTier['5-match'];
  const fourWinners     = winnersByTier['4-match'];
  const threeWinners    = winnersByTier['3-match'];

  // Insert winner records
  const winnerInserts = [];
  jackpotWinners.forEach(uid => winnerInserts.push({
    draw_id: draw.id, user_id: uid, match_type: '5-match',
    prize_amount: prizePerWinner('5-match', jackpotBase, jackpotWinners),
  }));
  fourWinners.forEach(uid => winnerInserts.push({
    draw_id: draw.id, user_id: uid, match_type: '4-match',
    prize_amount: prizePerWinner('4-match', fourMatch, fourWinners),
  }));
  threeWinners.forEach(uid => winnerInserts.push({
    draw_id: draw.id, user_id: uid, match_type: '3-match',
    prize_amount: prizePerWinner('3-match', threeMatch, threeWinners),
  }));

  if (winnerInserts.length > 0) {
    await supabase.from('winners').insert(winnerInserts);
  }

  // Jackpot rollover if no 5-match winner
  const newRollover = jackpotWinners.length === 0 ? jackpotBase : 0;

  // Update draw status
  const { data: updatedDraw } = await supabase
    .from('draws')
    .update({
      status: 'published',
      winning_numbers: winningNumbers,
      jackpot_amount: jackpotBase,
      rollover_amount: newRollover,
      published_at: new Date().toISOString(),
    })
    .eq('id', draw.id)
    .select()
    .single();

  // Email winners (non-blocking)
  for (const uid of [...jackpotWinners, ...fourWinners, ...threeWinners]) {
    const { data: u } = await supabase.from('users').select('email, full_name').eq('id', uid).single();
    if (u) sendDrawResultEmail(u.email, u.full_name, winningNumbers, true).catch(console.error);
  }

  res.json({
    draw: updatedDraw,
    winners: { jackpot: jackpotWinners.length, fourMatch: fourWinners.length, threeMatch: threeWinners.length },
    rollover: newRollover,
  });
});

module.exports = router;
