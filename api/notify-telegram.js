const SUPABASE_URL = 'https://jpbpzlpvhdwgbmljqfyd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_l6x3A2YiBL0Pc7huB-QejA_d2RXKL59';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || '7758479066';
  const authorization = req.headers.authorization || '';

  if (!token) return res.status(500).json({ error: 'Notification service unavailable' });
  if (!authorization.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: authorization }
    });
    if (!userResponse.ok) return res.status(401).json({ error: 'Unauthorized' });

    const user = await userResponse.json();
    const createdAt = Date.parse(user.created_at || '');
    if (!createdAt || Date.now() - createdAt > 10 * 60 * 1000) {
      return res.status(403).json({ error: 'Notification window expired' });
    }

    const name = user.user_metadata?.full_name || 'Não informado';
    const email = user.email || 'Não informado';
    const message = `🔔 *Novo usuário solicitando acesso ao Fine Touch ERP*\n\n👤 *Nome:* ${name}\n📧 *Email:* ${email}\n\n➡️ Acesse /users para aprovar ou rejeitar.`;

    const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' })
    });

    if (!telegramResponse.ok) return res.status(502).json({ error: 'Notification failed' });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Notification failed' });
  }
}
