const express = require('express');
const router = express.Router();
const client = require('../utils/redis');
const { v4: uuidv4 } = require('uuid');

/**
 * --- 简历管理接口 ---
 */

// 创建简历

/*
curl -X POST "http://localhost:9090/user/0aa905ac-9121-4f42-b3c4-e28216cdc627/resumes" \
-H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMGFhOTA1YWMtOTEyMS00ZjQyLWIzYzQtZTI4MjE2Y2RjNjI3IiwiY29udGFjdCI6ImNqdDgwNzkxNkBnbWFpbC5jb20iLCJpYXQiOjE3NDAwNzQ1NjcsImV4cCI6MTc0MDE2MDk2N30.b044UJuuV9gY887atUGLicIjbCp1q-kJ3KZVWvCjCdI" \
-H "Content-Type: application/json" \
-d '{"name": "我的简历"}'
*/
router.post('/:user_id/resumes', (req, res) => {
    const userId = req.params.user_id;
    const { name } = req.body;
    const resumeId = uuidv4();
    const createdAt = new Date().toISOString();
    const resumeName = name || `${new Date().toLocaleDateString()} 创建的简历`;

    // 保存简历基本信息
    client.hset(
        `resume:${resumeId}`,
        ['userId', userId, 'name', resumeName, 'createdAt', createdAt],
        (err) => {
            if (err) return res.status(500).send('创建简历失败');

            // 将简历ID添加到用户简历列表
            client.sadd(`user:${userId}:resumes`, resumeId, (err) => {
                if (err) return res.status(500).send('保存简历列表失败');
                res.status(201).json({
                    resumeId,
                    name: resumeName,
                    createdAt
                });
            });
        }
    );
});

// 修改简历信息
router.put('/:user_id/resumes/:resume_id', (req, res) => {
    const userId = req.params.user_id;
    const resumeId = req.params.resume_id;
    const { name } = req.body;

    // 验证简历归属
    client.hget(`resume:${resumeId}`, 'userId', (err, storedUserId) => {
        if (err) return res.status(500).send('系统错误');
        if (!storedUserId) return res.status(404).send('简历不存在');
        if (storedUserId !== userId) return res.status(403).send('无权限操作');

        // 更新简历名称
        client.hset(`resume:${resumeId}`, 'name', name, (err) => {
            if (err) return res.status(500).send('更新失败');
            res.status(200).json({
                message: '简历更新成功',
                resumeId,
                name
            });
        });
    });
});

/**
 * --- 修改后的元数据接口 ---
 * 新路径格式： /:user_id/resumes/:resume_id/meta_data
 */

// 中间件：验证简历权限
const validateResume = (req, res, next) => {
    const userId = req.params.user_id;
    const resumeId = req.params.resume_id;

    client.hget(`resume:${resumeId}`, 'userId', (err, storedUserId) => {
        if (err) return res.status(500).send('系统错误');
        if (!storedUserId) return res.status(404).send('简历不存在');
        if (storedUserId !== userId) return res.status(403).send('无权限访问');
        next();
    });
};

// 获取元数据
router.get('/:user_id/resumes/:resume_id/meta_data', validateResume, (req, res) => {
    const userId = req.params.user_id;
    const resumeId = req.params.resume_id;

    client.hget(`user_data:${userId}:${resumeId}`, 'meta_data', (err, data) => {
        if (err) return res.status(500).send('获取数据失败');
        if (!data) return res.status(404).send('未找到元数据');

        try {
            res.status(200).json(JSON.parse(data));
        } catch (error) {
            res.status(500).send('数据解析失败');
        }
    });
});

// 添加在简历管理接口部分（需补充到现有代码中）
// 获取简历基本信息
/*
# 示例（需替换真实值）：
curl -X GET "http://localhost:9090/user/0aa905ac-9121-4f42-b3c4-e28216cdc627/resumes/550e8400-e29b-41d4-a716-446655440000" \
-H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMGFhOTA1YWMtOTEyMS00ZjQyLWIzYzQtZTI4MjE2Y2RjNjI3IiwiY29udGFjdCI6ImNqdDgwNzkxNkBnbWFpbC5jb20iLCJpYXQiOjE3NDAwNzQ1NjcsImV4cCI6MTc0MDE2MDk2N30.b044UJuuV9gY887atUGLicIjbCp1q-kJ3KZVWvCjCdI"
*/
router.get('/:user_id/resumes/:resume_id', validateResume, (req, res) => {
    const resumeId = req.params.resume_id;
    
    client.hgetall(`resume:${resumeId}`, (err, resume) => {
        if (err) return res.status(500).send('获取简历失败');
        if (!resume) return res.status(404).send('简历不存在');
        
        res.status(200).json({
            resumeId,
            name: resume.name,
            createdAt: resume.createdAt,
            userId: resume.userId
        });
    });
});


// 其他元数据操作（POST/PUT/DELETE）使用相同中间件和路径结构
['post', 'put', 'delete'].forEach(method => {
    router[method]('/:user_id/resumes/:resume_id/meta_data', validateResume, (req, res) => {
        const userId = req.params.user_id;
        const resumeId = req.params.resume_id;
        const key = `user_data:${userId}:${resumeId}`;
        const { body } = req;

        // 删除操作处理
        if (method === 'delete') {
            client.hdel(key, 'meta_data', (err, reply) => {
                if (err || reply === 0) return res.status(404).send('删除失败');
                res.status(200).send('元数据已删除');
            });
            return;
        }

        // 新增/更新操作处理
        const value = JSON.stringify(method === 'post' ? body : { ...body, resumeId });
        client.hset(key, 'meta_data', value, (err) => {
            if (err) return res.status(500).send('操作失败');
            res.status(method === 'post' ? 201 : 200).json({
                message: `元数据${method === 'post' ? '创建' : '更新'}成功`,
                data: JSON.parse(value)
            });
        });
    });
});

/**
 * --- 修改后的聊天数据接口 ---
 * 新路径格式： /:user_id/resumes/:resume_id/chat
 */

// 聊天数据操作（复用验证中间件）
['get', 'post', 'put', 'delete'].forEach(method => {
    router[method]('/:user_id/resumes/:resume_id/chat', validateResume, (req, res) => {
        const userId = req.params.user_id;
        const resumeId = req.params.resume_id;
        const key = `user_data:${userId}:${resumeId}`;

        switch (method) {
            case 'get':
                client.hget(key, 'chat', (err, data) => {
                    if (err) return res.status(500).send('获取失败');
                    try {
                        res.json(JSON.parse(data || '{}'));
                    } catch {
                        res.status(500).send('数据解析失败');
                    }
                });
                break;

            case 'delete':
                client.hdel(key, 'chat', (err, reply) => {
                    if (err) return res.status(500).send('删除失败');
                    res.send('聊天数据已删除');
                });
                break;

            default: // post/put
                const value = JSON.stringify(req.body);
                client.hset(key, 'chat', value, (err) => {
                    if (err) return res.status(500).send('保存失败');
                    res.json({
                        message: `聊天数据${method === 'post' ? '创建' : '更新'}成功`,
                        data: JSON.parse(value)
                    });
                });
        }
    });
});

module.exports = router;