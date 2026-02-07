/**
 * index.js — TorqueTheMechanic backend (Express)
 * Fixes + upgrades:
 * ✅ Correct MODEL_PRICING keys (your gpt-4o-mini entry was accidentally keyed as gpt-4o)
 * ✅ Uses current OpenAI pricing defaults (can be overridden via .env)
 * ✅ Supports cached input token billing when usage includes cached_tokens
 * ✅ Lets you pick cheaper models per-route via env (VIN vision, facts, intervals, etc.)
 * ✅ Keeps your existing behavior (VIN auto-fix, compact service plan, trackers, etc.)
 *
 * Pricing defaults sourced from OpenAI API pricing docs:
 * - gpt-4o: $2.50 in / $1.25 cached in / $10.00 out
 * - gpt-4o-mini: $0.15 in / $0.075 cached in / $0.60 out
 * - Whisper transcription: $0.006 / minute
 *  (see citations in chat response)
 */

const express = require('express');
const axios = require('axios');
const cors = require('cors');
const sharp = require('sharp');
require('dotenv').config();

const FormData = require('form-data');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// ======================= Model Selection (per route) =======================
// You can override any of these in .env
const MODELS = {
  CHAT: process.env.MODEL_CHAT || 'gpt-4o',
  IMAGE_DIAGNOSE: process.env.MODEL_IMAGE_DIAGNOSE || 'gpt-4o', // vision
  VIN_VISION: process.env.MODEL_VIN_VISION || 'gpt-4o-mini',    // cheaper + good enough for extraction
  VIN_TEXT: process.env.MODEL_VIN_TEXT || 'gpt-4o',
  VEHICLE_FACTS: process.env.MODEL_VEHICLE_FACTS || 'gpt-4o-mini',
  INTERVALS: process.env.MODEL_INTERVALS || 'gpt-4o-mini',
  SERVICE_RECS: process.env.MODEL_SERVICE_RECS || 'gpt-4o',
  AUDIO_TRANSCRIBE: process.env.MODEL_AUDIO_TRANSCRIBE || 'whisper-1', // or "gpt-4o-mini-transcribe" if you switch
  AUDIO_DIAGNOSE: process.env.MODEL_AUDIO_DIAGNOSE || 'gpt-4o',
};

// ======================= Pricing (USD per 1M tokens) =======================
// Defaults match OpenAI API pricing docs; override via env if you want.
const MODEL_PRICING = {
  // Text/token models
  'gpt-4o': {
    in: Number(process.env.PRICE_GPT4O_IN_PER_1M || 2.5),
    cached_in: Number(process.env.PRICE_GPT4O_CACHED_IN_PER_1M || 1.25),
    out: Number(process.env.PRICE_GPT4O_OUT_PER_1M || 10),
  },
  'gpt-4o-mini': {
    in: Number(process.env.PRICE_GPT4OMINI_IN_PER_1M || 0.15),
    cached_in: Number(process.env.PRICE_GPT4OMINI_CACHED_IN_PER_1M || 0.075),
    out: Number(process.env.PRICE_GPT4OMINI_OUT_PER_1M || 0.6),
  },

  // Optional (if you ever swap chat model)
  'gpt-4.1': {
    in: Number(process.env.PRICE_GPT41_IN_PER_1M || 2.0),
    cached_in: Number(process.env.PRICE_GPT41_CACHED_IN_PER_1M || 0.5),
    out: Number(process.env.PRICE_GPT41_OUT_PER_1M || 8.0),
  },
  'gpt-4.1-mini': {
    in: Number(process.env.PRICE_GPT41MINI_IN_PER_1M || 0.4),
    cached_in: Number(process.env.PRICE_GPT41MINI_CACHED_IN_PER_1M || 0.1),
    out: Number(process.env.PRICE_GPT41MINI_OUT_PER_1M || 1.6),
  },
  'gpt-4.1-nano': {
    in: Number(process.env.PRICE_GPT41NANO_IN_PER_1M || 0.1),
    cached_in: Number(process.env.PRICE_GPT41NANO_CACHED_IN_PER_1M || 0.025),
    out: Number(process.env.PRICE_GPT41NANO_OUT_PER_1M || 0.4),
  },
};

// Non-token audio pricing (per minute) — for whisper
const AUDIO_PRICING_PER_MIN = {
  'whisper-1': Number(process.env.PRICE_WHISPER_PER_MIN || 0.006),
};

const OPENAI_FREE_MODE = String(process.env.OPENAI_FREE_MODE || 'false') === 'true';
const ENRICH_INTERVALS = String(process.env.ENRICH_INTERVALS || 'true') === 'true';

// Track usage
const tracker = { totals: {}, byRoute: {}, byTier: {}, recent: [], savedJSON: [] };

function priceFor(model) {
  return MODEL_PRICING[model] || { in: 0, cached_in: 0, out: 0 };
}

// Supports cached token billing if usage provides it
function costFor(model, usage = {}) {
  const p = priceFor(model);

  const pt = Number(usage.prompt_tokens || 0);
  const ct = Number(usage.completion_tokens || 0);

  // OpenAI usage sometimes includes cached token counts in nested fields.
  // We'll subtract cached tokens from prompt tokens if present.
  const cached =
    Number(usage?.prompt_tokens_details?.cached_tokens || 0) ||
    Number(usage?.prompt_tokens_details?.cached || 0) ||
    Number(usage?.cached_tokens || 0) ||
    0;

  const nonCachedPrompt = Math.max(0, pt - cached);

  return (
    (nonCachedPrompt * p.in + cached * (p.cached_in || 0) + ct * p.out) / 1_000_000
  );
}

function ensureBucket(obj, key, seed = null) {
  if (!obj[key]) obj[key] = seed || { count: 0, prompt: 0, completion: 0, total: 0, cost: 0 };
  return obj[key];
}

