const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const supabase = require('../config/supabase');
const { authenticate, requireSubscription } = require('../middleware/auth');

// GET /api/scores — get current user's last 5 scores
router.get('/', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('scores')
    .select('*')
    .eq('user_id', req.user.id)
    .order('played_at', { ascending: false })
    .limit(5);

  if (error) return res.status(500).json({ error: 'Failed to fetch scores' });
  res.json(data);
});

// POST /api/scores — add a new score (rolling 5-score window)
router.post(
  '/',
  authenticate,
  requireSubscription,
  [
    body('score').isInt({ min: 1, max: 45 }).withMessage('Score must be between 1 and 45'),
    body('played_at').isISO8601().withMessage('Invalid date format'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { score, played_at } = req.body;

    // Count existing scores
    const { data: existing, error: fetchError } = await supabase
      .from('scores')
      .select('id, played_at')
      .eq('user_id', req.user.id)
      .order('played_at', { ascending: true }); // oldest first

    if (fetchError) return res.status(500).json({ error: 'Failed to check scores' });

    // If already at 5, delete the oldest
    if (existing.length >= 5) {
      const oldestId = existing[0].id;
      await supabase.from('scores').delete().eq('id', oldestId);
    }

    const { data: newScore, error: insertError } = await supabase
      .from('scores')
      .insert({ user_id: req.user.id, score, played_at })
      .select()
      .single();

    if (insertError) return res.status(500).json({ error: 'Failed to save score' });
    res.status(201).json(newScore);
  }
);

// DELETE /api/scores/:id
router.delete('/:id', authenticate, async (req, res) => {
  const { error } = await supabase
    .from('scores')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id); // ensure ownership

  if (error) return res.status(500).json({ error: 'Failed to delete score' });
  res.json({ message: 'Score deleted' });
});

module.exports = router;
