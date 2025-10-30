// index.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const sharp = require('sharp');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ======================= Pricing (USD per 1M tokens) =======================
const MODEL_PRICING = {
  'gpt-4o': {
    in: Number(process.env.PRICE_GPT4O_IN_PER_1M || 5),
    out: Number(process.env.PRICE_GPT4O_OUT_PER_1M || 15),
  },
  'gpt-4o-mini': {
    in: Number(process.env.PRICE_GPT4OMINI_IN_PER_1M || 0.15),
    out: Number(process.env.PRICE_GPT4OMINI_OUT_PER_1M || 0.60),
  },
};
const OPENAI_FREE_MODE = String(process.env.OPENAI_FREE_MODE || 'false') === 'true';
const ENRICH_INTERVALS = String(process.env.ENRICH_INTERVALS || 'true') === 'true';

// Track usage
const tracker = { totals:{}, byRoute:{}, byTier:{}, recent:[], savedJSON:[] };

function priceFor(model){ return MODEL_PRICING[model] || { in:0, out:0 }; }
function costFor(model, usage = {}) {
  const p = priceFor(model);
  const pt = Number(usage.prompt_tokens || 0);
  const ct = Number(usage.completion_tokens || 0);
  return (pt * p.in + ct * p.out) / 1_000_000;
}
function ensureBucket(obj,key,seed=null){
  if(!obj[key]) obj[key]=seed||{count:0,prompt:0,completion:0,total:0,cost:0};
  return obj[key];
}
function logUsage({ route, model, tier, usage, ms, meta }) {
  const { prompt_tokens=0, completion_tokens=0, total_tokens=0 } = usage || {};
  const cost = costFor(model, usage);

  const mt = ensureBucket(tracker.totals, model);
  mt.count++; mt.prompt+=prompt_tokens; mt.completion+=completion_tokens; mt.total+=total_tokens; mt.cost+=cost;

  const rt = ensureBucket(tracker.byRoute, route);
  rt.count++; rt.prompt+=prompt_tokens; rt.completion+=completion_tokens; rt.total+=total_tokens; rt.cost+=cost;

  const tt = ensureBucket(tracker.byTier, tier||'token');
  tt.count++; tt.prompt+=prompt_tokens; tt.completion+=completion_tokens; tt.total+=total_tokens; tt.cost+=cost;

  tracker.recent.push({ ts:new Date().toISOString(), route, tier, model, usage, cost, ms, meta });
  if (tracker.recent.length>50) tracker.recent.shift();

  const costStr = OPENAI_FREE_MODE ? 'free-quota' : `$${cost.toFixed(6)} (est, per 1M)`;
  console.log(
    [`📊 [${route}] ${model} (${tier||'token'})`,
     `⏱️ ${ms}ms`,
     `🧮 in:${prompt_tokens} out:${completion_tokens} total:${total_tokens}`,
     `💵 ${costStr}`,
     meta?.note?`— ${meta.note}`:''
    ].join(' | ')
  );
  if (total_tokens>4500) console.warn(`⚠️ High token usage on ${route}: ${total_tokens} tokens`);
}

// OpenAI wrapper
async function openAIChat({ route, model='gpt-4o', tier='token', payload, headers={}, meta }){
  const t0=Date.now();
  try{
    const response=await axios.post('https://api.openai.com/v1/chat/completions', payload, {
      headers:{ Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json',...headers }
    });
    const ms=Date.now()-t0;
    const usage=response.data?.usage||{prompt_tokens:0,completion_tokens:0,total_tokens:0};
    logUsage({ route, model, tier, usage, ms, meta });
    return response;
  }catch(err){
    const ms=Date.now()-t0;
    console.error(`❌ OpenAI error on ${route} after ${ms}ms:`, err.response?.data || err.message);
    throw err;
  }
}

// request id
app.use((req,res,next)=>{ req._rid=Math.random().toString(36).slice(2,10); req._t0=Date.now(); res.setHeader('X-Request-Id', req._rid); next(); });

// ======================= Helpers =======================

// ====== Compact Service Catalog (ID-coded => text on expansion) ======
const SERVICE_CATALOG = {
  1: "Engine oil & filter",
  2: "Tire rotation",
  3: "Cabin air filter",
  4: "Engine air filter",
  5: "Brake inspection",
  6: "Brake fluid replace/bleed",
  7: "Coolant / antifreeze service",
  8: "Transmission fluid service",
  9: "Spark plugs replacement",
  10: "Belts replace/inspect",
  11: "Battery",
  12: "Fuel filter replacement",
  13: "Differential / transfer case fluid",
  14: "Power steering fluid check/service",
  15: "Timing belt/chain replace/inspect",
};
const ALLOWED_SERVICE_IDS = Object.keys(SERVICE_CATALOG).map(n => Number(n));

// NOTE: also returns `id` so we can map label overrides by id reliably.
function expandCompactPlan(compact = []) {
  const toNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  return compact
    .filter(item => ALLOWED_SERVICE_IDS.includes(Number(item.id)))
    .map(item => {
      const p = String(item.pr || '').toLowerCase().trim();
      const priority =
        p === 'h' ? 'high' :
        p === 'm' ? 'medium' :
        p === 'l' ? 'low' : 'low';

      return {
        id: Number(item.id),
        text: SERVICE_CATALOG[item.id],
        priority,
        mileage: toNum(item.mi),
        time_months: toNum(item.mo),
        applies: !!Number(item.ap),
      };
    });
}

// ======================= VIN helpers (ISO 3779) =======================
function normalizeVin(str='') {
  const up = String(str).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return up.replace(/I/g, '1').replace(/[OQ]/g, '0');
}
function isValidVinBasic(vin=''){ return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin); }