function logUsage({ route, model, tier, usage, ms, meta }) {
  const { prompt_tokens = 0, completion_tokens = 0, total_tokens = 0 } = usage || {};
  const cost = costFor(model, usage);

  const mt = ensureBucket(tracker.totals, model);
  mt.count++; mt.prompt += prompt_tokens; mt.completion += completion_tokens; mt.total += total_tokens; mt.cost += cost;

  const rt = ensureBucket(tracker.byRoute, route);
  rt.count++; rt.prompt += prompt_tokens; rt.completion += completion_tokens; rt.total += total_tokens; rt.cost += cost;

  const tt = ensureBucket(tracker.byTier, tier || 'token');
  tt.count++; tt.prompt += prompt_tokens; tt.completion += completion_tokens; tt.total += total_tokens; tt.cost += cost;

  tracker.recent.push({ ts: new Date().toISOString(), route, tier, model, usage, cost, ms, meta });
  if (tracker.recent.length > 50) tracker.recent.shift();

  const costStr = OPENAI_FREE_MODE ? 'free-quota' : `$${cost.toFixed(6)} (est)`;
  console.log(
    [
      `📊 [${route}] ${model} (${tier || 'token'})`,
      `⏱️ ${ms}ms`,
      `🧮 in:${prompt_tokens} out:${completion_tokens} total:${total_tokens}`,
      `💵 ${costStr}`,
      meta?.note ? `— ${meta.note}` : ''
    ].join(' | ')
  );
  if (total_tokens > 4500) console.warn(`⚠️ High token usage on ${route}: ${total_tokens} tokens`);
}

// OpenAI wrapper (chat completions)
async function openAIChat({ route, model = 'gpt-4o', tier = 'token', payload, headers = {}, meta }) {
  const t0 = Date.now();
  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        ...headers
      }
    });
    const ms = Date.now() - t0;
    const usage = response.data?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    logUsage({ route, model, tier, usage, ms, meta });
    return response;
  } catch (err) {
    const ms = Date.now() - t0;
    console.error(`❌ OpenAI error on ${route} after ${ms}ms:`, err.response?.data || err.message);
    throw err;
  }
}

// request id
app.use((req, res, next) => {
  req._rid = Math.random().toString(36).slice(2, 10);
  req._t0 = Date.now();
  res.setHeader('X-Request-Id', req._rid);
  next();
});

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
const ALLOWED_SERVICE_IDS_LIST = ALLOWED_SERVICE_IDS.join(',');

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
function normalizeVin(str = '') {
  const up = String(str).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return up.replace(/I/g, '1').replace(/[OQ]/g, '0');
}
function isValidVinBasic(vin = '') { return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin); }

const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const VIN_MAP = (() => {
  const map = {};
  '0123456789'.split('').forEach((d, i) => map[d] = i);
  Object.assign(map, { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 });
  return map;
})();
function computeVinCheckDigit(vin) {
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i];
    const val = VIN_MAP[ch];
    if (val == null) return null;
    sum += val * VIN_WEIGHTS[i];
  }
  const rem = sum % 11;
  return rem === 10 ? 'X' : String(rem);
}
function isValidVin(vin = '') {
  if (!isValidVinBasic(vin)) return false;
  const check = computeVinCheckDigit(vin);
  return check === vin[8];
}
function tryAutoFixVin(vin) {
  if (vin.length !== 17) return { vin, fixed: false };
  const expectedCheck = computeVinCheckDigit(vin);
  if (expectedCheck && expectedCheck !== vin[8]) {
    const fixed = vin.slice(0, 8) + expectedCheck + vin.slice(9);
    if (isValidVin(fixed)) return { vin: fixed, fixed: true, reason: 'check-digit corrected' };
  }
  const AMBIGUOUS_MAP = {
    '0': ['O', 'Q'], 'O': ['0'], 'Q': ['0'],
    '1': ['I', 'L'], 'I': ['1'], 'L': ['1'],
    '5': ['S'], 'S': ['5'],
    '8': ['B'], 'B': ['8'],
    '6': ['G'], 'G': ['6'],
    '2': ['Z'], 'Z': ['2', '7'],
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
        if (exp && exp === candVin[8]) return { vin: candVin, fixed: true, reason: `ambiguous swap @${i + 1}: ${ch}->${alt}` };
      }
    }
  }
  return { vin, fixed: false };
}

function stripNonTextContent(messages = []) {
  return (messages || []).map(m => {
    if (Array.isArray(m?.content)) return { ...m, content: '[attachment omitted]' };
    if (typeof m?.content === 'string' && m.content.length > 8000) {
      return { ...m, content: m.content.slice(0, 8000) + '…[truncated]' };
    }
    return m;
  });
}

// Persona
const getTorquePrompt = () => `
You are Torque — the in-app mechanic for TorqueTheMechanic. You are an automotive expert.
Speak like a helpful, confident technician. Never mention OpenAI or internal model names.
If asked “what are you,” answer: “I’m Torque, the mechanic assistant in this app. I diagnose issues, look up specs, and explain repairs with simple steps.”

When diagnosing except for image-diagnose then include part numbers if found, otherwise include a short section:
- Always try to get as much information as possible about the symptoms, conditions, and history to return the best possible diagnosis.
- attempt to also include the rare scenerios (1-5% likelihood) that could cause similar symptoms and look into other cases or causes that can perhaps be related to the issue.
- Likely issues (most → least) add percentage of likelyhood for each of different things it could be when compared to each other account for the rare issues too for the diagnostics topics, bullet list.
- also include the rare scenerios (1-5% likelihood) as well as the 1% other very rare scenarios so the user does not rely on just the stats.
- Quick checks (bullets, 1–5 items).
- If a spec is requested, give a safe range or note variations by engine/trim if uncertain.
- Keep the overall reply compact and practical. Use markdown bullets, not long paragraphs.

Keep replies compact and practical. Use markdown bullets, not long paragraphs.
When asked for part numbers also return likelihood of the statement you returned is to be true realistically too like if you know for sure these are the right part numbers returned you can return something like 99.99%.
Include legal protection in responses etc.
`.trim();

function summarizeVehicle(v = {}) {
  if (!v || typeof v !== 'object') return '';
  const parts = [];
  if (v.year) parts.push(String(v.year));
  if (v.make) parts.push(String(v.make));
  if (v.model) parts.push(String(v.model));
  const main = parts.join(' ');
  const extras = [
    v.trim && `Trim: ${v.trim}`,
    v.engine && `Engine: ${v.engine}`,
    v.transmission && `Trans: ${v.transmission}`,
    v.drive_type && `Drive: ${v.drive_type}`,
    v.body_style && `Body: ${v.body_style}`
  ].filter(Boolean).join(' | ');
  return extras ? `${main} (${extras})` : main;
}

