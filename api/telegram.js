const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jpbpzlpvhdwgbmljqfyd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const SUPABASE_ANON_KEY = 'sb_publishable_l6x3A2YiBL0Pc7huB-QejA_d2RXKL59';
const OPENAI_KEY   = process.env.OPENAI_API_KEY;

// ─── TELEGRAM ────────────────────────────────────────────────
async function send(chatId, text, opts = {}) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...opts })
  });
}

async function getFileUrl(fileId) {
  const res  = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
  const data = await res.json();
  return `https://api.telegram.org/file/bot${BOT_TOKEN}/${data.result.file_path}`;
}

// ─── SUPABASE ────────────────────────────────────────────────
async function sbGet(table, query = '', useAnon = false) {
  const key = useAnon ? SUPABASE_ANON_KEY : SUPABASE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }
  });
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function sbInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(data)
  });
  return res.json();
}

// ─── OPENAI VISION — extrai itens da nota fiscal ─────────────
async function extractReceiptItems(imageUrl) {
  // Baixa imagem e converte para base64 (URL do Telegram requer autenticação)
  const imgRes    = await fetch(imageUrl);
  const imgBuffer = await imgRes.arrayBuffer();
  const base64    = Buffer.from(imgBuffer).toString('base64');
  const mimeType  = 'image/jpeg';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: 'text', text: `Analise esta nota fiscal/recibo e extraia cada item de linha com sua descrição e valor.
Ignore QR codes, barcodes e cabeçalhos. Foque apenas no texto impresso com descrições de produtos e valores.
Retorne SOMENTE um JSON válido neste formato (sem markdown):
{"store":"nome da loja","total":99.99,"items":[{"desc":"descrição do produto","value":9.99},{"desc":"outro produto","value":5.00}]}
Se a nota tiver itens com quantidade x preço unitário, calcule o valor total de cada linha.
Se não conseguir identificar itens individuais, retorne o total como um único item com desc "Compra geral".` }
        ]
      }],
      max_tokens: 500
    })
  });
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (data.error) return { _raw: `ERRO OpenAI: ${data.error.message}`, _error: 'api error' };
  try {
    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
    // Remove itens duplicados (mesma desc + value)
    const seen = new Set();
    parsed.items = (parsed.items || []).filter(it => {
      const key = `${it.desc}|${it.value}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    return parsed;
  }
  catch { return { _raw: `Parse falhou. Resposta: ${content.slice(0, 400)}`, _error: 'parse failed' }; }
}

// ─── OPENAI WHISPER — transcreve áudio ───────────────────────
async function transcribeAudio(audioUrl) {
  const audioRes  = await fetch(audioUrl);
  const audioBlob = await audioRes.arrayBuffer();

  const form = new FormData();
  form.append('file', new Blob([audioBlob], { type: 'audio/ogg' }), 'audio.ogg');
  form.append('model', 'whisper-1');
  form.append('language', 'pt');

  const res  = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form
  });
  const data = await res.json();
  return data.text || '';
}

// ─── SESSÃO TEMPORÁRIA (Supabase marketing_data como KV) ─────
async function saveSession(chatId, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/marketing_data`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key: `tg_session_${chatId}`, value: data, updated_at: new Date().toISOString() })
  });
}

async function getSession(chatId) {
  const rows = await sbGet('marketing_data', `key=eq.tg_session_${chatId}&select=value,updated_at`);
  if (!rows.length) return null;
  const age = Date.now() - new Date(rows[0].updated_at).getTime();
  if (age > 10 * 60 * 1000) return null; // expira em 10 min
  return rows[0].value;
}

