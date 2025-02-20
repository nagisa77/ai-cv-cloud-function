// app.js
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
const picRoutes = require('./routes/pic');      // 图片上传模块
const chatRoutes = require('./routes/chat');      // 聊天模块

// ---------- 中间件配置 ----------
// 配置 CORS（根据你的前端地址调整）
app.use(cors({
  origin: [
    'http://localhost:8080', 
    'http://localhost:8081', 
    'http://chenjiating.com',
    'http://www.chenjiating.com',
    'https://chenjiating.com',
    'https://www.chenjiating.com',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true, 
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Authorization'],
}));

// 解析 JSON 请求体
app.use(express.json());

// ---------- 新增JWT鉴权中间件 ----------
const jwt = require('jsonwebtoken');
const secretKey = process.env.JWT_SECRET

console.log('Middleware SecretKey:', secretKey);

const authMiddleware = (req, res, next) => {
    console.log(`[Auth Middleware] 请求方法: ${req.method}, 请求路径: ${req.path}`);

    // 排除 OPTIONS 预检请求
    if (req.method === 'OPTIONS') {
        console.log('[Auth Middleware] OPTIONS 请求，跳过鉴权');
        return next();
    }
    
    // 排除 auth 相关路由
    if (req.path.startsWith('/auth')) {
        console.log('[Auth Middleware] Auth 路由，跳过鉴权');
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn('[Auth Middleware] 未提供认证令牌');
        return res.status(401).json({
            code: 40101,
            message: '未提供认证令牌'
        });
    }

    const token = authHeader.split(' ')[1];
    console.log(`[Auth Middleware] 验证令牌: ${token}`);
    jwt.verify(token, secretKey, (err, decoded) => {
        if (err) {
            console.error('[JWT Error]', err);
            return res.status(401).json({
                code: 40102,
                message: '无效或过期的令牌'
            });
        }
        console.log('[Auth Middleware] 令牌验证成功，用户信息:', decoded);
        req.user = decoded;
        next();
    });
};

// ---------- 路由挂载 ----------
app.use('/auth', authRoutes);

// 应用鉴权中间件（影响后续所有路由）
app.use(authMiddleware);
app.use('/user', userRoutes);
app.use('/pic', picRoutes);
app.use('/chat', chatRoutes);

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