// index.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ---------------- VIN helpers (safe, local) ----------------
function normalizeVin(str = '') {
  return String(str).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[IOQ]/g, '');
}
function isValidVin(vin = '') {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
}

// ---------------- Prompts ----------------
const getTorquePrompt = (tier = 'free') => {
  if (tier === 'pro') {
    return `
You are Torque — a certified Pro mechanic. Be blunt, confident, and clear. Give short, trusted answers based on real-world repair knowledge and mechanic consensus. 
Search trusted sources and occasionally offer to return your sources to users if needed. Never mention AI — act human, like a real pro helping in the garage.
If asked, say: "I'm upgraded — I research live sources and give expert-verified fixes, not just guesses."
Only discuss cars. Fix fast, explain when needed.
    `.trim();
  }

  return `
You live inside the app TorqueTheMechanic.
Avoid consulting professional mechanics, local shops, or dealerships unless asked for.
You're Torque — a bit sarcastic sometimes, charismatic, kind, and funny sometimes also not afraid to keep it blunt sometimes. 
Never mention AI. Keep replies short, simple, confident, and all about cars.
Occasionally upsell Pro using top marketing words and techniques: 
Pro: allows Torque to -> research trusted forums and service docs live, return in depth research, receive pics for visual part identifying, 
receive sound to help with sound related diagnostics, gives user more energy(tokens) for Torque to work!
If asked what Pro is: Promote what Pro allows you to do
If asked how to upgrade: Hit the upgrade button in settings — top right corner of the app.
Be the best mechanic you can be, consider different possibilities for diagnostics and list what could be the issues. 
Carefully consider users inputs before returning list of possibilities to avoid giving bad answers also verify if the list items even apply to 
the users vehicle before returning aka part mentioned may not exist on that car this cannot occur.
You must process as an automotive expert and Organize your replies in a mechanic friendly way.
Bring off-topic chats back with humor.
  `.trim();
};

// Build a compact, readable vehicle context line from optional fields
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
    v.body_style && `Body: ${v.body_style}`,
  ].filter(Boolean).join(' | ');
  return extras ? `${main} (${extras})` : main;
}

// Compose a system helper message that sets default vehicle + metadata contract
function vehicleSystemMessage(vehicle) {
  const hasVehicle = vehicle && vehicle.make && vehicle.model;
  const summary = hasVehicle ? summarizeVehicle(vehicle) : 'unknown';
  return `
VEHICLE CONTEXT:
- Default vehicle for this conversation: ${summary || 'unknown'}.
- Assume questions refer to this vehicle unless the user clearly switches to a different one.
- If the user specifies a different vehicle, use that for this reply.

METADATA CONTRACT (IMPORTANT):
- At the **very end** of EVERY reply, append exactly one line in this format:
  [[META: {"vehicle_used": <object-or-null>}]]
- "vehicle_used" must reflect the vehicle you actually used for reasoning **for this reply**.
- If using the default context, include the best-known fields (year, make, model, trim, engine, transmission, drive_type, body_style) that you’re confident in.
- If user switched vehicles this turn, set "vehicle_used" to that new one with whatever fields the user provided.
- If no vehicle is known, set "vehicle_used": null.
- Do NOT explain this metadata or mention it in normal text. Keep it as the final line only.
  `.trim();
}

// ---------------- Token controls ----------------
const MAX_TOTAL_TOKENS = { free: 1500, pro: 6000 };

function estimateTokenCount(messages) {
  const joined = messages.map(m => `${m.role}:${m.content}`).join('\n');
  return Math.round(joined.length / 4);
}

function trimHistory(messages, maxTurns = 6) {
  const system = messages.find((m) => m.role === 'system');
  const convo = messages.filter(m => m.role !== 'system');
  const recent = convo.slice(-maxTurns * 2);
  return system ? [system, ...recent] : recent;
}

