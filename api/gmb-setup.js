// Endpoint temporário para descobrir GMB Account ID e Location ID
module.exports = async function handler(req, res) {
  const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const GMB_REFRESH_TOKEN    = process.env.GMB_REFRESH_TOKEN;

  if (!GMB_REFRESH_TOKEN) return res.status(400).json({ error: 'GMB_REFRESH_TOKEN not set' });

  // Obter access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GMB_REFRESH_TOKEN,
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
    result.push({ account: acc.name, accountDisplayName: acc.accountName, locations: locData.locations || [] });
  }

  return res.status(200).json({ ok: true, accounts: result });
};
