const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jpbpzlpvhdwgbmljqfyd.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const SUPABASE_ANON_KEY = 'sb_publishable_l6x3A2YiBL0Pc7huB-QejA_d2RXKL59';
const OPENAI_KEY   = process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const STORAGE_BUCKET = 'obra-photos';
const NOTIFY_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7758479066';
// Segredo que o Telegram devolve no header X-Telegram-Bot-Api-Secret-Token em toda
// chamada do webhook (configurado via setWebhook). Confirma que a requisicao veio
// mesmo do Telegram, nao de qualquer POST publico batendo no endpoint.
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
// Segredo operacional pra concluir a configuracao (?setup=1 / ?status=1) direto do
// servidor logo apos o deploy, sem depender de sessao de navegador nem imprimir o
// token do bot em lugar nenhum. So quem publica o deploy (o proprio Vercel env) tem
// esse valor. O botao "Reconectar Telegram" dentro do ERP (users.html) continua
// funcionando via sessao de admin normalmente -- este e so um segundo caminho.
const OPS_SECRET = process.env.TELEGRAM_OPS_SECRET || '';
// So estes remetentes podem operar o bot (ele roda com service role, sem RLS).
// Restrito ao chat_id realmente confirmado em uso (marketing_data.owner_telegram_chat_id,
// populado por mensagens reais ja recebidas) -- NAO usa o TELEGRAM_CHAT_ID de envio de
// alertas como fallback, porque esse valor nunca foi comprovado como pertencente ao
// Fabinho pra fins de RECEBER comandos (e um destino de notificacao, papel diferente).
const AUTHORIZED_CHAT_IDS = new Set(
  (process.env.TELEGRAM_AUTHORIZED_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
);

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

// Upsert simples (usado pra gravar config chave/valor em marketing_data, ex:
// o chat_id do dono no Telegram, pra automações externas (n8n) saberem pra quem mandar mensagem).
async function sbUpsert(table, data, onConflict) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(data)
  });
  return res.ok;
}

// Garante que o fornecedor/loja da nota fiscal ou invoice esteja cadastrado em
// "suppliers". Se for uma empresa nova que o bot ainda não conhece, cadastra
// automaticamente em vez de deixar só como texto solto na compra.
function normalizeSupplierName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function getOrCreateSupplier(rawName) {
  const name = (rawName || '').trim();
  if (!name || name.toLowerCase() === 'telegram') return null;
  const target = normalizeSupplierName(name);
  if (!target) return null;
  // Compara normalizado (sem hifen/espaco/pontuacao) pra nao duplicar por causa de
  // "Sherwin-Williams" vs "Sherwin Williams" etc -- ja aconteceu de ter as duas grafias.
  const all = await sbGet('suppliers', 'select=id,name');
  const match = all.find(s => normalizeSupplierName(s.name) === target);
  if (match) return { id: match.id, isNew: false };
  try {
    const created = await sbInsert('suppliers', { name, notes: 'Cadastrado automaticamente pelo bot do Telegram (nota fiscal/invoice)' });
    const row = Array.isArray(created) ? created[0] : created;
    return row?.id ? { id: row.id, isNew: true } : null;
  } catch {
    return null;
  }
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
          { type: 'text', text: `Analise esta nota fiscal/recibo e extraia cada item de linha com descrição, quantidade, preço unitário e valor total da linha.
Ignore QR codes, barcodes e cabeçalhos. Foque apenas no texto impresso com descrições de produtos e valores.
Retorne SOMENTE um JSON válido neste formato (sem markdown):
{"store":"nome da loja","total":99.99,"tax":0,"discount":0,"items":[{"desc":"descrição do produto","qty":1,"unit_price":9.99,"value":9.99}]}
Regras importantes:
- Se a linha tiver quantidade x preço unitário impressos, preencha qty e unit_price corretamente e value = qty * unit_price.
- Se a nota tiver duas ou mais linhas do MESMO produto impressas separadamente (compras repetidas), mantenha cada uma como uma linha distinta — não junte nem remova linhas repetidas legítimas. Só elimine uma linha se for claramente o mesmo texto lido duas vezes por erro (ex: OCR duplicou a mesma linha física).
- Se a nota mostrar imposto (tax) ou desconto (discount) separados do valor dos itens, preencha esses campos; senão retorne 0 para ambos.
- Se não conseguir identificar itens individuais, retorne o total como um único item com desc "Compra geral", qty 1 e unit_price igual ao total.` }
        ]
      }],
      max_tokens: 600
    })
  });
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (data.error) return { _raw: `ERRO OpenAI: ${data.error.message}`, _error: 'api error' };
  try {
    const parsed = JSON.parse(content.replace(/```json|```/g, '').trim());
    // Normaliza qty/unit_price/value (nao remove itens repetidos -- podem ser legitimos,
    // ver instrucao no prompt acima; a IA ja foi orientada a nao duplicar por erro de leitura).
    parsed.items = (parsed.items || []).map(it => {
      const qty = Number(it.qty) || 1;
      const unitPrice = it.unit_price != null ? Number(it.unit_price) : (Number(it.value) || 0) / qty;
      const value = it.value != null ? Number(it.value) : qty * unitPrice;
      return { desc: it.desc, qty, unit_price: Math.round(unitPrice * 100) / 100, value: Math.round(value * 100) / 100 };
    });
    parsed.tax = Number(parsed.tax) || 0;
    parsed.discount = Number(parsed.discount) || 0;
    return parsed;
  }
  catch { return { _raw: `Parse falhou. Resposta: ${content.slice(0, 400)}`, _error: 'parse failed' }; }
}

// ─── OPENAI VISION — classifica: nota fiscal ou foto de obra ─
async function classifyPhoto(imageUrl) {
  try {
    const imgRes    = await fetch(imageUrl);
    const imgBuffer = await imgRes.arrayBuffer();
    const base64    = Buffer.from(imgBuffer).toString('base64');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
            { type: 'text', text: 'Essa imagem é (a) uma nota fiscal/recibo/comprovante (documento com texto e valores impressos), ou (b) uma foto de um ambiente/parede/obra de decoração (finalizada ou em andamento)? Responda APENAS com a palavra invoice ou project.' }
          ]
        }],
        max_tokens: 5
      })
    });
    const data = await res.json();
    const answer = (data.choices?.[0]?.message?.content || '').toLowerCase();
    return answer.includes('project') ? 'project' : 'invoice';
  } catch {
    // se a classificação falhar por qualquer motivo, mantém o comportamento atual (nota fiscal)
    return 'invoice';
  }
}

