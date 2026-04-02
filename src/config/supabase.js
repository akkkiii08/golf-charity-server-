const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !serviceKey) {
  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_KEY');

  throw new Error(
    `Missing required environment variable(s): ${missing.join(', ')}. ` +
    'Set these in Railway Variables before starting the server.'
  );
}

const supabase = createClient(supabaseUrl, serviceKey); // service role key — bypasses RLS

module.exports = supabase;