const VIN_WEIGHTS = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
const VIN_MAP = (() => {
  const map = {};
  '0123456789'.split('').forEach((d,i)=>map[d]=i);
  Object.assign(map, {A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9});
  return map;
})();
function computeVinCheckDigit(vin){
  let sum=0;
  for(let i=0;i<17;i++){
    const ch=vin[i];
    const val = VIN_MAP[ch];
    if(val==null) return null;
    sum += val * VIN_WEIGHTS[i];
  }
  const rem = sum % 11;
  return rem===10 ? 'X' : String(rem);
}
function isValidVin(vin=''){
  if(!isValidVinBasic(vin)) return false;
  const check = computeVinCheckDigit(vin);
  return check === vin[8];
}
function tryAutoFixVin(vin) {
  if (vin.length !== 17) return { vin, fixed: false };
  const expectedCheck = computeVinCheckDigit(vin);
  if (expectedCheck && expectedCheck !== vin[8]) {
    const fixed = vin.slice(0,8) + expectedCheck + vin.slice(9);
    if (isValidVin(fixed)) return { vin: fixed, fixed: true, reason: 'check-digit corrected' };
  }
  const AMBIGUOUS_MAP = {
    '0': ['O','Q'], 'O': ['0'], 'Q': ['0'],
    '1': ['I','L'], 'I': ['1'], 'L': ['1'],
    '5': ['S'],     'S': ['5'],
    '8': ['B'],     'B': ['8'],
    '6': ['G'],     'G': ['6'],
    '2': ['Z'],     'Z': ['2','7'],
    '7': ['Z']
  };
  const chars = vin.split('');
  for (let i = 0; i < 17; i++) {
    const ch = chars[i];
    const alts = AMBIGUOUS_MAP[ch];
    if (!alts) continue;
    for (const alt of alts) {
      const candidate = [...chars];
      candidate[i] = alt;
      const candVin = candidate.join('');
      if (isValidVinBasic(candVin)) {
        const exp = computeVinCheckDigit(candVin);
        if (exp && exp === candVin[8]) return { vin: candVin, fixed: true, reason: `ambiguous swap @${i+1}: ${ch}->${alt}` };
      }
    }
  }
  return { vin, fixed: false };
}

// Persona
const getTorquePrompt = () => `
You are Torque — the in-app mechanic for TorqueTheMechanic. You are an automotive expert.
Speak like a helpful, confident technician. Never mention OpenAI or internal model names.
If asked “what are you,” answer: “I’m Torque, the mechanic assistant in this app. I diagnose issues, look up specs, and explain repairs with simple steps.”

When diagnosing, include a short section:
- Likely issues (most → least), bullet list.
- Quick checks (bullets, 1–5 items).
- If a spec is requested, give a safe range or note variations by engine/trim if uncertain.

Keep replies compact and practical. Use markdown bullets, not long paragraphs.
`.trim();

function summarizeVehicle(v={}){ if(!v||typeof v!=='object') return ''; const parts=[]; if(v.year) parts.push(String(v.year)); if(v.make) parts.push(String(v.make)); if(v.model) parts.push(String(v.model));
  const main=parts.join(' '); const extras=[ v.trim&&`Trim: ${v.trim}`, v.engine&&`Engine: ${v.engine}`, v.transmission&&`Trans: ${v.transmission}`, v.drive_type&&`Drive: ${v.drive_type}`, v.body_style&&`Body: ${v.body_style}`].filter(Boolean).join(' | ');
  return extras ? `${main} (${extras})` : main;
}
function vehicleSystemMessage(vehicle){
  const hasVehicle=vehicle&&vehicle.make&&vehicle.model; const summary=hasVehicle? summarizeVehicle(vehicle) : 'unknown';
  return `
VEHICLE CONTEXT:
- Default vehicle: ${summary || 'unknown'}.
- Assume questions refer to this vehicle unless the user clearly switches.

METADATA CONTRACT:
- At the very end of EVERY reply, append exactly one line:
  [[META: {"vehicle_used": <object-or-null>}]]
- Include fields you actually used (year, make, model, trim, engine, transmission, drive_type, body_style). If none, set null.
`.trim();
}

// Token controls + summary memory
const HISTORY_WINDOW_TURNS = 3;
const SUMMARY_EVERY_N_USER = 2;
const SUMMARY_MAX_TOKENS = 100;
const memoryStore = new Map();

