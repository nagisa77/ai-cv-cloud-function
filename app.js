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

// ---------- 新增JWT鉴权中间件 ----------
const jwt = require('jsonwebtoken');
const secretKey = process.env.JWT_SECRET

const authMiddleware = (req, res, next) => {
    // 排除 OPTIONS 预检请求
    if (req.method === 'OPTIONS') return next();
    
    // 排除 auth 相关路由
    if (req.path.startsWith('/auth')) return next();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            code: 40101,
            message: '未提供认证令牌'
        });
    }

    const token = authHeader.split(' ')[1];
    jwt.verify(token, secretKey, (err, decoded) => {
        if (err) {
            console.error('[JWT Error]', err);
            return res.status(401).json({
                code: 40102,
                message: '无效或过期的令牌'
            });
        }
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