function vehicleSystemMessage(vehicle) {
  const hasVehicle = vehicle && vehicle.make && vehicle.model;
  const summary = hasVehicle ? summarizeVehicle(vehicle) : 'unknown';
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

function estimateTokenCount(messages) {
  const joined = messages.map(m => {
    const c = (typeof m.content === 'string') ? m.content : JSON.stringify(m.content);
    return `${m.role}:${c}`;
  }).join('\n');
  return Math.round(joined.length / 4);
}

function packWithSummary({ messages, summaryText, maxTurns }) {
  const systems = messages.filter(m => m.role === 'system');
  const convo = messages.filter(m => m.role !== 'system');
  const recent = convo.slice(-maxTurns * 2);
  const out = [...systems];
  if (summaryText && summaryText.trim()) {
    out.push({
      role: 'system',
      content: `CONVERSATION MEMORY (background only; do not quote):\n${summaryText.trim()}`
    });
  }
  return [...out, ...recent];
}

async function autosummarize(convoId, messages) {
  const convo = messages.filter(m => m.role !== 'system');
  const text = convo.map(m => `${m.role.toUpperCase()}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n');
  const payload = {
    model: MODELS.CHAT, // summarize using same class of model (or override if you want)
    messages: [
      { role: 'system', content: 'Summarize the dialog into a compact, tool-usable memory. 4-6 bullets max. No fluff.' },
      { role: 'user', content: text }
    ],
    temperature: 0.2,
    max_tokens: SUMMARY_MAX_TOKENS,
  };
  const resp = await openAIChat({
    route: '/chat#autosummary',
    model: payload.model,
    tier: 'token',
    payload,
    meta: { note: `autosummarize(${SUMMARY_MAX_TOKENS})` },
  });
  return resp.data?.choices?.[0]?.message?.content?.trim() || '';
}

function sanitizeAssistantText(s, maxBlock = 20000) {
  if (!s || typeof s !== 'string') return s;
  const replacer = (tag) => {
    const re = new RegExp("```" + tag + "\\s*([\\s\\S]*?)```", "g");
    return s.replace(re, (_m, inner) => {
      let clean = String(inner || '');
      if (tag === 'svg') {
        clean = clean.replace(/<!--[\s\S]*?-->/g, '').replace(/\s{2,}/g, ' ').trim();
      }
      if (clean.length > maxBlock) clean = clean.slice(0, maxBlock);
      return "```" + tag + "\n" + clean + "\n```";
    });
  };
  return replacer('svg').replace(/```diagram-json\s*([\s\S]*?)```/g, (_m, inner) => {
    let clean = String(inner || '');
    if (clean.length > maxBlock) clean = clean.slice(0, maxBlock);
    return "```diagram-json\n" + clean + "\n```";
  });
}

// Image optimizer (VIN OCR / vision)
async function optimizeImageBase64(base64DataUrlOrRaw, opts = {}) {
  const raw = base64DataUrlOrRaw.startsWith('data:image/')
    ? base64DataUrlOrRaw.split(',')[1]
    : base64DataUrlOrRaw;

  const input = Buffer.from(raw, 'base64');

  const {
    maxWidth = 900,
    quality = 45,
    toGrayscale = true,
    normalize = true,
    sharpen = false,
  } = opts;

  let pipeline = sharp(input).rotate();
  const meta = await pipeline.metadata();
  if ((meta.width || 0) > maxWidth) pipeline = pipeline.resize({ width: maxWidth });
  if (toGrayscale) pipeline = pipeline.grayscale();
  if (normalize) pipeline = pipeline.normalize();
  if (sharpen) pipeline = pipeline.sharpen();

  const out = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

// Spec folder / normalizer
function foldVehicleSpecs(raw = {}) {
  const v = { ...raw };
  const hpCandidate = v.horsepower_hp ?? v.horsepower ?? (typeof v.hp === 'string' ? v.hp.replace(/[^\d.]/g, '') : v.hp);
  if (hpCandidate != null && hpCandidate !== '') v.hp = Number(String(hpCandidate).replace(/[^\d.]/g, ''));

  const gvwCandidate = v.gvw_lbs ?? v.gvw ?? v.gross_vehicle_weight_rating ?? v.gvwr ?? (typeof v.gvw === 'string' ? v.gvw.replace(/[^\d.]/g, '') : v.gvw);
  if (gvwCandidate != null && gvwCandidate !== '') v.gvw = Number(String(gvwCandidate).replace(/[^\d.]/g, ''));

  const num = (x) => {
    if (x == null || x === '') return;
    const n = Number(String(x).replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  };
  const c = num(v.mpg_city ?? v.city_mpg ?? v.city ?? v?.mpg?.city);
  const h = num(v.mpg_highway ?? v.hwy_mpg ?? v.highway ?? v?.mpg?.highway);
  const comb = num(v.mpg_combined ?? v.combined_mpg ?? v.combined);
  if (c && h) v.mpg = `${c} city / ${h} highway`;
  else if (!v.mpg && comb) v.mpg = `${comb} combined`;
  else if (typeof v.mpg === 'object' && v.mpg) {
    const cc = num(v.mpg.city);
    const hh = num(v.mpg.highway);
    if (cc && hh) v.mpg = `${cc} city / ${hh} highway`;
  }

  if (v.vin) v.vin = normalizeVin(v.vin);
  if (v.transmission && /auto/i.test(v.transmission)) v.transmission = 'Automatic';
  if (v.transmission && /man/i.test(v.transmission)) v.transmission = 'Manual';
  return v;
}

// ---------------- OpenAI VIN text decode ----------------
async function decodeVinTextWithOpenAI(vin, model = MODELS.VIN_TEXT) {
  const payload = {
    model,
    messages: [
      {
        role: 'system', content: `
You are a meticulous VIN decoder.
Return ONLY a single JSON object (no markdown).
If uncertain about any spec, use null — do not guess.
Use these exact keys:
vin, year, make, model, trim, engine, transmission, drive_type, body_style, fuel_type,
horsepower_hp, gvw_lbs, mpg_city, mpg_highway, mpg_combined.
`.trim()
      },
      { role: 'user', content: `VIN: ${vin}\nDecode fully and include the fields above.` },
    ],
    temperature: 0.0,
    max_tokens: 600,
  };

  const response = await openAIChat({
    route: '/decode-vin-text',
    model,
    tier: 'token',
    payload,
    meta: { note: `VIN ${vin}` },
  });

  const raw = response.data.choices?.[0]?.message?.content?.trim() || '{}';
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}$/);
    parsed = m ? JSON.parse(m[0]) : {};
  }

  const folded = foldVehicleSpecs(parsed);
  folded.vin = vin;

  tracker.savedJSON.push({ ts: new Date().toISOString(), route: '/decode-vin-text', vin, json: folded });
  if (tracker.savedJSON.length > 100) tracker.savedJSON.shift();

  return { vehicle: folded, usage: response.data.usage };
}

// ---------- Vehicle facts (cached) ----------
const factsCache = new Map(); // key = vehicleKey(v)
function vehicleKey(v) {
  const k = {
    year: v?.year || null,
    make: v?.make || null,
    model: v?.model || null,
    trim: v?.trim || null,
    engine: v?.engine || null,
    transmission: v?.transmission || null,
    fuel_type: v?.fuel_type || null,
  };
  return JSON.stringify(k);
}

// local heuristics as last resort only
function localHeuristicFacts(vehicle) {
  const txt = [
    vehicle?.year, vehicle?.make, vehicle?.model,
    vehicle?.trim || '', vehicle?.engine || '', vehicle?.transmission || '', vehicle?.fuel_type || ''
  ].join(' ').toLowerCase();

  const isDiesel = /\bdiesel\b|tdi|td|cummins|powerstroke|duramax/.test(txt) || /b47d|n47d|m57d/.test(txt);
  const hasEPS = /\belectric power steering\b|\beps\b/.test(txt);
  const cylinders =
    /\bv12\b|12cyl/.test(txt) ? 12 :
      /\bv10\b|10cyl/.test(txt) ? 10 :
        /\bv8\b|8cyl|8-cylinder/.test(txt) ? 8 :
          /\bv6\b|6cyl|6-cylinder/.test(txt) ? 6 :
            /\bi4\b|4cyl|4-cylinder|inline-4|i-4/.test(txt) ? 4 : null;

  const timingChainLikely = /n\d{2}|pushrod|ohv|ls\d|ford 302|5\.0l v8|5\.7l v8/.test(txt);

  const yr = Number(vehicle?.year);
  const sparkMaterial =
    isDiesel ? null :
      isNaN(yr) ? null :
        yr >= 2005 ? 'iridium' :
          yr >= 1995 ? 'platinum' : 'copper';

  return {
    is_diesel: isDiesel || null,
    cylinders,
    spark_plug_material_hint: sparkMaterial,
    timing_drive_hint: timingChainLikely ? 'chain' : null,
    has_electric_ps_hint: hasEPS || null,
    fuel_filter_serviceable_hint: isDiesel ? true : null
  };
}

async function getVehicleFacts(vehicle) {
  const key = vehicleKey(vehicle);
  if (factsCache.has(key)) return { facts: factsCache.get(key), usage: null, fromCache: true };

  const vtxt = [
    vehicle?.year, vehicle?.make, vehicle?.model,
    vehicle?.trim ? `trim:${vehicle.trim}` : null,
    vehicle?.engine ? `engine:${vehicle.engine}` : null,
    vehicle?.transmission ? `trans:${vehicle.transmission}` : null,
    vehicle?.fuel_type ? `fuel:${vehicle.fuel_type}` : null,
  ].filter(Boolean).join(' ');

  const sys = `
Return STRICT JSON with ONLY these keys:
{
  "is_diesel": true | false | null,
  "cylinders": 3 | 4 | 5 | 6 | 8 | 10 | 12 | null,
  "spark_plug_material": "copper" | "platinum" | "iridium" | null,
  "fuel_filter_serviceable": true | false | null,
  "timing_drive": "belt" | "chain" | null,
  "timing_service": "replace" | "inspect" | null,
  "power_steering": "hydraulic" | "electric" | null
}
Rules:
- If fuel is diesel: is_diesel=true and spark_plug_material=null.
- If timing=chain and no scheduled service: timing_service=null; if periodic check: "inspect".
- If timing=belt: timing_service="replace".
- If fuel filter is in-tank 'lifetime': fuel_filter_serviceable=false.
- If unclear for any field: null (do not guess).
`.trim();

  const payload = {
    model: MODELS.VEHICLE_FACTS,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: `Vehicle: ${vtxt}` },
    ],
    temperature: 0.0,
    max_tokens: 160,
  };

  try {
    const resp = await openAIChat({
      route: '/vehicle-facts',
      model: payload.model,
      tier: 'token',
      payload,
      meta: { note: `facts for ${vtxt}` },
    });

    const raw = resp.data?.choices?.[0]?.message?.content?.trim() || '{}';
    let data;
    try { data = JSON.parse(raw); }
    catch {
      const m = raw.match(/\{[\s\S]*\}$/);
      data = m ? JSON.parse(m[0]) : {};
    }

    const heur = localHeuristicFacts(vehicle);
    const facts = {
      is_diesel: (typeof data.is_diesel === 'boolean') ? data.is_diesel
        : (vehicle?.fuel_type && /diesel/i.test(vehicle.fuel_type) ? true : (heur.is_diesel ?? null)),
      cylinders: data.cylinders ?? heur.cylinders ?? null,
      spark_plug_material: (data.is_diesel === true) ? null : (data.spark_plug_material ?? heur.spark_plug_material_hint ?? null),
      fuel_filter_serviceable: (typeof data.fuel_filter_serviceable === 'boolean')
        ? data.fuel_filter_serviceable : (heur.fuel_filter_serviceable_hint ?? null),
      timing_drive: (data.timing_drive === 'belt' || data.timing_drive === 'chain') ? data.timing_drive : (heur.timing_drive_hint ?? null),
      timing_service: (['replace', 'inspect'].includes(data.timing_service)) ? data.timing_service : null,
      power_steering: (data.power_steering === 'hydraulic' || data.power_steering === 'electric')
        ? data.power_steering : (heur.has_electric_ps_hint ? 'electric' : null),
    };

    factsCache.set(key, facts);
    return { facts, usage: resp.data?.usage || null, fromCache: false };
  } catch {
    const facts = localHeuristicFacts(vehicle);
    factsCache.set(key, facts);
    return { facts, usage: null, fromCache: false };
  }
}

// ---------- NEW: Cheap interval enricher (per-vehicle, cached) ----------
const intervalCache = new Map(); // key = vehicleKey(v)

function clampReasonable(id, mi, mo) {
  const n = (x) => Number.isFinite(Number(x)) ? Number(x) : null;
  let miles = n(mi), months = n(mo);

  const clamp = (lo, x, hi) => x == null ? null : Math.max(lo, Math.min(x, hi));

  switch (id) {
    case 1: miles = clamp(2500, miles, 15000); months = clamp(3, months, 24); break;
    case 2: miles = clamp(3000, miles, 15000); months = clamp(3, months, 24); break;
    case 3:
    case 4: miles = clamp(8000, miles, 45000); months = clamp(6, months, 48); break;
    case 6: miles = clamp(15000, miles, 80000); months = clamp(18, months, 72); break;
    case 7: miles = clamp(30000, miles, 150000); months = clamp(24, months, 120); break;
    case 8: miles = clamp(30000, miles, 150000); months = clamp(24, months, 120); break;
    case 9: miles = clamp(30000, miles, 150000); months = clamp(24, months, 144); break;
    case 15: miles = clamp(60000, miles, 120000); months = clamp(48, months, 120); break;
    default:
      miles = miles == null ? null : clamp(3000, miles, 200000);
      months = months == null ? null : clamp(3, months, 180);
  }
  return { mi: miles, mo: months };
}

async function enrichRecommendedIntervals(vehicle, compactPlan) {
  if (!ENRICH_INTERVALS) return { enriched: null, usage: null, fromCache: false };
  const key = vehicleKey(vehicle);
  if (intervalCache.has(key)) return { enriched: intervalCache.get(key), usage: null, fromCache: true };

  const items = compactPlan
    .filter(x => Number(x.ap) === 1)
    .map(x => ({ id: x.id, name: SERVICE_CATALOG[x.id], mi: x.mi ?? null, mo: x.mo ?? null }));

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
- Never invent extreme values (e.g., oil 120000 mi).
- If no recommendation exists (sealed/lifetime), set both mi and mo to null and skip the update.
- Do not change applicability.
`.trim();

  const user = `
Vehicle: ${vtxt}
Items (update only where helpful):
${JSON.stringify({ items }, null, 2)}
`.trim();

  const payload = {
    model: MODELS.INTERVALS,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.1,
    max_tokens: 350,
  };

  try {
    const resp = await openAIChat({
      route: '/interval-enricher',
      model: payload.model,
      tier: 'token',
      payload,
      meta: { note: `vehicle=${vtxt}` },
    });

    const raw = resp.data?.choices?.[0]?.message?.content?.trim() || '{}';
    let parsed = {};
    try { parsed = JSON.parse(raw); }
    catch {
      const m = raw.match(/\{[\s\S]*\}$/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    const updates = Array.isArray(parsed?.updates) ? parsed.updates : [];
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

// ---------- Truthiness guard (final authority before UI expand) ----------
function enforceCardTruthiness(facts, fixedCompact) {
  const SPARK_ID = 9, FUEL_ID = 12, PS_ID = 14, TIMING_ID = 15;

  const idxById = Object.fromEntries(fixedCompact.map((x, i) => [x.id, i]));
  const idx = (id) => idxById[id] ?? -1;

  // Spark plugs: only NA on diesel
  {
    const i = idx(SPARK_ID);
    if (i >= 0) {
      if (facts.is_diesel === true) {
        fixedCompact[i].ap = 0; fixedCompact[i].mi = null; fixedCompact[i].mo = null;
      } else {
        if (fixedCompact[i].ap === 0) fixedCompact[i].ap = 1;
        if (fixedCompact[i].mi == null) {
          const mat = String(facts.spark_plug_material || '').toLowerCase();
          fixedCompact[i].mi = (mat === 'iridium') ? 100000 : (mat === 'platinum' ? 60000 : 30000);
        }
        if (fixedCompact[i].mo == null) {
          const mat = String(facts.spark_plug_material || '').toLowerCase();
          fixedCompact[i].mo = (mat === 'iridium') ? 96 : (mat === 'platinum' ? 72 : 36);
        }
      }
    }
  }

  // Fuel filter: NA if non-serviceable
  {
    const i = idx(FUEL_ID);
    if (i >= 0) {
      if (facts.fuel_filter_serviceable === false) {
        fixedCompact[i].ap = 0; fixedCompact[i].mi = null; fixedCompact[i].mo = null;
      } else if (facts.fuel_filter_serviceable === true) {
        fixedCompact[i].ap = 1;
      }
    }
  }

  // Power steering: EPS => NA
  {
    const i = idx(PS_ID);
    if (i >= 0) {
      if (facts.power_steering === 'electric') {
        fixedCompact[i].ap = 0; fixedCompact[i].mi = null; fixedCompact[i].mo = null;
      } else if (facts.power_steering === 'hydraulic') {
        if (fixedCompact[i].ap === 0) fixedCompact[i].ap = 1;
      } else {
        if (fixedCompact[i].ap == null) fixedCompact[i].ap = 1;
      }
    }
  }

  // Timing drive: belt vs chain
  {
    const i = idx(TIMING_ID);
    if (i >= 0) {
      const card = fixedCompact[i];
      const setIfBlank = (k, val) => { if (card[k] == null || !Number.isFinite(Number(card[k]))) card[k] = val; };

      if (facts.timing_drive === 'belt') {
        card.ap = 1;
        setIfBlank('mi', 90000);
        setIfBlank('mo', 72);
      } else if (facts.timing_drive === 'chain') {
        if (facts.timing_service === 'inspect') {
          card.ap = 1;
          if (card.mi && Number(card.mi) < 150000) card.mi = null;
        } else {
          card.ap = 0; card.mi = null; card.mo = null;
        }
      } else {
        if (card.mi && Number(card.mi) < 60000) card.mi = null;
      }
    }
  }

  // Final clamp
  for (const item of fixedCompact) {
    const c = clampReasonable(item.id, item.mi, item.mo);
    item.mi = c.mi; item.mo = c.mo;
    if (item.ap !== 0 && item.ap !== 1) item.ap = 1;
  }
}

function getTorqueVisionPrompt() {
  return `
You are Torque — an automotive mechanic. The user attached a photo related to a vehicle problem.
You MUST:
- Only discuss automotive topics.
- Use the VEHICLE CONTEXT provided.
- Describe what you can visually infer (but label uncertain items as uncertain).
- Give: Likely causes (most→least) with rough % relative likelihoods, Quick checks (1–5), and 3 follow-up questions.
- Be compact and practical (bullets, no fluff).
- If the photo isn't useful, say what’s missing and how to retake it (angle, lighting, distance).
Never mention OpenAI or internal model names.
`.trim();
}

// ======================= Routes =======================
app.get('/pricing', (req, res) => {
  res.json({
    per_1M_tokens: MODEL_PRICING,
    audio_per_min: AUDIO_PRICING_PER_MIN,
    free_mode: OPENAI_FREE_MODE,
    enrich_intervals: ENRICH_INTERVALS,
    models: MODELS
  });
});

app.get('/metrics', (req, res) => {
  res.json({
    totals: tracker.totals,
    byRoute: tracker.byRoute,
    byTier: tracker.byTier,
    recent: tracker.recent.slice(-50),
    pricing_per_1M: MODEL_PRICING,
    audio_per_min: AUDIO_PRICING_PER_MIN,
    models: MODELS,
    savedJSON: tracker.savedJSON.slice(-10),
    note: 'Costs shown are estimates using current pricing defaults (supports cached prompt tokens if present).',
  });
});

// ---------------- Chat ----------------
app.post('/chat', async (req, res) => {
  const { messages = [], vehicle = null, convoId = 'default', model: requestedModel } = req.body;
  const model = requestedModel || MODELS.CHAT;

  const baseSystem = { role: 'system', content: getTorquePrompt() };
  const vehicleSystem = { role: 'system', content: vehicleSystemMessage(vehicle) };

  const hasPersona = messages.some(m => m.role === 'system' && /TorqueTheMechanic/i.test(m.content));
  const safeMessages = stripNonTextContent(messages);
  const injected = hasPersona ? safeMessages : [baseSystem, vehicleSystem, ...safeMessages];

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
      packed = tryPacked;
      estBase = estTry;
      mem.summary = newSummary;
      mem.userTurns = 0;
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
    const response = await openAIChat({ route: '/chat', model, tier: 'token', payload, meta: { note: `rid=${req._rid}, msgs=${packed.length}` } });

    let raw = response.data.choices?.[0]?.message?.content ?? '';
    raw = sanitizeAssistantText(raw);

    let vehicle_used = null;
    const metaMatch = raw.match(/\[\[META:\s*(\{[\s\S]*?\})\s*\]\]\s*$/);
    if (metaMatch) {
      try {
        const m = JSON.parse(metaMatch[1]);
        if (m && typeof m === 'object' && 'vehicle_used' in m) vehicle_used = m.vehicle_used || null;
      } catch { }
      raw = raw.replace(/\n?\s*\[\[META:[\s\S]*\]\]\s*$/, '').trim();
    }

    res.json({ reply: raw, usage: response.data.usage, vehicle_used });
  } catch (error) {
    console.error('OpenAI Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Something went wrong with OpenAI' });
  }
});

// ---- IMAGE DIAGNOSE (VISION) ----
app.post('/image-diagnose', async (req, res) => {
  try {
    const { imageBase64, text = '', vehicle = null, model: requestedModel } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64.' });

    const optimized = await optimizeImageBase64(imageBase64, {
      maxWidth: 900,
      quality: 45,
      toGrayscale: false,
      normalize: true,
    });

    const model = requestedModel || MODELS.IMAGE_DIAGNOSE;
    const vSummary = summarizeVehicle(vehicle) || 'unknown';

    const payload = {
      model,
      messages: [
        { role: 'system', content: getTorqueVisionPrompt() },
        { role: 'system', content: vehicleSystemMessage(vehicle) },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `VEHICLE: ${vSummary}

USER NOTE:
${(text || '').trim() || '(no text provided)'}

Task: analyze the attached photo for whatever the user asks for as long as its car related.
If the image has no context, identify likely part(s) and be honest about uncertainty.
Return part numbers only if reasonably confident, and include confidence.`
            },
            { type: 'image_url', image_url: { url: optimized, detail: 'low' } },
          ],
        },
      ],
      temperature: 0.3,
      max_tokens: 450,
    };

    const response = await openAIChat({
      route: '/image-diagnose',
      model,
      tier: 'token',
      payload,
      meta: { note: `rid=${req._rid}, vision=diag` },
    });

    let reply = response.data?.choices?.[0]?.message?.content?.trim() || '';
    reply = sanitizeAssistantText(reply);
    reply = reply.replace(/\n?\s*\[\[META:[\s\S]*\]\]\s*$/, '').trim();

    return res.json({ reply, usage: response.data?.usage || {} });
  } catch (e) {
    console.error('Image diagnose error:', e.response?.data || e.message);
    return res.status(500).json({ error: 'Failed to process image.' });
  }
});

// ---- AUDIO DIAGNOSE ----
// Body: { audioBase64: "<base64>", prompt?: string, vehicle?: object, audio_seconds?: number }
app.post('/audio-diagnose', async (req, res) => {
  try {
    const { audioBase64, prompt = 'Diagnose this sound.', vehicle = null, mimeType, filename, audio_seconds } = req.body || {};
    if (!audioBase64) return res.status(400).json({ error: 'Missing audioBase64.' });

    // 1) Transcribe (Whisper)
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    const form = new FormData();
    form.append('file', audioBuffer, {
      filename: filename || 'audio.m4a',
      contentType: mimeType || 'audio/mp4',
    });
    form.append('model', MODELS.AUDIO_TRANSCRIBE);

    const t0 = Date.now();
    const tr = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    const ms = Date.now() - t0;

    const transcript = tr.data?.text?.trim() || '';
    if (!transcript) return res.status(422).json({ error: 'Could not transcribe audio.' });

    // Track audio cost if client provides duration
    let audio_cost_est = null;
    if (typeof audio_seconds === 'number' && audio_seconds > 0) {
      const mins = audio_seconds / 60;
      const rate = AUDIO_PRICING_PER_MIN[MODELS.AUDIO_TRANSCRIBE] || null;
      if (rate != null) audio_cost_est = Number((mins * rate).toFixed(6));
    }
    tracker.recent.push({
      ts: new Date().toISOString(),
      route: '/audio-diagnose#transcribe',
      tier: 'audio',
      model: MODELS.AUDIO_TRANSCRIBE,
      usage: null,
      cost: audio_cost_est,
      ms,
      meta: { note: 'audio transcription' },
    });
    if (tracker.recent.length > 50) tracker.recent.shift();
    console.log(`📊 [/audio-diagnose#transcribe] ${MODELS.AUDIO_TRANSCRIBE} (audio) | ⏱️ ${ms}ms | ✅ transcribed`);

    // 2) Diagnose using transcript
    const packedMessages = [
      { role: 'system', content: getTorquePrompt() },
      { role: 'system', content: vehicleSystemMessage(vehicle) },
      {
        role: 'user',
        content:
          `User recorded audio from a vehicle.
TRANSCRIPT (from audio): ${transcript}

User prompt: ${prompt}

Task:
- Give likely causes (most → least) with rough likelihoods.
- Quick checks (1–5).
- Ask 3 key follow-up questions.
- Keep it compact and practical.`
      }
    ];

    const payload = {
      model: MODELS.AUDIO_DIAGNOSE,
      messages: packedMessages,
      temperature: 0.3,
      max_tokens: 450,
    };

    const response = await openAIChat({
      route: '/audio-diagnose',
      model: payload.model,
      tier: 'token',
      payload,
      meta: { note: `rid=${req._rid}, transcript_ms=${ms}` },
    });

    const reply = response.data?.choices?.[0]?.message?.content?.trim() || '';
    return res.json({ transcript, reply, usage: response.data?.usage || {}, audio_cost_est });
  } catch (e) {
    console.error('Audio diagnose error:', e.response?.data || e.message);
    return res.status(500).json({ error: 'Failed to process audio.' });
  }
});

// --------- VIN photo route (vision candidates + auto-fix) ---------
app.post('/decode-vin', async (req, res) => {
  try {
    let { base64Image, model: requestedModel } = req.body;
    if (!base64Image) return res.status(400).json({ error: 'Missing base64Image in request body.' });

    // Slightly better VIN OCR: normalize+grayscale AND sharpen
    const optimized = await optimizeImageBase64(base64Image, {
      maxWidth: 900, quality: 45, toGrayscale: true, normalize: true, sharpen: true
    });

    const visionModel = MODELS.VIN_VISION;

    async function visionPass(detail = 'low') {
      const payloadVision = {
        model: visionModel,
        messages: [
          {
            role: 'system', content: `
You will receive a photo likely containing a VIN.
Return ONLY JSON with either:
  {"vin":"<17-chars>"}       OR
  {"vins":["<17-chars>", "..."]}
Rules:
- VIN is exactly 17 chars.
- Use uppercase A–Z (no I,O,Q) and digits 0–9.
- If you see I→1, O→0, Q→0.
- Do not return any other keys or prose.
`.trim()
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extract VIN(s) as JSON as specified above.' },
              { type: 'image_url', image_url: { url: optimized, detail } },
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
        meta: { note: `rid=${req._rid}, vision-extract(${detail})` },
      });

      const raw = resp.data?.choices?.[0]?.message?.content?.trim() || '{}';
      let out = {};
      try { out = JSON.parse(raw); }
      catch {
        const m = raw.match(/\{[\s\S]*\}$/);
        out = m ? JSON.parse(m[0]) : {};
      }
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

    const textModel = requestedModel || MODELS.VIN_TEXT;
    const { vehicle, usage: usageText } = await decodeVinTextWithOpenAI(picked, textModel);

    tracker.savedJSON.push({ ts: new Date().toISOString(), route: '/decode-vin', vin: picked, json: vehicle });
    if (tracker.savedJSON.length > 100) tracker.savedJSON.shift();

    const usageVision = (() => {
      const a = usageVisionLow || {};
      const b = usageVisionHigh || {};
      return {
        prompt_tokens: (a.prompt_tokens || 0) + (b.prompt_tokens || 0),
        completion_tokens: (a.completion_tokens || 0) + (b.completion_tokens || 0),
        total_tokens: (a.total_tokens || 0) + (b.total_tokens || 0),
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
        text: { model: textModel, usage: usageText, estimated_cost_usd: Number(costText.toFixed(6)) },
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
    const model = req.body?.model || MODELS.VIN_TEXT;
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
app.post('/generate-service-recommendations', async (req, res) => {
  const { vehicle, currentMileage } = req.body;
  if (!vehicle || !vehicle.year || !vehicle.make || !vehicle.model) {
    return res.status(400).json({ error: 'Missing required vehicle data (year, make, model).' });
  }

  const TEMPLATE_15 = ALLOWED_SERVICE_IDS.map((id) => ({ id, pr: null, mi: null, mo: null, ap: 1 }));

  try {
    const vparts = [
      vehicle.year, vehicle.make, vehicle.model,
      vehicle.engine ? `engine:${vehicle.engine}` : null,
      vehicle.transmission ? `trans:${vehicle.transmission}` : null,
      vehicle.drive_type ? `drive:${vehicle.drive_type}` : null,
      vehicle.trim ? `trim:${vehicle.trim}` : null,
      vehicle.fuel_type ? `fuel:${vehicle.fuel_type}` : null,
    ].filter(Boolean).join(' ');

    const { facts, usage: factsUsage } = await getVehicleFacts(vehicle);

    const FACTS = {
      is_diesel: facts.is_diesel,
      cylinders: facts.cylinders,
      spark_plug_material: facts.spark_plug_material,
      fuel_filter_serviceable: facts.fuel_filter_serviceable,
      timing_drive: facts.timing_drive,
      timing_service: facts.timing_service,
      power_steering: facts.power_steering
    };

    const systemPrompt = `
You are a certified master mechanic. You will receive:
1) A FACTS object about the vehicle, and
2) A JSON array of 15 maintenance items with IDs in [${ALLOWED_SERVICE_IDS_LIST}].

For EACH item, fill in realistic values for:
- "pr": one of "h" | "m" | "l"
- "mi": interval miles (integer) or null
- "mo": interval months (integer) or null
- "ap": 1 if applicable, else 0

STRICT RULES:
- Return ONLY the UPDATED JSON ARRAY (length 15), same order, same "id" values. No extra keys/prose.
- **You MUST obey FACTS when setting applicability and labels.**
- If FACTS.is_diesel=true => set the Spark Plugs (id 9) "ap": 0 and mi/mo null.
- If FACTS.fuel_filter_serviceable=false => set Fuel Filter (id 12) "ap": 0 and mi/mo null.
- If FACTS.timing_drive="belt" => Timing (id 15) "ap": 1 and "mo"/"mi" as replacement interval.
- If FACTS.timing_drive="chain":
   - If FACTS.timing_service="inspect" => "ap":1 and mi/mo may be null or long; DO NOT set for replacement.
   - Else => "ap":0 and mi/mo null (no scheduled service).
- If FACTS.power_steering="electric" => Power steering fluid (id 14) "ap":0 and mi/mo null.
- Consider ${currentMileage ? `current mileage = ${currentMileage}` : 'unknown mileage'}; still output nominal intervals.
- Use conservative mainstream values if intervals are unclear; do NOT output extremes.

PRIORITY GUIDANCE:
- Oil/filter (1) and brake inspection (5) are at least "m"; raise to "h" if due soon.
- Safety-critical fluid services (6 brake fluid, 7 coolant, 8 trans) typically "m".
`.trim();

    const userPrompt = `
Vehicle: ${vparts}

FACTS (obey these when setting ap/mi/mo):
${JSON.stringify(FACTS)}

Template (update in place and return the ARRAY only):
${JSON.stringify(TEMPLATE_15)}
`.trim();

    const payload = {
      model: MODELS.SERVICE_RECS,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 700
    };

    const response = await openAIChat({
      route: '/generate-service-recommendations',
      model: payload.model,
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
      const pr = (p === 'h' || p === 'm' || p === 'l') ? p : 'l';
      const toNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      return { id, pr, mi: toNum(src?.mi), mo: toNum(src?.mo), ap: (src?.ap === 0 || src?.ap === 1) ? src.ap : 1 };
    });

    // interval enricher (optional)
    let enricherUsage = null;
    if (ENRICH_INTERVALS) {
      const { enriched, usage } = await enrichRecommendedIntervals(vehicle, fixedCompact);
      enricherUsage = usage || null;
      if (enriched) {
        for (const item of fixedCompact) {
          const upd = enriched[item.id];
          if (!upd) continue;

          const currentMi = Number(item.mi);
          const currentMo = Number(item.mo);
          const needMi = !(Number.isFinite(currentMi)) || currentMi <= 0;
          const needMo = !(Number.isFinite(currentMo)) || currentMo <= 0;

          if (needMi && upd.mi != null) item.mi = upd.mi;
          if (needMo && upd.mo != null) item.mo = upd.mo;

          const c = clampReasonable(item.id, item.mi, item.mo);
          item.mi = c.mi; item.mo = c.mo;
        }
      }
    }

    enforceCardTruthiness(facts, fixedCompact);

    const labelOverrides = {};
    if (facts.is_diesel === true) labelOverrides[9] = 'Spark plugs (not applicable — diesel)';
    if (facts.fuel_filter_serviceable === false) labelOverrides[12] = 'Fuel filter (non-serviceable / in-tank)';
    if (facts.timing_drive === 'chain' && facts.timing_service !== 'inspect') labelOverrides[15] = 'Timing chain (no scheduled service)';
    if (facts.power_steering === 'electric') labelOverrides[14] = 'Power steering (electric — no fluid service)';

    let expanded = expandCompactPlan(fixedCompact);
    if (Object.keys(labelOverrides).length) {
      expanded = expanded.map((item) => {
        if (labelOverrides[item.id]) return { ...item, text: labelOverrides[item.id] };
        if (item.id === 12 && item.applies === false) return { ...item, text: 'Fuel filter (non-serviceable / in-tank)' };
        return item;
      });
    }

    if (!expanded.length || expanded.length !== 15) {
      const baseline = ALLOWED_SERVICE_IDS.map((id) => {
        const defaults = {
          1: { pr: 'h', mi: 5000, mo: 6, ap: 1 },
          2: { pr: 'm', mi: 6000, mo: 6, ap: 1 },
          3: { pr: 'l', mi: 15000, mo: 18, ap: 1 },
          4: { pr: 'l', mi: 15000, mo: 18, ap: 1 },
          5: { pr: 'm', mi: 12000, mo: 12, ap: 1 },
          6: { pr: 'm', mi: 30000, mo: 24, ap: 1 },
          7: { pr: 'm', mi: 60000, mo: 48, ap: 1 },
          8: { pr: 'm', mi: 60000, mo: 48, ap: 1 },
          9: { pr: 'm', mi: 100000, mo: 96, ap: facts.is_diesel === true ? 0 : 1 },
          10: { pr: 'l', mi: 60000, mo: 48, ap: 1 },
          11: { pr: 'm', mi: null, mo: 48, ap: 1 },
          12: { pr: 'l', mi: 60000, mo: 48, ap: facts.fuel_filter_serviceable === false ? 0 : 1 },
          13: { pr: 'l', mi: 60000, mo: 48, ap: 1 },
          14: { pr: 'l', mi: 60000, mo: 48, ap: facts.power_steering === 'electric' ? 0 : 1 },
          15: { pr: 'm', mi: facts.timing_drive === 'belt' ? 90000 : null, mo: facts.timing_drive === 'belt' ? 72 : null, ap: facts.timing_drive === 'belt' ? 1 : (facts.timing_drive === 'chain' && facts.timing_service === 'inspect' ? 1 : 0) },
        }[id] || { pr: 'l', mi: null, mo: null, ap: 1 };
        return { id, ...defaults };
      });

      res.json({
        compact: baseline,
        result: expandCompactPlan(baseline),
        usage: response.data?.usage || {},
        facts_usage: factsUsage || undefined,
        enricher_usage: enricherUsage || undefined,
        note: 'Returned baseline due to incomplete model output.',
      });
      return;
    }

    res.json({
      compact: fixedCompact,
      result: expanded,
      usage: response.data?.usage || {},
      facts_usage: factsUsage || undefined,
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