function estimateTokenCount(messages){
  const joined=messages.map(m => {
    const c = (typeof m.content === 'string') ? m.content : JSON.stringify(m.content);
    return `${m.role}:${c}`;
  }).join('\n');
  return Math.round(joined.length/4);
}
function packWithSummary({ messages, summaryText, maxTurns }){
  const systems = messages.filter(m => m.role==='system');
  const convo   = messages.filter(m => m.role!=='system');
  const recent  = convo.slice(-maxTurns*2);
  const out = [...systems];
  if (summaryText && summaryText.trim()) {
    out.push({
      role: 'system',
      content: `CONVERSATION MEMORY (background only; do not quote):\n${summaryText.trim()}`
    });
  }
  return [...out, ...recent];
}
async function autosummarize(convoId, messages){
  const convo = messages.filter(m => m.role !== 'system');
  const text = convo.map(m => `${m.role.toUpperCase()}: ${typeof m.content==='string'?m.content:JSON.stringify(m.content)}`).join('\n');
  const payload = {
    model: 'gpt-4o-mini',
    messages: [
      { role:'system', content: 'Summarize the dialog into a compact, tool-usable memory. 4-6 bullets max. No fluff.' },
      { role:'user', content: text }
    ],
    temperature: 0.2,
    max_tokens: SUMMARY_MAX_TOKENS,
  };
  const resp = await openAIChat({
    route: '/chat#autosummary',
    model: 'gpt-4o-mini',
    tier: 'token',
    payload,
    meta: { note:`autosummarize(${SUMMARY_MAX_TOKENS})` },
  });
  return resp.data?.choices?.[0]?.message?.content?.trim() || '';
}
function sanitizeAssistantText(s, maxBlock = 20000){
  if (!s || typeof s !== 'string') return s;
  const replacer = (tag) => {
    const re = new RegExp("```"+tag+"\\s*([\\s\\S]*?)```","g");
    return s.replace(re, (_m, inner) => {
      let clean = String(inner || '');
      if (tag === 'svg') {
        clean = clean.replace(/<!--[\s\S]*?-->/g, '').replace(/\s{2,}/g,' ').trim();
      }
      if (clean.length > maxBlock) clean = clean.slice(0, maxBlock);
      return "```"+tag+"\n"+clean+"\n```";
    });
  };
  return replacer('svg').replace(/```diagram-json\s*([\s\S]*?)```/g, (_m, inner) => {
    let clean = String(inner || '');
    if (clean.length > maxBlock) clean = clean.slice(0, maxBlock);
    return "```diagram-json\n"+clean+"\n```";
  });
}

