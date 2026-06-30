const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
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
async function sbGet(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
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
  try { return JSON.parse(content.replace(/```json|```/g, '').trim()); }
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
async function parseItemResponseWithGPT(text, items, projectNames) {
  const itemList = items.map((it, i) => `${i+1}. ${it.desc} ($${it.value})`).join('\n');
  const projList = projectNames.join(', ');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `O usuário recebeu esta lista de itens de uma nota fiscal e respondeu em linguagem natural (pode ser transcrição de áudio em português).

Itens:
${itemList}

Projetos disponíveis: ${projList}

Resposta do usuário: "${text}"

Mapeie cada item para o projeto correto, "geral" (sem projeto), ou "ignorar".
Use o nome EXATO do projeto da lista acima.
Retorne SOMENTE JSON válido (sem markdown):
{"assignments":{"1":"nome exato do projeto ou geral ou ignorar","2":"...","3":"..."}}`
      }],
      max_tokens: 200
    })
  });
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  try {
    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
    const result = {};
    for (const [k, v] of Object.entries(parsed.assignments || {})) {
      result[parseInt(k) - 1] = v.toLowerCase();
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
    await send(chatId, `🔗 URL obtida. Chamando OpenAI...`);
    data = await extractReceiptItems(url);
    await send(chatId, `📦 Resposta: ${JSON.stringify(data).slice(0, 300)}`);
  } catch (e) {
    await send(chatId, `💥 Erro: ${e.message}`);
    return;
  }

  if (!data || !data.items?.length) {
    const debug = data?._raw ? `\n\n${data._raw.slice(0, 300)}` : JSON.stringify(data).slice(0,200);
    await send(chatId, `❌ Não consegui ler os itens da nota.\n\n${debug}`);
    return;
  }

  await saveSession(chatId, { items: data.items, store: data.store, total: data.total });

  const list = data.items.map((it, i) => `*${i+1}.* ${it.desc} — $${Number(it.value).toFixed(2)}`).join('\n');
  await send(chatId,
    `🧾 *${data.store || 'Nota Fiscal'}* — Total: $${Number(data.total||0).toFixed(2)}\n\n` +
    `${list}\n\n` +
    `Para cada número, responda:\n` +
    `• *nome da obra* → lança na obra\n` +
    `• *geral* → custo geral (sem obra)\n` +
    `• *ignorar* → não lança\n\n` +
    `Ex: \`1 angie, 2 nadia, 3 geral, 4 ignorar\`\n` +
    `_(Pode responder por áudio também!)_`
  );
}

async function handleSessionReply(chatId, text) {
  const session = await getSession(chatId);
  if (!session) return false;

  const { items } = session;

  // Buscar todos os projetos disponíveis para passar ao GPT
  const allProjects = await sbGet('projects', 'select=id,name&status=neq.archived&limit=50');
  const projectNames = allProjects.map(p => p.name);

  const assignments = await parseItemResponseWithGPT(text, items, projectNames);
  if (!Object.keys(assignments).length) return false;

  // Montar mapa de projetos pelo nome exato
  const projectMap = {};
  for (const proj of allProjects) projectMap[proj.name.toLowerCase()] = proj;

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

    if (dest === 'geral') {
      await sbInsert('transactions', { type: 'expense', description: item.desc, amount: item.value, date, category: 'material', source: 'telegram' });
      results.push(`✅ ${item.desc} ($${Number(item.value).toFixed(2)}) → custo geral`);
    } else {
      const proj = projectMap[dest] || Object.values(projectMap).find(p => p.name.toLowerCase().includes(dest) || dest.includes(p.name.toLowerCase()));
      if (!proj) { results.push(`❌ ${item.desc} — obra "${dest}" não encontrada`); continue; }
      await sbInsert('transactions', { type: 'expense', description: item.desc, amount: item.value, date, category: 'material', project_id: proj.id, source: 'telegram' });
      results.push(`✅ ${item.desc} ($${Number(item.value).toFixed(2)}) → ${proj.name}`);
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
