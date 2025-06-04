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

// 文件上传配置（仅在 fileFilter 部分增加对 PDF 的支持）
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        // 增加对 PDF 的判断
        if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('仅支持图片或PDF格式'), false);
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
        let isPdf = false;

        if (req.file) {
            // 用户通过 multipart/form-data 上传了文件
            console.log('[OCR Resume] Received an uploaded file.');
            imageBase64 = req.file.buffer.toString('base64');
            isPdf = req.file.mimetype === 'application/pdf';
        } else if (req.body.url) {
            // 用户在 JSON body 中提供了图片URL
            console.log('[OCR Resume] Received an image URL:', req.body.url);
            imageUrl = req.body.url;
            isPdf = req.body.url.endsWith('.pdf');
        } else {
            // 都没提供
            return res.status(400).json({
                code: 40010,
                message: '请提供 image 或者 url'
            });
        }

        // 2. 从请求体中获取 “简历内容”、“简历模板”、“简历模板描述”
        //    注意：如果前端是 form-data 方式，需要使用  -F "resume=xxxx" 这样的方式传参
        const { resume, resumeTemplate, resumeTemplateDescription } = req.body;

        // 对参数做一下简单校验（可根据需求自行调整）
        if (!resumeTemplate) {
            return res.status(400).json({
                code: 40011,
                message: '请提供简历模版（resumeTemplate）'
            });
        }
        if (!resumeTemplateDescription) {
            return res.status(400).json({
                code: 40012,
                message: '请提供简历模版描述（resumeTemplateDescription）'
            });
        }
        // resume 可以是可选的

        // 3. 调用腾讯云OCR，配置client
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

        // ---------- 4. 调用 OCR 并提取文本 ----------
        let textDetections = [];

        if (isPdf) {
            // —— PDF：先认首页，拿到总页数 —— //
            const firstParams = {
                IsPdf: true,
                PdfPageNumber: 1,
                ImageUrl: imageUrl,        // 此时 PDF 必有 URL
            };
            console.log('[OCR Resume] OCR params, page 1:', firstParams);
            const firstRes = await ocrClient.GeneralBasicOCR(firstParams);
            console.log('[OCR Resume] OCR result page 1:', JSON.stringify(firstRes, null, 2));

            textDetections = textDetections.concat(firstRes.TextDetections || []);
            const totalPages = firstRes.PdfPageSize || 1;

            // —— 其余页 —— //
            for (let page = 2; page <= totalPages; page++) {
                const pageParams = {
                    IsPdf: true,
                    PdfPageNumber: page,
                    ImageUrl: imageUrl,
                };
                console.log(`[OCR Resume] OCR params, page ${page}:`, pageParams);
                const pageRes = await ocrClient.GeneralBasicOCR(pageParams);
                console.log(`[OCR Resume] OCR result page ${page}:`, JSON.stringify(pageRes, null, 2));
                textDetections = textDetections.concat(pageRes.TextDetections || []);
            }

        } else {
            // —— 图片：一次即可 —— //
            const imgParams = imageBase64
                ? { ImageBase64: imageBase64 }
                : { ImageUrl: imageUrl };

            console.log('[OCR Resume] OCR params (image):', imgParams);
            const imgRes = await ocrClient.GeneralBasicOCR(imgParams);
            console.log('[OCR Resume] OCR result (image):', JSON.stringify(imgRes, null, 2));
            textDetections = imgRes.TextDetections || [];
        }

        // ---------- 5. 整理提取文本 ----------
        const extractedText = textDetections.map(item => item.DetectedText).join(' ');
        console.log('[OCR Resume] Extracted Text:', extractedText);

        // 6. 构造给 QWEN 的消息
        const messages = [
            {
                role: 'system',
                content: `你是一个资深的简历生成助手，请根据用户提供的【简历模板描述】和【简历模板】，将OCR提取的文本以及用户已有的简历内容合并整理，生成符合此模板的简历信息。`
            },
            {
                role: 'user',
                content: `以下是用户提供的信息，请你将 OCR 文本和已有简历内容整合到指定的 JSON 模板中：
                
【简历模板描述】:
${resumeTemplateDescription}

【简历模板(这是一个JSON字符串)】:
${resumeTemplate}

【OCR提取文本】:
${extractedText}

> 注意：
1. 如果有字段无法匹配或信息缺失，请保持该字段为空值；输出最终结果时，请以 JSON 结构返回，符合【简历模板】中的格式。
2. 不要遗漏任何信息，不要合并任何项目，尽量按照OCR提取的文本，生成完整的简历。
3. bullet points 最好只维持在3-4个，如果多于3-4个，需要合并`
            }
        ]

        // 7. 调用青问 (QWEN) 接口
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

        // 8. 返回结果
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

        await page.setViewport({ width: 1300, height: 917, deviceScaleFactor: 2 });

        // 这里使用你的前端简历预览URL
        // 例如 http://your-domain.com/#/create-resume/${type}/${id}/${color}
        // Demo中用一个示例IP代替，按需修改
        const url = `http://www.jianlijun.com/#/create-resume/${type}/${id}/${color}`;
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // 等待最后一页渲染完成
        await page.waitForSelector('.cv-page-content:last-child', { timeout: 30000 });

        const pages = await page.$$('.cv-page-content');
        if (!pages.length) throw new Error('未找到任何 .cv-page-content');

        const screenshotUrls = [];

        for (const [idx, el] of pages.entries()) {
            const buffer = await el.screenshot({ type: 'png' });

            const cosKey = `screenshots/${id}_page${idx + 1}.png`;
            await cos.putObject({
                Bucket: process.env.COS_BUCKET,
                Region: process.env.COS_REGION,
                Key: cosKey,
                Body: buffer,
                ACL: 'public-read',
                ContentType: 'image/png'
            });

            screenshotUrls.push(
                `https://${process.env.COS_BUCKET}.cos.${process.env.COS_REGION}.myqcloud.com/${cosKey}`
            );
        }

        console.log(`[takeScreenshot] Success: resumeId=${id}, pages=${screenshotUrls.length}`);
        return screenshotUrls.length === 1 ? screenshotUrls[0] : screenshotUrls;
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
        const screenshotResult = await takeScreenshot(templateType, resumeId, color, req.headers.authorization);

        const screenshotUrls = Array.isArray(screenshotResult) ? screenshotResult : [screenshotResult];
        const firstUrl = screenshotUrls[0];

        // 2. 将截图链接存入 Redis
        client.hmset(
            `resume:${resumeId}`,
            {
                screenshotUrl: firstUrl,
                screenshotUrls: JSON.stringify(screenshotUrls)
            },
            (err) => {
                if (err) {
                    console.error(`[SCF Screenshot] Failed to store screenshot urls: ${err.message}`);
                    return res.status(500).json({ code: 50014, message: 'Failed to store screenshot url' });
                }
                console.log(`[SCF Screenshot] Successfully stored screenshot urls, resumeId=${resumeId}`);
                return res.json({
                    code: 20009,
                    data: { resumeId, screenshotUrls }
                });
            }
        );
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