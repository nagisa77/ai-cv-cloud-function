// pic.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const COS = require('cos-nodejs-sdk-v5');
const { v4: uuidv4 } = require('uuid');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const client = require('../utils/redis'); // 用于存储 screenshotUrl
const isProduction = process.env.NODE_ENV === 'production';
const tencentcloud = require("tencentcloud-sdk-nodejs");
const OcrClient = tencentcloud.ocr.v20181119.Client;
const axios = require('axios');


// 初始化 COS
const cos = new COS({
    SecretId: process.env.COS_SECRET_ID,
    SecretKey: process.env.COS_SECRET_KEY
});

// 文件上传配置
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('仅支持图片格式（JPEG/PNG/GIF等）'), false);
        }
    }
});

// 获取 Puppeteer Browser 实例
const getBrowser = async () => {
    if (isProduction) {
        // 生产环境（如 Serverless）时使用 chromium-min
        return puppeteer.launch({
            args: chromium.args,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
        });
    } else {
        // 本地调试
        return puppeteer.launch({
            headless: true,
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    }
};

// ========== 新增接口：/pic/ocr-resume ==========
// 说明：
// 1) 支持 FormData 方式上传图片：字段名 image
// 2) 支持 JSON 方式提交图片URL：{ "url": "https://xx.png" }
// 3) 先用腾讯云OCR提取文字，然后将文字 + 预设简历模板，送给青问 QWEN，得到结构化简历
// 4) 返回结构化简历
router.post('/ocr-resume', upload.single('image'), async (req, res) => {
    console.log('[OCR Resume] Request start...');

    try {
        // 1. 获取图片来源（本地上传 或 远程URL）
        let imageBase64 = null;
        let imageUrl = null;

        if (req.file) {
            // 用户通过 multipart/form-data 上传了图片
            console.log('[OCR Resume] Received an uploaded file.');
            imageBase64 = req.file.buffer.toString('base64');
        } else if (req.body.url) {
            // 用户在 JSON body 中提供了图片URL
            console.log('[OCR Resume] Received an image URL:', req.body.url);
            imageUrl = req.body.url;
        } else {
            // 都没提供
            return res.status(400).json({
                code: 40010,
                message: '请提供 image 或者 url'
            });
        }

        // 2. 调用腾讯云OCR，配置client
        const ocrClient = new OcrClient({
            credential: {
                secretId: process.env.TENCENT_OCR_SECRET_ID,
                secretKey: process.env.TENCENT_OCR_SECRET_KEY,
            },
            region: process.env.TENCENT_OCR_REGION || 'ap-shanghai',
            profile: {
                signMethod: "TC3-HMAC-SHA256", // 确保使用 v3 鉴权
            },
        });

        // 3. 组装OCR请求参数
        // 注意：如果图片较大，可考虑使用 imageBase64 或 imageUrl，二选一
        const ocrParams = {};
        if (imageBase64) {
            ocrParams.ImageBase64 = imageBase64;
        }
        if (imageUrl) {
            ocrParams.ImageUrl = imageUrl;
        }

        // 使用通用印刷体识别,也可根据实际情况使用其他OCR接口,比如：GeneralAccurateOCR
        // https://cloud.tencent.com/document/api/866/33526
        console.log('[OCR Resume] OCR params:', ocrParams);
        const ocrResult = await ocrClient.GeneralBasicOCR(ocrParams);
        console.log('[OCR Resume] OCR result:', JSON.stringify(ocrResult, null, 2));

        // 4. 提取OCR文本
        // GeneralBasicOCR返回TextDetections的数组，每项有DetectedText
        const textDetections = ocrResult.TextDetections || [];
        const extractedText = textDetections.map(item => item.DetectedText).join(' ');
        console.log('[OCR Resume] Extracted Text:', extractedText);

        // 5. 调用青问 QWEN 接口
        //    你已有 /chat/completions 代理接口，这里通过 axios 调用本地接口即可
        //    下方示例：我们把 OCR 文本发给 QWEN 并让它输出一个“简历格式”。
        const messages = [
            {
                role: 'system',
                content: `你是一个资深的简历生成助手，请将用户提供的文本整理为一个标准的简历信息。`
            },
            {
                role: 'user',
                content: `以下是从图片OCR提取的文本片段，请你根据这些信息，填充到下列简历模板中。如果信息缺失，可以留空。
                
【简历模板】
姓名: 
电话: 
邮箱: 
工作经历: 
教育经历: 
技能专长: 
自我评价:
                
【用户文本】:
${extractedText}
`
            }
        ];
        const response = await axios.post(
            'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
            {
                model: 'qwen-plus',
                messages,
                temperature: 0.7
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                }
            }
        );
        
        console.log('[GPT Response] 成功接收响应:', response.data);

        return res.json({
            code: 20020,
            data: {
                ocrText: extractedText,
                resume: response.data
            }
        });

    } catch (err) {
        console.error('[OCR Resume] Error:', err);
        return res.status(500).json({
            code: 50020,
            message: 'OCR简历生成失败',
            error: err.message
        });
    }
});

// 核心截图逻辑
async function takeScreenshot(type, id, color, token) {
    let browser;
    try {
        browser = await getBrowser();
        const page = await browser.newPage();

        // 将用户的 JWT 传给前端路由（如需调用受限接口）
        await page.setExtraHTTPHeaders({ 'Authorization': token });

        await page.setViewport({ width: 1602, height: 917, deviceScaleFactor: 2 });

        // 这里使用你的前端简历预览URL
        // 例如 http://your-domain.com/#/create-resume/${type}/${id}/${color}
        // Demo中用一个示例IP代替，按需修改
        const url = `http://207.180.225.219:8080/#/create-resume/${type}/${id}/${color}`;
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        const element = await page.waitForSelector('.cv-page', { timeout: 30000 });
        const boundingBox = await element.boundingBox();
        
        let screenshotBuffer = await page.screenshot({ 
            type: 'png', 
            clip: boundingBox 
        });

        // 确保 screenshotBuffer 一定是 Buffer
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

        const finalUrl = `https://${process.env.COS_BUCKET}.cos.${process.env.COS_REGION}.myqcloud.com/${cosKey}`;
        console.log(`[takeScreenshot] Success: resumeId=${id}, screenshotUrl=${finalUrl}`);
        return finalUrl;
    } finally {
        if (browser) await browser.close();
    }
}

// ========== 新增：校验简历归属中间件（可选） ==========
const validateResumeOwnership = (req, res, next) => {
    const userId = req.user.user_id;
    const { resumeId } = req.body;
    
    if (!resumeId) {
        return res.status(400).json({ code: 40002, message: 'resumeId is required in request body' });
    }

    client.hget(`resume:${resumeId}`, 'userId', (err, storedUserId) => {
        if (err) {
            console.error(`[validateResumeOwnership] Redis error: ${err.message}`);
            return res.status(500).json({ code: 50001, message: 'System error' });
        }
        if (!storedUserId) {
            console.warn(`[validateResumeOwnership] Resume not found: ${resumeId}`);
            return res.status(404).json({ code: 40401, message: 'Resume not found' });
        }
        if (storedUserId !== userId) {
            console.warn(`[validateResumeOwnership] No permission: user=${userId}, resumeOwner=${storedUserId}`);
            return res.status(403).json({ code: 40301, message: 'No permission' });
        }
        next();
    });
};

// ========== 新增：SCF 截图路由 ==========
// 前端(或 user.js)只需要 post 到 /pic/scf-screenshot 
// body: { resumeId, templateType, color }
router.post('/scf-screenshot', validateResumeOwnership, async (req, res) => {
    try {
        const { resumeId, templateType, color } = req.body;
        console.log(`[SCF Screenshot] Start: resumeId=${resumeId}, templateType=${templateType}, color=${color}`);

        // 1. 执行截图
        const screenshotUrl = await takeScreenshot(templateType, resumeId, color, req.headers.authorization);

        // 2. 将 screenshotUrl 存入 Redis
        client.hset(`resume:${resumeId}`, 'screenshotUrl', screenshotUrl, (err) => {
            if (err) {
                console.error(`[SCF Screenshot] Failed to store screenshotUrl: ${err.message}`);
                return res.status(500).json({ code: 50014, message: 'Failed to store screenshot url' });
            }
            console.log(`[SCF Screenshot] Successfully stored screenshotUrl, resumeId=${resumeId}`);
            return res.json({ 
                code: 20009, 
                data: { resumeId, screenshotUrl } 
            });
        });
    } catch (error) {
        console.error(`[SCF Screenshot] Error: ${error.message}`);
        res.status(500).json({ code: 50015, message: 'Screenshot failed', error: error.message });
    }
});

/**
 * 保留原有的图片上传接口
 * POST /pic
 * 请求参数：
 * - image: 图片文件（multipart/form-data）
 */
router.post('/', upload.single('image'), async (req, res) => {
    try {
        // 验证文件存在
        if (!req.file) {
            return res.status(400).json({
                code: 40001,
                message: '请选择要上传的图片文件'
            });
        }

        // 生成唯一文件名
        const fileExtension = req.file.originalname.split('.').pop();
        const cosKey = `uploads/${uuidv4()}.${fileExtension}`;

        // 上传到COS
        const { Bucket, Region } = {
            Bucket: process.env.COS_BUCKET,
            Region: process.env.COS_REGION
        };
        const params = {
            Bucket,
            Region,
            Key: cosKey,
            Body: req.file.buffer,
            ACL: 'public-read'
        };
        await cos.putObject(params);

        res.status(200).json({
            code: 0,
            data: {
                url: `https://${Bucket}.cos.${Region}.myqcloud.com/${cosKey}`,
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
    takeScreenshot  // 如其他模块需要直接调用，可保留
};
