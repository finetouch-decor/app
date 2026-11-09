// Sincronizacao Google -> ERP (FT-013): Google Ads (todas as contas acessiveis), GA4,
// Search Console e Perfil da Empresa (avaliacoes). SOMENTE LEITURA.
//
// - Uma unica conexao OAuth ("Conectar Google"), refresh token em api_secrets (so service_role).
// - Cada fonte grava uma linha em google_sync_runs com o erro REAL do Google (nunca engole erro).
// - Nunca gera numero simulado: sem dado = sem linha.
// - Mesmo arquivo de funcao do marketing-sync (limite de 12 funcoes do plano Hobby da Vercel):
//   rotas ?task=google-connect | google-status | google-sync[&source=ads|ga4|gsc|gbp|all].
'use strict';
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jpbpzlpvhdwgbmljqfyd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const ANON_KEY = 'sb_publishable_l6x3A2YiBL0Pc7huB-QejA_d2RXKL59';
const REDIRECT = 'https://app-one-amber-58.vercel.app/api/gmb-callback';
const SECRET_KEY_NAME = 'google_unified_refresh_token';
const ADS_API = 'v24';
const WINDOW_DAYS = 30; // reprocessa os ultimos 30 dias (conversoes chegam com atraso)
const SOURCES = ['ads', 'ga4', 'gsc', 'gbp'];
const LABELS = { ads: 'Google Ads', ga4: 'Google Analytics', gsc: 'Search Console', gbp: 'Perfil da Empresa (avaliacoes)' };
const SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/analytics.readonly',
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/userinfo.email',
];
const NEEDED_BY_SOURCE = {
  ads: 'https://www.googleapis.com/auth/adwords',
  ga4: 'https://www.googleapis.com/auth/analytics.readonly',
  gsc: 'https://www.googleapis.com/auth/webmasters.readonly',
  gbp: 'https://www.googleapis.com/auth/business.manage',
};

// ───────────────────────── Supabase (service role) ─────────────────────────
const enc = encodeURIComponent;
function sbHeaders(extra) {
  return Object.assign({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, extra || {});
}
async function sb(path, opts) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, Object.assign({}, opts, { headers: sbHeaders(opts && opts.headers) }));
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`supabase ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`.slice(0, 400));
  return body;
}
// Upsert em lotes; remove chaves duplicadas dentro do lote (Postgres recusa "afetar a mesma linha duas vezes").
async function upsert(table, rows, conflictCols) {
  if (!rows.length) return 0;
  const keyOf = r => conflictCols.map(c => String(r[c])).join('\u0001');
  const map = new Map();
  for (const r of rows) map.set(keyOf(r), r);
  const uniq = Array.from(map.values());
  for (let i = 0; i < uniq.length; i += 500) {
    await sb(`${table}?on_conflict=${conflictCols.join(',')}`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(uniq.slice(i, i + 500)) });
  }
  return uniq.length;
}

// ───────────────────────── Erros do Google (mensagem real) ─────────────────────────
class GoogleError extends Error {
  constructor(code, message, extra) { super(message); this.code = code; Object.assign(this, extra || {}); }
}
// Converte a resposta de erro de qualquer API Google em {code, message} legivel (sem segredos).
function parseGoogleError(status, body, where) {
  const e = (body && body.error) || {};
  const detail = Array.isArray(e.details) ? e.details : [];
  let adsCode = '';
  let adsMsg = '';
  for (const d of detail) {
    const first = d && Array.isArray(d.errors) ? d.errors[0] : null;
    if (first) {
      const ec = first.errorCode ? Object.values(first.errorCode)[0] : '';
      adsCode = adsCode || String(ec || '');
      adsMsg = adsMsg || String(first.message || '');
    }
    if (d && d.reason && !adsCode) adsCode = String(d.reason);
  }
  const code = (adsCode || (typeof e === 'string' ? e : e.status) || String(status)).toLowerCase();
  const msg = [typeof e === 'string' ? e : e.message, adsMsg && adsMsg !== e.message ? adsMsg : ''].filter(Boolean).join(' | ') || (body && body.error_description) || `HTTP ${status}`;
  return new GoogleError(code, `${where}: ${msg}`.slice(0, 500), { httpStatus: status });
}
async function gjson(res, where) {
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: { message: text.slice(0, 200) } }; }
  if (!res.ok) throw parseGoogleError(res.status, body, where);
  return body;
}
async function gfetch(url, opts, where, attempt = 0) {
  const res = await fetch(url, opts);
  if ((res.status === 429 || res.status >= 500) && attempt < 2) {
    await new Promise(r => setTimeout(r, 800 * 2 ** attempt));
    return gfetch(url, opts, where, attempt + 1);
  }
  return gjson(res, where);
}

