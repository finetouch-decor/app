// Busca dados reais de posição/cliques/impressões do Google Search Console
// para o site da Fine Touch, usando o refresh token salvo em marketing_data
// (gsc_refresh_token, obtido via /api/gsc-auth -> /api/gmb-callback?state=gsc).
module.exports = async function handler(req, res) {
  const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    // 1. Pega o refresh token salvo
    const tokenRowRes = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_data?key=eq.gsc_refresh_token&select=value`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const tokenRows = await tokenRowRes.json();
    const refreshToken = tokenRows?.[0]?.value?.token;
    if (!refreshToken) {
      return res.status(400).json({ ok: false, error: 'Search Console ainda não conectado. Acesse /api/gsc-auth primeiro.' });
    }

    // 2. Troca o refresh token por um access token novo
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) {
      return res.status(400).json({ ok: false, error: 'Falha ao renovar access token', details: tokens });
    }
    const authHeader = { Authorization: `Bearer ${tokens.access_token}` };

    // 3. Descobre a propriedade verificada (domain property ou url-prefix)
    const sitesRes = await fetch('https://www.googleapis.com/webmasters/v3/sites', { headers: authHeader });
    const sitesJson = await sitesRes.json();
    if (sitesJson.error) {
      return res.status(400).json({ ok: false, error: 'Erro da API do Google ao listar sites', googleError: sitesJson.error, httpStatus: sitesRes.status });
    }
    const entries = sitesJson.siteEntry || [];
    const site = entries.find(s => s.siteUrl?.includes('ftdecordesign.com')) || entries[0];
    if (!site) {
      return res.status(400).json({ ok: false, error: 'Nenhuma propriedade verificada encontrada nessa conta Google.', allSites: entries, rawResponse: sitesJson, httpStatus: sitesRes.status });
    }

    // 3b. Checagem pontual de indexação (?indexcheck=1): usa a URL Inspection API
    // pra saber, por URL, se o Google indexou ou não (SEO — página /areas/lake-nona etc).
    if (req.query.indexcheck === '1') {
      const urlsToCheck = [
        '/', '/projects', '/blog', '/catalog', '/privacy-policy',
        '/areas/winter-garden', '/areas/ocoee', '/areas/dr-phillips', '/areas/windermere',
        '/areas/clermont', '/areas/winter-park', '/areas/lake-nona', '/areas/kissimmee-davenport',
        '/projects/slat-wood-kitchen-island', '/projects/tv-fireplace-feature-wall',
        '/projects/marbled-pvc-tv-panel', '/projects/boiserie-living-room',
        '/projects/geometric-accent-wall', '/projects/wall-paneling-fireplace-windermere-2026',
        '/blog/tv-panel-wall-vs-media-wall', '/blog/accent-wall-winter-garden',
        '/blog/wood-slat-wall-panels-orlando', '/blog/accent-wall-cost-orlando-fl',
      ];
      const results = [];
      for (const path of urlsToCheck) {
        const inspectionUrl = `https://ftdecordesign.com${path}`;
        try {
          const inspRes = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
            method: 'POST',
            headers: { ...authHeader, 'Content-Type': 'application/json' },
            body: JSON.stringify({ inspectionUrl, siteUrl: site.siteUrl }),
          });
          const inspJson = await inspRes.json();
          const r = inspJson.inspectionResult?.indexStatusResult || {};
          results.push({
            path,
            verdict: r.verdict || null,
            coverageState: r.coverageState || null,
            indexingState: r.indexingState || null,
            robotsTxtState: r.robotsTxtState || null,
            lastCrawlTime: r.lastCrawlTime || null,
            googleCanonical: r.googleCanonical || null,
            userCanonical: r.userCanonical || null,
            error: inspJson.error ? inspJson.error.message : null,
          });
        } catch (e) {
          results.push({ path, error: e.message });
        }
      }
      return res.status(200).json({ ok: true, site: site.siteUrl, checkedAt: new Date().toISOString(), results });
    }

    // 4. Consulta os dados reais dos últimos 90 dias, agrupados por keyword (query)
    const end = new Date();
    end.setDate(end.getDate() - 3); // GSC tem defasagem de ~2-3 dias
    const start = new Date(end);
    start.setDate(start.getDate() - 90);
    const fmt = d => d.toISOString().slice(0, 10);

    const queryRes = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: fmt(start),
          endDate: fmt(end),
          dimensions: ['query'],
          rowLimit: 50,
        }),
      }
    );
    const queryJson = await queryRes.json();
    const rows = (queryJson.rows || [])
      .map(r => ({
        query: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: Math.round(r.ctr * 1000) / 10, // %
        position: Math.round(r.position * 10) / 10,
      }))
      .sort((a, b) => b.impressions - a.impressions);

    // Totais do período (soma geral, sem quebra por keyword) pra dar visão macro
    const totalsRes = await fetch(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.siteUrl)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: fmt(start), endDate: fmt(end), dimensions: [] }),
      }
    );
    const totalsJson = await totalsRes.json();
    const totalsRow = (totalsJson.rows || [])[0] || {};

    const result = {
      ok: true,
      site: site.siteUrl,
      periodStart: fmt(start),
      periodEnd: fmt(end),
      totals: {
        clicks: totalsRow.clicks || 0,
        impressions: totalsRow.impressions || 0,
        ctr: totalsRow.ctr ? Math.round(totalsRow.ctr * 1000) / 10 : 0,
        position: totalsRow.position ? Math.round(totalsRow.position * 10) / 10 : null,
      },
      topQueries: rows,
      fetchedAt: new Date().toISOString(),
    };

    // 5. Guarda um cache no banco pra não precisar bater no Google toda hora
    await fetch(`${SUPABASE_URL}/rest/v1/marketing_data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ key: 'gsc_data', value: result, updated_at: new Date().toISOString() }),
    });

    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