// Image optimizer (VIN OCR)
async function optimizeImageBase64(base64DataUrlOrRaw, opts={}){
  const raw = base64DataUrlOrRaw.startsWith('data:image/') ?
    base64DataUrlOrRaw.split(',')[1] : base64DataUrlOrRaw;
  const input = Buffer.from(raw, 'base64');

  const {
    maxWidth = 900,
    quality = 45,
    toGrayscale = true,
    normalize = true,
  } = opts;

  let pipeline = sharp(input).rotate();
  const meta = await pipeline.metadata();
  if ((meta.width||0) > maxWidth) pipeline = pipeline.resize({ width: maxWidth });
  if (toGrayscale) pipeline = pipeline.grayscale();
  if (normalize) pipeline = pipeline.normalize();

  const out = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

// Spec folder / normalizer
function foldVehicleSpecs(raw={}){
  const v={...raw};
  const hpCandidate = v.horsepower_hp ?? v.horsepower ?? (typeof v.hp==='string' ? v.hp.replace(/[^\d.]/g,'') : v.hp);
  if(hpCandidate!=null && hpCandidate!=='') v.hp = Number(String(hpCandidate).replace(/[^\d.]/g,''));
  const gvwCandidate = v.gvw_lbs ?? v.gvw ?? v.gross_vehicle_weight_rating ?? v.gvwr ?? (typeof v.gvw==='string' ? v.gvw.replace(/[^\d.]/g,'') : v.gvw);
  if(gvwCandidate!=null && gvwCandidate!=='') v.gvw = Number(String(gvwCandidate).replace(/[^\d.]/g,''));
  const num=(x)=>{ if(x==null||x==='') return; const n=Number(String(x).replace(/[^\d.]/g,'')); return Number.isFinite(n)?n:undefined; };
  const c=num(v.mpg_city ?? v.city_mpg ?? v.city ?? v?.mpg?.city);
  const h=num(v.mpg_highway ?? v.hwy_mpg ?? v.highway ?? v?.mpg?.highway);
  const comb=num(v.mpg_combined ?? v.combined_mpg ?? v.combined);
  if(c&&h) v.mpg=`${c} city / ${h} highway`;
  else if(!v.mpg && comb) v.mpg=`${comb} combined`;
  else if(typeof v.mpg==='object' && v.mpg){ const cc=num(v.mpg.city); const hh=num(v.mpg.highway); if(cc&&hh) v.mpg=`${cc} city / ${hh} highway`; }
  if(v.vin) v.vin = normalizeVin(v.vin);
  if(v.transmission && /auto/i.test(v.transmission)) v.transmission='Automatic';
  if(v.transmission && /man/i.test(v.transmission)) v.transmission='Manual';
  return v;
}

// ---------------- OpenAI VIN text decode ----------------
async function decodeVinTextWithOpenAI(vin, model='gpt-4o') {
  const payload = {
    model,
    messages: [
      { role:'system', content: `
You are a meticulous VIN decoder.
Return ONLY a single JSON object (no markdown).
If uncertain about any spec, use null — do not guess.
Use these exact keys:
vin, year, make, model, trim, engine, transmission, drive_type, body_style, fuel_type,
horsepower_hp, gvw_lbs, mpg_city, mpg_highway, mpg_combined.
`.trim() },
      { role:'user', content: `VIN: ${vin}\nDecode fully and include the fields above.` },
    ],
    temperature: 0.0,
    max_tokens: 600,
  };

  const response = await openAIChat({
    route: '/decode-vin-text',
    model,
    tier: 'token',
    payload,
    meta: { note:`VIN ${vin}` },
  });

  const raw = response.data.choices?.[0]?.message?.content?.trim() || '{}';
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { const m = raw.match(/\{[\s\S]*\}$/); parsed = m ? JSON.parse(m[0]) : {}; }

  const folded = foldVehicleSpecs(parsed);
  folded.vin = vin;

  tracker.savedJSON.push({ ts:new Date().toISOString(), route:'/decode-vin-text', vin, json:folded });
  if(tracker.savedJSON.length>100) tracker.savedJSON.shift();

  return { vehicle: folded, usage: response.data.usage };
}

// ---------- Serviceability / timing hints ----------
async function getServiceabilityHints(vehicle) {
  const vtxt = [
    vehicle?.year, vehicle?.make, vehicle?.model,
    vehicle?.trim ? `trim:${vehicle.trim}` : null,
    vehicle?.engine ? `engine:${vehicle.engine}` : null,
    vehicle?.transmission ? `trans:${vehicle.transmission}` : null,
  ].filter(Boolean).join(' ');

  const payload = {
    model: 'gpt-4o-mini',
    messages: [
      { role:'system', content: `
Return ONLY strict JSON with these exact keys:
{
  "fuel_filter_serviceable": true | false | null,
  "timing_drive": "belt" | "chain" | null,
  "timing_service": "replace" | "inspect" | null
}
Rules:
- If most trims/engines for this vehicle have an in-tank non-serviceable fuel filter, set fuel_filter_serviceable=false.
- If unclear, set null (do NOT guess).
- "timing_drive" is the main timing mechanism.
- If timing is belt: timing_service="replace".
- If timing is chain and manufacturer calls for periodic inspection: timing_service="inspect".
- If timing is chain and no periodic service is recommended: timing_service=null.
`.trim() },
      { role:'user', content: `Vehicle: ${vtxt}` },
    ],
    temperature: 0.0,
    max_tokens: 120,
  };

  try {
    const resp = await openAIChat({
      route: '/serviceability-hints',
      model: 'gpt-4o-mini',
      tier: 'token',
      payload,
      meta: { note: `hints for ${vtxt}` },
    });

    const raw = resp.data?.choices?.[0]?.message?.content?.trim() || '{}';
    let data;
    try { data = JSON.parse(raw); }
    catch { const m = raw.match(/\{[\s\S]*\}$/); data = m ? JSON.parse(m[0]) : {}; }

    return {
      fuel_filter_serviceable: typeof data.fuel_filter_serviceable === 'boolean' ? data.fuel_filter_serviceable : null,
      timing_drive: (data.timing_drive === 'belt' || data.timing_drive === 'chain') ? data.timing_drive : null,
      timing_service: (data.timing_service === 'replace' || data.timing_service === 'inspect') ? data.timing_service : null,
    };
  } catch {
    return { fuel_filter_serviceable: null, timing_drive: null, timing_service: null };
  }
}

// ---------- NEW: Cheap interval enricher (per-vehicle, cached) ----------
const intervalCache = new Map(); // key = JSON.stringify({year,make,model,trim,engine,trans})

function vehicleKey(v) {
  const k = {
    year: v?.year||null,
    make: v?.make||null,
    model: v?.model||null,
    trim: v?.trim||null,
    engine: v?.engine||null,
    transmission: v?.transmission||null,
  };
  return JSON.stringify(k);
}

// sanity clamps so GPT can’t go wild
function clampReasonable(id, mi, mo) {
  const n = (x)=> Number.isFinite(Number(x)) ? Number(x) : null;
  let miles = n(mi), months = n(mo);

  const clamp = (lo, x, hi) => x==null?null:Math.max(lo, Math.min(x, hi));

  switch (id) {
    case 1: // oil & filter
      miles = clamp(2500, miles, 15000);
      months = clamp(3, months, 24);
      break;
    case 2: // tire rotation
      miles = clamp(3000, miles, 15000);
      months = clamp(3, months, 24);
      break;
    case 3: // cabin
    case 4: // engine air
      miles = clamp(8000, miles, 45000);
      months = clamp(6, months, 48);
      break;
    case 6: // brake fluid
      miles = clamp(15000, miles, 80000);
      months = clamp(18, months, 72);
      break;
    case 7: // coolant
      miles = clamp(30000, miles, 150000);
      months = clamp(24, months, 120);
      break;
    case 8: // transmission
      miles = clamp(30000, miles, 150000);
      months = clamp(24, months, 120);
      break;
    case 9: // plugs
      miles = clamp(30000, miles, 150000);
      months = clamp(24, months, 144);
      break;
    case 15: // timing belt/chain (we override later but keep sane)
      miles = clamp(60000, miles, 120000);
      months = clamp(48, months, 120);
      break;
    default:
      // general clamp
      miles = miles==null?null:clamp(3000, miles, 200000);
      months = months==null?null:clamp(3, months, 180);
  }
  return { mi: miles, mo: months };
}

async function enrichRecommendedIntervals(vehicle, compactPlan) {
  if (!ENRICH_INTERVALS) return { enriched: null, usage: null, fromCache: false };
  const key = vehicleKey(vehicle);
  if (intervalCache.has(key)) return { enriched: intervalCache.get(key), usage: null, fromCache: true };

  // Build minimal payload: only ap=1 items, with names, and the current mi/mo (so the model only fills holes)
  const items = compactPlan
    .filter(x => Number(x.ap) === 1)
    .map(x => ({
      id: x.id,
      name: SERVICE_CATALOG[x.id],
      mi: x.mi ?? null,
      mo: x.mo ?? null
    }));

  const vtxt = [
    vehicle?.year, vehicle?.make, vehicle?.model,
    vehicle?.trim ? `trim:${vehicle.trim}` : null,
    vehicle?.engine ? `engine:${vehicle.engine}` : null,
    vehicle?.transmission ? `trans:${vehicle.transmission}` : null,
  ].filter(Boolean).join(' ');

  const system = `
You are a service-schedule assistant. Return STRICT JSON: {"updates":[...]}.
For each input item, if miles ("mi") or months ("mo") is null or clearly unrealistic,
fill with a manufacturer-style recommended interval for THIS vehicle.
DO NOT change items that already look reasonable.
Keep values integers or null. No markdown, no prose.

For each updated item, output:
{"id": <number>, "mi": <int|null>, "mo": <int|null>, "confidence": 0.0-1.0, "note": "<<=40 chars>"}.

Rules:
- Prefer what's typical for ${vtxt}. If unclear, pick conservative mainstream values.
- Never invent crazy values (e.g., oil 120000 mi).
- If no recommendation exists (sealed, lifetime), set both mi and mo to null and skip the update.
- Do not change applicability.
`.trim();

  const user = `
Vehicle: ${vtxt}
Items (update only where helpful):
${JSON.stringify({ items }, null, 2)}
`.trim();

  const payload = {
    model: 'gpt-4o-mini',
    messages: [
      { role:'system', content: system },
      { role:'user', content: user },
    ],
    temperature: 0.1,
    max_tokens: 350,
  };

  try {
    const resp = await openAIChat({
      route: '/interval-enricher',
      model: 'gpt-4o-mini',
      tier: 'token',
      payload,
      meta: { note:`vehicle=${vtxt}` },
    });

    const raw = resp.data?.choices?.[0]?.message?.content?.trim() || '{}';
    let parsed = {};
    try { parsed = JSON.parse(raw); }
    catch { const m = raw.match(/\{[\s\S]*\}$/); parsed = m ? JSON.parse(m[0]) : {}; }

    const updates = Array.isArray(parsed?.updates) ? parsed.updates : [];

    // Normalize & clamp
    const byId = {};
    for (const u of updates) {
      const id = Number(u?.id);
      if (!ALLOWED_SERVICE_IDS.includes(id)) continue;
      const clamped = clampReasonable(id, u?.mi, u?.mo);
      byId[id] = {
        mi: clamped.mi,
        mo: clamped.mo,
        confidence: Math.min(1, Math.max(0, Number(u?.confidence || 0))),
        note: (typeof u?.note === 'string' ? u.note.slice(0, 40) : '')
      };
    }

    intervalCache.set(key, byId);
    return { enriched: byId, usage: resp.data?.usage || null, fromCache: false };
  } catch (e) {
    console.warn('Interval enricher failed; continuing without:', e?.message || e);
    return { enriched: null, usage: null, fromCache: false };
  }
}

// ======================= Routes =======================
app.get('/pricing', (req, res) => {
  res.json({ per_1M_tokens: MODEL_PRICING, free_mode: OPENAI_FREE_MODE, enrich_intervals: ENRICH_INTERVALS });
});

app.get('/metrics', (req, res) => {
  res.json({
    totals: tracker.totals,
    byRoute: tracker.byRoute,
    byTier: tracker.byTier,
    recent: tracker.recent.slice(-50),
    pricing_per_1M: MODEL_PRICING,
    savedJSON: tracker.savedJSON.slice(-10),
    note: 'Costs shown are estimates using per-million token pricing.',
  });
});

// ---------------- Chat ----------------
app.post('/chat', async (req, res) => {
  const {
    messages = [],
    vehicle = null,
    convoId = 'default',
    model: requestedModel,
  } = req.body;

  const model = requestedModel || 'gpt-4o';

  const baseSystem = { role: 'system', content: getTorquePrompt() };
  const vehicleSystem = { role: 'system', content: vehicleSystemMessage(vehicle) };
  const hasPersona = messages.some(m => m.role === 'system' && /TorqueTheMechanic/i.test(m.content));
  const injected = hasPersona ? messages : [baseSystem, vehicleSystem, ...messages];

  const mem = memoryStore.get(convoId) || { summary: '', userTurns: 0 };
  const userTurnsThisReq = messages.filter(m => m.role === 'user').length;
  const shouldSummarize = ((mem.userTurns + userTurnsThisReq) >= SUMMARY_EVERY_N_USER);

  let packed = packWithSummary({ messages: injected, summaryText: mem.summary, maxTurns: HISTORY_WINDOW_TURNS });
  let estBase = estimateTokenCount(packed);

  if (shouldSummarize) {
    const newSummary = await autosummarize(convoId, injected);
    const tryPacked = packWithSummary({ messages: injected, summaryText: newSummary, maxTurns: HISTORY_WINDOW_TURNS });
    const estTry = estimateTokenCount(tryPacked);
    if (estTry <= estBase) {
      packed = tryPacked; estBase = estTry; mem.summary = newSummary; mem.userTurns = 0;
      console.log(`✂️  History packed: est ${estimateTokenCount(injected)} -> ${estBase} tokens (summary used)`);
    } else {
      console.log(`ℹ️  Summary skipped this turn: ${estBase} -> ${estTry} (would increase)`);
      mem.userTurns += userTurnsThisReq;
    }
  } else {
    mem.userTurns += userTurnsThisReq;
  }
  memoryStore.set(convoId, mem);

  console.log(`🧮 Estimated tokens: ~${estBase} (req ${req._rid})`);

  try {
    const payload = { model, messages: packed, temperature: 0.5, max_tokens: 400 };
    const response = await openAIChat({ route:'/chat', model, tier:'token', payload, meta:{ note:`rid=${req._rid}, msgs=${packed.length}` } });

    let raw = response.data.choices?.[0]?.message?.content ?? '';
    raw = sanitizeAssistantText(raw);

    let vehicle_used = null;
    const metaMatch = raw.match(/\[\[META:\s*(\{[\s\S]*?\})\s*\]\]\s*$/);
    if (metaMatch) {
      try { const m = JSON.parse(metaMatch[1]); if (m && typeof m==='object' && 'vehicle_used' in m) vehicle_used = m.vehicle_used || null; } catch {}
      raw = raw.replace(/\n?\s*\[\[META:[\s\S]*\]\]\s*$/, '').trim();
    }

    res.json({ reply: raw, usage: response.data.usage, vehicle_used });
  } catch (error) {
    console.error('OpenAI Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Something went wrong with OpenAI' });
  }
});