// ---------------- OpenAI helpers ----------------
async function decodeVinTextWithOpenAI(vin) {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `
You are an expert VIN decoder. Input is a 17-character VIN string.
Return ONLY raw JSON (no markdown). Use keys:
vin, year, make, model, trim, engine, transmission, drive_type, body_style, fuel_type,
mpg, horsepower, gvw. Omit unknowns.
          `.trim(),
        },
        { role: 'user', content: vin },
      ],
      temperature: 0.2,
      max_tokens: 600,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const raw = response.data.choices?.[0]?.message?.content?.trim() || '{}';
  let vehicle;
  try {
    vehicle = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}$/);
    vehicle = m ? JSON.parse(m[0]) : null;
  }
  if (!vehicle || typeof vehicle !== 'object') {
    throw new Error('Failed to parse VIN details.');
  }

  vehicle.vin = vin; // ensure normalized VIN
  return { vehicle, usage: response.data.usage };
}

// ---------------- Routes ----------------
app.post('/chat', async (req, res) => {
  const { messages = [], tier = 'free', vehicle = null } = req.body;

  const baseSystem = { role: 'system', content: getTorquePrompt(tier) };
  const vehicleSystem = { role: 'system', content: vehicleSystemMessage(vehicle) };

  const hasTorque = messages.some(m => m.role === 'system' && m.content.includes('TorqueTheMechanic'));
  const injected = hasTorque ? messages : [baseSystem, vehicleSystem, ...messages];

  const finalMessages = trimHistory(injected);
  const estimatedTokens = estimateTokenCount(finalMessages);
  if (estimatedTokens > MAX_TOTAL_TOKENS[tier]) {
    return res.status(400).json({ error: '🛑 Token limit exceeded. Please shorten your chat or upgrade to Pro.' });
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: finalMessages,
        temperature: tier === 'pro' ? 0.7 : 0.5,
        max_tokens: 700,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    let raw = response.data.choices?.[0]?.message?.content ?? '';
    const usage = response.data.usage;

    let vehicle_used = null;
    const metaMatch = raw.match(/\[\[META:\s*(\{[\s\S]*?\})\s*\]\]\s*$/);
    if (metaMatch) {
      try {
        const meta = JSON.parse(metaMatch[1]);
        if (meta && typeof meta === 'object' && 'vehicle_used' in meta) {
          vehicle_used = meta.vehicle_used || null;
        }
      } catch {}
      raw = raw.replace(/\n?\s*\[\[META:[\s\S]*\]\]\s*$/, '').trim();
    }

    res.json({ reply: raw, usage, vehicle_used });
  } catch (error) {
    console.error('OpenAI Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Something went wrong with OpenAI' });
  }
});

// --------- VIN photo route (SIMPLE: one call — find VIN anywhere & decode; return JSON) ---------
app.post('/decode-vin', async (req, res) => {
  try {
    let { base64Image } = req.body;
    if (!base64Image) {
      return res.status(400).json({ error: 'Missing base64Image in request body.' });
    }
    // Accept bare base64 or data URL; normalize to data URL
    if (!/^data:image\/(png|jpe?g);base64,/.test(base64Image)) {
      base64Image = `data:image/jpeg;base64,${base64Image}`;
    }

    // Single vision pass: OCR + VIN extraction + decode + JSON
    const payload = {
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `
You will receive an image that may be a door sticker, windshield plate, title/registration, or any document/photo that might contain a vehicle VIN.
1) Scan the entire image (including rotated/small text) and find the best VIN candidate:
   - VIN must be exactly 17 characters and match /^[A-HJ-NPR-Z0-9]{17}$/ (NO I, O, Q).
2) If a valid VIN is found, decode it (year, make, model, etc.).
3) Return ONLY JSON with these keys (omit unknowns):
   vin, year, make, model, trim, engine, transmission, drive_type, body_style, fuel_type, mpg, horsepower, gvw.
No markdown. No extra commentary. JSON object only.
          `.trim(),
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Find the VIN anywhere in this image, decode it, and return ONLY the JSON object.' },
            { type: 'image_url', image_url: { url: base64Image, detail: 'high' } },
          ],
        },
      ],
      temperature: 0.0,
      max_tokens: 900,
    };

    const resp = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const raw = resp.data?.choices?.[0]?.message?.content?.trim() || '{}';
    let vehicle;
    try {
      vehicle = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}$/);
      vehicle = m ? JSON.parse(m[0]) : null;
    }

    if (!vehicle || typeof vehicle !== 'object' || !vehicle.vin) {
      return res.status(422).json({ error: 'Could not find a valid 17-character VIN in the image.' });
    }

    // Normalize and validate VIN
    vehicle.vin = normalizeVin(vehicle.vin);
    if (!isValidVin(vehicle.vin)) {
      return res.status(422).json({ error: 'Found VIN is invalid (must be 17 chars, no I/O/Q).' });
    }

    return res.json({ vehicle });
  } catch (error) {
    console.error('VIN Photo Decode Error:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Failed to decode VIN from photo.' });
  }
});

