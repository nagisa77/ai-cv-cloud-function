const express = require('express');
const redis = require('redis');
const app = express();

// 解析请求体
app.use(express.json());

// 连接到远程 Redis
const client = redis.createClient({
  host: '23.159.248.46', // Redis 服务器的 IP 地址
  port: 6379, // Redis 默认端口
  // 如果需要密码认证，取消下面的注释并修改密码
  password: 'qq1216414009'
});

// Redis 连接成功后打印消息
client.on('connect', () => {
  console.log('Connected to Redis');
});

// 处理增（Create）操作
app.post('/user', (req, res) => {
  const { id, title, link } = req.body;
  client.hmset(id, 'title', title, 'link', link, (err, reply) => {
    if (err) return res.status(500).send('Error saving to Redis');
    res.status(200).send({ message: 'User created successfully', id });
  });
});

// 处理查（Read）操作
app.get('/user/:id', (req, res) => {
  const id = req.params.id;
  client.hgetall(id, (err, data) => {
    if (err || !data) return res.status(404).send('User not found');
    res.status(200).json(data);
  });
});

// 处理改（Update）操作
app.put('/user/:id', (req, res) => {
  const id = req.params.id;
  const { title, link } = req.body;
  client.hmset(id, 'title', title, 'link', link, (err, reply) => {
    if (err) return res.status(500).send('Error updating in Redis');
    res.status(200).send({ message: 'User updated successfully', id });
  });
});

// 处理删（Delete）操作
app.delete('/user/:id', (req, res) => {
  const id = req.params.id;
  client.del(id, (err, reply) => {
    if (err || reply === 0) return res.status(404).send('User not found');
    res.status(200).send({ message: 'User deleted successfully', id });
  });
});

// Error handler
app.use(function (err, req, res, next) {
  console.error(err);
  res.status(500).send('Internal Serverless Error');
});

// Web 类型云函数，只能监听 9000 端口
app.listen(9000, () => {
  console.log(`Server start on http://localhost:9000`);
});