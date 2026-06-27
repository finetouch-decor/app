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

  await Promise.all(blogPosts.map(async (post) => {
    const base = post.id === 'blog-post1'
      ? 'https://ftdecordesign.com/blog'
      : `https://ftdecordesign.com/blog/${post.slug}`;
    try {
      // GET com verificação de conteúdo — site retorna 200 mesmo para páginas inexistentes
      const r = await fetch(base, { method: 'GET', redirect: 'follow' });
      if (!r.ok) {
        blogResults.push({ id: post.id, published: false, url: base, label: post.label });
        return;
      }
      const html = await r.text();
      // Verifica se o slug aparece no conteúdo (indica página real, não redirect genérico)
      const slugKeyword = post.id === 'blog-post1' ? 'blog' : post.slug.split('-').slice(0, 3).join('-');
      const published = html.includes(slugKeyword) && html.length > 5000;
      blogResults.push({ id: post.id, published, url: base, label: post.label });
    } catch {
      blogResults.push({ id: post.id, published: false, url: base, label: post.label });
    }
  }));

  // Salvar status geral do blog em marketing_data
  await fetch(`${SUPABASE_URL}/rest/v1/marketing_data`, {
    method: 'POST', headers,
    body: JSON.stringify({ key: 'blog', value: { posts: blogResults, checkedAt: now }, updated_at: now }),
  });

  // Marcar como done em marketing_tasks os posts confirmados publicados
  await Promise.all(blogResults.filter(p => p.published).map(p =>
    fetch(`${SUPABASE_URL}/rest/v1/marketing_tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({ id: p.id, done: true, done_at: now, done_by: 'auto-sync' }),
    })
  ));

  // ── 2. GMB REVIEWS (se token configurado) ────────────────────
  const GMB_REFRESH_TOKEN   = process.env.GMB_REFRESH_TOKEN;
  const GMB_ACCOUNT_ID      = process.env.GMB_ACCOUNT_ID;
  const GMB_LOCATION_ID     = process.env.GMB_LOCATION_ID;
  const GOOGLE_CLIENT_ID    = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

  let gmbResult = { pending_setup: true };

  if (GMB_REFRESH_TOKEN && GMB_ACCOUNT_ID && GMB_LOCATION_ID) {
    try {
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
      const { access_token } = await tokenRes.json();
      const reviewRes = await fetch(
        `https://mybusinessaccountmanagement.googleapis.com/v1/accounts/${GMB_ACCOUNT_ID}/locations/${GMB_LOCATION_ID}/reviews?pageSize=50`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      const reviewData = await reviewRes.json();
      gmbResult = {
        reviews: (reviewData.reviews || []).map(r => ({
          author: r.reviewer?.displayName || 'Anônimo',
          rating: r.starRating,
          comment: r.comment || '',
          date: r.createTime,
        })),
        averageRating: reviewData.averageRating,
        totalCount: reviewData.totalReviewCount,
        checkedAt: now,
      };
    } catch (e) {
      gmbResult = { error: e.message, checkedAt: now };
    }
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