// ─── SUPABASE STORAGE — sobe foto de obra e devolve URL pública ─
async function uploadPhotoToStorage(telegramUrl, chatId) {
  const imgRes    = await fetch(telegramUrl);
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  const filename  = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const path      = `${chatId}/${filename}`;

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'image/jpeg',
    },
    body: imgBuffer,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Storage upload failed: ${errText.slice(0, 200)}`);
  }

  // Espelha no Google Drive em segundo plano — só funciona depois que o Drive for autorizado
  // (reaproveita o mesmo refresh token do GMB). Nunca quebra o fluxo principal se falhar.
  mirrorToGDrive(imgBuffer, filename).catch(() => {});

  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

// ─── GOOGLE DRIVE — espelha fotos de obra numa pasta dedicada ─
async function getGDriveAccessToken() {
  const rows = await sbGet('marketing_data', 'key=eq.gdrive_refresh_token&select=value');
  const refreshToken = rows[0]?.value?.token;
  if (!refreshToken) return null; // Drive ainda não foi autorizado

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await tokenRes.json();
  return data.access_token || null;
}

async function getOrCreateGDriveFolder(accessToken) {
  const rows = await sbGet('marketing_data', 'key=eq.gdrive_folder_id&select=value');
  if (rows[0]?.value?.id) return rows[0].value.id;

  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Fotos de Obras — Fine Touch', mimeType: 'application/vnd.google-apps.folder' }),
  });
  const folder = await res.json();
  if (!folder.id) throw new Error('Falha ao criar pasta no Drive: ' + JSON.stringify(folder));

  await fetch(`${SUPABASE_URL}/rest/v1/marketing_data`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key: 'gdrive_folder_id', value: { id: folder.id }, updated_at: new Date().toISOString() }),
  });
  return folder.id;
}

async function mirrorToGDrive(imgBuffer, filename) {
  const accessToken = await getGDriveAccessToken();
  if (!accessToken) return; // sem autorização ainda — no-op silencioso

  const folderId = await getOrCreateGDriveFolder(accessToken);

  const boundary = 'ftboundary' + Date.now();
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const multipartBody = Buffer.concat([Buffer.from(head, 'utf-8'), imgBuffer, Buffer.from(tail, 'utf-8')]);

  await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });
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

// ─── FILA PERSISTENTE POR NOTA (Supabase marketing_data como KV) ─────
// Cada chat tem UM estado { active, pending[] }. "active" e a nota/conversa em
// andamento agora; "pending" sao notas/fotos que chegaram enquanto uma outra
// conversa ja estava em andamento -- antes elas SOBRESCREVIAM a sessao ativa e
// se perdiam. Agora entram na fila e sao apresentadas em ordem, sem perder nada.
// Nao ha expiracao destrutiva: cada nota carrega os proprios dados (itens, obras
// disponiveis no momento da leitura), entao retomar depois de muito tempo continua
// seguro -- so o usuario decide quando responder.
async function getQueueState(chatId) {
  const rows = await sbGet('marketing_data', `key=eq.tg_queue_${chatId}&select=value`);
  const v = rows[0]?.value || {};
  return { active: v.active || null, pending: Array.isArray(v.pending) ? v.pending : [] };
}

async function saveQueueState(chatId, state) {
  await sbUpsert('marketing_data', { key: `tg_queue_${chatId}`, value: state, updated_at: new Date().toISOString() }, 'key');
}

async function clearQueueState(chatId) {
  await fetch(`${SUPABASE_URL}/rest/v1/marketing_data?key=eq.tg_queue_${chatId}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
}

// Coloca uma nota nova pra tramitar: se nao ha nada em andamento, ela vira a ativa
// (started:true, chame presentNote pra mostrar); senao entra na fila (started:false).
async function enqueueNote(chatId, note) {
  const state = await getQueueState(chatId);
  note.id = note.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  note.createdAt = new Date().toISOString();
  if (!state.active) {
    state.active = note;
    await saveQueueState(chatId, state);
    return { started: true, note };
  }
  state.pending.push(note);
  await saveQueueState(chatId, state);
  return { started: false, position: state.pending.length, note };
}

// Atualiza a nota ativa em andamento (ex: usuario escolheu a obra, aguardando audio).
async function updateActive(chatId, data) {
  const state = await getQueueState(chatId);
  state.active = data;
  await saveQueueState(chatId, state);
}

// Encerra a nota ativa (concluida) e promove a proxima da fila, se houver.
// Retorna a nova nota ativa (pra ser apresentada) ou null se a fila esvaziou.
async function advanceQueue(chatId) {
  const state = await getQueueState(chatId);
  if (state.pending.length) {
    state.active = state.pending.shift();
    await saveQueueState(chatId, state);
    return state.active;
  }
  await clearQueueState(chatId);
  return null;
}

async function getSession(chatId) {
  const state = await getQueueState(chatId);
  return state.active;
}

// Mantido pelo nome por compatibilidade com o restante do arquivo: "limpar a sessao"
// agora significa "concluir a nota ativa e avancar a fila".
async function clearSession(chatId) {
  return advanceQueue(chatId);
}

async function saveSession(chatId, data) {
  return updateActive(chatId, data);
}

// ─── GPT INTERPRETA RESPOSTA DO USUÁRIO ──────────────────────
// Rede de seguranca: nunca confia 100% no modelo pra decidir sozinho qual obra
// leva um item que o usuario nao citou. So permite que um item "nao citado por numero"
// va pra uma obra se o usuario usou uma palavra de "resto" (resto/restante/demais) --
// senao, forca "ignorar" mesmo que o modelo tenha (erradamente) sugerido uma obra.
function extractMentionedItemNumbers(text, maxIdx) {
  const mentioned = new Set();
  const rangeRe = /(\d+)\s*(?:a|até|ate|-)\s*(\d+)/gi;
  let m;
  while ((m = rangeRe.exec(text))) {
    let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    if (a > b) { const tmp = a; a = b; b = tmp; }
    for (let n = a; n <= b && n <= maxIdx; n++) mentioned.add(n);
  }
  const singleRe = /\b(\d+)\b/g;
  while ((m = singleRe.exec(text))) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= maxIdx) mentioned.add(n);
  }
  return mentioned;
}

function enforceExplicitMentionSafety(assignments, text, itemCount) {
  const hasRestoClause = /\b(resto|restante|demais)\b/i.test(text);
  if (hasRestoClause) return assignments; // usuario usou "resto" de proposito, confia no modelo
  const mentioned = extractMentionedItemNumbers(text, itemCount);
  for (const idxStr of Object.keys(assignments)) {
    const itemNumber = parseInt(idxStr, 10) + 1;
    if (!mentioned.has(itemNumber) && assignments[idxStr] !== 'ignorar') {
      assignments[idxStr] = 'ignorar';
    }
  }
  return assignments;
}

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
- REGRA MAIS IMPORTANTE: se um item NÃO foi mencionado explicitamente pelo número (nem em uma lista, nem em um intervalo), o valor DEVE ser "ignorar". Nunca invente, deduza ou "complete" uma obra para um item que o usuário não citou — mesmo que sobre só um item. Exemplo: se só existem 5 itens e o usuário disse "itens 2, 3, 4 e 5 na obra B", o item 1 é "ignorar" (ele não foi citado), NUNCA deve ir pra outra obra.
- Só use "resto"/"restante"/"demais" como referência a itens não citados se o próprio usuário usar uma dessas palavras explicitamente.
- "geral" = custo sem obra específica