// ───────────────────────── Token ─────────────────────────
async function getToken(source) {
  const r = await sb(`api_secrets?key_name=eq.${SECRET_KEY_NAME}&select=secret_value,meta&limit=1`);
  if (r && r[0]) return { token: r[0].secret_value, meta: r[0].meta || {}, legacy: false };
  if (source === 'gsc') { // compatibilidade: token antigo do Search Console enquanto o Google nao for reconectado
    const m = await sb('marketing_data?key=eq.gsc_refresh_token&select=value&limit=1').catch(() => null);
    const t = m && m[0] && m[0].value && m[0].value.token;
    if (t) return { token: t, meta: {}, legacy: true };
  }
  return null;
}
async function accessTokenFrom(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.access_token) {
    const code = j.error || `http_${res.status}`;
    const hint = code === 'invalid_grant' ? ' (autorizacao expirada ou revogada: clique em Reconectar Google)' : code === 'invalid_client' ? ' (GOOGLE_CLIENT_ID/SECRET nao conferem com o cliente que gerou o token)' : '';
    throw new GoogleError(code, `oauth: ${code}${j.error_description ? ' - ' + j.error_description : ''}${hint}`.slice(0, 500));
  }
  return j.access_token;
}

// Primeira execucao de uma fonte (tabela vazia): puxa historico maior (sazonalidade); depois so reprocessa 30 dias.
async function windowFor(table, firstDays) {
  const r = await sb(`${table}?select=date&limit=1`).catch(() => null);
  return r && r.length ? WINDOW_DAYS : firstDays;
}

// ───────────────────────── Datas ─────────────────────────
const ymd = d => d.toISOString().slice(0, 10);
function windowDates(days = WINDOW_DAYS, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - days * 86400000);
  return { start: ymd(start), end: ymd(end) };
}

