// routes/chat.js
const express = require('express');
const router = express.Router();
const axios = require('axios');

// 代理GPT请求的接口
router.post('/completions', async (req, res) => {
  try {
    const { messages, model = 'qwen-plus', temperature = 0.7 } = req.body;
    
    console.log('[GPT Request] 收到请求:', { messages, model, temperature });

    // 验证必要参数
    if (!messages || !Array.isArray(messages)) {
      console.warn('[GPT Request] 无效的消息格式:', messages);
      return res.status(400).json({ error: 'Invalid messages format' });
    }

    // 调用OpenAI API
    const response = await axios.post(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        model,
        messages,
        temperature,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 
        },
      }
    );

    console.log('[GPT Response] 成功接收响应:', response.data);

    // 转发OpenAI的响应
    res.json(response.data);
  } catch (error) {
    console.error('[GPT API Error] 请求失败:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.error?.message || 'GPT API request failed'
    });
  }
});

module.exports = router;