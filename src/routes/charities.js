const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET /api/charities — public list
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('charities')
    .select('*')
    .eq('is_active', true)
    .order('is_featured', { ascending: false });

  if (error) return res.status(500).json({ error: 'Failed to fetch charities' });
  res.json(data);
});

// GET /api/charities/:id
router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('charities')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Charity not found' });
  res.json(data);
});

// POST /api/charities — admin
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { name, description, image_url, website_url, is_featured } = req.body;
  const { data, error } = await supabase
    .from('charities')
    .insert({ name, description, image_url, website_url, is_featured: is_featured || false })
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Failed to create charity' });
  res.status(201).json(data);
});

// PATCH /api/charities/:id — admin
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  const { name, description, image_url, website_url, is_featured, is_active } = req.body;
  const { data, error } = await supabase
    .from('charities')
    .update({ name, description, image_url, website_url, is_featured, is_active })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: 'Failed to update charity' });
  res.json(data);
});

// DELETE /api/charities/:id — admin (soft delete)
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  await supabase.from('charities').update({ is_active: false }).eq('id', req.params.id);
  res.json({ message: 'Charity deactivated' });
});

// PATCH /api/charities/user/select — user selects charity
router.patch('/user/select', authenticate, async (req, res) => {
  const { charity_id, charity_percent } = req.body;
  const percent = Number(charity_percent);

  if (percent < 10 || percent > 100) {
    return res.status(400).json({ error: 'Charity percent must be between 10 and 100' });
  }

  const { data, error } = await supabase
    .from('users')
    .update({ charity_id, charity_percent: percent })
    .eq('id', req.user.id)
    .select('charity_id, charity_percent')
    .single();

  if (error) return res.status(500).json({ error: 'Failed to update charity preference' });
  res.json(data);
});

module.exports = router;