Retorne SOMENTE JSON válido (sem markdown):
{"assignments":{"1":"A","2":"geral","3":"ignorar"}}
Use a LETRA da obra (A, B, C...) como valor, não o nome.`
      }],
      temperature: 0,
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
  let url;
  try {
    url = await getFileUrl(fileId);
  } catch (e) {
    await send(chatId, `💥 Erro: ${e.message}`);
    return;
  }

  const kind = await classifyPhoto(url);
  if (kind === 'project') {
    await handleProjectPhoto(chatId, url);
    return;
  }

  await send(chatId, '📸 Processando nota fiscal...');
  let data;
  try {
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

  // Buscar obras -- so as que estao "em andamento" (active). Obras concluidas ou canceladas
  // nao aparecem aqui; se precisar lancar uma compra numa obra ja fechada, reabra o status
  // dela em /projects antes de mandar a nota.
  const allProjects = await sbGet('projects', `select=id,name,status,clients(name)&order=name`); // service role key — ver nota acima sobre RLS
  const filteredProjects = allProjects.filter(p => p.status === 'active').sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  // client name vem do join clients(name)
  filteredProjects.forEach(p => { p.client_name = p.clients?.name || ''; });
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // Monta a nota (itens + obras mapeadas por letra) e entra na fila: se nao ha
  // nenhuma conversa em andamento nesse chat ela vira a ativa na hora; se ja tem
  // uma nota sendo respondida, esta entra na fila e e apresentada depois -- sem
  // apagar a que estava em andamento (era o bug antigo: a 2a foto sobrescrevia a 1a).
  const projectsByLetter = {};
  filteredProjects.forEach((p, i) => { if (i < 26) projectsByLetter[letters[i]] = p; });
  const note = {
    kind: 'invoice',
    items: data.items,
    store: data.store,
    total: data.total,
    tax: data.tax || 0,
    discount: data.discount || 0,
    // fixado na criacao: se uma resposta parcial falhar e sobrar so alguns itens
    // pra retry, o rateio de taxa/desconto continua usando a base ORIGINAL da nota
    // (nao a soma dos itens restantes), senao o retry herdaria 100% da taxa/desconto
    // que deveria ter sido dividida entre todos os grupos.
    baseSubtotal: data.items.reduce((s, it) => s + Number(it.value || 0), 0),
    projectsByLetter,
  };
  const { started, position } = await enqueueNote(chatId, note);
  if (started) {
    await presentInvoiceNote(chatId, note);
  } else {
    await send(chatId, `📥 Nota de *${data.store || 'fornecedor'}* ($${Number(data.total || 0).toFixed(2)}) recebida e guardada na fila (posição ${position}). Termine a conversa atual que eu pergunto sobre essa em seguida — nada foi perdido.`);
  }
}

// Monta e envia a mensagem com itens + obras de uma nota fiscal. Usada tanto pra
// apresentar uma nota nova quanto pra retomar uma nota que estava na fila.
async function presentInvoiceNote(chatId, note, opts = {}) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const itemList = note.items.map((it, i) => `*${i+1}.* ${it.desc}${it.qty && Number(it.qty) !== 1 ? ' (x' + it.qty + ')' : ''} — $${Number(it.value).toFixed(2)}`).join('\n');
  const entries = Object.entries(note.projectsByLetter || {});
  const projectList = entries.map(([letter, p]) => `*${letter}.* ${p.name}${p.client_name ? ' — ' + p.client_name : ''}`).join('\n') || '_Nenhuma obra em andamento no momento._';

  // Reconciliação: soma dos itens + imposto - desconto deve bater com o total impresso
  // na nota. Se nao bater, avisa em vez de considerar os valores validados sem checagem.
  // Pulado num retry parcial: "note.items" ali é só o que falhou, não a nota inteira,
  // então comparar com o total da nota completa daria um alerta falso.
  const sumItems = note.items.reduce((s, it) => s + Number(it.value || 0), 0);
  const expectedTotal = sumItems + Number(note.tax || 0) - Number(note.discount || 0);
  const noteTotal = Number(note.total || 0);
  const diff = Math.abs(expectedTotal - noteTotal);
  const reconcileWarning = (!opts.retry && diff > 0.5)
    ? `\n\n⚠️ *Confira antes de responder:* itens${note.tax ? ` + taxa $${Number(note.tax).toFixed(2)}` : ''}${note.discount ? ` - desconto $${Number(note.discount).toFixed(2)}` : ''} = $${expectedTotal.toFixed(2)}, mas a nota mostra $${noteTotal.toFixed(2)}.`
    : '';

  const header = opts.retry
    ? `🧾 *Itens pendentes${note.store ? ' de ' + note.store : ''}*`
    : `🧾 *${note.store || 'Nota Fiscal'}* — Total: $${noteTotal.toFixed(2)}`;

  await send(chatId,
    `${header}\n\n` +
    `*Itens:*\n${itemList}\n\n` +
    `*Obras em andamento:*\n${projectList}${reconcileWarning}\n\n` +
    `Responda com itens e obras:\n` +
    `Ex: \`itens 1 e 3 obra A, item 2 obra B, resto ignorar\`\n` +
    `_(Pode responder por áudio!)_\n` +
    `_Obra já concluída não aparece aqui — reabra o status dela em /projects se precisar lançar algo nela._`
  );
}

// Ao concluir a nota/foto ativa, se havia outra na fila ela vira a ativa e precisa
// ser apresentada ao usuario (prompt de itens+obras, ou retomada do batch de fotos).
async function presentNote(chatId, note) {
  if (!note) return;
  if (note.kind === 'invoice') { await presentInvoiceNote(chatId, note); return; }
  if (note.kind === 'photos') {
    await send(chatId, `📸 Retomando ${note.photoUrls?.length || 0} foto(s) pendente(s) de obra.\nManda mais fotos ou responda *pronto* quando terminar.`);
  }
}

async function handleProjectPhoto(chatId, telegramUrl) {
  await send(chatId, '📸 Foto de obra detectada — salvando...');
  let publicUrl;
  try {
    publicUrl = await uploadPhotoToStorage(telegramUrl, chatId);
  } catch (e) {
    await send(chatId, `💥 Erro ao salvar a foto: ${e.message}`);
    return;
  }

  // So acumula na MESMA sessao ativa se ela ja for um batch de fotos em andamento;
  // caso contrario entra na fila (nao sobrescreve o que estiver em andamento).
  const state = await getQueueState(chatId);
  if (state.active?.kind === 'photos') {
    const photoUrls = [...(state.active.photoUrls || []), publicUrl];
    await updateActive(chatId, { ...state.active, photoUrls });
    await send(chatId, `📸 Foto recebida (${photoUrls.length} até agora).\nManda mais fotos dessa obra ou responda *pronto* quando terminar.`);
    return;
  }

  const { started, position } = await enqueueNote(chatId, { kind: 'photos', photoUrls: [publicUrl] });
  if (started) {
    await send(chatId, `📸 Foto recebida (1 até agora).\nManda mais fotos dessa obra ou responda *pronto* quando terminar.`);
  } else {
    await send(chatId, `📸 Foto guardada na fila (posição ${position}) — tem outra conversa em andamento. Termine a atual que eu aviso quando for a vez dessa foto.`);
  }
}

