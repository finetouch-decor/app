import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, full_name } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email obrigatório' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
  );

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { full_name: full_name || '' },
    redirectTo: `${process.env.APP_URL || 'https://app-one-amber-58.vercel.app'}/login.html`,
  });

  if (error) return res.status(400).json({ error: error.message });

  // cria perfil aprovado diretamente
  await supabase.from('user_profiles').upsert({
    id: data.user.id,
    email,
    full_name: full_name || '',
    status: 'approved',
    role: 'user',
    approved_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  return res.status(200).json({ ok: true });
}
