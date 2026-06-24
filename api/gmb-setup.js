// Endpoint para descobrir GMB Account ID e Location ID usando token salvo no Supabase
module.exports = async function handler(req, res) {
  const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const SUPABASE_URL         = process.env.SUPABASE_URL;
  const SERVICE_KEY          = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Buscar refresh token do Supabase
  const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/marketing_data?key=eq.gmb_refresh_token&select=value`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` },
  });
  const dbData = await dbRes.json();
  const refresh_token = dbData?.[0]?.value?.token;
  if (!refresh_token) return res.status(400).json({ error: 'No refresh token in DB. Visit /api/gmb-auth first.' });

  // Obter access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) return res.status(400).json({ error: 'Token failed', details: tokenData });

  const access_token = tokenData.access_token;

  // Listar accounts
  const accRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const accData = await accRes.json();
  if (!accRes.ok) return res.status(400).json({ error: 'Accounts failed', details: accData });

  // Para cada account, listar locations
  const result = [];
  for (const acc of (accData.accounts || [])) {
    const locRes = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations?readMask=name,title`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const locData = await locRes.json();
    result.push({ account: acc.name, accountDisplayName: acc.accountName, locations: locData.locations || [], locationsRaw: locData });
  }

  return res.status(200).json({ ok: true, accounts: result });
};
