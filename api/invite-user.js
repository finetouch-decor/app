module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, full_name } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email obrigatório' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Envia convite via Supabase Auth Admin REST API
  const invRes = await fetch(`${SUPABASE_URL}/auth/v1/invite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ email, data: { full_name: full_name || '' } }),
  });

  const invJson = await invRes.json();
  if (!invRes.ok) return res.status(400).json({ error: invJson.msg || invJson.error_description || 'Erro ao convidar' });

  const userId = invJson.id;

  // Cria perfil aprovado
  await fetch(`${SUPABASE_URL}/rest/v1/user_profiles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: userId,
      email,
      full_name: full_name || '',
      status: 'approved',
      role: 'user',
      approved_at: new Date().toISOString(),
    }),
  });

  return res.status(200).json({ ok: true });
};
