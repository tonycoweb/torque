// backend/index.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// POST endpoint to handle messages from the frontend
app.post('/chat', async (req, res) => {
    const { message, system } = req.body;
  
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o', // or tier-based switch logic
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: message }
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );
  
      const reply = response.data.choices[0].message.content;
      res.json({ reply });
    } catch (error) {
      console.error('OpenAI Error:', error.response?.data || error.message);
      res.status(500).json({ error: 'Something went wrong with OpenAI' });
    }
  });
  
  

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});