// --------- Typed VIN route (unchanged) ---------
app.post('/decode-vin-text', async (req, res) => {
  try {
    const vin = normalizeVin(req.body?.vin || '');
    if (!isValidVin(vin)) {
      return res.status(400).json({ error: 'Invalid VIN. Must be 17 chars (no I/O/Q).' });
    }
    const { vehicle, usage } = await decodeVinTextWithOpenAI(vin);
    return res.json({ vehicle, usage });
  } catch (err) {
    console.error('VIN Text Decode Error:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Failed to decode VIN.' });
  }
});

// --------- Manual validator (unchanged) ---------
app.post('/validate-manual', async (req, res) => {
  const { year, make, model, engine } = req.body;

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `
You are a precise vehicle decoder. A user will input partial information (like year, make, model, or engine). Your job is to:

1. Use the provided fields as-is and do not change them.
2. Identify which fields are **missing** or ambiguous.
3. For each missing or uncertain field, return a list of valid options as an array.
4. For fields that are certain or known (e.g., fixed by the user), return them as strings.
5. Do NOT return multiple full vehicle variants.
6. Do NOT return markdown or explanations — only raw JSON.

Only return a flat object.
Expected keys:
- year, make, model, engine, transmission, drive_type, body_style, fuel_type, mpg, horsepower, gvw, trim (optional), variants (optional)
            `.trim(),
          },
          { role: 'user', content: `Year: ${year}, Make: ${make}, Model: ${model}, Engine: ${engine || '(blank)'}` },
        ],
        temperature: 0.3,
        max_tokens: 600,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const reply = response.data.choices[0].message.content.trim();
    console.log('✅ Manual Validation GPT Reply:', reply);
    res.json({ result: reply });
  } catch (error) {
    console.error(`Manual Validation Error:`, error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to validate vehicle.' });
  }
});

// --------- Service recommendations (unchanged) ---------
app.post('/generate-service-recommendations', async (req, res) => {
  const { vehicle, currentMileage } = req.body;
  if (!vehicle || !vehicle.year || !vehicle.make || !vehicle.model) {
    return res.status(400).json({ error: 'Missing required vehicle data (year, make, model).' });
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `
You are a certified master mechanic building a factory-style maintenance plan that combines mileage **and** time intervals.
REQUIREMENTS:
1) ONLY JSON array of objects, no markdown.
2) Each object MUST have: text, priority, mileage?, time_months?, applies
3) Include baseline list; set applies=false for non-applicable items; pick realistic intervals.
            `.trim(),
          },
          {
            role: 'user',
            content: `Generate service recommendations for a ${vehicle.year} ${vehicle.make} ${vehicle.model}${vehicle.engine ? ` with ${vehicle.engine}` : ''}${currentMileage ? `, current mileage: ${currentMileage}` : ''}.`,
          },
        ],
        temperature: 0.2,
        max_tokens: 1600,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

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

    const cleanText = (t) => {
      const s = String(t || '').trim();
      const rx = /\s*(?:[-–—]\s*)?(?:every\s+)?\d[\d,\.kK]*\s*(?:mi|miles?)\s*(?:\/\s*\d+\s*months?)?$/i;
      return s.replace(rx, '').trim();
    };
    const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };

    const sanitized = result.map((item) => {
      const priority = String(item.priority || '').toLowerCase();
      const normalizedPriority = ['high', 'medium', 'low'].includes(priority) ? priority : 'low';
      return {
        text: cleanText(item.text),
        priority: normalizedPriority,
        mileage: toNum(item.mileage),
        time_months: toNum(item.time_months),
        applies: Boolean(item.applies),
      };
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
});