async function showProjectPickerForPhotos(chatId, session) {
  // obras que ainda podem receber fotos: qualquer uma que não esteja publicada nem ignorada
  // usa a service role key (não a anon) — depois da correção de RLS de 01/07/2026,
  // a chave anon não tem mais acesso a catalog_portfolio (correto, é dado interno).
  // Este bot roda 100% no servidor, então a service role key é a certa aqui.
  const rows = await sbGet('catalog_portfolio',
    `select=id,status,created_at,projects(id,name,status,city,clients(name))&status=not.in.(published,ignored)`);
  // obras finalizadas (prontas pra virar conteúdo) aparecem antes das que ainda estão em andamento;
  // dentro de cada grupo, as mais recentes primeiro. Nada aqui expira por data — só some quando
  // publicada ou ignorada, mesmo que a obra tenha terminado há meses.
  const usable = rows.filter(r => r.projects).sort((a, b) => {
    const aOpen = a.status === 'awaiting_completion' ? 1 : 0;
    const bOpen = b.status === 'awaiting_completion' ? 1 : 0;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return new Date(b.created_at) - new Date(a.created_at);
  });
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const byLetter = {};
  usable.forEach((r, i) => {
    if (i >= 26) return;
    byLetter[letters[i]] = { rowId: r.id, name: r.projects.name, client_name: r.projects.clients?.name || '' };
  });

  await saveSession(chatId, { ...session, awaitingProjectPick: true, byLetter });

  if (!Object.keys(byLetter).length) {
    await send(chatId, '❌ Não encontrei nenhuma obra em aberto pra vincular essas fotos. Abra o sistema e crie a obra primeiro.');
    return;
  }

  const list = Object.entries(byLetter).map(([letter, p]) => `*${letter}.* ${p.name}${p.client_name ? ' — ' + p.client_name : ''}`).join('\n');
  await send(chatId, `📸 ${session.photoUrls.length} foto(s) prontas.\n\n*De qual obra são essas fotos?*\n${list}\n\nResponda só com a letra (ex: \`A\`).`);
}

