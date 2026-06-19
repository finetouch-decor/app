// Vercel Serverless Function — Google Ads API proxy seguro
// Credenciais APENAS em variáveis de ambiente do Vercel (nunca expostas ao browser)

const ALLOWED_ORIGINS = [
  'https://app-one-amber-58.vercel.app',
  'http://localhost:3000',
];

const PERIOD_MAP = { '7': 'LAST_7_DAYS', '30': 'LAST_30_DAYS', '90': 'LAST_90_DAYS' };
const API_VERSION = 'v24';

export default async function handler(req, res) {
  const origin = req.headers.origin || '';

  // CORS — só domínios autorizados
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const {
    GOOGLE_ADS_DEVELOPER_TOKEN,
    GOOGLE_ADS_CLIENT_ID,
    GOOGLE_ADS_CLIENT_SECRET,
    GOOGLE_ADS_REFRESH_TOKEN,
    GOOGLE_ADS_CUSTOMER_ID,
  } = process.env;

  if (!GOOGLE_ADS_REFRESH_TOKEN) {
    return res.status(500).json({ error: 'Credentials not configured' });
  }

  try {
    // 1. Obter access token via refresh token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_ADS_CLIENT_ID,
        client_secret: GOOGLE_ADS_CLIENT_SECRET,
        refresh_token: GOOGLE_ADS_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }),
    });
    const { access_token } = await tokenRes.json();
    if (!access_token) return res.status(401).json({ error: 'Auth failed' });

    const customerId = GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '');
    const period = req.query.period || '30';
    const gaqlPeriod = PERIOD_MAP[period] || 'LAST_30_DAYS';

    const headers = {
      'Authorization': `Bearer ${access_token}`,
      'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
      'login-customer-id': customerId,
      'Content-Type': 'application/json',
    };
    const base = `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:search`;

    // 2. Dados diários
    const dailyRes = await fetch(base, {
      method: 'POST', headers,
      body: JSON.stringify({ query: `
        SELECT segments.date, metrics.clicks, metrics.impressions,
               metrics.cost_micros, metrics.ctr, metrics.average_cpc
        FROM campaign
        WHERE segments.date DURING ${gaqlPeriod}
          AND campaign.status = 'ENABLED'
        ORDER BY segments.date ASC
      `}),
    });
    const dailyJson = await dailyRes.json();

    // 3. Keywords
    const kwRes = await fetch(base, {
      method: 'POST', headers,
      body: JSON.stringify({ query: `
        SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
               metrics.clicks, metrics.impressions, metrics.cost_micros,
               metrics.ctr, metrics.average_cpc, metrics.conversions
        FROM keyword_view
        WHERE segments.date DURING ${gaqlPeriod}
          AND campaign.status = 'ENABLED'
        ORDER BY metrics.clicks DESC
        LIMIT 20
      `}),
    });
    const kwJson = await kwRes.json();

    // 4. Processar resultados
    const daily = (dailyJson.results || []).map(r => ({
      date: r.segments?.date,
      clicks: r.metrics?.clicks || 0,
      impressions: r.metrics?.impressions || 0,
      cost: parseFloat(((r.metrics?.costMicros || 0) / 1_000_000).toFixed(2)),
      ctr: parseFloat(((r.metrics?.ctr || 0) * 100).toFixed(2)),
      cpc: parseFloat(((r.metrics?.averageCpc || 0) / 1_000_000).toFixed(2)),
    }));

    const keywords = (kwJson.results || []).map(r => ({
      text: r.adGroupCriterion?.keyword?.text,
      matchType: r.adGroupCriterion?.keyword?.matchType,
      clicks: r.metrics?.clicks || 0,
      impressions: r.metrics?.impressions || 0,
      cost: parseFloat(((r.metrics?.costMicros || 0) / 1_000_000).toFixed(2)),
      ctr: parseFloat(((r.metrics?.ctr || 0) * 100).toFixed(2)),
      cpc: parseFloat(((r.metrics?.averageCpc || 0) / 1_000_000).toFixed(2)),
      conversions: r.metrics?.conversions || 0,
    }));

    res.status(200).json({
      ok: true,
      period: gaqlPeriod,
      fetchedAt: new Date().toISOString(),
      daily,
      keywords,
    });

  } catch (err) {
    console.error('Google Ads error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}
