/*
> 发送验证码
curl -X POST http://localhost:9000/auth/captcha/send \
  -H "Content-Type: application/json" \
  -d '{
    "email": "cjt807916@gmail.com"
  }'

> 验证码登录
curl -X POST http://localhost:9000/auth/captcha/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "cjt807916@gmail.com",
    "captcha": "965366"
  }'
*/
const express = require('express');
const router = express.Router();
const client = require('../utils/redis');
const { Resend } = require('resend');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid'); 
// const resend = new Resend(process.env.RESEND_API_KEY, {
//     fetch: require('node-fetch')
// });
const resend = new Resend(process.env.RESEND_API_KEY);
const secretKey = process.env.JWT_SECRET

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^1[3-9]\d{9}$/;

console.log('Login SecretKey:', secretKey);

function generateCaptcha() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

const validateContact = (req, res, next) => {
    const { email, phone } = req.body;

    if (!email && !phone) {
        return res.status(400).json({
            code: 40001,
            message: '邮箱或手机号必须提供其一'
        });
    }

    if (email && !EMAIL_REGEX.test(email)) {
        return res.status(400).json({
            code: 40002,
            message: '邮箱格式不正确'
        });
    }

    if (phone && !PHONE_REGEX.test(phone)) {
        return res.status(400).json({
            code: 40003,
            message: '手机号格式不正确'
        });
    }

    req.contact = email || phone;
    req.contactType = email ? 'email' : 'phone';
    next();
};

// 发送验证码接口
router.post('/captcha/send', validateContact, async (req, res) => {
    try {
        const { contact, contactType } = req;
        const captcha = generateCaptcha();

        client
            .multi()
            .hset('captcha', contact, captcha)
            .expire('captcha', 600)
            .exec();

        if (contactType === 'email') {
            const { data, error } = await resend.emails.send({
                from: 'AI-CV <noreply@chenjiating.com>',
                to: [contact],
                subject: '您的验证码',
                html: `<p>您的验证码是：<strong>${captcha}</strong>，10分钟内有效</p>`
            });

            if (error) throw error;
        }

        res.json({
            code: 200,
            message: '验证码已发送',
            data: {
                ...(process.env.NODE_ENV !== 'production' && { captcha })
            }
        });
    } catch (error) {
        console.error('[Captcha Error]', error);
        res.status(500).json({
            code: 50001,
            message: '验证码发送失败',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// 验证码登录接口
router.post('/captcha/login', validateContact, async (req, res) => {
    try {
        const { contact } = req;
        const { captcha } = req.body;

        if (!captcha) {
            return res.status(400).json({
                code: 40004,
                message: '验证码不能为空'
            });
        }

        // 从 Redis 获取验证码
        const storedCaptcha = await new Promise((resolve, reject) => {
            client.hget('captcha', contact, (err, data) => {
                if (err) reject(err);
                else resolve(data);
            });
        });

        if (!storedCaptcha) {
            return res.status(401).json({
                code: 40101,
                message: '验证码已过期，请重新获取'
            });
        }

        if (storedCaptcha !== captcha) {
            return res.status(401).json({
                code: 40102,
                message: '验证码不正确'
            });
        }

        // 获取或创建用户ID
        let userId = await new Promise((resolve, reject) => {
            client.hget('user_contacts', contact, (err, data) => {
                if (err) reject(err);
                else resolve(data);
            });
        });

        if (!userId) {
            userId = uuidv4();
            await new Promise((resolve, reject) => {
                client.hset('user_contacts', contact, userId, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }

        // 生成 JWT Token
        const payload = { user_id: userId, contact };
        const token = jwt.sign(payload, secretKey, { expiresIn: '1d' });

        // 返回登录结果
        res.json({
            code: 200,
            message: '登录成功',
            data: {
                token: token,
                user: {
                    user_id: userId, 
                    contact,
                    type: req.contactType
                }
            }
        });

        // 清除已使用的验证码
        await client.hdel('captcha', contact);
    } catch (error) {
        console.error('[Login Error]', error);
        res.status(500).json({
            code: 50002,
            message: '登录过程发生错误',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;