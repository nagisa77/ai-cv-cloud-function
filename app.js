const express = require('express');
const cors = require('cors'); // 引入 CORS 模块
const redis = require('redis');
const app = express();

// 启用 CORS，允许来自 http://localhost:8080 的请求（可根据需要调整）
app.use(cors({
  origin: 'http://localhost:8080',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 解析 JSON 请求体
app.use(express.json());

// 连接到远程 Redis
const client = redis.createClient({
  host: '23.159.248.46', // Redis 服务器 IP
  port: 6379,            // Redis 默认端口
  password: 'qq1216414009'
});

client.on('connect', () => {
  console.log('Connected to Redis');
});

/**
 * --- 元数据接口 --- 
 * 路径格式： /:user_id/meta_data
 */

// 获取用户的元数据
app.get('/:user_id/meta_data', (req, res) => {
  const userId = req.params.user_id;
  client.hget(`${userId}`, 'meta_data', (err, data) => {
    if (err) return res.status(500).send('Error retrieving meta_data');
    if (!data) return res.status(404).send('Meta_data not found');
    try {
      const parsedData = JSON.parse(data);
      res.status(200).json(parsedData);
    } catch (error) {
      res.status(500).send('Error parsing meta_data');
    }
  });
});

// 新增或覆盖元数据
app.post('/:user_id/meta_data', (req, res) => {
  const userId = req.params.user_id;
  const metaData = req.body;
  client.hset(`${userId}`, 'meta_data', JSON.stringify(metaData), (err, reply) => {
    if (err) return res.status(500).send('Error saving meta_data');
    res.status(200).send({ message: 'Meta_data created successfully' });
  });
});

// 更新元数据
app.put('/:user_id/meta_data', (req, res) => {
  const userId = req.params.user_id;
  const metaData = req.body;
  client.hset(`${userId}`, 'meta_data', JSON.stringify(metaData), (err, reply) => {
    if (err) return res.status(500).send('Error updating meta_data');
    res.status(200).send({ message: 'Meta_data updated successfully' });
  });
});

// 删除元数据
app.delete('/:user_id/meta_data', (req, res) => {
  const userId = req.params.user_id;
  client.hdel(`${userId}`, 'meta_data', (err, reply) => {
    if (err || reply === 0) return res.status(404).send('Meta_data not found');
    res.status(200).send({ message: 'Meta_data deleted successfully' });
  });
});

/**
 * --- 聊天数据接口 ---
 */

// 获取用户的聊天数据
app.get('/:user_id/chat', (req, res) => {
  const userId = req.params.user_id;
  client.hget(`${userId}`, 'chat', (err, data) => {
    if (err) return res.status(500).send('Error retrieving chat data');
    if (!data) return res.status(404).send('Chat data not found');
    try {
      const parsedData = JSON.parse(data);
      res.status(200).json(parsedData);
    } catch (error) {
      res.status(500).send('Error parsing chat data');
    }
  });
});

// 新增或覆盖聊天数据
app.post('/:user_id/chat', (req, res) => {
  const userId = req.params.user_id;
  const chatData = req.body;
  client.hset(`${userId}`, 'chat', JSON.stringify(chatData), (err, reply) => {
    if (err) return res.status(500).send('Error saving chat data');
    res.status(200).send({ message: 'Chat data created successfully' });
  });
});

// 更新聊天数据
app.put('/:user_id/chat', (req, res) => {
  const userId = req.params.user_id;
  const chatData = req.body;
  client.hset(`${userId}`, 'chat', JSON.stringify(chatData), (err, reply) => {
    if (err) return res.status(500).send('Error updating chat data');
    res.status(200).send({ message: 'Chat data updated successfully' });
  });
});

// 删除聊天数据
app.delete('/:user_id/chat', (req, res) => {
  const userId = req.params.user_id;
  client.hdel(`${userId}`, 'chat', (err, reply) => {
    if (err || reply === 0) return res.status(404).send('Chat data not found');
    res.status(200).send({ message: 'Chat data deleted successfully' });
  });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Internal Serverless Error');
});

// 云函数（Web 类型）监听 9000 端口
app.listen(9000, () => {
  console.log('Server start on http://localhost:9000');
});
