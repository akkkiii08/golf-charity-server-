const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const supabase = require('../config/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');

// Multer config — store in /uploads
const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    cb(null, `proof_${req.user.id}_${Date.now()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only images and PDFs are allowed'));
  },
});

// GET /api/winners/my — user's winning history
router.get('/my', authenticate, async (req, res) => {
  const { data, error } = await supabase
    .from('winners')
    .select('*, draws(draw_month, winning_numbers)')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch winnings' });
  res.json(data);
});

// GET /api/winners — admin: all winners
router.get('/', authenticate, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('winners')
    .select('*, users(full_name, email), draws(draw_month)')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch winners' });
  res.json(data);
});

// POST /api/winners/:id/upload-proof — winner uploads proof
router.post('/:id/upload-proof', authenticate, upload.single('proof'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const proofUrl = `/uploads/${req.file.filename}`;

  const { data, error } = await supabase
    .from('winners')
    .update({ proof_url: proofUrl })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id) // ensure ownership
    .select()
    .single();

  if (error || !data) return res.status(404).json({ error: 'Winner record not found' });
  res.json(data);
});

// PATCH /api/winners/:id/verify — admin verifies winner
router.patch('/:id/verify', authenticate, requireAdmin, async (req, res) => {
  const { verification } = req.body; // 'approved' | 'rejected'
  if (!['approved', 'rejected'].includes(verification)) {
    return res.status(400).json({ error: 'Invalid verification status' });
  }

  const { data, error } = await supabase
    .from('winners')
    .update({ verification })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Failed to update verification' });
  res.json(data);
});

// PATCH /api/winners/:id/payout — admin marks payout complete
router.patch('/:id/payout', authenticate, requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('winners')
    .update({ payment_status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('verification', 'approved')
    .select()
    .single();

  if (error || !data) return res.status(400).json({ error: 'Cannot mark payout — not yet approved' });
  res.json(data);
});

module.exports = router;
