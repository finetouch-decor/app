module.exports = async function handler(req, res) {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Google OAuth error: ${error}`);
  if (!code) return res.status(400).send('No code received');

  const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const REDIRECT      = 'https://app-one-amber-58.vercel.app/api/gsc-callback';
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

  // Salva o refresh token do Search Console (escopo webmasters.readonly)
  await fetch(`${SUPABASE_URL}/rest/v1/marketing_data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      key: 'gsc_refresh_token',
      value: { token: tokens.refresh_token },
      updated_at: new Date().toISOString(),
    }),
  });

  // Lista as propriedades verificadas nessa conta pra confirmar que o site está acessível
  let sitesInfo = '';
  try {
    const sitesRes = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const sitesJson = await sitesRes.json();
    sitesInfo = JSON.stringify(sitesJson.siteEntry || sitesJson, null, 2);
  } catch (e) {
    sitesInfo = 'Erro ao listar sites: ' + e.message;
  }

  return res.status(200).send(`
    <html><body style="font-family:sans-serif;padding:40px">
      <h2>✅ Search Console conectado com sucesso!</h2>
      <p>Refresh token salvo no banco. Pode fechar esta janela.</p>
      <p><strong>Propriedades encontradas nessa conta Google:</strong></p>
      <pre style="background:#f4f4f4;padding:16px;border-radius:8px;white-space:pre-wrap">${sitesInfo}</pre>
    </body></html>
  `);
};