// ───────────────────────── Google Ads ─────────────────────────
function adsHeaders(at, loginId) {
  const h = { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' };
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) h['developer-token'] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (loginId) h['login-customer-id'] = String(loginId).replace(/-/g, '');
  return h;
}
async function adsSearch(at, customerId, loginId, query) {
  const out = [];
  let pageToken;
  for (let i = 0; i < 30; i++) {
    const j = await gfetch(`https://googleads.googleapis.com/${ADS_API}/customers/${customerId}/googleAds:search`, {
      method: 'POST', headers: adsHeaders(at, loginId), body: JSON.stringify(pageToken ? { query, pageToken } : { query }),
    }, `ads ${customerId}`);
    out.push(...(j.results || []));
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}
// Descobre TODAS as contas acessiveis (inclui contas filhas de administradoras).
async function adsDiscover(at) {
  const lr = await gfetch(`https://googleads.googleapis.com/${ADS_API}/customers:listAccessibleCustomers`, { headers: adsHeaders(at) }, 'ads listAccessibleCustomers');
  const ids = (lr.resourceNames || []).map(n => n.split('/')[1]).filter(Boolean);
  const accounts = new Map();
  const warnings = [];
  for (const id of ids) {
    let info;
    try {
      const r = await adsSearch(at, id, id, 'SELECT customer.id, customer.descriptive_name, customer.manager, customer.currency_code, customer.time_zone, customer.status FROM customer');
      info = r[0] && r[0].customer;
    } catch (e) {
      if (/not_enabled|customer_not_enabled|not_ads_user/i.test(e.code + ' ' + e.message)) continue; // conta ainda em configuracao/inativa
      warnings.push(`${id}: ${e.message}`);
      continue;
    }
    if (!info) continue;
    const base = { descriptive_name: info.descriptiveName || null, currency_code: info.currencyCode || null, time_zone: info.timeZone || null, status: info.status || null };
    accounts.set(String(info.id), Object.assign({ customer_id: String(info.id), is_manager: !!info.manager, manager_customer_id: null, login: String(id) }, base));
    if (info.manager) {
      try {
        const kids = await adsSearch(at, id, id, 'SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.currency_code, customer_client.time_zone, customer_client.status, customer_client.level FROM customer_client WHERE customer_client.level > 0');
        for (const k of kids) {
          const c = k.customerClient;
          if (!c || accounts.has(String(c.id)) && accounts.get(String(c.id)).login === String(c.id)) continue;
          accounts.set(String(c.id), { customer_id: String(c.id), descriptive_name: c.descriptiveName || null, is_manager: !!c.manager, manager_customer_id: String(id), currency_code: c.currencyCode || null, time_zone: c.timeZone || null, status: c.status || null, login: String(id) });
        }
      } catch (e) { warnings.push(`${id} (filhas): ${e.message}`); }
    }
  }
  return { accounts: Array.from(accounts.values()), warnings };
}
function mapAdsRow(r, acct) {
  const c = r.campaign || {}; const m = r.metrics || {}; const s = r.segments || {};
  return {
    customer_id: acct.customer_id, campaign_id: String(c.id), date: s.date,
    campaign_name: c.name || null, campaign_status: c.status || null, channel_type: c.advertisingChannelType || null,
    impressions: Number(m.impressions || 0), clicks: Number(m.clicks || 0), cost_micros: Number(m.costMicros || 0),
    conversions: Number(m.conversions || 0), conversions_value: Number(m.conversionsValue || 0),
    currency_code: acct.currency_code, synced_at: new Date().toISOString(),
  };
}
async function syncAds(at) {
  const { accounts, warnings } = await adsDiscover(at);
  if (!accounts.length && !warnings.length) throw new GoogleError('no_accounts', 'ads: nenhuma conta do Google Ads acessivel por esta conta Google');
  const now = new Date().toISOString();
  await upsert('google_ads_accounts', accounts.map(a => ({ customer_id: a.customer_id, descriptive_name: a.descriptive_name, is_manager: a.is_manager, manager_customer_id: a.manager_customer_id, currency_code: a.currency_code, time_zone: a.time_zone, status: a.status, last_seen_at: now })), ['customer_id']);
  const { start, end } = windowDates(await windowFor('google_ads_campaign_daily', 365));
  let rows = 0;
  const failures = warnings.slice();
  for (const a of accounts.filter(x => !x.is_manager && String(x.status || 'ENABLED') === 'ENABLED')) {
    try {
      const res = await adsSearch(at, a.customer_id, a.login, `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${start}' AND '${end}'`);
      rows += await upsert('google_ads_campaign_daily', res.map(r => mapAdsRow(r, a)), ['customer_id', 'campaign_id', 'date']);
    } catch (e) { failures.push(`${a.customer_id}: ${e.message}`); }
  }
  if (failures.length) throw new GoogleError('partial_failure', `ads: ${failures.length} conta(s) com erro: ${failures.join(' || ')}`.slice(0, 500), { rows });
  return { rows, detail: `${accounts.length} conta(s)` };
}

// ───────────────────────── GA4 ─────────────────────────
function parseGa4Rows(propertyId, report) {
  const out = [];
  for (const r of (report && report.rows) || []) {
    const d = r.dimensionValues.map(x => x.value);
    const m = r.metricValues.map(x => Number(x.value || 0));
    const raw = d[0];
    out.push({
      property_id: String(propertyId), date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
      source: d[1] || '(direct)', medium: d[2] || '(none)', campaign: d[3] || '(not set)',
      sessions: m[0] || 0, total_users: m[1] || 0, new_users: m[2] || 0, engaged_sessions: m[3] || 0, key_events: m[4] || 0,
      synced_at: new Date().toISOString(),
    });
  }
  return out;
}
function parseGa4Landing(propertyId, report) {
  const acc = new Map();
  for (const r of (report && report.rows) || []) {
    const d = r.dimensionValues.map(x => x.value);
    const m = r.metricValues.map(x => Number(x.value || 0));
    const raw = d[0];
    const row = {
      property_id: String(propertyId), date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
      channel_group: d[1] || 'Unassigned', source: d[2] || '(direct)', medium: d[3] || '(none)', landing_page: (d[4] || '(not set)').slice(0, 300),
      sessions: m[0] || 0, total_users: m[1] || 0, engaged_sessions: m[2] || 0, key_events: m[3] || 0, synced_at: new Date().toISOString(),
    };
    const k = [row.date, row.channel_group, row.source, row.medium, row.landing_page].join('|');
    const o = acc.get(k);
    if (o) { o.sessions += row.sessions; o.total_users += row.total_users; o.engaged_sessions += row.engaged_sessions; o.key_events += row.key_events; } else acc.set(k, row);
  }
  return [...acc.values()];
}
function parseGa4Events(propertyId, report) {
  const out = [];
  for (const r of (report && report.rows) || []) {
    const d = r.dimensionValues.map(x => x.value);
    const m = r.metricValues.map(x => Number(x.value || 0));
    const raw = d[0];
    out.push({ property_id: String(propertyId), date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`, channel_group: d[1] || 'Unassigned', event_name: d[2] || '(not set)', event_count: m[0] || 0, key_events: m[1] || 0, synced_at: new Date().toISOString() });
  }
  return out;
}
async function syncGa4(at) {
  const auth = { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' };
  const sums = await gfetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200', { headers: auth }, 'ga4 accountSummaries');
  const props = [];
  for (const a of sums.accountSummaries || []) for (const p of a.propertySummaries || []) props.push({ id: String(p.property).split('/')[1], name: p.displayName });
  if (!props.length) throw new GoogleError('no_properties', 'ga4: nenhuma propriedade do Google Analytics 4 acessivel por esta conta Google');
  const gaDays = await windowFor('ga4_daily', 180);
  let rows = 0;
  for (const p of props) {
    const rep = await gfetch(`https://analyticsdata.googleapis.com/v1beta/properties/${p.id}:runReport`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        dateRanges: [{ startDate: `${gaDays}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'date' }, { name: 'sessionSource' }, { name: 'sessionMedium' }, { name: 'sessionCampaignName' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'newUsers' }, { name: 'engagedSessions' }, { name: 'keyEvents' }],
        limit: 100000,
      }),
    }, `ga4 runReport ${p.id}`);
    rows += await upsert('ga4_daily', parseGa4Rows(p.id, rep), ['property_id', 'date', 'source', 'medium', 'campaign']);
    // Canal + pagina de entrada: separa organico, blog, anuncios, direto e redes sociais.
    const land = await gfetch(`https://analyticsdata.googleapis.com/v1beta/properties/${p.id}:runReport`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        dateRanges: [{ startDate: `${gaDays}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }, { name: 'sessionSource' }, { name: 'sessionMedium' }, { name: 'landingPage' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagedSessions' }, { name: 'keyEvents' }],
        limit: 100000,
      }),
    }, `ga4 landing ${p.id}`);
    rows += await upsert('ga4_landing_daily', parseGa4Landing(p.id, land), ['property_id', 'date', 'channel_group', 'source', 'medium', 'landing_page']);
    // Eventos por nome e canal (cliques em telefone/WhatsApp, formularios etc.).
    const ev = await gfetch(`https://analyticsdata.googleapis.com/v1beta/properties/${p.id}:runReport`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        dateRanges: [{ startDate: `${gaDays}daysAgo`, endDate: 'today' }],
        dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }, { name: 'eventName' }],
        metrics: [{ name: 'eventCount' }, { name: 'keyEvents' }],
        limit: 100000,
      }),
    }, `ga4 events ${p.id}`);
    rows += await upsert('ga4_events_daily', parseGa4Events(p.id, ev), ['property_id', 'date', 'channel_group', 'event_name']);
  }
  return { rows, detail: `${props.length} propriedade(s)` };
}

