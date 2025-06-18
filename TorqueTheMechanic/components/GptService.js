// components/GptService.js

import { getTorquePrompt } from './TorquePrompt';

 // Update to deployed URL later

export async function sendToGPT(message, tier = 'free') {
  const system = getTorquePrompt(tier);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, system }),
    });

    if (!response.ok) throw new Error('API Error');

    const data = await response.json();
    return data.reply || "⚠️ Torque didn’t return anything this time.";
  } catch (err) {
    console.error('Error talking to GPT backend:', err);
    return "⚠️ There was an error processing your request.";
  }
}
