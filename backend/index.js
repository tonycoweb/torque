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

// Track usage
const tracker = { totals:{}, byRoute:{}, byTier:{}, recent:[], savedJSON:[] };

function priceFor(model){ return MODEL_PRICING[model] || { in:0, out:0 }; }
function costFor(model, usage = {}) {
  const p = priceFor(model);
  const pt = Number(usage.prompt_tokens || 0);
  const ct = Number(usage.completion_tokens || 0);
  // pricing is per *million*
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
// VIN
function normalizeVin(str=''){ return String(str).toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/[IOQ]/g,''); }
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

// Persona (token-based; no Pro upsell)
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

// Vehicle helpers
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
const HISTORY_WINDOW_TURNS = 3;     // last 3 user + 3 assistant
const SUMMARY_EVERY_N_USER = 2;     // summarize every 2 user messages
const SUMMARY_MAX_TOKENS = 100;     // short!
const memoryStore = new Map();      // convoId -> { summary: string, userTurns: number }

function estimateTokenCount(messages){
  const joined=messages.map(m => {
    const c = (typeof m.content === 'string') ? m.content : JSON.stringify(m.content);
    return `${m.role}:${c}`;
  }).join('\n');
  return Math.round(joined.length/4);
}
function trimToRecent(messages, maxTurns=HISTORY_WINDOW_TURNS){
  const systems = messages.filter(m => m.role==='system');
  const convo   = messages.filter(m => m.role!=='system');
  const recent  = convo.slice(-maxTurns*2);
  return [...systems, ...recent];
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
  // Summarize only user/assistant parts (skip system)
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

// Light sanitizer for assistant text: cap svg/diagram blocks to keep payload tiny
function sanitizeAssistantText(s, maxBlock = 20000){
  if (!s || typeof s !== 'string') return s;
  const replacer = (tag) => {
    const re = new RegExp("```"+tag+"\\s*([\\s\\S]*?)```","g");
    return s.replace(re, (_m, inner) => {
      let clean = String(inner || '');
      // basic minification for svg
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

// ======================= Routes =======================
app.get('/pricing', (req, res) => {
  res.json({ per_1M_tokens: MODEL_PRICING, free_mode: OPENAI_FREE_MODE });
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
    model: requestedModel,          // optional override
  } = req.body;

  const model = requestedModel || 'gpt-4o';

  const baseSystem = { role: 'system', content: getTorquePrompt() };
  const vehicleSystem = { role: 'system', content: vehicleSystemMessage(vehicle) };
  const hasPersona = messages.some(m => m.role === 'system' && /TorqueTheMechanic/i.test(m.content));
  const injected = hasPersona ? messages : [baseSystem, vehicleSystem, ...messages];

  // Summary cadence
  const mem = memoryStore.get(convoId) || { summary: '', userTurns: 0 };
  const userTurnsThisReq = messages.filter(m => m.role === 'user').length;
  const shouldSummarize = ((mem.userTurns + userTurnsThisReq) >= SUMMARY_EVERY_N_USER);

  // Pack baseline (no new summary)
  let packed = packWithSummary({ messages: injected, summaryText: mem.summary, maxTurns: HISTORY_WINDOW_TURNS });
  let estBase = estimateTokenCount(packed);

  // Try autosummary only if cadence says so
  if (shouldSummarize) {
    const newSummary = await autosummarize(convoId, injected);
    const tryPacked = packWithSummary({ messages: injected, summaryText: newSummary, maxTurns: HISTORY_WINDOW_TURNS });
    const estTry = estimateTokenCount(tryPacked);
    if (estTry <= estBase) {
      packed = tryPacked;
      estBase = estTry;
      mem.summary = newSummary;
      mem.userTurns = 0; // reset after summarizing
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

    // strip final [[META...]] line into field
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

// --------- VIN photo route (2-stage: extract -> decode) ---------
app.post('/decode-vin', async (req, res) => {
  try {
    let { base64Image, model: requestedModel } = req.body;
    if (!base64Image) return res.status(400).json({ error: 'Missing base64Image in request body.' });

    const optimized = await optimizeImageBase64(base64Image, { maxWidth: 900, quality: 45, toGrayscale: true, normalize: true });

    const visionModel = 'gpt-4o-mini';
    const payloadVision = {
      model: visionModel,
      messages: [
        { role:'system', content: `
You will receive a photo likely containing a VIN.
Return ONLY: {"vin":"<17-chars>"} or {"vin": null}
Rules: 17 chars; uppercase A–Z (no I,O,Q) + digits.
`.trim() },
        {
          role:'user',
          content: [
            { type:'text', text:'Extract the VIN as JSON: {"vin":"..."}' },
            { type:'image_url', image_url: { url: optimized, detail: 'low' } },
          ],
        },
      ],
      temperature: 0.0,
      max_tokens: 60,
    };

    const respVision = await openAIChat({
      route: '/decode-vin#vision',
      model: visionModel,
      tier: 'token',
      payload: payloadVision,
      meta: { note:`rid=${req._rid}, vision-extract` },
    });

    const rawV = respVision.data?.choices?.[0]?.message?.content?.trim() || '{}';
    let vinObj;
    try { vinObj = JSON.parse(rawV); }
    catch { const m = rawV.match(/\{[\s\S]*\}$/); vinObj = m ? JSON.parse(m[0]) : {}; }

    let vin = normalizeVin(vinObj?.vin || '');
    if (!isValidVinBasic(vin)) return res.status(422).json({ error: 'Could not find a valid VIN in the image.' });
    if (!isValidVin(vin)) return res.status(422).json({ error: 'Found VIN failed check-digit validation.' });

    const textModel = requestedModel || 'gpt-4o';
    const { vehicle, usage: usageText } = await decodeVinTextWithOpenAI(vin, textModel);

    tracker.savedJSON.push({ ts:new Date().toISOString(), route:'/decode-vin', vin, json:vehicle });
    if(tracker.savedJSON.length>100) tracker.savedJSON.shift();

    const usageVision = respVision.data?.usage || {};
    const costVision = costFor(visionModel, usageVision);
    const costText = costFor(textModel, usageText || {});
    const totalCost = (costVision + costText);

    return res.json({
      vin_extracted: vin,
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

// --------- Typed VIN route ---------
app.post('/decode-vin-text', async (req, res) => {
  try {
    const model = req.body?.model || 'gpt-4o';
    const vin = normalizeVin(req.body?.vin || '');
    if (!isValidVinBasic(vin)) return res.status(400).json({ error: 'Invalid VIN. Must be 17 chars (no I/O/Q).' });
    if (!isValidVin(vin))   return res.status(400).json({ error: 'Invalid VIN check digit.' });

    const { vehicle, usage } = await decodeVinTextWithOpenAI(vin, model);
    return res.json({ vehicle, usage });
  } catch (err) {
    console.error('VIN Text Decode Error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Failed to decode VIN.' });
  }
});

// --------- Manual validator ---------
app.post('/validate-manual', async (req, res) => {
  const { year, make, model, engine } = req.body;
  const mdl = req.body?.model || 'gpt-4o';
  try {
    const payload = {
      model: mdl,
      messages:[
        { role:'system', content: `
You are a precise vehicle decoder. A user will input partial information (like year, make, model, or engine). Your job is to:
1. Use the provided fields as-is and do not change them.
2. Identify which fields are **missing** or ambiguous.
3. For each missing/uncertain field, return an array of valid options.
4. For certain fields, return canonical strings.
5. Return raw JSON only (no markdown).
Keys: year, make, model, engine, transmission, drive_type, body_style, fuel_type, mpg, horsepower, gvw, trim (optional), variants (optional)
`.trim() },
        { role:'user', content:`Year: ${year}, Make: ${make}, Model: ${model}, Engine: ${engine || '(blank)'}` },
      ],
      temperature:0.3,
      max_tokens:600,
    };

    const response = await openAIChat({ route:'/validate-manual', model: mdl, tier:'token', payload, meta:{ note:`rid=${req._rid}` } });
    const reply = response.data.choices[0].message.content.trim();
    res.json({ result: reply, usage: response.data.usage });
  } catch (error) {
    console.error(`Manual Validation Error:`, error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to validate vehicle.' });
  }
});

// --------- Service recommendations ---------
app.post('/generate-service-recommendations', async (req, res) => {
  const { vehicle, currentMileage } = req.body;
  const mdl = req.body?.model || 'gpt-4o';
  if (!vehicle || !vehicle.year || !vehicle.make || !vehicle.model) {
    return res.status(400).json({ error: 'Missing required vehicle data (year, make, model).' });
  }
  try {
    const payload = {
      model: mdl,
      messages:[
        { role:'system', content: `
You are a certified master mechanic building a factory-style maintenance plan that combines mileage **and** time intervals.
REQUIREMENTS:
1) ONLY JSON array of objects, no markdown.
2) Each object MUST have: text, priority, mileage?, time_months?, applies
3) Include baseline list; set applies=false for non-applicable items; pick realistic intervals.
`.trim() },
        { role:'user', content:`Generate service recommendations for a ${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.engine?` with ${vehicle.engine}`:''}${currentMileage?`, current mileage: ${currentMileage}`:''}.` },
      ],
      temperature:0.2,
      max_tokens:1200,
    };

    const response = await openAIChat({ route:'/generate-service-recommendations', model: mdl, tier:'token', payload, meta:{ note:`rid=${req._rid}` } });
    const reply = response.data.choices[0].message.content;
    const usage = response.data.usage;

    let result;
    try {
      result = JSON.parse(reply);
      if (!Array.isArray(result)) throw new Error('Response is not an array');
    } catch (error) {
      console.error('Parse Error:', error.message, reply);
      return res.status(500).json({ error: 'Failed to parse service recommendations.' });
    }

    const cleanText = (t)=>{ const s=String(t||'').trim(); const rx=/\s*(?:[-–—]\s*)?(?:every\s+)?\d[\d,\.kK]*\s*(?:mi|miles?)\s*(?:\/\s*\d+\s*months?)?$/i; return s.replace(rx,'').trim(); };
    const toNum = (v)=>{ const n=Number(v); return Number.isFinite(n)?n:undefined; };

    const sanitized = result.map((item)=>{
      const priority = String(item.priority||'').toLowerCase();
      const normalized = ['high','medium','low'].includes(priority) ? priority : 'low';
      return { text: cleanText(item.text), priority: normalized, mileage: toNum(item.mileage), time_months: toNum(item.time_months), applies: Boolean(item.applies) };
    });

    res.json({ result: sanitized, usage });
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
});