// ───────────────────────── Search Console ─────────────────────────
async function syncGsc(at) {
  const auth = { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' };
  const sites = await gfetch('https://www.googleapis.com/webmasters/v3/sites', { headers: auth }, 'gsc sites');
  const list = (sites.siteEntry || []).filter(s => s.permissionLevel !== 'siteUnverifiedUser');
  if (!list.length) throw new GoogleError('no_sites', 'gsc: nenhuma propriedade verificada do Search Console acessivel por esta conta Google');
  const { start, end } = windowDates(await windowFor('gsc_query_daily', 180));
  let rows = 0;
  for (const s of list) {
    for (let startRow = 0, page = 0; page < 8; page++, startRow += 25000) {
      const j = await gfetch(`https://www.googleapis.com/webmasters/v3/sites/${enc(s.siteUrl)}/searchAnalytics/query`, {
        method: 'POST', headers: auth,
        body: JSON.stringify({ startDate: start, endDate: end, dimensions: ['date', 'query', 'page'], rowLimit: 25000, startRow }),
      }, `gsc query ${s.siteUrl}`);
      const got = j.rows || [];
      rows += await upsert('gsc_query_daily', got.map(r => ({ site_url: s.siteUrl, date: r.keys[0], query: r.keys[1], page: r.keys[2], clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr == null ? null : r.ctr, position: r.position == null ? null : r.position, synced_at: new Date().toISOString() })), ['site_url', 'date', 'query', 'page']);
      if (got.length < 25000) break;
    }
    // Totais diarios reais (incluem consultas anonimas, que o Google omite nos dados por consulta).
    const d = await gfetch(`https://www.googleapis.com/webmasters/v3/sites/${enc(s.siteUrl)}/searchAnalytics/query`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ startDate: start, endDate: end, dimensions: ['date'], rowLimit: 25000 }),
    }, `gsc daily ${s.siteUrl}`);
    rows += await upsert('gsc_daily', (d.rows || []).map(r => ({ site_url: s.siteUrl, date: r.keys[0], clicks: r.clicks || 0, impressions: r.impressions || 0, ctr: r.ctr == null ? null : r.ctr, position: r.position == null ? null : r.position, synced_at: new Date().toISOString() })), ['site_url', 'date']);
  }
  return { rows, detail: `${list.length} propriedade(s)` };
}