// --------- VIN photo route (vision candidates + auto-fix) ---------
app.post('/decode-vin', async (req, res) => {
  try {
    let { base64Image, model: requestedModel } = req.body;
    if (!base64Image) return res.status(400).json({ error: 'Missing base64Image in request body.' });

    const optimized = await optimizeImageBase64(base64Image, { maxWidth: 900, quality: 45, toGrayscale: true, normalize: true });
    const visionModel = 'gpt-4o-mini';

    async function visionPass(detail = 'low') {
      const payloadVision = {
        model: visionModel,
        messages: [
          { role:'system', content: `
You will receive a photo likely containing a VIN.
Return ONLY JSON with either:
  {"vin":"<17-chars>"}       OR
  {"vins":["<17-chars>", "..."]}
Rules:
- VIN is exactly 17 chars.
- Use uppercase A–Z (no I,O,Q) and digits 0–9.
- If you see I→1, O→0, Q→0.
- Do not return any other keys or prose.
`.trim() },
          {
            role:'user',
            content: [
              { type:'text', text:'Extract VIN(s) as JSON as specified above.' },
              { type:'image_url', image_url: { url: optimized, detail } },
            ],
          },
        ],
        temperature: 0.0,
        max_tokens: 80,
      };

      const resp = await openAIChat({
        route: '/decode-vin#vision',
        model: visionModel,
        tier: 'token',
        payload: payloadVision,
        meta: { note:`rid=${req._rid}, vision-extract(${detail})` },
      });

      const raw = resp.data?.choices?.[0]?.message?.content?.trim() || '{}';
      let out = {};
      try { out = JSON.parse(raw); }
      catch { const m = raw.match(/\{[\s\S]*\}$/); out = m ? JSON.parse(m[0]) : {}; }
      return { out, usage: resp.data?.usage || {} };
    }

    let { out, usage: usageVisionLow } = await visionPass('low');
    let candidates = [];
    if (typeof out?.vin === 'string') candidates.push(out.vin);
    if (Array.isArray(out?.vins)) candidates.push(...out.vins);

    let usageVisionHigh = null;
    if (candidates.length === 0) {
      const second = await visionPass('high');
      out = second.out;
      usageVisionHigh = second.usage;
      if (typeof out?.vin === 'string') candidates.push(out.vin);
      if (Array.isArray(out?.vins)) candidates.push(...out.vins);
    }

    let picked = null;
    let fixReason = null;

    for (const cand of candidates) {
      let vin = normalizeVin(cand || '');
      if (vin.length !== 17) {
        const fx = tryAutoFixVin(vin);
        vin = fx.vin;
      }
      if (isValidVin(vin)) { picked = vin; break; }
      const fx = tryAutoFixVin(vin);
      if (fx.fixed && isValidVin(fx.vin)) { picked = fx.vin; fixReason = fx.reason || null; break; }
    }

    if (!picked) return res.status(422).json({ error: 'Could not find a valid 17-character VIN in the image.' });
    if (fixReason) console.log(`ℹ️  VIN auto-fixed (${fixReason}): ${picked}`);

    const textModel = requestedModel || 'gpt-4o';
    const { vehicle, usage: usageText } = await decodeVinTextWithOpenAI(picked, textModel);

    tracker.savedJSON.push({ ts:new Date().toISOString(), route:'/decode-vin', vin: picked, json:vehicle });
    if(tracker.savedJSON.length>100) tracker.savedJSON.shift();

    const usageVision = (() => {
      const a = usageVisionLow || {};
      const b = usageVisionHigh || {};
      return {
        prompt_tokens: (a.prompt_tokens||0) + (b.prompt_tokens||0),
        completion_tokens: (a.completion_tokens||0) + (b.completion_tokens||0),
        total_tokens: (a.total_tokens||0) + (b.total_tokens||0),
      };
    })();

    const costVision = costFor(visionModel, usageVision);
    const costText = costFor(textModel, usageText || {});
    const totalCost = (costVision + costText);

    return res.json({
      vin_extracted: picked,
      vehicle,
      usage_breakdown: {
        vision: { model: visionModel, usage: usageVision, estimated_cost_usd: Number(costVision.toFixed(6)) },
        text:   { model: textModel, usage: usageText, estimated_cost_usd: Number(costText.toFixed(6)) },
        total_estimated_cost_usd: Number(totalCost.toFixed(6)),
      },
    });
  } catch (error) {
    console.error('VIN Photo Decode Error:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Failed to decode VIN from photo.' });
  }
});

