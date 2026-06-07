const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

// ─── TELEGRAM ────────────────────────────────────────────────
async function send(chatId, text, opts = {}) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...opts })
  });
}

// ─── SUPABASE ────────────────────────────────────────────────
async function sbGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }
  });
  return res.json();
}

async function sbInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(data)
  });
  return res.json();
}

// ─── HANDLERS ────────────────────────────────────────────────
async function handleStatus(chatId) {
  const today = new Date().toISOString().slice(0, 10);

  const [tasks, leads, followups] = await Promise.all([
    sbGet('tasks', 'status=neq.done&select=id'),
    sbGet('leads', `status=neq.fechado&status=neq.perdido&select=id`),
    sbGet('leads', `follow_up_date=lte.${today}&status=neq.fechado&status=neq.perdido&select=id`)
  ]);

  await send(chatId,
    `📊 *Status Fine Touch*\n\n` +
    `✅ Tarefas abertas: *${tasks.length}*\n` +
    `🎯 Leads ativos: *${leads.length}*\n` +
    `⚠️ Follow-ups atrasados: *${followups.length}*\n\n` +
    `🔗 [Abrir sistema](https://app-one-amber-58.vercel.app/dashboard)`
  );
}

async function handleTask(chatId, text) {
  // "tarefa: ligar para cliente X" ou "task: ..."
  const title = text.replace(/^(tarefa|task)[:\s]+/i, '').trim();
  if (!title) { await send(chatId, '❌ Formato: `tarefa: descrição da tarefa`'); return; }

  await sbInsert('tasks', { title, status: 'todo', priority: 'medium', source: 'telegram' });
  await send(chatId, `✅ Tarefa criada!\n*${title}*\n\n🔗 [Ver tarefas](https://app-one-amber-58.vercel.app/tasks)`);
}

async function handleLead(chatId, text) {
  // "lead: Nome Cliente, +1 305 000-0000, Miami FL"
  const body = text.replace(/^lead[:\s]+/i, '').trim();
  const parts = body.split(',').map(s => s.trim());
  const name  = parts[0];
  const phone = parts[1] || '';
  const city  = parts[2] || '';

  if (!name) { await send(chatId, '❌ Formato: `lead: Nome, Telefone, Cidade`'); return; }

  const [client] = await sbInsert('clients', { name, phone, city, type: 'person', source: 'telegram' });
  if (client?.id) {
    await sbInsert('leads', { client_id: client.id, status: 'lead', source: 'telegram', first_contact_date: new Date().toISOString().slice(0,10) });
  }
  await send(chatId, `✅ Lead criado!\n*${name}* ${phone ? '· '+phone : ''} ${city ? '· '+city : ''}\n\n🔗 [Ver CRM](https://app-one-amber-58.vercel.app/app)`);
}

async function handleCusto(chatId, text) {
  // "custo: Reforma Johnson, tinta sherwin williams, 320"
  const body  = text.replace(/^(custo|compra)[:\s]+/i, '').trim();
  const parts = body.split(',').map(s => s.trim());
  const projName = parts[0];
  const desc     = parts[1];
  const amount   = parseFloat(parts[2]);

  if (!projName || !desc || isNaN(amount)) {
    await send(chatId, '❌ Formato: `custo: Nome da Obra, Descrição, Valor`\nEx: `custo: Reforma Johnson, Tinta Sherwin, 320`');
    return;
  }

  // Find project by name (partial match)
  const projects = await sbGet('projects', `name=ilike.*${encodeURIComponent(projName)}*&select=id,name&limit=1`);
  if (!projects.length) {
    await send(chatId, `❌ Obra não encontrada: *${projName}*\nVerifique o nome exato da obra.`);
    return;
  }

  const project = projects[0];
  await sbInsert('transactions', {
    type: 'expense',
    description: desc,
    amount,
    date: new Date().toISOString().slice(0, 10),
    category: 'material',
    project_id: project.id,
    source: 'telegram'
  });

  await send(chatId, `✅ Custo registrado!\n🏗️ *${project.name}*\n📝 ${desc}\n💵 $${amount.toLocaleString('en-US', {minimumFractionDigits: 2})}\n\n🔗 [Ver financeiro](https://app-one-amber-58.vercel.app/financial)`);
}

async function handleHelp(chatId) {
  await send(chatId,
    `🤖 *Fine Touch ERP Bot*\n\n` +
    `Comandos disponíveis:\n\n` +
    `📊 *status* — resumo do sistema\n\n` +
    `✅ *tarefa: descrição*\n` +
    `→ Cria uma tarefa\n` +
    `Ex: \`tarefa: ligar para cliente Johnson\`\n\n` +
    `🎯 *lead: nome, telefone, cidade*\n` +
    `→ Cadastra um novo lead\n` +
    `Ex: \`lead: Sarah Smith, +1 305 111-2222, Miami FL\`\n\n` +
    `💸 *custo: obra, descrição, valor*\n` +
    `→ Lança um custo em uma obra\n` +
    `Ex: \`custo: Reforma Johnson, Tinta Sherwin, 320\`\n\n` +
    `🔗 [Abrir sistema](https://app-one-amber-58.vercel.app/dashboard)`
  );
}

// ─── MAIN HANDLER ────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(200).json({ ok: true }); return; }

  try {
    const body    = req.body;
    const message = body.message || body.edited_message;
    if (!message) { res.status(200).json({ ok: true }); return; }

    const chatId = message.chat.id;
    const text   = (message.text || '').trim();

    // Photo — acknowledge
    if (message.photo) {
      await send(chatId, '📸 Foto recebida! Em breve vou processar notas fiscais automaticamente.\n\nPor enquanto, use:\n`custo: nome da obra, descrição, valor`');
      res.status(200).json({ ok: true });
      return;
    }

    const lower = text.toLowerCase();

    if (lower === '/start' || lower === 'ajuda' || lower === 'help' || lower === '/help') {
      await handleHelp(chatId);
    } else if (lower === 'status' || lower === '/status') {
      await handleStatus(chatId);
    } else if (/^(tarefa|task)[:\s]/i.test(text)) {
      await handleTask(chatId, text);
    } else if (/^lead[:\s]/i.test(text)) {
      await handleLead(chatId, text);
    } else if (/^(custo|compra)[:\s]/i.test(text)) {
      await handleCusto(chatId, text);
    } else {
      await send(chatId, `Não entendi 🤔\n\nDigite *ajuda* para ver os comandos disponíveis.`);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(200).json({ ok: true }); // always 200 for Telegram
  }
}
