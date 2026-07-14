// Endpoint chamado pelo n8n (Schedule Trigger + HTTP Request) pra lembrar o
// dono de publicar o proximo post de blog pendente. Nao precisa de credenciais
// no n8n: so uma URL. Toda a logica (achar o proximo post, montar o texto
// pronto pra copiar, mandar no Telegram) roda aqui, usando as mesmas env vars
// que o bot do Telegram ja usa.
const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL  = process.env.SUPABASE_URL || 'https://jpbpzlpvhdwgbmljqfyd.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

// Mesma ordem usada em marketing.html (BLOG_DRAFT_ORDER)
const BLOG_DRAFT_ORDER = ['blog-post2','blog-post3','blog-post4','blog-post5','blog-post6','blog-post7','blog-post8'];

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
    const [draftRows, taskRows, chatRows] = await Promise.all([
      sbGet('marketing_data', `key=eq.blog_drafts&select=value`),
      sbGet('marketing_tasks', `id=like.blog-post*&select=id,done`),
      sbGet('marketing_data', `key=eq.owner_telegram_chat_id&select=value`),
    ]);

    const drafts  = draftRows[0]?.value || {};
    const doneMap = {};
    taskRows.forEach(t => doneMap[t.id] = t.done);
    const chatId = chatRows[0]?.value?.chatId;

    const nextId = BLOG_DRAFT_ORDER.find(id => drafts[id] && !doneMap[id]);

    if (!nextId) {
      res.status(200).json({ ok: true, sent: false, reason: 'Todos os posts do blog ja estao marcados como publicados.' });
      return;
    }

    if (!chatId) {
      res.status(200).json({ ok: true, sent: false, reason: 'owner_telegram_chat_id ainda nao capturado. Mande uma mensagem qualquer pro bot no Telegram uma vez pra ativar isso.' });
      return;
    }

    const d = drafts[nextId];
    const img = d.featuredImage || null;
    const imgLine = img ? `\nImagem destacada: ${img.url}\nTexto alternativo (alt): ${img.alt}\n` : '';
    const fullText = `📝 *Hora de publicar o próximo post do blog!*\n\n` +
      `${d.h1}\n\n` +
      `Título (SEO): ${d.metaTitle}\n` +
      `Meta description: ${d.metaDescription}\n` +
      `URL sugerida: /blog/${d.slug}\n` +
      `${imgLine}\n` +
      `${d.body}\n\n` +
      `_Depois de publicar em ftdecordesign.com/blog, marca esse post como concluído na aba Marketing > Blog do ERP._`;

    await sendTelegram(chatId, fullText);
    res.status(200).json({ ok: true, sent: true, postId: nextId });
  } catch (err) {
    console.error('blog-reminder error', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
}