// --------- Typed VIN route (with auto-fix) ---------
app.post('/decode-vin-text', async (req, res) => {
  try {
    const model = req.body?.model || 'gpt-4o';
    let vin = normalizeVin(req.body?.vin || '');

    if (!isValidVinBasic(vin)) {
      const fx = tryAutoFixVin(vin);
      vin = fx.vin;
      if (!isValidVinBasic(vin)) return res.status(400).json({ error: 'Invalid VIN. Must be 17 chars (no I/O/Q).' });
    }
    if (!isValidVin(vin)) {
      const fx = tryAutoFixVin(vin);
      vin = fx.vin;
      if (!isValidVin(vin)) return res.status(400).json({ error: 'Invalid VIN check digit.' });
      if (fx.fixed) console.log(`ℹ️  VIN auto-fixed (manual): ${fx.reason || 'check/ambiguous'}`);
    }

    const { vehicle, usage } = await decodeVinTextWithOpenAI(vin, model);
    return res.json({ vehicle, usage });
  } catch (err) {
    console.error('VIN Text Decode Error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Failed to decode VIN.' });
  }
});

// --------- Service recommendations (COMPACT, CHEAP) — EXACTLY 15 ITEMS ---------
const ALLOWED_SERVICE_IDS_LIST = ALLOWED_SERVICE_IDS.join(',');
app.post('/generate-service-recommendations', async (req, res) => {
  const { vehicle, currentMileage } = req.body;
  if (!vehicle || !vehicle.year || !vehicle.make || !vehicle.model) {
    return res.status(400).json({ error: 'Missing required vehicle data (year, make, model).' });
  }

  const TEMPLATE_15 = ALLOWED_SERVICE_IDS.map((id) => ({
    id,
    pr: null,
    mi: null,
    mo: null,
    ap: 1
  }));

  try {
    const vparts = [
      vehicle.year, vehicle.make, vehicle.model,
      vehicle.engine ? `engine:${vehicle.engine}` : null,
      vehicle.transmission ? `trans:${vehicle.transmission}` : null,
      vehicle.drive_type ? `drive:${vehicle.drive_type}` : null,
      vehicle.trim ? `trim:${vehicle.trim}` : null,
    ].filter(Boolean).join(' ');

    const systemPrompt = `
You are a certified master mechanic. You will receive a JSON array of 15 maintenance items with IDs in [${ALLOWED_SERVICE_IDS_LIST}].
For EACH item, fill in realistic values for:
- "pr": one of "h" | "m" | "l"
- "mi": interval miles (integer) or null
- "mo": interval months (integer) or null
- "ap": 1 if applicable, else 0

STRICT RULES:
- Return ONLY the UPDATED JSON ARRAY.
- KEEP ARRAY LENGTH EXACTLY 15.
- KEEP THE SAME ORDER AND THE SAME "id" VALUES.
- NO extra keys, no comments, no markdown.
- Choose intervals consistent with factory-style schedules for the vehicle named.
- Consider ${currentMileage ? `current mileage = ${currentMileage}` : 'unknown mileage'}; do not set past-due items to null—still provide their nominal interval.
`.trim();

    const userPrompt = `
Vehicle: ${vparts}
Template (update in place and return):
${JSON.stringify(TEMPLATE_15)}
`.trim();

    const payload = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 700,
      response_format: { type: 'json_object' }
    };

    const response = await openAIChat({
      route: '/generate-service-recommendations',
      model: 'gpt-4o-mini',
      tier: 'token',
      payload,
      meta: { note: `rid=${req._rid}, compact-plan (15)` },
    });

    const raw = response.data?.choices?.[0]?.message?.content?.trim() || '[]';
    let compact = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) compact = parsed;
      else if (Array.isArray(parsed?.data)) compact = parsed.data;
    } catch {
      const m = raw.match(/\[[\s\S]*\]/);
      compact = m ? JSON.parse(m[0]) : [];
    }

    const byId = new Map();
    for (const item of compact) {
      const idNum = Number(item?.id);
      if (ALLOWED_SERVICE_IDS.includes(idNum)) byId.set(idNum, item);
    }
    const fixedCompact = ALLOWED_SERVICE_IDS.map((id) => {
      const src = byId.get(id) || {};
      const p = String(src?.pr || '').toLowerCase().trim();
      const pr = p === 'h' || p === 'm' || p === 'l' ? p : 'l';
      const toNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      return {
        id,
        pr,
        mi: toNum(src?.mi),
        mo: toNum(src?.mo),
        ap: (src?.ap === 0 || src?.ap === 1) ? src.ap : 1,
      };
    });

    // ---------- timing & fuel filter hints ----------
    const hints = await getServiceabilityHints(vehicle);
    const FUEL_FILTER_ID = 12;
    const TIMING_ID = 15;
    const labelOverrides = {};

    if (hints.fuel_filter_serviceable === false) {
      const idx = fixedCompact.findIndex(x => Number(x.id) === FUEL_FILTER_ID);
      if (idx >= 0) {
        fixedCompact[idx].ap = 0;
        fixedCompact[idx].mi = null;
        fixedCompact[idx].mo = null;
        labelOverrides[FUEL_FILTER_ID] = 'Fuel filter (non-serviceable / in-tank)';
      }
    } else if (hints.fuel_filter_serviceable === true) {
      const idx = fixedCompact.findIndex(x => Number(x.id) === FUEL_FILTER_ID);
      if (idx >= 0) fixedCompact[idx].ap = 1;
    }

    {
      const idx = fixedCompact.findIndex(x => Number(x.id) === TIMING_ID);
      if (idx >= 0) {
        const card = fixedCompact[idx];
        const setIfBlank = (k, val) => { if (card[k] == null || !Number.isFinite(Number(card[k]))) card[k] = val; };

        if (hints.timing_drive === 'belt') {
          card.ap = 1;
          setIfBlank('mi', 90000);
          setIfBlank('mo', 72);
          labelOverrides[TIMING_ID] = 'Timing belt — replace';
        } else if (hints.timing_drive === 'chain') {
          if (hints.timing_service === 'inspect') {
            card.ap = 1;
            if (card.mi && Number(card.mi) < 150000) card.mi = null;
            labelOverrides[TIMING_ID] = 'Timing chain — inspect';
          } else {
            card.ap = 0;
            card.mi = null; card.mo = null;
            labelOverrides[TIMING_ID] = 'Timing chain (no scheduled service)';
          }
        } else {
          if ((card.mi == null) && (card.mo == null)) {
            labelOverrides[TIMING_ID] = 'Timing belt/chain — inspect';
          }
        }
      }
    }
    // ---------- end hints ----------

    // ---------- NEW: interval enricher ----------
    let enricherUsage = null;
    if (ENRICH_INTERVALS) {
      const { enriched, usage } = await enrichRecommendedIntervals(vehicle, fixedCompact);
      enricherUsage = usage || null;
      if (enriched) {
        for (const item of fixedCompact) {
          const upd = enriched[item.id];
          if (!upd) continue;
          // Only apply if missing or obviously off
          const currentMi = Number(item.mi);
          const currentMo = Number(item.mo);
          const proposedMi = upd.mi;
          const proposedMo = upd.mo;

          const needMi = !(Number.isFinite(currentMi)) || currentMi <= 0;
          const needMo = !(Number.isFinite(currentMo)) || currentMo <= 0;

          if (needMi && proposedMi != null) item.mi = proposedMi;
          if (needMo && proposedMo != null) item.mo = proposedMo;

          // clamp again for safety
          const c = clampReasonable(item.id, item.mi, item.mo);
          item.mi = c.mi; item.mo = c.mo;
        }
      }
    }

    // Expand into UI shape (now includes id) & apply labels
    let expanded = expandCompactPlan(fixedCompact);
    if (Object.keys(labelOverrides).length) {
      expanded = expanded.map((item) => {
        if (labelOverrides[item.id]) return { ...item, text: labelOverrides[item.id] };
        if (item.id === 12 && item.applies === false) return { ...item, text: 'Fuel filter (non-serviceable / in-tank)' };
        return item;
      });
    } else {
      expanded = expanded.map((item) =>
        (item.id === 12 && item.applies === false)
          ? { ...item, text: 'Fuel filter (non-serviceable / in-tank)' }
          : item
      );
    }

    if (!expanded.length || expanded.length !== 15) {
      const baseline = ALLOWED_SERVICE_IDS.map((id) => {
        const defaults = {
          1: { pr:'h', mi:5000,  mo:6,  ap:1 },
          2: { pr:'m', mi:6000,  mo:6,  ap:1 },
          3: { pr:'l', mi:15000, mo:18, ap:1 },
          4: { pr:'l', mi:15000, mo:18, ap:1 },
          5: { pr:'m', mi:12000, mo:12, ap:1 },
          6: { pr:'m', mi:30000, mo:24, ap:1 },
          7: { pr:'m', mi:60000, mo:48, ap:1 },
          8: { pr:'m', mi:60000, mo:48, ap:1 },
          9: { pr:'m', mi:100000,mo:96, ap:1 },
          10:{ pr:'l', mi:60000, mo:48, ap:1 },
          11:{ pr:'m', mi:null,  mo:48, ap:1 },
          12:{ pr:'l', mi:60000, mo:48, ap:1 },
          13:{ pr:'l', mi:60000, mo:48, ap:1 },
          14:{ pr:'l', mi:60000, mo:48, ap:1 },
          15:{ pr:'m', mi:90000, mo:72, ap:1 },
        }[id] || { pr:'l', mi:null, mo:null, ap:1 };
        return { id, ...defaults };
      });
      res.json({
        compact: baseline,
        result: expandCompactPlan(baseline),
        usage: response.data?.usage || {},
        enricher_usage: enricherUsage || undefined,
        note: 'Returned baseline due to incomplete model output.',
      });
      return;
    }

    res.json({
      compact: fixedCompact,
      result: expanded,
      usage: response.data?.usage || {},
      enricher_usage: enricherUsage || undefined,
      flags: { enriched_intervals: ENRICH_INTERVALS },
    });
  } catch (error) {
    console.error('Service Recommendations Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to generate service recommendations.' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
  console.log(`ℹ️  Pricing at http://localhost:${PORT}/pricing`);
  console.log(`ℹ️  Metrics at http://localhost:${PORT}/metrics`);
  console.log(`ℹ️  Interval enricher: ${ENRICH_INTERVALS ? 'ON' : 'OFF'} (set ENRICH_INTERVALS=true|false)`);
});
