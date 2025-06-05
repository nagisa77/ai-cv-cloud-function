// routes/chat.js
const express = require('express');
const router = express.Router();
const axios = require('axios');

// 代理GPT请求的接口
router.post('/completions', async (req, res) => {
  try {
    const defaultModel = process.env.OPENAI_MODEL || 'deepseek-chat';
    const { messages, model = defaultModel, temperature = 0.7 } = req.body;
    
    console.log('[GPT Request] 收到请求:', { messages, model, temperature });

    // 验证必要参数
    if (!messages || !Array.isArray(messages)) {
      console.warn('[GPT Request] 无效的消息格式:', messages);
      return res.status(400).json({ error: 'Invalid messages format' });
    }

    // 根据模型选择 API 地址
    const baseUrl = model.toLowerCase().includes('qwen')
      ? 'https://dashscope.aliyuncs.com/compatible-mode'
      : 'https://api.deepseek.com';

    // 调用 OpenAI 兼容接口
    const response = await axios.post(
      `${baseUrl}/v1/chat/completions`,
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
