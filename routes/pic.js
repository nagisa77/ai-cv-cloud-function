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

        // 设置视口尺寸为常见的A4比例（1200x1697）
        await page.setViewport({
            width: 1602,
            height: 917,
            deviceScaleFactor: 2 // 提高分辨率
        });

        // 导航到目标页面
        const url = `http://localhost:8080/#/create-resume/${type}/${id}`;
        console.log(`[Navigation] 导航到URL: ${url}`);
        await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        console.log('[Navigation] 页面加载完成');

        // 等待内容加载（根据实际页面调整选择器）
        const element = await page.waitForSelector('.cv-page', {
            timeout: 30000
        });
        console.log('[Content] 内容加载完成');

        const boundingBox = await element.boundingBox();
        
        if (!boundingBox) {
            throw new Error('目标元素不可见或没有尺寸');
        }

        // 调试日志：打印视口设置
        console.log('[Debug] 视口设置:', page.viewport());

        // 生成截图（确保返回Buffer）
        let screenshotBuffer = await page.screenshot({
            type: 'png',
            clip: boundingBox, 
            omitBackground: false
        });

        // 调试日志增强
        console.log('[Debug] 原始数据类型:', screenshotBuffer.constructor.name);
        console.log('[Debug] 数据特征:', {
            isBuffer: Buffer.isBuffer(screenshotBuffer),
            isUint8Array: screenshotBuffer instanceof Uint8Array,
            byteLength: screenshotBuffer.byteLength
        });

        // 强制转换保障（兼容所有二进制格式）
        if (!Buffer.isBuffer(screenshotBuffer)) {
            console.warn('[Debug] 需要类型转换，原始类型:', screenshotBuffer.constructor.name);
            screenshotBuffer = Buffer.from(
                screenshotBuffer.buffer || screenshotBuffer,
                screenshotBuffer.byteOffset,
                screenshotBuffer.byteLength
            );
        }

        // 验证PNG文件头（确保数据有效性）
        const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        if (!screenshotBuffer.slice(0, 8).equals(PNG_HEADER)) {
            throw new Error('生成的截图非有效PNG格式');
        }

        // 上传到 COS（添加Encoding处理）
        const fileExtension = 'png';
        const cosKey = `screenshots/${uuidv4()}.${fileExtension}`;
        console.log(`[COS] 准备上传文件: ${cosKey}`);
        const params = {
            Bucket: process.env.COS_BUCKET,
            Region: process.env.COS_REGION,
            Key: cosKey,
            Body: screenshotBuffer,
            ACL: 'public-read',
            ContentType: 'image/png',
            ContentEncoding: 'binary'
        };

        const { Location } = await cos.putObject(params);
        console.log(`[COS] 文件上传成功: ${Location}`);

        res.status(200).json({
            code: 0,
            data: {
                url: `https://${params.Bucket}.cos.${params.Region}.myqcloud.com/${cosKey}`,
                type: 'image/png'
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