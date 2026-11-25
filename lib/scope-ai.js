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

const RULES = `- Use ONLY facts present in the notes. Never invent prices, measurements, brands, materials, colors, quantities or timelines. If there are no dimensions, return an empty dimensions list.
- Keep measurements exactly as given (convert nothing).
- Each "scope" bullet is one concrete action, one sentence, no marketing fluff.
- Expand the notes into the usual professional steps ONLY when implied by the work (surface preparation, precision cutting, finishing, final touch-ups). Do not add services the notes do not imply (no electrical, paint, removal or LED unless mentioned).
- "included" is one short sentence listing what the price covers, based on the notes.
- "title": short service name, no numbering.
- Follow the extra instruction if given (shorter, more premium...), without breaking the rules above.
Always answer by calling the tool.`;

const SYSTEM_PT = `Voce organiza as anotacoes soltas do dono da Fine Touch Decor & Design (acabamentos decorativos em Orlando, Florida: accent walls, paineis ripados de PVC e madeira, meia parede/boiserie, iluminacao LED, rodameio, pintura) em um escopo estruturado, em PORTUGUES DO BRASIL claro e profissional. Cada bloco de anotacao e um servico. Este texto e so para o dono revisar; depois sera traduzido para o cliente.
Regras:
${RULES}
- Se pedirem "overview", escreva 2-3 frases em portugues resumindo os servicos em termos gerais, comecando com "A Fine Touch Decor & Design fornecera".`;

const SYSTEM_EN = `You turn an already-reviewed Brazilian Portuguese scope (title, measurements, scope bullets, included) into polished, professional US English that a homeowner will read, for proposals by Fine Touch Decor & Design, a premium interior finishes company in Orlando, Florida (accent walls, PVC and wood slat panels, wainscoting/picture-frame molding, LED lighting, crown molding, painting).
The Portuguese is the source of truth: translate and polish it faithfully, keeping the same number of services and the same facts.
Rules:
${RULES}
- Format measurements like: Main wall: 133" W x 136" H.
- Glossary: ripado = slat panels (PVC slat panels / wood slat panels); meia parede = half-wall wainscoting; moldura/boiserie = picture frame molding / wainscoting; rodape = baseboard; forro/teto = ceiling; fita de LED = LED strip; eletricista = electrical installation; hardboard branco = white hardboard panels; tinta Sherwin = Sherwin-Williams paint; massa corrida/lixar = filling and sanding; pintura = painting.
- If an overview in Portuguese is given, translate it into 2-3 natural sentences starting with "Fine Touch Decor & Design will provide".`;

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

async function callClaude(userText, system) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('ANTHROPIC_API_KEY ausente no ambiente'), { code: 500 });
  let lastErr = null;
  for (const model of MODELS) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 4000, system,
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
    const stage = body.stage === 'en' ? 'en' : 'pt';
    const raw = (Array.isArray(body.sections) ? body.sections : []).slice(0, MAX_SECTIONS);
    const sections = raw.map((s, i) => {
      const base = { id: clean(s.id || `s${i}`, 40), instruction: clean(s.instruction, 300) };
      if (stage === 'pt') return { ...base, pt: clean(s.pt, MAX_CHARS) };
      const list = a => (Array.isArray(a) ? a : []).map(x => clean(x, 400)).filter(Boolean);
      return { ...base, title: clean(s.title, 160), dimensions: list(s.dimensions), scope: list(s.scope), included: clean(s.included, 500) };
    }).filter(s => (stage === 'pt' ? s.pt : (s.title || s.scope.length)));
    if (!sections.length) return res.status(400).json({ ok: false, error: stage === 'pt' ? 'Escreva ao menos um servico em portugues.' : 'Nao ha servicos em portugues para traduzir.' });
    const overviewPt = clean(body.overviewPt, 900);
    const wantOverview = stage === 'pt' ? body.overview === true : !!overviewPt;

    const parts = [];
    if (body.client) parts.push(`Client: ${clean(body.client, 120)}`);
    if (body.project) parts.push(`Project: ${clean(body.project, 120)}`);
    if (stage === 'pt') parts.push(wantOverview ? 'Escreva tambem o overview.' : 'Nao escreva overview (devolva string vazia).');
    else parts.push(wantOverview ? `Translate this overview too: ${overviewPt}` : 'Do not write an overview (return an empty string).');
    const general = clean(body.instruction, 300);
    if (general) parts.push(`Extra instruction for all sections: ${general}`);
    sections.forEach(s => {
      const extra = s.instruction ? `\n(Extra instruction for this service: ${s.instruction})` : '';
      if (stage === 'pt') parts.push(`--- SERVICE id=${s.id} ---\n${s.pt}${extra}`);
      else parts.push(`--- SERVICE id=${s.id} ---\nTitle: ${s.title}\nMeasurements: ${s.dimensions.join('; ') || '(none)'}\nScope:\n${s.scope.map(x => '- ' + x).join('\n')}\nIncluded: ${s.included || '(none)'}${extra}`);
    });

    const { input, model } = await callClaude(parts.join('\n\n'), stage === 'pt' ? SYSTEM_PT : SYSTEM_EN);
    const out = (Array.isArray(input.sections) ? input.sections : []).map(s => ({
      id: clean(s.id, 40),
      title: clean(s.title, 160).replace(/^\d+[.)]\s*/, '').replace(/^-+\s*|\s*-+$/g, ''),
      dimensions: (Array.isArray(s.dimensions) ? s.dimensions : []).map(x => clean(x, 160)).filter(Boolean),
      scope: (Array.isArray(s.scope) ? s.scope : []).map(x => clean(x, 400)).filter(Boolean),
      included: clean(s.included, 500).replace(/^(Included|Incluido|Incluído):\s*/i, ''),
    }));
    return res.status(200).json({ ok: true, stage, model, overview: wantOverview ? clean(input.overview, 900) : '', sections: out });
  } catch (e) {
    return res.status(e.code === 500 ? 500 : 502).json({ ok: false, error: String(e.message || e).slice(0, 300) });
  }
}

module.exports = { handleTask };
