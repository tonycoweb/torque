const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

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
        max_tokens: 600, // Controlled response length
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
    res.json({ reply, usage }); // Optional: return token info to client
  } catch (error) {
    console.error('OpenAI Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Something went wrong with OpenAI' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});
