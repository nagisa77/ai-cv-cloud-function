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