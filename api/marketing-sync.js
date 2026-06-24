// Roda 2x/dia via Vercel Cron: verifica blog posts + GMB reviews
module.exports = async function handler(req, res) {
  // Permite chamada manual via GET ou cron via GET
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const results = {};

  // ── 1. VERIFICAR POSTS DO BLOG ────────────────────────────────
  const blogPosts = [
    { id: 'blog-post1a', slug: 'accent-wall-cost-orlando-fl',        title: 'How Much Does an Accent Wall Cost in Orlando, FL?' },
    { id: 'blog-post2',  slug: 'wood-slat-wall-panels-orlando',       title: 'Wood Slat Wall Panels in Orlando' },
    { id: 'blog-post3',  slug: 'accent-wall-winter-garden',           title: 'Accent Walls in Winter Garden' },
    { id: 'blog-post4',  slug: 'tv-panel-wall-vs-media-wall',         title: 'TV Panel Wall vs Media Wall' },
    { id: 'blog-post5',  slug: 'pvc-marble-panels-florida',           title: 'PVC Marble Panels Florida' },
    { id: 'blog-post6',  slug: 'fireplace-accent-wall-orlando',       title: 'Fireplace Accent Wall Orlando' },
    { id: 'blog-post7',  slug: 'wall-paneling-short-term-rentals-florida', title: 'Wall Paneling for Short-Term Rentals' },
    { id: 'blog-post8',  slug: 'accent-wall-contractors-orlando-fl',  title: 'Best Accent Wall Contractors in Orlando' },
  ];

  const blogStatus = {};
  await Promise.all(blogPosts.map(async (post) => {
    try {
      const url = `https://ftdecordesign.com/blog/${post.slug}`;
      const r = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      blogStatus[post.id] = { published: r.ok, url, checkedAt: new Date().toISOString() };
    } catch {
      blogStatus[post.id] = { published: false, checkedAt: new Date().toISOString() };
    }
  }));
  results.blog = blogStatus;

  // ── 2. GMB REVIEWS (se token configurado) ────────────────────
  const GMB_REFRESH_TOKEN = process.env.GMB_REFRESH_TOKEN;
  const GMB_ACCOUNT_ID    = process.env.GMB_ACCOUNT_ID;
  const GMB_LOCATION_ID   = process.env.GMB_LOCATION_ID;
  const GOOGLE_CLIENT_ID  = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

  if (GMB_REFRESH_TOKEN && GMB_ACCOUNT_ID && GMB_LOCATION_ID) {
    try {
      // Renovar access token
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

      // Buscar reviews
      const reviewRes = await fetch(
        `https://mybusinessaccountmanagement.googleapis.com/v1/accounts/${GMB_ACCOUNT_ID}/locations/${GMB_LOCATION_ID}/reviews?pageSize=50`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      const reviewData = await reviewRes.json();
      results.gmb_reviews = {
        reviews: (reviewData.reviews || []).map(r => ({
          author: r.reviewer?.displayName || 'Anônimo',
          rating: r.starRating,
          comment: r.comment || '',
          date: r.createTime,
        })),
        totalRating: reviewData.averageRating,
        totalCount: reviewData.totalReviewCount,
        checkedAt: new Date().toISOString(),
      };
    } catch (e) {
      results.gmb_reviews = { error: e.message, checkedAt: new Date().toISOString() };
    }
  } else {
    results.gmb_reviews = { pending_setup: true };
  }

  // ── 3. SALVAR NO SUPABASE ─────────────────────────────────────
  await Promise.all(Object.entries(results).map(([key, value]) =>
    fetch(`${SUPABASE_URL}/rest/v1/marketing_data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    })
  ));

  return res.status(200).json({ ok: true, results });
};
