// Assistente de escopo da proposta: recebe topicos em portugues e devolve o texto em ingles
// no formato dos "cartoes" de servico (titulo, medidas, escopo, incluido). Nunca grava nada:
// o navegador mostra uma previa editavel e o usuario decide o que aplicar.
// Mesmo arquivo de funcao do marketing-sync (limite de 12 funcoes da Vercel Hobby):
// rota POST /api/marketing-sync?task=scope-generate
'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jpbpzlpvhdwgbmljqfyd.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const ANON_KEY = 'sb_publishable_l6x3A2YiBL0Pc7huB-QejA_d2RXKL59';
const MODELS = ['claude-sonnet-5-5', 'claude-haiku-4-5-20251001'];
const MAX_SECTIONS = 12;
const MAX_CHARS = 6000;

const SYSTEM = `You write the scope-of-work section of client proposals for Fine Touch Decor & Design, a premium interior finishes company in Orlando, Florida (accent walls, PVC and wood slat panels, wainscoting/picture-frame molding, LED lighting, crown molding, painting).
The owner gives rough notes in Brazilian Portuguese, one block per service. Produce polished, professional US English that a homeowner will read.

Rules:
- Use ONLY facts present in the notes. Never invent prices, measurements, brands, materials, colors, quantities or timelines. If the notes give no dimensions, return an empty dimensions list.
- Keep measurements exactly as given (convert nothing). Format like: Main wall: 133" W x 136" H.
- Each "scope" bullet is one concrete action, starting with a verb or noun phrase, one sentence, no marketing fluff.
- A natural proposal expands the notes into the usual professional steps ONLY when they are implied by the work (e.g. surface preparation, precision cutting, finishing, final touch-ups). Do not add services the notes do not imply (no electrical, paint, removal or LED unless mentioned).
- "included" is one short sentence listing what the price covers, based on the notes: materials, labor, finishing, etc.
- "title": short, uppercase-style service name (e.g. "CUSTOM KITCHEN ISLAND - PVC SLAT PANELS & LED LIGHTING"). No numbering.
- Glossary: ripado = slat panels (PVC slat panels / wood slat panels); meia parede = half-wall wainscoting; accent wall = accent wall; moldura/boiserie = picture frame molding / wainscoting; rodape = baseboard; forro/teto = ceiling; fita de LED = LED strip; eletricista = electrical installation; hardboard branco = white hardboard panels; tinta Sherwin = Sherwin-Williams paint; massa corrida/lixar = filling and sanding; pintura = painting.
- Follow the extra instruction if given (e.g. shorter, more premium), without breaking the rules above.
- If asked for an overview, write 2-3 sentences for the proposal's "Project Scope" paragraph that summarize the services in general terms, starting with "Fine Touch Decor & Design will provide".
Always answer by calling the tool.`;

const TOOL = {
  name: 'return_scope',
  description: 'Return the polished English scope sections.',
  input_schema: {
    type: 'object',
    properties: {
      overview: { type: 'string', description: 'Project Scope paragraph; empty string if not requested.' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            dimensions: { type: 'array', items: { type: 'string' } },
            scope: { type: 'array', items: { type: 'string' } },
            included: { type: 'string' },
          },
          required: ['id', 'title', 'dimensions', 'scope', 'included'],
        },
      },
    },
    required: ['sections'],
  },
};

async function profileOf(authorization) {
  if (!String(authorization).startsWith('Bearer ')) return null;
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: authorization } });
  if (!u.ok) return null;
  const user = await u.json();
  const r = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${user.id}&select=role,status&limit=1`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  const p = r.ok ? await r.json() : [];
  return p && p[0] ? p[0] : null;
}
const isApproved = p => p && (p.status === 'approved' || p.role === 'admin');

async function callClaude(userText) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('ANTHROPIC_API_KEY ausente no ambiente'), { code: 500 });
  let lastErr = null;
  for (const model of MODELS) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 4000, system: SYSTEM,
        tools: [TOOL], tool_choice: { type: 'tool', name: 'return_scope' },
        messages: [{ role: 'user', content: userText }],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      const tu = (j.content || []).find(b => b.type === 'tool_use');
      if (tu && tu.input) return { input: tu.input, model };
      lastErr = new Error('A IA nao devolveu o formato esperado');
    } else {
      lastErr = new Error((j.error && j.error.message) || `Erro ${r.status} da Anthropic`);
    }
  }
  throw lastErr;
}

const clean = (s, n) => String(s == null ? '' : s).slice(0, n).trim();

async function handleTask(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST' });
    const p = await profileOf(req.headers.authorization || '');
    if (!isApproved(p)) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const sections = (Array.isArray(body.sections) ? body.sections : []).slice(0, MAX_SECTIONS)
      .map((s, i) => ({ id: clean(s.id || `s${i}`, 40), pt: clean(s.pt, MAX_CHARS), instruction: clean(s.instruction, 300) }))
      .filter(s => s.pt);
    if (!sections.length) return res.status(400).json({ ok: false, error: 'Escreva ao menos um servico em portugues.' });
    const wantOverview = body.overview === true;

    const parts = [];
    if (body.client) parts.push(`Client: ${clean(body.client, 120)}`);
    if (body.project) parts.push(`Project: ${clean(body.project, 120)}`);
    parts.push(wantOverview ? 'Also write the overview paragraph.' : 'Do not write an overview (return an empty string).');
    const general = clean(body.instruction, 300);
    if (general) parts.push(`Extra instruction for all sections: ${general}`);
    sections.forEach(s => {
      parts.push(`--- SERVICE id=${s.id} ---\n${s.pt}${s.instruction ? `\n(Extra instruction for this service: ${s.instruction})` : ''}`);
    });

    const { input, model } = await callClaude(parts.join('\n\n'));
    const out = (Array.isArray(input.sections) ? input.sections : []).map(s => ({
      id: clean(s.id, 40),
      title: clean(s.title, 160).replace(/^\d+[.)]\s*/, '').replace(/^-+\s*|\s*-+$/g, ''),
      dimensions: (Array.isArray(s.dimensions) ? s.dimensions : []).map(x => clean(x, 160)).filter(Boolean),
      scope: (Array.isArray(s.scope) ? s.scope : []).map(x => clean(x, 400)).filter(Boolean),
      included: clean(s.included, 500).replace(/^Included:\s*/i, ''),
    }));
    return res.status(200).json({ ok: true, model, overview: wantOverview ? clean(input.overview, 900) : '', sections: out });
  } catch (e) {
    return res.status(e.code === 500 ? 500 : 502).json({ ok: false, error: String(e.message || e).slice(0, 300) });
  }
}

module.exports = { handleTask };
