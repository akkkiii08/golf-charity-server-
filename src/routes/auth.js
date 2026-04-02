const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { authenticate } = require('../middleware/auth');
const { sendWelcomeEmail } = require('../utils/email');

const signToken = (userId, role) =>
  jwt.sign({ userId, role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// POST /api/auth/register
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Min 8 characters'),
    body('full_name').trim().notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, full_name, charity_id, charity_percent } = req.body;

    // Check existing user
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const password_hash = await bcrypt.hash(password, 12);

    const { data: user, error } = await supabase
      .from('users')
      .insert({
        email,
        password_hash,
        full_name,
        charity_id: charity_id || null,
        charity_percent: charity_percent || 10,
        role: 'user',
      })
      .select('id, email, full_name, role, charity_id, charity_percent')
      .single();

    if (error) return res.status(500).json({ error: 'Registration failed' });

    // Send welcome email (non-blocking)
    sendWelcomeEmail(email, full_name).catch(console.error);

    const token = signToken(user.id, user.role);
    res.status(201).json({ token, user });
  }
);

// POST /api/auth/login
router.post(
  '/login',
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;

    const { data: user } = await supabase
      .from('users')
      .select('id, email, full_name, role, password_hash, is_active, charity_id, charity_percent')
      .eq('email', email)
      .single();

    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!user.is_active) return res.status(403).json({ error: 'Account suspended' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user.id, user.role);
    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  }
);

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  // Also return subscription status
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('id, plan, status, current_period_end')
    .eq('user_id', req.user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  res.json({ user: req.user, subscription: subscription || null });
});

module.exports = router;
