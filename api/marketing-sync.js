// Roda 2x/dia via Vercel Cron — verifica blog posts + GMB reviews e salva no Supabase
module.exports = async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Prefer': 'resolution=merge-duplicates',
  };

  // ── 1. VERIFICAR POSTS DO BLOG ────────────────────────────────
  const blogPosts = [
    { id: 'blog-post1',  slug: 'blog',                                   label: 'Blog criado em ftdecordesign.com/blog' },
    { id: 'blog-post1a', slug: 'accent-wall-cost-orlando-fl',            label: 'How Much Does an Accent Wall Cost in Orlando, FL?' },
    { id: 'blog-post2',  slug: 'wood-slat-wall-panels-orlando',          label: 'Wood Slat Wall Panels in Orlando' },
    { id: 'blog-post3',  slug: 'accent-wall-winter-garden',              label: 'What Are Accent Walls — Winter Garden' },
    { id: 'blog-post4',  slug: 'tv-panel-wall-vs-media-wall',            label: 'TV Panel Wall vs Media Wall' },
    { id: 'blog-post5',  slug: 'pvc-marble-panels-florida',              label: 'PVC Marble Panels Florida' },
    { id: 'blog-post6',  slug: 'fireplace-accent-wall-orlando',          label: 'Fireplace Accent Wall Orlando' },
    { id: 'blog-post7',  slug: 'wall-paneling-short-term-rentals-florida', label: 'Wall Paneling — Short-Term Rentals' },
    { id: 'blog-post8',  slug: 'accent-wall-contractors-orlando-fl',     label: 'Best Accent Wall Contractors in Orlando' },
  ];

  const now = new Date().toISOString();
  const blogResults = [];

  // Buscar sitemap para saber quais URLs estão realmente publicadas
  let sitemapUrls = new Set();
  try {
    const sitemapRes = await fetch('https://ftdecordesign.com/sitemap.xml');
    const sitemapXml = await sitemapRes.text();
    const matches = sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g);
    for (const m of matches) sitemapUrls.add(m[1].trim().replace(/\/$/, ''));
  } catch {}

  // IMPORTANTE (correção 2026-07-01): ftdecordesign.com é uma SPA renderizada no
  // cliente (Lovable/Vite) com um catch-all route no servidor - toda URL (real,
  // inexistente ou a home) devolve o MESMO HTML "casca" e os mesmos meta tags.
  // Isso foi confirmado testando uma URL propositalmente falsa e comparando com
  // uma página real: resposta idêntica. Ou seja, um fetch simples é estruturalmente
  // incapaz de confirmar se um post específico está publicado - só confirma que o
  // site responde. Por isso este check NÃO sobrescreve mais o status "done" manual
  // em marketing_tasks (isso causava falsos negativos, ex: blog-post1a apareceu
  // como não publicado quando na verdade já estava no ar há dias).
  // A fonte de verdade para "publicado" volta a ser a confirmação manual do dono
  // (checkbox na aba Blog do ERP). Este bloco só guarda um diagnóstico informativo.
  blogPosts.forEach((post) => {
    const base = post.id === 'blog-post1'
      ? 'https://ftdecordesign.com/blog'
      : `https://ftdecordesign.com/blog/${post.slug}`;
    const inSitemap = sitemapUrls.has(base) || sitemapUrls.has(base + '/');
    blogResults.push({ id: post.id, inSitemap, url: base, label: post.label });
  });

  // Salvar status geral do blog em marketing_data (apenas diagnóstico, não é mais
  // usado para marcar tarefas automaticamente como concluídas)
  await fetch(`${SUPABASE_URL}/rest/v1/marketing_data`, {
    method: 'POST', headers,
    body: JSON.stringify({
      key: 'blog',
      value: {
        posts: blogResults,
        checkedAt: now,
        note: 'Site é SPA client-side; "inSitemap" é apenas diagnóstico. Status real de publicação deve ser confirmado manualmente no ERP.',
      },
      updated_at: now,
    }),
  });

  // ── 2. GMB REVIEWS ─────────────────────────────────────────────
  // BUGFIX (2026-07-01): o refresh token nunca foi lido daqui - ele é salvo pelo
  // gmb-callback.js direto no Supabase (marketing_data.gmb_refresh_token), nunca
  // em uma env var. Antes este código lia process.env.GMB_REFRESH_TOKEN, que
  // nunca existiu, então gmbResult ficava para sempre em pending_setup.
  const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

  let gmbResult = { pending_setup: true };

  try {
    const tokenRowRes = await fetch(
      `${SUPABASE_URL}/rest/v1/marketing_data?key=eq.gmb_refresh_token&select=value`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const tokenRows = await tokenRowRes.json();
    const GMB_REFRESH_TOKEN = tokenRows?.[0]?.value?.token;

    if (GMB_REFRESH_TOKEN && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
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
      const tokenJson = await tokenRes.json();
      const access_token = tokenJson.access_token;

      if (!access_token) {
        gmbResult = { error: 'token_refresh_failed', detail: tokenJson, checkedAt: now };
      } else {
        // Auto-descobrir account_id / location_id (evita depender de env vars manuais
        // que talvez nunca tenham sido configuradas). Cai para env vars se existirem.
        let accountId = process.env.GMB_ACCOUNT_ID;
        let locationId = process.env.GMB_LOCATION_ID;

        if (!accountId) {
          const acctRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
            headers: { Authorization: `Bearer ${access_token}` },
          });
          const acctData = await acctRes.json();
          accountId = acctData.accounts?.[0]?.name?.split('/')[1];
        }

        if (accountId && !locationId) {
          const locRes = await fetch(
            `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${accountId}/locations?readMask=name,title`,
            { headers: { Authorization: `Bearer ${access_token}` } }
          );
          const locData = await locRes.json();
          locationId = locData.locations?.[0]?.name?.split('/')[1];
        }

        if (!accountId || !locationId) {
          gmbResult = { error: 'account_or_location_not_found', accountId, locationId, checkedAt: now };
        } else {
          // Nota: a Reviews API do Google Business Profile (mybusinessreviews.googleapis.com)
          // historicamente exige aprovação/allowlist da própria Google para acesso de terceiros.
          // Se isso falhar com 403, o problema é permissão da API no lado da Google, não este código.
          const reviewRes = await fetch(
            `https://mybusinessreviews.googleapis.com/v1/accounts/${accountId}/locations/${locationId}/reviews?pageSize=50`,
            { headers: { Authorization: `Bearer ${access_token}` } }
          );
          const reviewData = await reviewRes.json();

          if (reviewRes.status !== 200) {
            gmbResult = { error: 'reviews_api_error', status: reviewRes.status, detail: reviewData, accountId, locationId, checkedAt: now };
          } else {
            gmbResult = {
              reviews: (reviewData.reviews || []).map(r => ({
                author: r.reviewer?.displayName || 'Anônimo',
                rating: r.starRating,
                comment: r.comment || '',
                date: r.createTime,
              })),
              averageRating: reviewData.averageRating,
              totalCount: reviewData.totalReviewCount,
              accountId, locationId,
              checkedAt: now,
            };
          }
        }
      }
    } else {
      gmbResult = { pending_setup: true, missing: !GMB_REFRESH_TOKEN ? 'refresh_token' : 'google_client_credentials', checkedAt: now };
    }
  } catch (e) {
    gmbResult = { error: e.message, checkedAt: now };
  }

  await fetch(`${SUPABASE_URL}/rest/v1/marketing_data`, {
    method: 'POST', headers,
    body: JSON.stringify({ key: 'gmb_reviews', value: gmbResult, updated_at: now }),
  });

  return res.status(200).json({
    ok: true,
    blog: blogResults,
    gmb: gmbResult,
  });
};
