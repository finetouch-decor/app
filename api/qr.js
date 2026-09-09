export default async function handler(req, res) {
  const SUPABASE_URL = 'https://jpbpzlpvhdwgbmljqfyd.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_l6x3A2YiBL0Pc7huB-QejA_d2RXKL59';
  const code = (req.query && req.query.code) || 'yard_sign';
  const dest = 'https://ftdecordesign.com/?utm_source=yard_sign&utm_medium=qr&utm_campaign=jobsite_signage';

  try {
    const ua = req.headers['user-agent'] || '';
    const ref = req.headers['referer'] || req.headers['referrer'] || '';
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    await fetch(SUPABASE_URL + '/rest/v1/qr_scans', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ code, dest_url: dest, user_agent: ua, referrer: ref, ip }),
    });
  } catch (e) {
    // logging failure should never block the redirect
  }

  res.writeHead(302, { Location: dest });
  res.end();
}
