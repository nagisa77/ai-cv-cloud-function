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

/**
 * 简历截图功能
 * GET /pic/screenshot/:type/:id
 */
router.get('/screenshot/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    const token = req.headers.authorization;

    console.log(`[Request] 收到截图请求: type=${type}, id=${id}, token=${token ? '存在' : '缺失'}`);

    if (!token) {
        console.warn('[Authorization Error] 缺少认证令牌');
        return res.status(400).json({
            code: 40002,
            message: '缺少认证令牌'
        });
    }

    let browser = null;
    try {
        browser = await getBrowser();
        console.log('[Browser] 启动浏览器实例成功');

        const page = await browser.newPage();
        console.log('[Page] 创建新页面成功');

        // 设置认证 Token
        await page.setExtraHTTPHeaders({
            'Authorization': token
        });
        console.log('[Page] 设置认证令牌成功');

        // 导航到目标页面
        const url = `http://localhost:8080/#/create-resume/${type}/${id}`;
        console.log(`[Navigation] 导航到URL: ${url}`);
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        console.log('[Navigation] 页面加载完成');

        // 等待内容加载（根据实际页面调整选择器）
        await page.waitForSelector('.resume-container', {
            timeout: 15000
        });
        console.log('[Content] 内容加载完成');

        // 设置 PDF 生成选项
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '20mm',
                right: '20mm',
                bottom: '20mm',
                left: '20mm'
            }
        });
        console.log('[PDF] PDF生成成功');

        // 上传到 COS
        const fileExtension = 'pdf';
        const cosKey = `screenshots/${uuidv4()}.${fileExtension}`;
        console.log(`[COS] 准备上传文件: ${cosKey}`);

        const params = {
            Bucket: process.env.COS_BUCKET,
            Region: process.env.COS_REGION,
            Key: cosKey,
            Body: pdfBuffer,
            ACL: 'public-read'
        };

        const { Location } = await cos.putObject(params);
        console.log(`[COS] 文件上传成功: ${Location}`);

        res.status(200).json({
            code: 0,
            data: {
                url: `https://${params.Bucket}.cos.${params.Region}.myqcloud.com/${cosKey}`,
                type: 'pdf'
            }
        });
        console.log('[Response] 响应成功发送');

    } catch (error) {
        console.error('[Screenshot Error]', error);
        res.status(500).json({
            code: 50002,
            message: '截图生成失败',
            error: error.message
        });
    } finally {
        if (browser) {
            await browser.close();
            console.log('[Browser] 浏览器实例关闭');
        }
    }
});
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

module.exports = router;