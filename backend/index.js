const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Efficient Torque prompts
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

// Max token ceilings
const MAX_TOTAL_TOKENS = {
  free: 1500,
  pro: 6000,
};

// Estimate total tokens (simple heuristic)
function estimateTokenCount(messages) {
  const joined = messages.map(m => `${m.role}:${m.content}`).join('\n');
  return Math.round(joined.length / 4);
}

// Trim chat history down to last N user/assistant turns + system
function trimHistory(messages, maxTurns = 6) {
  const system = messages.find((m) => m.role === 'system');
  const convo = messages.filter(m => m.role !== 'system');
  const recent = convo.slice(-maxTurns * 2);
  return system ? [system, ...recent] : recent;
}

app.post('/chat', async (req, res) => {
  const { messages = [], tier = 'free' } = req.body;

  const systemPrompt = { role: 'system', content: getTorquePrompt(tier) };
  const hasPrompt = messages.some(m => m.role === 'system' && m.content.includes('Torque'));
  const injected = hasPrompt ? messages : [systemPrompt, ...messages];
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
        max_tokens: 600,
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

    console.log('🧮 Token Usage:', usage);
    res.json({ reply, usage });
  } catch (error) {
    console.error('OpenAI Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Something went wrong with OpenAI' });
  }
});

app.post('/decode-vin', async (req, res) => {
  const { base64Image } = req.body;
  if (!base64Image) {
    return res.status(400).json({ error: 'Missing base64Image in request body.' });
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
You are an expert VIN decoder and vehicle data estimator. Your job is to extract the 17-character VIN from the image and decode the vehicle details.

Then, return a JSON object with as many of the following keys as possible:
- vin  
- year  
- make  
- model  
- trim  
- engine  
- transmission (thoroughly determine and state: automatic or manual)  
- drive_type (FWD, RWD, AWD, 4WD)  
- body_style (sedan, coupe, SUV, etc.)  
- fuel_type (gasoline, diesel, electric, hybrid)  
- country (country of manufacture)  
- mpg (estimate based on year/make/model/engine if needed)  
- horsepower (estimate from known trim/engine specs)  
- gross_vehicle_weight_rating (GVWR or gvw — estimate if needed)  
- exterior_color (if available or likely from defaults)

Do not explain. Only return a raw JSON object — no markdown, no headings, no descriptions.
            `.trim(),
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Here is a photo of a VIN. Please extract and decode it:' },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`,
                },
              },
            ],
          },
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

    const reply = response.data.choices[0].message.content;
    const usage = response.data.usage;

    console.log('📦 Full VIN GPT reply:\n' + reply);
    console.log('🔍 VIN Decode Token Usage:', usage);

    res.json({ result: reply, usage });
  } catch (error) {
    console.error('VIN Decode Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to decode VIN.' });
  }
});

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

Only return a flat object. Example (for understanding only):
If a user enters "2004 Infiniti", you might return:
{
  "year": 2004,
  "make": "Infiniti",
  "model": ["G35", "FX35", "QX56"],
  "engine": ["3.5L V6", "4.5L V8"]
}

Return ONLY clean JSON. No markdown or explanations. Fill in the expected keys if possible based off data
or once its validated properly and you can infer the vehicle exists and thus return the expected keys filled.

Expected keys:
- year
- make
- model
- engine
- transmission
- drive_type
- body_style
- fuel_type
- mpg
- horsepower
- gvw
- trim (optional)
- variants (optional array of differing configurations)
            `.trim(),
          },
          {
            role: 'user',
            content: `Year: ${year}, Make: ${make}, Model: ${model}, Engine: ${engine || '(blank)'}`,
          },
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

// --- REPLACE your /generate-service-recommendations handler with this ---
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

REQUIREMENTS (important):
1) Output must be ONLY a JSON array of objects, no markdown.
2) Each object MUST have:
   - "text": short service description ONLY (no numbers, no "miles", no "every", no hyphens)
     ✓ Examples: "Oil/Filter Change", "Cabin Air Filter", "Brake Fluid", "Front Differential Fluid"
     ✗ INVALID: "Oil Change - 7,500 miles", "Oil Change every 7,500 miles"
   - "priority": "high" | "medium" | "low"
   - "mileage": NUMBER interval in miles (omit if N/A)
   - "time_months": NUMBER interval in months (omit if N/A)
   - "applies": true|false (true only if this service actually applies to the given vehicle config)
3) Include **a complete baseline list** appropriate for the powertrain:
   ENGINE/GENERAL:
     - Oil/Filter Change, Engine Air Filter, Cabin Air Filter, Spark Plugs (if non-diesel),
       PCV Valve (if serviceable), Drive/Serpentine Belt, Timing Belt inspect/replace (if belt; if chain -> applies=false but include inspection),
       Coolant flush, Brake Fluid flush, Battery Test, Tire Rotation, Alignment Check
   FUEL:
     - Fuel Filter (only if serviceable—some are in-tank lifetime; set applies accordingly)
   TRANSMISSION/DRIVELINE:
     - Automatic Transmission Fluid (AT) or CVT/DCT/Manual (choose correct ONE), Transfer Case (if 4WD/AWD and applicable),
       Front Differential service, Rear Differential service (applies based on drivetrain)
   CHASSIS/INSPECTION:
     - Brake Pads/Rotors Inspection, Suspension/Steering Inspection, Hoses & Clamps Check
4) If something is **not applicable** (e.g., “Front Differential” on FWD cars, or “Fuel Filter” is non-serviceable), set "applies": false.
   Still include it (so the app can be consistent), but with applies=false.
5) Choose realistic factory-like intervals (miles **and** months when known). Prefer both; if time is unknown, omit time_months.
6) Consider currentMileage for priority ranking only; do NOT bake mileage numbers into "text".
7) Return ONLY clean JSON array. No explanations. No extra keys.
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

    // Helpers
    const cleanText = (t) => {
      const s = String(t || '').trim();
      // Remove trailing interval hints if model ever slips:
      const rx = /\s*(?:[-–—]\s*)?(?:every\s+)?\d[\d,\.kK]*\s*(?:mi|miles?)\s*(?:\/\s*\d+\s*months?)?$/i;
      return s.replace(rx, '').trim();
    };
    const toNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };

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