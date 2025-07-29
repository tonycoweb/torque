const API_URL = 'http://192.168.1.246:3001/chat';

export async function sendToGPT(tier = 'free', chatHistory = []) {
  const trimmed = trimLastTurns(chatHistory, 2); // Only keep 2 user+assistant turns

  console.log("→ Sending to GPT:", JSON.stringify(trimmed, null, 2));
  console.log("Approx. tokens:", estimateTokenCount(trimmed));

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: trimmed,
        tier, // backend injects system prompt
      }),
    });

    if (!response.ok) throw new Error('API Error');
    const data = await response.json();
    return data.reply || "⚠️ Torque didn’t return anything this time.";
  } catch (err) {
    console.error('Error talking to GPT backend:', err);
    return "⚠️ There was an error processing your request.";
  }
}

function trimLastTurns(history, numTurns = 2) {
  const last = history.filter((m) => m.role === 'user' || m.role === 'assistant');
  return last.slice(-numTurns * 2); // e.g., 2 user+assistant pairs = 4 messages
}

function estimateTokenCount(messages) {
  const joined = messages.map(m => `${m.role}:${m.content}`).join('\n');
  return Math.round(joined.length / 4); // rough estimate
}
