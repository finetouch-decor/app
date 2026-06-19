// Vercel Serverless Function — Google Ads API proxy
// Credenciais ficam APENAS em variáveis de ambiente do Vercel (nunca no código)

export default async function handler(req, res) {
  // CORS — só permite requisições do próprio domínio
  const origin = req.headers.origin || '';
  const allowed = ['https://app-one-amber-58.vercel.app', 'http://localhost:3000'];
  if (origin && !allowed.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600'); // cache 5min

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const {
    GOOGLE_ADS_DEVELOPER_TOKEN,
    GOOGLE_ADS_CLIENT_ID,
    GOOGLE_ADS_CLIENT_SECRET,
    GOOGLE_ADS_REFRESH_TOKEN,
    GOOGLE_ADS_CUSTOMER_ID,
  } = process.env;

  if (!GOOGLE_ADS_REFRESH_TOKEN || !GOOGLE_ADS_DEVELOPER_TOKEN) {
    return res.status(500).json({ error: 'Google Ads credentials not configured' });
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
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(401).json({ error: 'Failed to obtain access token' });
    }
    const accessToken = tokenData.access_token;

    const customerId = GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, '');
    const period = req.query.period || '30';
    const periodMap = { '7': 'LAST_7_DAYS', '30': 'LAST_30_DAYS', '90': 'LAST_90_DAYS' };
    const gaqlPeriod = periodMap[period] || 'LAST_30_DAYS';

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': GOOGLE_ADS_DEVELOPER_TOKEN,
      'Content-Type': 'application/json',
    };

    // 2. Dados diários
    const dailyQuery = `
      SELECT segments.date, metrics.clicks, metrics.impressions,
             metrics.cost_micros, metrics.ctr, metrics.average_cpc
      FROM campaign
      WHERE segments.date DURING ${gaqlPeriod}
        AND campaign.status = 'ENABLED'
      ORDER BY segments.date ASC
    `;

    const dailyRes = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
      { method: 'POST', headers, body: JSON.stringify({ query: dailyQuery }) }
    );
    const dailyData = await dailyRes.json();

    // 3. Keywords
    const kwQuery = `
      SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
             metrics.clicks, metrics.impressions, metrics.cost_micros,
             metrics.ctr, metrics.average_cpc, metrics.conversions
      FROM keyword_view
      WHERE segments.date DURING ${gaqlPeriod}
        AND campaign.status = 'ENABLED'
      ORDER BY metrics.clicks DESC
      LIMIT 20
    `;

    const kwRes = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
      { method: 'POST', headers, body: JSON.stringify({ query: kwQuery }) }
    );
    const kwData = await kwRes.json();

    // 4. Processar e retornar
    const daily = (dailyData.results || []).map(r => ({
      date: r.segments.date,
      clicks: r.metrics.clicks || 0,
      impressions: r.metrics.impressions || 0,
      cost: parseFloat(((r.metrics.costMicros || 0) / 1_000_000).toFixed(2)),
      ctr: parseFloat(((r.metrics.ctr || 0) * 100).toFixed(2)),
      cpc: parseFloat(((r.metrics.averageCpc || 0) / 1_000_000).toFixed(2)),
    }));

    const keywords = (kwData.results || []).map(r => ({
      text: r.adGroupCriterion.keyword.text,
      matchType: r.adGroupCriterion.keyword.matchType,
      clicks: r.metrics.clicks || 0,
      impressions: r.metrics.impressions || 0,
      cost: parseFloat(((r.metrics.costMicros || 0) / 1_000_000).toFixed(2)),
      ctr: parseFloat(((r.metrics.ctr || 0) * 100).toFixed(2)),
      cpc: parseFloat(((r.metrics.averageCpc || 0) / 1_000_000).toFixed(2)),
      conversions: r.metrics.conversions || 0,
    }));

    res.status(200).json({
      ok: true,
      period: gaqlPeriod,
      fetchedAt: new Date().toISOString(),
      daily,
      keywords,
    });

  } catch (err) {
    console.error('Google Ads API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