async function clearSession(chatId) {
  await fetch(`${SUPABASE_URL}/rest/v1/marketing_data?key=eq.tg_session_${chatId}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
}

// ─── GPT INTERPRETA RESPOSTA DO USUÁRIO ──────────────────────
async function parseItemResponseWithGPT(text, items, projects) {
  const itemList = items.map((it, i) => `${i+1}. ${it.desc} ($${it.value})`).join('\n');
  const projList = projects.map(p => `${p.letter}. "${p.name}"${p.client_name ? ' (cliente: '+p.client_name+')' : ''}`).join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `O usuário recebeu uma lista numerada de itens de nota fiscal e uma lista de obras com letras (A, B, C...). Ele respondeu em português indicando quais itens vão para quais obras.

Itens da nota:
${itemList}

Obras disponíveis:
${projList}

Resposta do usuário: "${text}"

Instruções:
- O usuário usa números para itens e letras para obras (ex: "itens 1 e 3 obra A")
- Pode mencionar nome do cliente ou da obra em vez da letra
- Transcrição de áudio pode ter erros: "Bente"="Bench", etc.
- Se não mencionou um item, use "ignorar"
- "geral" = custo sem obra específica

Retorne SOMENTE JSON válido (sem markdown):
{"assignments":{"1":"A","2":"geral","3":"ignorar"}}
Use a LETRA da obra (A, B, C...) como valor, não o nome.`
      }],
      max_tokens: 300
    })
  });
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  try {
    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
    const result = {};
    for (const [k, v] of Object.entries(parsed.assignments || {})) {
      result[parseInt(k) - 1] = v.toLowerCase().trim();
    }
    return result;
  } catch { return {}; }
}

// ─── HANDLERS ────────────────────────────────────────────────
async function handleStatus(chatId) {
  const today = new Date().toISOString().slice(0, 10);
  const [tasks, leads, followups] = await Promise.all([
    sbGet('tasks', 'status=neq.done&select=id'),
    sbGet('leads', 'status=neq.fechado&status=neq.perdido&select=id'),
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
  const title = text.replace(/^(tarefa|task)[:\s]+/i, '').trim();
  if (!title) { await send(chatId, '❌ Formato: `tarefa: descrição da tarefa`'); return; }
  await sbInsert('tasks', { title, status: 'todo', priority: 'medium', source: 'telegram' });
  await send(chatId, `✅ Tarefa criada!\n*${title}*\n\n🔗 [Ver tarefas](https://app-one-amber-58.vercel.app/tasks)`);
}

async function handleLead(chatId, text) {
  const body  = text.replace(/^lead[:\s]+/i, '').trim();
  const parts = body.split(',').map(s => s.trim());
  const name  = parts[0], phone = parts[1] || '', city = parts[2] || '';
  if (!name) { await send(chatId, '❌ Formato: `lead: Nome, Telefone, Cidade`'); return; }
  const [client] = await sbInsert('clients', { name, phone, city, type: 'person', source: 'telegram' });
  if (client?.id) await sbInsert('leads', { client_id: client.id, status: 'lead', source: 'telegram', first_contact_date: new Date().toISOString().slice(0,10) });
  await send(chatId, `✅ Lead criado!\n*${name}* ${phone?'· '+phone:''} ${city?'· '+city:''}\n\n🔗 [Ver CRM](https://app-one-amber-58.vercel.app/app)`);
}

async function handleCusto(chatId, text) {
  const body     = text.replace(/^(custo|compra)[:\s]+/i, '').trim();
  const parts    = body.split(',').map(s => s.trim());
  const projName = parts[0], desc = parts[1], amount = parseFloat(parts[2]);
  if (!projName || !desc || isNaN(amount)) {
    await send(chatId, '❌ Formato: `custo: Nome da Obra, Descrição, Valor`\nEx: `custo: Reforma Johnson, Tinta Sherwin, 320`');
    return;
  }
  const projects = await sbGet('projects', `name=ilike.*${encodeURIComponent(projName)}*&select=id,name&limit=1`);
  if (!projects.length) { await send(chatId, `❌ Obra não encontrada: *${projName}*`); return; }
  const project = projects[0];
  await sbInsert('transactions', { type: 'expense', description: desc, amount, date: new Date().toISOString().slice(0,10), category: 'material', project_id: project.id, source: 'telegram' });
  await send(chatId, `✅ Custo registrado!\n🏗️ *${project.name}*\n📝 ${desc}\n💵 $${amount.toLocaleString('en-US', {minimumFractionDigits: 2})}\n\n🔗 [Ver financeiro](https://app-one-amber-58.vercel.app/financial)`);
}

async function handlePhoto(chatId, fileId) {
  await send(chatId, '📸 Processando nota fiscal...');
  let url, data;
  try {
    url  = await getFileUrl(fileId);
    data = await extractReceiptItems(url);
  } catch (e) {
    await send(chatId, `💥 Erro: ${e.message}`);
    return;
  }

  if (!data || !data.items?.length) {
    const debug = data?._raw ? `\n\n${data._raw.slice(0, 200)}` : '';
    await send(chatId, `❌ Não consegui ler os itens da nota. Use:\n\`custo: obra, descrição, valor\`${debug}`);
    return;
  }

  // Buscar obras em andamento
  const allProjects = await sbGet('projects', `select=id,name,client_name,status&order=name`, true);
  const filteredProjects = allProjects.filter(p => p.status !== 'completed' && p.status !== 'cancelled');
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // Salvar sessão com itens E projetos mapeados por letra
  const projectsByLetter = {};
  filteredProjects.forEach((p, i) => { if (i < 26) projectsByLetter[letters[i]] = p; });
  await saveSession(chatId, { items: data.items, store: data.store, total: data.total, projectsByLetter });

  const itemList    = data.items.map((it, i) => `*${i+1}.* ${it.desc} — $${Number(it.value).toFixed(2)}`).join('\n');
  const projectList = filteredProjects.map((p, i) => i < 26 ? `*${letters[i]}.* ${p.name}${p.client_name ? ' — '+p.client_name : ''}` : '').filter(Boolean).join('\n');

  await send(chatId,
    `🧾 *${data.store || 'Nota Fiscal'}* — Total: $${Number(data.total||0).toFixed(2)}\n\n` +
    `*Itens:*\n${itemList}\n\n` +
    `*Obras em andamento:*\n${projectList}\n\n` +
    `Responda com itens e obras:\n` +
    `Ex: \`itens 1 e 3 obra A, item 2 obra B, resto ignorar\`\n` +
    `_(Pode responder por áudio!)_`
  );
}

async function handleSessionReply(chatId, text) {
  const session = await getSession(chatId);
  if (!session) return false;

  const { items, projectsByLetter } = session;

  // Ignora mensagens muito curtas
  if (text.trim().length < 3) return false;

  // Passa projetos por letra ao GPT
  const projectsForGPT = Object.entries(projectsByLetter || {}).map(([letter, p]) => ({
    id: p.id, name: p.name, client_name: p.client_name, letter
  }));

  const assignments = await parseItemResponseWithGPT(text, items, projectsForGPT);
  if (!Object.keys(assignments).length) return false;

  // Mapa por letra E por nome
  const projectMap = {};
  for (const p of projectsForGPT) {
    projectMap[p.name.toLowerCase()] = p;
    projectMap[p.letter.toLowerCase()] = p;
  }

  const date = new Date().toISOString().slice(0,10);
  const results = [];

  for (const [idxStr, dest] of Object.entries(assignments)) {
    const idx  = parseInt(idxStr);
    const item = items[idx];
    if (!item) continue;

    if (dest === 'ignorar') {
      results.push(`⏭️ ${item.desc} — ignorado`);
      continue;
    }

    const amount = Number(item.value);
    if (dest === 'geral') {
      const num = 'CMP-' + Date.now().toString().slice(-5);
      const [purch] = await sbInsert('purchases', { purchase_number: num, supplier_name: session.store || 'Telegram', status: 'received', order_date: date, subtotal: amount, total: amount, source: 'telegram' });
      if (purch?.id) await sbInsert('purchase_items', [{ purchase_id: purch.id, description: item.desc, quantity: 1, unit_price: amount, total: amount }]);
      results.push(`✅ ${item.desc} ($${amount.toFixed(2)}) → custo geral`);
    } else {
      const proj = projectMap[dest] || projectMap[dest.toUpperCase()] || Object.values(projectMap).find(p => p.name && (p.name.toLowerCase().includes(dest) || dest.includes(p.name.toLowerCase())));
      if (!proj) { results.push(`❌ ${item.desc} — obra "${dest}" não encontrada`); continue; }
      const num = 'CMP-' + Date.now().toString().slice(-5);
      const [purch] = await sbInsert('purchases', { purchase_number: num, supplier_name: session.store || 'Telegram', project_id: proj.id, status: 'received', order_date: date, subtotal: amount, total: amount, source: 'telegram' });
      if (purch?.id) await sbInsert('purchase_items', [{ purchase_id: purch.id, description: item.desc, quantity: 1, unit_price: amount, total: amount }]);
      results.push(`✅ ${item.desc} ($${amount.toFixed(2)}) → ${proj.name}`);
    }
  }

  await clearSession(chatId);
  await send(chatId, `📋 *Lançamentos realizados:*\n\n${results.join('\n')}\n\n🔗 [Ver financeiro](https://app-one-amber-58.vercel.app/financial)`);
  return true;
}

async function handleHelp(chatId) {
  await send(chatId,
    `🤖 *Fine Touch ERP Bot*\n\n` +
    `📊 *status* — resumo do sistema\n\n` +
    `✅ *tarefa: descrição*\n→ Ex: \`tarefa: ligar para cliente Johnson\`\n\n` +
    `🎯 *lead: nome, telefone, cidade*\n→ Ex: \`lead: Sarah Smith, +1 305 111-2222, Miami FL\`\n\n` +
    `💸 *custo: obra, descrição, valor*\n→ Ex: \`custo: Reforma Johnson, Tinta Sherwin, 320\`\n\n` +
    `📸 *Foto de nota fiscal* → extrai itens automaticamente\n🎙️ Pode responder por áudio!\n\n` +
    `🔗 [Abrir sistema](https://app-one-amber-58.vercel.app/dashboard)`
  );
}

// ─── MAIN HANDLER ────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(200).json({ ok: true }); return; }

  try {
    const message = req.body.message || req.body.edited_message;
    if (!message) { res.status(200).json({ ok: true }); return; }

    const chatId = message.chat.id;
    const text   = (message.text || '').trim();

    // Foto → OCR
    if (message.photo) {
      const fileId = message.photo[message.photo.length - 1].file_id;
      await handlePhoto(chatId, fileId);
      res.status(200).json({ ok: true }); return;
    }

    // Áudio/voz → Whisper → processa como texto
    if (message.voice || message.audio) {
      const fileId = (message.voice || message.audio).file_id;
      await send(chatId, '🎙️ Transcrevendo áudio...');
      const audioUrl    = await getFileUrl(fileId);
      const transcribed = await transcribeAudio(audioUrl);
      if (!transcribed) { await send(chatId, '❌ Não consegui entender o áudio. Tente novamente.'); res.status(200).json({ ok: true }); return; }
      await send(chatId, `📝 Entendi: _"${transcribed}"_`);
      const handled = await handleSessionReply(chatId, transcribed);
      if (!handled) {
        if (/^(tarefa|task)[:\s]/i.test(transcribed)) await handleTask(chatId, transcribed);
        else if (/^lead[:\s]/i.test(transcribed)) await handleLead(chatId, transcribed);
        else if (/^(custo|compra)[:\s]/i.test(transcribed)) await handleCusto(chatId, transcribed);
        else await send(chatId, `Não entendi 🤔\n\nDigite *ajuda* para ver os comandos.`);
      }
      res.status(200).json({ ok: true }); return;
    }

    // Texto
    if (text) {
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
        const handled = await handleSessionReply(chatId, text);
        if (!handled) await send(chatId, `Não entendi 🤔\n\nDigite *ajuda* para ver os comandos.`);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(200).json({ ok: true });
  }
}
