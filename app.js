globalThis.Headers = require('node-fetch').Headers;
globalThis.fetch = require('node-fetch');

const dotenv = require('dotenv');
// 配置环境变量
dotenv.config();

const express = require('express');
const cors = require('cors');
const app = express();

// ---------- 引入自定义模块 ----------
const userRoutes = require('./routes/user');      // 用户数据模块
const authRoutes = require('./routes/auth');      // 登录模块

// ---------- 中间件配置 ----------
// 配置 CORS（根据你的前端地址调整）
app.use(cors({
  origin: [
    'http://localhost:8080', 
    'http://chenjiating.com',
    'http://www.chenjiating.com',
    'https://chenjiating.com',
    'https://www.chenjiating.com',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 解析 JSON 请求体
app.use(express.json());

// ---------- 路由挂载 ----------
app.use('/user', userRoutes);
app.use('/auth', authRoutes);

// ---------- 全局错误处理 ----------
app.use((err, req, res, next) => {
  console.error('[Global Error]', err);
  res.status(500).json({
    code: 500,
    message: 'Internal Serverless Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ---------- 服务器启动 ----------
const PORT = 9000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});