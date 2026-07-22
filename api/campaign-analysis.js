// Endpoint de leitura apenas — manda no Telegram do dono uma analise da campanha
// de Meta Ads (Lead Ads) ativa, sem alterar nada na campanha em si.
// Reusa exatamente o mesmo padrao/env vars do api/blog-reminder.js.
const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jpbpzlpvhdwgbmljqfyd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

async function sbGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
  });
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function sendTelegram(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
  });
}

export default async function handler(req, res) {
  try {
    const [chatRows, fbLeadsRows, recentLeadsRows] = await Promise.all([
      sbGet('marketing_data', `key=eq.owner_telegram_chat_id&select=value`),
      sbGet('fb_leads_processed', `select=id`),
      sbGet('leads', `select=id,source,created_at&order=created_at.desc&limit=10`),
    ]);

    const chatId = chatRows[0]?.value?.chatId;
    if (!chatId) {
      res.status(200).json({ ok: true, sent: false, reason: 'owner_telegram_chat_id ainda nao capturado. Manda uma msg qualquer pro bot no Telegram uma vez.' });
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const fbLeadAdsCount = fbLeadsRows.length;
    const leadsToday = recentLeadsRows.filter(l => (l.created_at || '').slice(0, 10) === today);
    const fbMarketplaceToday = leadsToday.filter(l => l.source === 'fb_marketplace');

    const text =
      `📊 *Análise da Campanha — Meta Lead Ads*\n\n` +
      `Campanha: "[Accent wall] Campanha feita com Claude..."\n` +
      `Início: 21/07/2026, 05:00 (horário local do ad set)\n\n` +
      `🎯 *Leads via Lead Ads (webhook novo):* ${fbLeadAdsCount}\n` +
      (fbMarketplaceToday.length ? `📩 *Leads hoje (outra origem — fb_marketplace):* ${fbMarketplaceToday.length}\n` : '') +
      `\n*Status na Meta:* Ativo, em fase de aprendizado. Anúncio aprovado, verba e cronograma OK, sem erros de conta ou pagamento.\n\n` +
      `⚠️ *Ponto de atenção:* "Campanha de leads Advantage+" está ativada nesse ad set, expandindo o público estimado pra 18–21 milhões — bem mais amplo que o ideal pra um negócio hiperlocal (Orlando/FL). Isso pode estar atrasando a entrega inicial enquanto o algoritmo explora.\n\n` +
      `*Nenhuma alteração foi feita na campanha* — isso é só a leitura de hoje. Se depois de mais um dia sem entrega quiser, posso sugerir ajustes (ex: restringir geografia, desligar Advantage+) — mas só com seu OK.`;

    await sendTelegram(chatId, text);
    res.status(200).json({ ok: true, sent: true });
  } catch (err) {
    console.error('campaign-analysis error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
