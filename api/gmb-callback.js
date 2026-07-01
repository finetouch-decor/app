module.exports = async function handler(req, res) {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Google OAuth error: ${error}`);
  if (!code) return res.status(400).send('No code received');

  const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const REDIRECT      = 'https://app-one-amber-58.vercel.app/api/gmb-callback';
  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    return res.status(400).send(`Token exchange failed: ${JSON.stringify(tokens)}`);
  }

  // Save refresh token to Supabase marketing_data (mesmo token cobre GMB + Google Drive, já que
  // pedimos os dois escopos juntos na tela de autorização)
  const saveKey = async (key) => fetch(`${SUPABASE_URL}/rest/v1/marketing_data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      key,
      value: { token: tokens.refresh_token },
      updated_at: new Date().toISOString(),
    }),
  });
  await Promise.all([saveKey('gmb_refresh_token'), saveKey('gdrive_refresh_token')]);

  return res.status(200).send(`
    <html><body style="font-family:sans-serif;padding:40px">
      <h2>✅ GMB conectado com sucesso!</h2>
      <p>Refresh token salvo no banco. Pode fechar esta janela.</p>
      <p><small>Token: ${tokens.refresh_token.slice(0,20)}...</small></p>
    </body></html>
  `);
};