// ───────────────────────── Perfil da Empresa (avaliacoes) ─────────────────────────
const STARS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
function mapReview(locationName, r) {
  return {
    review_id: String(r.reviewId || String(r.name || '').split('/').pop()), location_id: locationName,
    reviewer_name: (r.reviewer && r.reviewer.displayName) || null, rating: STARS[r.starRating] || null, comment: r.comment || null,
    created_at_google: r.createTime || null, updated_at_google: r.updateTime || null,
    reply_comment: (r.reviewReply && r.reviewReply.comment) || null, reply_updated_at: (r.reviewReply && r.reviewReply.updateTime) || null,
    synced_at: new Date().toISOString(),
  };
}
async function syncGbp(at) {
  const auth = { Authorization: `Bearer ${at}` };
  const accts = await gfetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: auth }, 'gbp accounts');
  const list = accts.accounts || [];
  if (!list.length) throw new GoogleError('no_accounts', 'gbp: nenhuma conta do Perfil da Empresa acessivel por esta conta Google');
  let rows = 0; let locs = 0;
  for (const a of list) {
    const l = await gfetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title&pageSize=100`, { headers: auth }, `gbp locations ${a.name}`);
    for (const loc of l.locations || []) {
      locs++;
      let pageToken = '';
      for (let i = 0; i < 20; i++) {
        const rv = await gfetch(`https://mybusiness.googleapis.com/v4/${a.name}/${loc.name}/reviews?pageSize=50${pageToken ? '&pageToken=' + enc(pageToken) : ''}`, { headers: auth }, `gbp reviews ${loc.name}`);
        rows += await upsert('gbp_reviews', (rv.reviews || []).map(r => mapReview(loc.name, r)), ['review_id']);
        pageToken = rv.nextPageToken || '';
        if (!pageToken) break;
      }
    }
  }
  if (!locs) throw new GoogleError('no_locations', 'gbp: conta encontrada, mas sem locais (perfis) acessiveis');
  return { rows, detail: `${locs} local(is)` };
}

const SYNCERS = { ads: syncAds, ga4: syncGa4, gsc: syncGsc, gbp: syncGbp };