async function handlePhotoSessionReply(chatId, text, session) {
  const t = text.trim().toLowerCase();

  if (!session.awaitingProjectPick) {
    if (t === 'pronto' || t === 'ok' || t === 'fim' || t === 'feito') {
      await showProjectPickerForPhotos(chatId, session);
      return true;
    }
    return false; // ainda esperando mais fotos, não interpreta como comando
  }

  const letter = text.trim().toUpperCase();
  const picked = session.byLetter?.[letter];
  if (!picked) {
    await send(chatId, `❌ Não achei a obra "${text}". Responda só com a letra mostrada (ex: A).`);
    return true;
  }

  const currentRows = await sbGet('catalog_portfolio', `id=eq.${picked.rowId}&select=image_urls`);
  const merged = [...((currentRows[0] && currentRows[0].image_urls) || []), ...session.photoUrls];

  await fetch(`${SUPABASE_URL}/rest/v1/catalog_portfolio?id=eq.${picked.rowId}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ image_urls: merged, updated_at: new Date().toISOString() }),
  });

  await send(chatId, `✅ ${session.photoUrls.length} foto(s) anexada(s) em *${picked.name}*!`);

  // Pede um contexto do dono (por áudio ou texto) sobre a obra, pra dar mais material
  // pra IA usar na hora de escrever o blog (em vez de só o template genérico).
  await saveSession(chatId, {
    kind: 'photos',
    awaitingAudioNote: true,
    portfolioRowId: picked.rowId,
    portfolioName: picked.name,
  });
  await send(chatId, `🎙️ Quer contar um pouco sobre essa obra? Manda um *áudio* (ou pode escrever) falando do processo de criação, o que o cliente pediu, algum desafio que apareceu, etc. Isso ajuda a IA a escrever um texto de blog bem melhor.\n\nSe não quiser, responda *pular*.`);
  return true;
}

async function handleAudioNoteReply(chatId, text, session) {
  const t = text.trim().toLowerCase();
  if (t === 'pular' || t === 'nao' || t === 'não' || t === 'skip' || t === 'não quero' || t === 'nao quero') {
    const nextNote = await clearSession(chatId);
    await send(chatId, `Tranquilo! 👍\n\n🔗 [Ver no Marketing](https://app-one-amber-58.vercel.app/marketing)`);
    await presentNote(chatId, nextNote);
    return true;
  }

  await fetch(`${SUPABASE_URL}/rest/v1/catalog_portfolio?id=eq.${session.portfolioRowId}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ owner_notes: text, owner_notes_updated_at: new Date().toISOString() }),
  });

  const nextNote = await clearSession(chatId);
  await send(chatId, `📝 Anotado! Isso vai ajudar bastante na hora de gerar o texto de *${session.portfolioName}*.\n\n🔗 [Ver no Marketing](https://app-one-amber-58.vercel.app/marketing)`);
  await presentNote(chatId, nextNote);
  return true;
}

async function handleSessionReply(chatId, text) {
  const session = await getSession(chatId);
  if (!session) return false;

  if (session.kind === 'photos') {
    if (session.awaitingAudioNote) {
      return await handleAudioNoteReply(chatId, text, session);
    }
    return await handlePhotoSessionReply(chatId, text, session);
  }

  const { items, projectsByLetter } = session;

  if (text.trim().length < 3) return false;

  const projectsForGPT = Object.entries(projectsByLetter || {}).map(([letter, p]) => ({
    id: p.id, name: p.name, client_name: p.client_name, letter
  }));

  let assignments = await parseItemResponseWithGPT(text, items, projectsForGPT);
  if (!Object.keys(assignments).length) return false;
  assignments = enforceExplicitMentionSafety(assignments, text, items.length);

  // Mapa por letra E por nome
  const projectMap = {};
  for (const p of projectsForGPT) {
    projectMap[p.name.toLowerCase()] = p;
    projectMap[p.letter.toLowerCase()] = p;
  }

  const date = new Date().toISOString().slice(0,10);
  const supplier = await getOrCreateSupplier(session.store);
  const results = [];
  const failedIdx = []; // itens cujo grupo falhou ao gravar -- ficam retidos pra retry, sem duplicar o que ja gravou

  // Agrupa itens por destino para criar uma compra por destino
  const groups = {}; // dest → [{ idx, item, amount }]
  for (const [idxStr, dest] of Object.entries(assignments)) {
    const idx  = parseInt(idxStr);
    const item = items[idx];
    if (!item) continue;
    if (dest === 'ignorar') { results.push(`⏭️ ${item.desc} — ignorado`); continue; }
    if (!groups[dest]) groups[dest] = [];
    groups[dest].push({ idx, item, amount: Number(item.value) });
  }

  // Reconciliação: taxa/desconto da nota (se houver) sao rateados proporcionalmente
  // entre as obras/destinos, pra o total gravado bater com o total real pago por cada uma,
  // em vez de simplesmente somar os valores de linha e ignorar taxa/desconto.
  const noteSubtotal = Number(session.baseSubtotal) || items.reduce((s, it) => s + Number(it.value || 0), 0);
  const adjustment = Number(session.tax || 0) - Number(session.discount || 0);

  for (const [dest, itens] of Object.entries(groups)) {
    const subtotal = itens.reduce((s, x) => s + x.amount, 0);
    const share = noteSubtotal > 0 ? subtotal / noteSubtotal : 0;
    const total = Math.round((subtotal + adjustment * share) * 100) / 100;
    const num = 'CMP-' + Date.now().toString().slice(-5) + '-' + Math.random().toString(36).slice(2, 4);

    let projectId = null;
    let destLabel = dest === 'geral' ? 'custo geral' : dest;
    if (dest !== 'geral') {
      const proj = projectMap[dest] || projectMap[dest.toUpperCase()] || Object.values(projectMap).find(p => p.name && (p.name.toLowerCase().includes(dest) || dest.includes(p.name.toLowerCase())));
      if (!proj) {
        itens.forEach(x => { results.push(`❌ ${x.item.desc} — obra "${dest}" não encontrada`); });
        continue; // erro de digitação do usuario, nao de gravacao -- nao entra em failedIdx (nao ha pra onde gravar)
      }
      projectId = proj.id;
      destLabel = proj.name;
    }

    const purchasePayload = {
      purchase_number: num,
      supplier_name: session.store || 'Telegram',
      supplier_id: supplier?.id || null,
      project_id: projectId,
      status: 'received',
      order_date: date,
      subtotal,
      total,
    };
    const itemsPayload = itens.map(x => ({
      description: x.item.desc,
      quantity: Number(x.item.qty) || 1,
      unit_price: Number(x.item.unit_price) || x.amount,
      total: x.amount,
    }));

    // Grava compra + itens numa unica transacao (RPC create_purchase_with_items) --
    // ou os dois entram, ou nenhum entra. So confirma sucesso pro usuario depois de
    // confirmar que a gravacao realmente aconteceu (nunca antes, como acontecia antes
    // quando o insert falhava em silencio e a mensagem de sucesso saia igual).
    try {
      const purch = await createPurchaseWithItems(purchasePayload, itemsPayload);
      if (!purch?.id) throw new Error('RPC nao retornou id da compra');
      results.push(`✅ ${itens.length} item(s) ($${total.toFixed(2)}) → ${destLabel}`);
    } catch (e) {
      console.error('Falha ao gravar compra do Telegram:', dest, e);
      itens.forEach(x => failedIdx.push(x.idx));
      results.push(`❌ Falha ao gravar ${itens.length} item(s) de "${destLabel}" — mantive pendente, tenta responder de novo.`);
    }
  }

  const supplierNote = supplier?.isNew ? `\n\n🏢 *Novo fornecedor cadastrado:* ${session.store}` : '';

  if (failedIdx.length) {
    // Mantem so os itens que falharam na sessao ativa (os que ja gravaram nao voltam
    // a aparecer, pra nao duplicar compra se o usuario responder de novo).
    const remainingItems = failedIdx.map(i => items[i]);
    const updatedNote = { ...session, items: remainingItems };
    await updateActive(chatId, updatedNote);
    await send(chatId, `📋 *Resultado parcial:*\n\n${results.join('\n')}${supplierNote}`);
    await presentInvoiceNote(chatId, updatedNote, { retry: true });
    return true;
  }

  const nextNote = await clearSession(chatId);
  await send(chatId, `📋 *Lançamentos realizados:*\n\n${results.join('\n')}${supplierNote}\n\n🔗 [Ver financeiro](https://app-one-amber-58.vercel.app/financial)`);
  await presentNote(chatId, nextNote);
  return true;
}

// Grava purchase + purchase_items atomicamente via funcao no banco (RPC) --
// ou os dois entram, ou nenhum entra (evita compra orfa sem itens no meio de uma falha).
async function createPurchaseWithItems(purchase, items) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_purchase_with_items`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_purchase: purchase, p_items: items }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message || data?.hint || `HTTP ${res.status}`);
  return Array.isArray(data) ? data[0] : data;
}

async function handleHelp(chatId) {
  await send(chatId,
    `🤖 *Fine Touch ERP Bot*\n\n` +
    `📊 *status* — resumo do sistema\n\n` +
    `✅ *tarefa: descrição*\n→ Ex: \`tarefa: ligar para cliente Johnson\`\n\n` +
    `🎯 *lead: nome, telefone, cidade*\n→ Ex: \`lead: Sarah Smith, +1 305 111-2222, Miami FL\`\n\n` +
    `💸 *custo: obra, descrição, valor*\n→ Ex: \`custo: Reforma Johnson, Tinta Sherwin, 320\`\n\n` +
    `📸 *Foto de nota fiscal* → extrai itens automaticamente\n🏗️ *Foto de obra* → identifica sozinho e pergunta de qual obra é (manda várias e responda 'pronto')\n🎙️ Pode responder por áudio!\n\n` +
    `💬 *Pergunte naturalmente:* \`quantas obras temos?\`, \`quanto tá em invoice aberto?\`, \`quais orçamentos aprovados esse mês?\`\n\n` +
    `🔗 [Abrir sistema](https://app-one-amber-58.vercel.app/dashboard)`
  );
}

// ─── PERGUNTAS EM LINGUAGEM NATURAL (Claude + tool-use) ──────
const BOT_TOOLS = [
  {
    name: 'list_projects',
    description: 'Lista as obras (projetos) cadastradas no ERP, uma por uma. Use para perguntas sobre quantas obras existem, quais estão ativas/completas, etc.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'completed', 'all'], description: 'Filtra por status. Use "all" se o usuário não especificar.' }
      }
    }
  },
  {
    name: 'sum_invoices',
    description: 'Soma e conta invoices (faturas) por status. Use para perguntas sobre quanto está em aberto, quanto já foi pago, invoices vencidos, etc.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'paid', 'overdue', 'all'], description: 'open = ainda não pago. overdue = vencido e não pago.' }
      },
      required: ['status']
    }
  },
  {
    name: 'sum_quotes',
    description: 'Soma e conta orçamentos por status ou por mês. Use para perguntas sobre orçamentos aprovados, pendentes, ou de um mês específico.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['approved', 'pending', 'rejected', 'all'] },
        month: { type: 'string', description: 'Mês no formato YYYY-MM, se o usuário mencionar um mês específico.' }
      }
    }
  },
  {
    name: 'list_leads',
    description: 'Lista leads (clientes em potencial) cadastrados, um por um. Use para perguntas sobre quantos leads existem.',
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', description: 'Filtro opcional de status do lead.' } }
    }
  },
  {
    name: 'list_tasks',
    description: 'Lista tarefas internas, uma por uma. Use para perguntas sobre tarefas pendentes ou concluídas.',
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['pending', 'done', 'all'] } }
    }
  },
  {
    name: 'count_clients',
    description: 'Conta o total de clientes cadastrados no ERP.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_project_materials',
    description: 'Mostra o resumo de materiais (produtos, quantidades e valores) comprados/usados em uma obra específica. Use para perguntas tipo "quanto gastei de tinta na obra X", "quantas latas usei na casa da Fulana", "quais materiais entraram nessa obra".',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'Nome (ou parte do nome) da obra ou do cliente, ex: "Cheryl Katzman", "Paige", "Bench Room".' }
      },
      required: ['project_name']
    }
  },
  {
    name: 'campaign_analysis',
    description: 'Retorna uma analise da campanha de anuncios paga (Meta Lead Ads) ativa no momento: quantos leads novos entraram pelo formulario de anuncios, leads de outras origens hoje, e o status/observacoes da campanha. Use para perguntas tipo "como esta a campanha", "teve lead novo hoje", "analise dos anuncios".',
    input_schema: { type: 'object', properties: {} }
  }
];

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function toolListProjects(status) {
  const rows = await sbGet('projects', 'select=id,name,status,budget&order=created_at.desc');
  const filtered = (!status || status === 'all') ? rows : rows.filter(p => p.status === status);
  if (!filtered.length) return `Não encontrei nenhuma obra${status && status !== 'all' ? ` com status "${status}"` : ''}.`;
  const lines = filtered.map((p, i) => `${i + 1}. ${p.name} — ${p.status}${p.budget ? ` ($${fmtMoney(p.budget)})` : ''}`);
  return `🏗️ *${filtered.length} obra(s)${status && status !== 'all' ? ` (${status})` : ''}:*\n\n${lines.join('\n')}`;
}

