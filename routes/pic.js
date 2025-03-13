// pic.js
/*
curl -i -X POST http://localhost:9000/pic \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjb250YWN0IjoiY2p0ODA3OTE2QGdtYWlsLmNvbSIsImlhdCI6MTczOTg5MDY2OSwiZXhwIjoxNzM5ODk0MjY5fQ.KNdcwii61lmuikdg5Sb7WH6q7UiK7OUIDOpyJzs3kTs" \
  -F "image=@/Users/tim/Desktop/截屏2024-11-08 20.56.45.png"

*/
const express = require('express');
const router = express.Router();
const multer = require('multer');
const COS = require('cos-nodejs-sdk-v5');
const { v4: uuidv4 } = require('uuid');
const puppeteer = require('puppeteer');
const chromium = require('@sparticuz/chromium-min');
const isProduction = process.env.NODE_ENV === 'production';

// 初始化COS永久密钥
const cos = new COS({
    SecretId: process.env.COS_SECRET_ID,
    SecretKey: process.env.COS_SECRET_KEY
});

// 文件上传配置
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB限制
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('仅支持图片格式（JPEG/PNG/GIF等）'), false);
        }
    }
});

const getBrowser = async () => {
    if (isProduction) {
        // 生产环境配置（云函数/Serverless）
        return puppeteer.launch({
            args: chromium.args,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });
    } else {
        // 本地开发配置
        return puppeteer.launch({
            headless: true,
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // 本地Chrome路径
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    }
};

async function takeScreenshot(type, id, token) {
    let browser = null;
    try {
        browser = await getBrowser();
        const page = await browser.newPage();
        await page.setExtraHTTPHeaders({ 'Authorization': token });
        await page.setViewport({ width: 1602, height: 917, deviceScaleFactor: 2 });
        const url = `http://localhost:8080/#/create-resume/${type}/${id}`;
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        const element = await page.waitForSelector('.cv-page', { timeout: 30000 });
        const boundingBox = await element.boundingBox();
        let screenshotBuffer = await page.screenshot({ type: 'png', clip: boundingBox });

        // 强制转换保障（兼容所有二进制格式）
        if (!Buffer.isBuffer(screenshotBuffer)) {
            screenshotBuffer = Buffer.from(
                screenshotBuffer.buffer || screenshotBuffer,
                screenshotBuffer.byteOffset,
                screenshotBuffer.byteLength
            );
        }

        // 上传到 COS
        const cosKey = `screenshots/${id}.png`;
        await cos.putObject({
            Bucket: process.env.COS_BUCKET,
            Region: process.env.COS_REGION,
            Key: cosKey,
            Body: screenshotBuffer,
            ACL: 'public-read',
            ContentType: 'image/png'
        });

        console.log(`take screenshot success: https://${process.env.COS_BUCKET}.cos.${process.env.COS_REGION}.myqcloud.com/${cosKey}`);

        return `https://${process.env.COS_BUCKET}.cos.${process.env.COS_REGION}.myqcloud.com/${cosKey}`;
    } finally {
        if (browser) await browser.close();
    }
}

router.get('/screenshot/:type/:id', async (req, res) => {
    try {
        const { type, id } = req.params;
        const token = req.headers.authorization;
        const url = await takeScreenshot(type, id, token);
        res.status(200).json({ code: 0, data: { url } });
    } catch (error) {
        res.status(500).json({ 
            code: 50002, 
            message: '截图失败',
            error: error.message 
        });
    }
});
``
/**
 * 图片上传接口
 * POST /pic
 * 请求参数：
 * - image: 图片文件（multipart/form-data）
 */
router.post('/', upload.single('image'), async (req, res) => {
    try {
        // 验证文件存在性
        if (!req.file) {
            return res.status(400).json({
                code: 40001,
                message: '请选择要上传的图片文件'
            });
        }

        // 生成唯一文件名
        const fileExtension = req.file.originalname.split('.').pop();
        const cosKey = `uploads/${uuidv4()}.${fileExtension}`;

        // COS上传配置
        const params = {
            Bucket: process.env.COS_BUCKET,
            Region: process.env.COS_REGION,
            Key: cosKey,
            Body: req.file.buffer,
            ACL: 'public-read'
        };

        // 执行上传
        const { Location } = await cos.putObject(params);

        // 返回标准格式响应
        res.status(200).json({
            code: 0,
            data: {
                url: `https://${params.Bucket}.cos.${params.Region}.myqcloud.com/${cosKey}`,
                key: cosKey,
                size: req.file.size,
                mimeType: req.file.mimetype
            }
        });

    } catch (error) {
        console.error('[COS Error]', error);
        res.status(500).json({
            code: 50001,
            message: '文件上传服务暂不可用',
            error: error.message
        });
    }
});

module.exports = {
    router,
    takeScreenshot
};