// ───────────────────────── Execucao, log e alerta ─────────────────────────
async function sendTelegram(text) {
  const bot = process.env.TELEGRAM_BOT_TOKEN;
  if (!bot) return;
  try {
    await fetch(`https://api.telegram.org/bot${bot}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID || '7758479066', text }) });
  } catch { /* alerta e best-effort */ }
}
async function lastRun(source) {
  const r = await sb(`google_sync_runs?source=eq.${source}&order=started_at.desc&limit=1&select=ok,started_at,finished_at,error_code`);
  return r && r[0] ? r[0] : null;
}
async function runSource(source) {
  const prev = await lastRun(source).catch(() => null);
  const started = new Date().toISOString();
  const ins = await sb('google_sync_runs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ source, started_at: started }) });
  const id = ins && ins[0] && ins[0].id;
  const finish = patch => id ? sb(`google_sync_runs?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(Object.assign({ finished_at: new Date().toISOString() }, patch)) }).catch(() => {}) : null;
  try {
    const tok = await getToken(source);
    if (!tok) throw new GoogleError('not_connected', 'Google ainda nao conectado: abra Usuarios > Integracoes e clique em Conectar Google.');
    const missing = tok.meta && Array.isArray(tok.meta.missing_scopes) && tok.meta.missing_scopes.includes(NEEDED_BY_SOURCE[source]);
    if (missing) throw new GoogleError('missing_scope', `Permissao do Google nao concedida para ${LABELS[source]}. Reconecte e marque todas as caixas.`);
    const at = await accessTokenFrom(tok.token);
    const r = await SYNCERS[source](at);
    await finish({ ok: true, rows_written: r.rows || 0, error_code: null, error_message: null });
    return { source, ok: true, rows: r.rows || 0, detail: r.detail };
  } catch (e) {
    const code = e.code || 'error';
    const message = String(e.message || e).slice(0, 500);
    await finish({ ok: false, rows_written: e.rows || 0, error_code: code, error_message: message });
    // Alerta so na transicao ok->erro (ou a cada 24 h de erro continuo); "nao conectado" aparece so na faixa do ERP.
    const prevAt = prev && new Date(prev.finished_at || prev.started_at).getTime();
    const shouldAlert = code !== 'not_connected' && (!prev || prev.ok || Date.now() - prevAt > 24 * 3600000);
    if (shouldAlert) await sendTelegram(`⚠️ ERP x Google: falha ao sincronizar ${LABELS[source]}\n${code}: ${message}\n\nAbra o ERP > Usuarios > Integracoes e clique em "Reconectar Google" (ou veja o erro na aba Marketing).`);
    return { source, ok: false, error_code: code, error: message };
  }
}
async function runSync(which) {
  const list = which === 'all' || !which ? SOURCES : [which];
  const results = [];
  for (const s of list) results.push(await runSource(s));
  return { ok: results.every(r => r.ok), results };
}

// ───────────────────────── OAuth (estado assinado) ─────────────────────────
function stateSecret() { return crypto.createHash('sha256').update('google-unified-oauth|' + (SERVICE_KEY || '')).digest(); }
function signState() {
  const body = `google.${Date.now()}.${crypto.randomBytes(8).toString('hex')}`;
  return `${body}.${crypto.createHmac('sha256', stateSecret()).update(body).digest('hex').slice(0, 32)}`;
}
function verifyState(state) {
  const parts = String(state || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'google') return false;
  const body = parts.slice(0, 3).join('.');
  const want = crypto.createHmac('sha256', stateSecret()).update(body).digest('hex').slice(0, 32);
  const a = Buffer.from(parts[3]), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b) && Date.now() - Number(parts[1]) < 15 * 60000;
}
function connectUrl() {
  const p = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state: signState() });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, body) => `<html><body style="font-family:sans-serif;padding:40px;max-width:640px"><h2>${esc(title)}</h2><p>${esc(body)}</p><p><a href="/users">Voltar ao ERP</a></p></body></html>`;