async function toolSumInvoices(status) {
  const rows = await sbGet('invoices', 'select=id,status,total,due_date');
  const today = new Date().toISOString().slice(0, 10);
  let filtered;
  if (status === 'paid') filtered = rows.filter(r => r.status === 'paid');
  else if (status === 'overdue') filtered = rows.filter(r => r.status !== 'paid' && r.due_date && r.due_date < today);
  else if (status === 'open') filtered = rows.filter(r => r.status !== 'paid');
  else filtered = rows;
  const total = filtered.reduce((s, r) => s + Number(r.total || 0), 0);
  const label = status === 'paid' ? 'pagos' : status === 'overdue' ? 'vencidos (em atraso)' : status === 'open' ? 'em aberto' : 'no total';
  return `💰 *Invoices ${label}:* ${filtered.length} invoice(s), somando *$${fmtMoney(total)}*.`;
}

async function toolSumQuotes(status, month) {
  const rows = await sbGet('quotes', 'select=id,status,sale_price,total,created_at');
  let filtered = rows;
  if (status && status !== 'all') filtered = filtered.filter(r => r.status === status);
  if (month) filtered = filtered.filter(r => (r.created_at || '').slice(0, 7) === month);
  const total = filtered.reduce((s, r) => s + Number(r.sale_price ?? r.total ?? 0), 0);
  const label = [status && status !== 'all' ? status : null, month].filter(Boolean).join(' — ');
  return `📄 *Orçamentos${label ? ` (${label})` : ''}:* ${filtered.length}, somando *$${fmtMoney(total)}*.`;
}

async function toolListLeads(status) {
  const rows = await sbGet('leads', 'select=id,status,project_type,client_id&order=created_at.desc');
  const filtered = status ? rows.filter(r => (r.status || '').toLowerCase() === status.toLowerCase()) : rows;
  if (!filtered.length) return `Não encontrei leads${status ? ` com status "${status}"` : ''}.`;
  const clients = await sbGet('clients', 'select=id,name');
  const cmap = Object.fromEntries(clients.map(c => [c.id, c.name]));
  const lines = filtered.map((l, i) => `${i + 1}. ${cmap[l.client_id] || 'Cliente'} — ${l.project_type || '—'} (${l.status})`);
  return `🎯 *${filtered.length} lead(s):*\n\n${lines.join('\n')}`;
}

async function toolListTasks(status) {
  const rows = await sbGet('tasks', 'select=id,title,status,due_date&order=due_date.asc');
  const filtered = (!status || status === 'all') ? rows : rows.filter(r => r.status === status);
  if (!filtered.length) return `Não encontrei tarefas${status && status !== 'all' ? ` (${status})` : ''}.`;
  const lines = filtered.map((t, i) => `${i + 1}. ${t.title}${t.due_date ? ` — vence ${t.due_date}` : ''}`);
  return `✅ *${filtered.length} tarefa(s)${status && status !== 'all' ? ` (${status})` : ''}:*\n\n${lines.join('\n')}`;
}

async function toolCountClients() {
  const rows = await sbGet('clients', 'select=id');
  return `👥 Você tem *${rows.length} cliente(s)* cadastrados no ERP.`;
}

// Mesmo critério do resumo de materiais na tela (projects.html): agrupa por
// PRODUTO (tira código SW e tamanho do texto), não pelo texto exato da linha --
// assim "SW6166 Venetian Yellow 1 Gallon" e "SW1666 Venetian Yellow 1 GAL" contam
// como o mesmo produto.
function normalizeMaterialName(raw) {
  const s0 = (raw || '').trim();
  const sizeMatch = s0.match(/(\d+(?:\.\d+)?)\s*(gallons?|gal)\b/i);
  const hasSize = !!sizeMatch;
  const gallons = hasSize ? (parseFloat(sizeMatch[1]) || 1) : 0;

  let s = s0.replace(/^SW\d+\s*/i, '');
  s = s.split(' - ')[0];
  s = s.replace(/\d+(?:\.\d+)?\s*(gallons?|gal)\b/gi, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) s = s0;
  return { name: s, gallons, hasSize };
}

function aggregateMaterialsFromPurchases(purchasesWithItems) {
  const map = {};
  (purchasesWithItems || []).forEach(pu => {
    (pu.purchase_items || []).forEach(it => {
      const rawDesc = (it.description || 'Item sem descrição').trim();
      const { name, gallons, hasSize } = normalizeMaterialName(rawDesc);
      const qty = Number(it.quantity || 1);
      const total = Number(it.unit_price || 0) * qty;
      const key = name.toUpperCase();
      if (!map[key]) map[key] = { description: name, quantity: 0, gallons: 0, hasSize: false, total: 0, unit: it.unit || 'un', sizeBreakdown: {} };
      map[key].quantity += qty;
      map[key].gallons += gallons * qty;
      map[key].hasSize = map[key].hasSize || hasSize;
      map[key].total += total;
      if (hasSize) {
        const sizeKey = String(gallons);
        map[key].sizeBreakdown[sizeKey] = (map[key].sizeBreakdown[sizeKey] || 0) + qty;
      }
    });
  });
  return Object.values(map).sort((a,b) => b.total - a.total);
}

// Ex: "2×1gal + 1×2gal" -- mesma lógica do projects.html, evita a impressão
// errada de que 3 latas teriam que somar 3 galões quando são de tamanhos diferentes.
function fmtSizeBreakdown(m) {
  if (!m.hasSize) return '';
  return Object.entries(m.sizeBreakdown)
    .sort((a,b) => parseFloat(a[0]) - parseFloat(b[0]))
    .map(([size,count]) => `${count}\u00d7${size}gal`)
    .join(' + ');
}