async function oauthCallback(req, res) {
  const { code, error, state } = req.query;
  if (!verifyState(state)) return res.status(400).send(page('Link invalido ou expirado', 'Volte ao ERP (Usuarios > Integracoes) e clique em Conectar Google novamente.'));
  if (error) return res.status(400).send(page('Autorizacao negada', String(error)));
  if (!code) return res.status(400).send(page('Sem codigo', 'O Google nao devolveu o codigo de autorizacao.'));
  const tr = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
  });
  const tokens = await tr.json().catch(() => ({}));
  if (!tokens.refresh_token) return res.status(400).send(page('Nao foi possivel conectar', `O Google nao devolveu o token de renovacao (${tokens.error || 'sem detalhe'}). Remova o acesso do app em myaccount.google.com/permissions e tente de novo.`));
  const granted = String(tokens.scope || '').split(' ');
  const missing = Object.values(NEEDED_BY_SOURCE).filter(s => !granted.includes(s));
  let email = null;
  try {
    const u = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    email = (await u.json()).email || null;
  } catch { /* opcional */ }
  await sb('api_secrets?on_conflict=key_name', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ provider: 'google', key_name: SECRET_KEY_NAME, secret_value: tokens.refresh_token, meta: { email, scope: tokens.scope, missing_scopes: missing, connected_at: new Date().toISOString() }, updated_at: new Date().toISOString() }) });
  if (missing.length) return res.status(200).send(page('Google conectado, mas faltam permissoes', `Conta ${email || ''} conectada, porem voce nao marcou todas as caixas. Faltam: ${missing.map(m => m.split('/').pop()).join(', ')}. Clique em Conectar Google de novo e marque todas.`));
  return res.redirect(302, '/users?google=connected');
}

// ───────────────────────── Autorizacao e rotas ─────────────────────────
async function profileOf(authorization) {
  if (!String(authorization).startsWith('Bearer ')) return null;
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: authorization } });
  if (!u.ok) return null;
  const user = await u.json();
  const p = await sb(`user_profiles?id=eq.${user.id}&select=role,status&limit=1`);
  return p && p[0] ? p[0] : null;
}
const isAdmin = p => p && p.status === 'approved' && ['admin', 'owner', 'superadmin'].includes(p.role);
const isApproved = p => p && (p.status === 'approved' || p.role === 'admin');
function isCron(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization === `Bearer ${secret}`) return true;
  return /vercel-cron/i.test(req.headers['user-agent'] || ''); // spoofavel, mas a rotina e idempotente e somente leitura
}
async function status() {
  const tok = await getToken('ads');
  const runs = await sb('google_sync_runs?order=started_at.desc&limit=80&select=source,ok,started_at,finished_at,rows_written,error_code,error_message').catch(() => []);
  const bySource = {};
  for (const s of SOURCES) {
    const mine = runs.filter(r => r.source === s);
    bySource[s] = { label: LABELS[s], last_run: mine[0] || null, last_success: mine.find(r => r.ok) || null };
  }
  return { ok: true, connected: !!tok, email: tok && tok.meta ? tok.meta.email || null : null, connected_at: tok && tok.meta ? tok.meta.connected_at || null : null, missing_scopes: tok && tok.meta ? tok.meta.missing_scopes || [] : [], oauth_client_configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), developer_token_configured: !!process.env.GOOGLE_ADS_DEVELOPER_TOKEN, sources: bySource };
}

// task: google-connect | google-status | google-sync
async function handleTask(req, res) {
  const task = req.query.task;
  try {
    const authz = req.headers.authorization || '';
    if (task === 'google-sync') {
      const source = String(req.query.source || 'all');
      if (source !== 'all' && !SOURCES.includes(source)) return res.status(400).json({ ok: false, error: 'source invalida' });
      if (!isCron(req)) {
        const p = await profileOf(authz);
        if (!isApproved(p)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      }
      return res.status(200).json(await runSync(source));
    }
    const p = await profileOf(authz);
    if (task === 'google-status') {
      if (!isApproved(p)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      return res.status(200).json(await status());
    }
    if (!isAdmin(p)) return res.status(p ? 403 : 401).json({ ok: false, error: p ? 'Forbidden' : 'Unauthorized' });
    if (task === 'google-connect') {
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return res.status(500).json({ ok: false, error: 'GOOGLE_CLIENT_ID/SECRET ausentes no ambiente' });
      return res.status(200).json({ ok: true, url: connectUrl() });
    }
    return res.status(400).json({ ok: false, error: 'task desconhecida' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message).slice(0, 300) });
  }
}

module.exports = { handleTask, oauthCallback, verifyState, signState, connectUrl, runSync, runSource, parseGoogleError, parseGa4Rows, parseGa4Landing, parseGa4Events, mapAdsRow, mapReview, windowDates, SOURCES, SCOPES };