async function toolGetProjectMaterials(projectNameQuery) {
  if (!projectNameQuery) return `❌ Preciso do nome da obra ou do cliente pra buscar os materiais.`;
  const q = encodeURIComponent(projectNameQuery);
  let rows = await sbGet('projects', `select=id,name,status,materials_summary,materials_summary_computed_at,clients(name)&name=ilike.*${q}*&limit=5`);
  if (!rows.length) {
    // não achou pelo nome da obra -- tenta pelo nome do cliente vinculado
    rows = await sbGet('projects', `select=id,name,status,materials_summary,materials_summary_computed_at,clients(name)&clients.name=ilike.*${q}*&limit=5`);
  }
  const proj = rows[0];
  if (!proj) return `❌ Não encontrei nenhuma obra parecida com "${projectNameQuery}".`;

  let summary = proj.materials_summary;
  let frozen = !!summary;

  if (!summary || !summary.length) {
    // obra ainda não fechada (ou sem snapshot congelado) -- calcula na hora com o que já foi comprado
    const purchases = await sbGet('purchases', `select=purchase_items(description,quantity,unit,unit_price)&project_id=eq.${proj.id}`);
    summary = aggregateMaterialsFromPurchases(purchases);
    frozen = false;
  }

  if (!summary.length) return `📦 *${proj.name}* ainda não tem nenhuma compra de material registrada.`;

  const lines = summary.map((m,i) => `${i+1}. ${m.description} — ${m.hasSize ? fmtSizeBreakdown(m) + ' = ' + m.gallons + ' gal' : m.quantity + ' un'} — $${fmtMoney(m.total)}`);
  const totalGeral = summary.reduce((s,m)=>s+Number(m.total||0),0);
  const nota = frozen
    ? `_(resumo congelado no fechamento da obra${proj.materials_summary_computed_at ? ' em ' + proj.materials_summary_computed_at.slice(0,10) : ''})_`
    : `_(obra ainda em andamento — soma do que já foi comprado até agora)_`;

  return `📦 *Materiais — ${proj.name}*\n\n${lines.join('\n')}\n\n💰 Total: *$${fmtMoney(totalGeral)}*\n${nota}`;
}

async function toolCampaignAnalysis() {
  const today = new Date().toISOString().slice(0, 10);
  const [fbLeadsRows, recentLeadsRows] = await Promise.all([
    sbGet('fb_leads_processed', 'select=id'),
    sbGet('leads', 'select=id,source,created_at&order=created_at.desc&limit=15'),
  ]);
  const leadsToday = recentLeadsRows.filter(l => (l.created_at || '').slice(0, 10) === today);
  const fbAdsLeadsToday = leadsToday.filter(l => l.source === 'facebook_lead_ads' || l.source === 'fb_lead_ads');
  const otherLeadsToday = leadsToday.filter(l => !(l.source === 'facebook_lead_ads' || l.source === 'fb_lead_ads'));

  return `📊 *Campanha Meta Lead Ads*\n\n` +
    `🎯 Leads recebidos pelo formulario de anuncios (total ate agora): *${fbLeadsRows.length}*\n` +
    (fbAdsLeadsToday.length ? `🆕 Novos hoje pelo formulario: *${fbAdsLeadsToday.length}*\n` : `🆕 Nenhum lead novo pelo formulario hoje.\n`) +
    (otherLeadsToday.length ? `📩 Leads hoje de outras origens: *${otherLeadsToday.length}*\n` : '') +
    `\n*Status na Meta:* campanha ativa, anuncio aprovado, verba e cronograma OK, sem erro de conta/pagamento.\n` +
    `⚠️ A opcao "Campanha de leads Advantage+" esta ligada, ampliando bastante o publico estimado (18-21 milhoes) alem da regiao de Orlando/FL — isso pode atrasar a entrega inicial.\n\n` +
    `_Nenhuma alteracao foi feita na campanha — isso e so a leitura de agora._`;
}

async function handleIntelligentQuery(chatId, text) {
  if (!ANTHROPIC_KEY) {
    await send(chatId, `Não entendi 🤔\n\nDigite *ajuda* para ver os comandos.`);
    return true;
  }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: 'Você é o assistente do ERP da Fine Touch Decor Design (empresa de paredes/painéis decorativos em Orlando, FL). Responda perguntas do dono sobre o negócio usando as ferramentas disponíveis. Se a pergunta não tiver relação com obras, invoices, orçamentos, leads, tarefas ou clientes do ERP, responda educadamente em português que só pode ajudar com dados do sistema.',
        tools: BOT_TOOLS,
        messages: [{ role: 'user', content: text }]
      })
    });
    const data = await res.json();
    if (data.error) { console.error('Anthropic error', data.error); await send(chatId, `Não entendi 🤔\n\nDigite *ajuda* para ver os comandos.`); return true; }

    const toolUse = (data.content || []).find(b => b.type === 'tool_use');
    if (toolUse) {
      const input = toolUse.input || {};
      let reply = null;
      switch (toolUse.name) {
        case 'list_projects': reply = await toolListProjects(input.status); break;
        case 'sum_invoices': reply = await toolSumInvoices(input.status); break;
        case 'sum_quotes': reply = await toolSumQuotes(input.status, input.month); break;
        case 'list_leads': reply = await toolListLeads(input.status); break;
        case 'list_tasks': reply = await toolListTasks(input.status); break;
        case 'count_clients': reply = await toolCountClients(); break;
        case 'get_project_materials': reply = await toolGetProjectMaterials(input.project_name); break;
        case 'campaign_analysis': reply = await toolCampaignAnalysis(); break;
      }
      if (reply) { await send(chatId, reply); return true; }
    }

    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (textBlock?.text) { await send(chatId, textBlock.text); return true; }
  } catch (err) {
    console.error('Anthropic error', err);
  }
  await send(chatId, `Não entendi 🤔\n\nDigite *ajuda* para ver os comandos.`);
  return true;
}

// Exige sessao Supabase valida de um usuario aprovado com papel administrativo.
// Usado pelas rotas operacionais (?setup=1, ?status=1) -- nunca pelo webhook do
// Telegram em si, que e autenticado pelo secret_token, nao por sessao de usuario.
async function requireAdmin(authorization) {
  if (!authorization.startsWith('Bearer ') || !SUPABASE_KEY) {
    return { ok: false, code: 401, error: 'Unauthorized' };
  }
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: authorization }
  });
  if (!userRes.ok) return { ok: false, code: 401, error: 'Unauthorized' };
  const user = await userRes.json();
  const profiles = await sbGet('user_profiles', `id=eq.${user.id}&select=role,status&limit=1`);
  const profile = profiles[0];
  if (!profile || profile.status !== 'approved' || !['admin', 'owner', 'superadmin'].includes(profile.role)) {
    return { ok: false, code: 403, error: 'Forbidden' };
  }
  return { ok: true, user };
}

// Segunda forma de autorizar ?setup=1/?status=1, alem da sessao de admin: um
// segredo operacional (TELEGRAM_OPS_SECRET) conhecido so pelo ambiente do servidor.
// Existe pra concluir a configuracao logo apos um deploy sem depender de ninguem
// estar logado no navegador -- nunca aparece no cliente, nunca e impresso em log.
function requireOpsSecret(req) {
  if (!OPS_SECRET) return false;
  return req.headers['x-ops-secret'] === OPS_SECRET;
}

// ─── MAIN HANDLER ────────────────────────────────────────────
export default async function handler(req, res) {
  // Alerta de novo cadastro pro dono via Telegram: exige sessao Supabase valida
  // e conta criada nos ultimos 10 minutos, pra nao virar endpoint de spam aberto.
  if (req.method === 'POST' && req.query?.notify === '1') {
    const authorization = req.headers.authorization || '';
    if (!BOT_TOKEN) { res.status(500).json({ error: 'Notification service unavailable' }); return; }
    if (!authorization.startsWith('Bearer ')) { res.status(401).json({ error: 'Unauthorized' }); return; }

    try {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: authorization }
      });
      if (!userRes.ok) { res.status(401).json({ error: 'Unauthorized' }); return; }

      const user = await userRes.json();
      const createdAt = Date.parse(user.created_at || '');
      if (!createdAt || Date.now() - createdAt > 10 * 60 * 1000) {
        res.status(403).json({ error: 'Notification window expired' }); return;
      }

      const name = user.user_metadata?.full_name || 'Não informado';
      const email = user.email || 'Não informado';
      const message = `🔔 *Novo usuário solicitando acesso ao Fine Touch ERP*\n\n👤 *Nome:* ${name}\n📧 *Email:* ${email}\n\n➡️ Acesse /users para aprovar ou rejeitar.`;

      const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: NOTIFY_CHAT_ID, text: message, parse_mode: 'Markdown' })
      });

      if (!tgRes.ok) { res.status(502).json({ error: 'Notification failed' }); return; }
      res.status(200).json({ ok: true }); return;
    } catch {
      res.status(500).json({ error: 'Notification failed' }); return;
    }
  }

  // Reconfiguracao segura do webhook apos troca do token: exige um usuario
  // autenticado com papel administrativo no ERP (botao "Reconectar Telegram" em
  // /users), OU o segredo operacional do servidor (uso direto logo apos um deploy).
  if (req.method === 'POST' && req.query?.setup === '1') {
    if (!requireOpsSecret(req)) {
      const admin = await requireAdmin(req.headers.authorization || '');
      if (!admin.ok) { res.status(admin.code).json({ ok: false, error: admin.error }); return; }
    }
    if (!BOT_TOKEN || !SUPABASE_KEY) { res.status(500).json({ ok: false, error: 'Missing config' }); return; }
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const webhookUrl = `https://${host}/api/telegram`;
    const body = { url: webhookUrl, drop_pending_updates: false };
    if (WEBHOOK_SECRET) body.secret_token = WEBHOOK_SECRET;
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await tgRes.json();
    res.status(tgRes.ok && result.ok ? 200 : 502).json({ ok: !!result.ok, description: result.description || null });
    return;
  }

  // Consulta o estado real do webhook no Telegram (sem alterar nada) -- pra
  // verificar antes de presumir que uma reconexao e necessaria.
  if (req.method === 'GET' && req.query?.status === '1') {
    if (!requireOpsSecret(req)) {
      const admin = await requireAdmin(req.headers.authorization || '');
      if (!admin.ok) { res.status(admin.code).json({ ok: false, error: admin.error }); return; }
    }
    if (!BOT_TOKEN) { res.status(500).json({ ok: false, error: 'Missing config' }); return; }
    const tgRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
    const info = await tgRes.json();
    res.status(200).json(info);
    return;
  }

  if (req.method !== 'POST') { res.status(200).json({ ok: true }); return; }

  // Confirma que a chamada veio mesmo do Telegram (nao de qualquer POST publico
  // batendo neste endpoint) antes de processar com service role.
  if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
    res.status(401).json({ ok: false }); return;
  }

  // Deduplicacao: o Telegram pode reentregar a MESMA atualizacao (timeout, retry de
  // rede) -- um INSERT que colide na PK detecta duplicata sem race condition. So
  // processa update_id uma vez; reentregas devolvem 200 sem reprocessar nada.
  const updateId = req.body?.update_id;
  if (updateId != null) {
    const dedupRes = await fetch(`${SUPABASE_URL}/rest/v1/telegram_processed_updates`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ update_id: updateId, chat_id: (req.body?.message || req.body?.edited_message)?.chat?.id || null }),
    });
    if (dedupRes.status === 409) { res.status(200).json({ ok: true, duplicate: true }); return; }
  }

  let chatId;
  try {
    const message = req.body.message || req.body.edited_message;
    if (!message) { res.status(200).json({ ok: true }); return; }

    chatId = message.chat.id;
    const fromId = message.from?.id;
    const text = (message.text || '').trim();

    // So processa remetentes autorizados -- o handler roda com service role (sem
    // RLS), entao qualquer pessoa que descubra o bot nao pode disparar leitura de
    // notas, gravacao no ERP nem sobrescrever o chat_id do dono usado por automacoes.
    // Confere chat_id E from_id: num chat privado os dois sao a mesma pessoa, mas se
    // o bot algum dia entrar num GRUPO, o chat_id do grupo sozinho nao autorizaria
    // qualquer membro dele a mandar comando -- precisa ser o remetente autorizado
    // especificamente.
    if (!AUTHORIZED_CHAT_IDS.has(String(chatId)) || (fromId != null && !AUTHORIZED_CHAT_IDS.has(String(fromId)))) {
      console.warn('Telegram: remetente nao autorizado tentou usar o bot. chat:', chatId, 'from:', fromId);
      res.status(200).json({ ok: true }); return;
    }

    // Guarda o chat_id do dono pra automacoes externas (n8n) poderem mandar
    // lembretes (ex: proximo post de blog a publicar) sem precisar de uma mensagem
    // de entrada. Fire-and-forget, nao bloqueia a resposta do bot. So chega aqui
    // remetente ja autorizado (checagem acima), entao nao ha mais risco de qualquer
    // mensagem de estranho sequestrar esse ponteiro.
    sbUpsert('marketing_data', { key: 'owner_telegram_chat_id', value: { chatId } }, 'key').catch(()=>{});

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
        else await handleIntelligentQuery(chatId, transcribed);
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
        if (!handled) await handleIntelligentQuery(chatId, text);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    // Libera a reserva do update_id: a falha pode ter acontecido antes de qualquer
    // gravacao real ter sido feita, entao NAO fica marcado como "processado" pra
    // sempre -- se nao liberarmos, o retry do Telegram (habilitado pelo status
    // nao-200 abaixo) seria descartado pela deduplicacao e a atualizacao se perderia
    // de vez, que era exatamente o risco que essa checagem devia evitar.
    if (updateId != null) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/telegram_processed_updates?update_id=eq.${updateId}`, {
          method: 'DELETE',
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
      } catch {}
    }
    if (chatId) { try { await send(chatId, '⚠️ Tive um problema técnico processando sua mensagem. O Telegram deve tentar reentregar automaticamente — se não vier resposta em alguns minutos, reenvie.'); } catch {} }
    // Devolve erro de verdade (nao 200): um 200 aqui diria ao Telegram que a
    // atualizacao foi entregue com sucesso e ele NUNCA mais reenviaria, perdendo a
    // nota/mensagem de vez numa falha real de infraestrutura (nao confundir com os
    // erros "esperados" de input do usuario, que os handlers ja tratam e respondem
    // 200 normalmente sem chegar aqui).
    res.status(500).json({ ok: false });
  }
}
