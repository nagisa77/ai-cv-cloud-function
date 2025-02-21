const express = require('express');
const router = express.Router();
const client = require('../utils/redis');
const { v4: uuidv4 } = require('uuid');

/**
 * --- 中间件优化 ---
 * 修改验证逻辑，直接使用JWT中的用户ID
 */

// 统一验证简历权限
const validateResume = (req, res, next) => {
    const userId = req.user.user_id; // 从JWT中获取
    const resumeId = req.params.resume_id;

    client.hget(`resume:${resumeId}`, 'userId', (err, storedUserId) => {
        if (err) return res.status(500).json({ code: 50001, message: '系统错误' });
        if (!storedUserId) return res.status(404).json({ code: 40401, message: '简历不存在' });
        if (storedUserId !== userId) return res.status(403).json({ code: 40301, message: '无权限操作' });
        next();
    });
};

/**
 * --- 简历管理接口 ---
 * 新路径格式：/resumes
 */

// 创建简历（无需路径参数）
/*
curl -X POST "http://localhost:9000/user/resumes" \
-H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMGFhOTA1YWMtOTEyMS00ZjQyLWIzYzQtZTI4MjE2Y2RjNjI3IiwiY29udGFjdCI6ImNqdDgwNzkxNkBnbWFpbC5jb20iLCJpYXQiOjE3NDAwNzQ1NjcsImV4cCI6MTc0MDE2MDk2N30.b044UJuuV9gY887atUGLicIjbCp1q-kJ3KZVWvCjCdI" \
-H "Content-Type: application/json" \
-d '{"name": "高级开发工程师简历"}'

curl -X POST "http://localhost:9000/user/resumes/5f4c946f-9eb7-4a42-a06b-6a5ecd73d8d8/meta_data" \
-H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMGFhOTA1YWMtOTEyMS00ZjQyLWIzYzQtZTI4MjE2Y2RjNjI3IiwiY29udGFjdCI6ImNqdDgwNzkxNkBnbWFpbC5jb20iLCJpYXQiOjE3NDAwNzQ1NjcsImV4cCI6MTc0MDE2MDk2N30.b044UJuuV9gY887atUGLicIjbCp1q-kJ3KZVWvCjCdI" \
-H "Content-Type: application/json" \
-d '{"education": ["清华大学计算机科学硕士"], "work_experience": ["Google高级工程师"]}'

*/
router.post('/resumes', (req, res) => {
    const userId = req.user.user_id; // 从JWT获取
    const { name } = req.body;
    const resumeId = uuidv4();
    const createdAt = new Date().toISOString();

    client.hset(
        `resume:${resumeId}`,
        ['userId', userId, 'name', name || '未命名简历', 'createdAt', createdAt],
        (err) => {
            if (err) return res.status(500).json({ code: 50002, message: '创建简历失败' });

            client.sadd(`user:${userId}:resumes`, resumeId, (err) => {
                if (err) return res.status(500).json({ code: 50003, message: '保存列表失败' });
                res.status(201).json({
                    code: 20101,
                    data: { resumeId, name, createdAt }
                });
            });
        }
    );
});

// 获取简历列表
/*
curl -X GET "http://localhost:9000/user/resumes" \
-H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMGFhOTA1YWMtOTEyMS00ZjQyLWIzYzQtZTI4MjE2Y2RjNjI3IiwiY29udGFjdCI6ImNqdDgwNzkxNkBnbWFpbC5jb20iLCJpYXQiOjE3NDAwNzQ1NjcsImV4cCI6MTc0MDE2MDk2N30.b044UJuuV9gY887atUGLicIjbCp1q-kJ3KZVWvCjCdI"

*/
router.get('/resumes', (req, res) => {
    const userId = req.user.user_id;

    client.smembers(`user:${userId}:resumes`, (err, resumeIds) => {
        if (err) {
            console.error('获取简历ID列表失败:', err);
            return res.status(500).json({ code: 50004, message: '获取列表失败' });
        }

        if (resumeIds.length === 0) {
            return res.json({ code: 20001, data: [] });
        }

        const pipeline = client.multi();
        resumeIds.forEach(id => pipeline.hgetall(`resume:${id}`)); // 确保使用 hgetall

        pipeline.exec((err, results) => {
            if (err) {
                console.error('获取简历详情失败:', err);
                return res.status(500).json({ code: 50004, message: '获取列表失败' });
            }

            const resumes = results.map((data, index) => ({
                resumeId: resumeIds[index],
                name: data.name,
                createdAt: data.createdAt
            }));

            res.json({ code: 20002, data: resumes });
        });
    });
});

// 简历详情（路径参数保留resume_id）
/*
curl -X GET "http://localhost:9000/user/resumes/550e8400-e29b-41d4-a716-446655440000" \
-H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMGFhOTA1YWMtOTEyMS00ZjQyLWIzYzQtZTI4MjE2Y2RjNjI3IiwiY29udGFjdCI6ImNqdDgwNzkxNkBnbWFpbC5jb20iLCJpYXQiOjE3NDAwNzQ1NjcsImV4cCI6MTc0MDE2MDk2N30.b044UJuuV9gY887atUGLicIjbCp1q-kJ3KZVWvCjCdI"
*/
router.get('/resumes/:resume_id', validateResume, (req, res) => {
    const resumeId = req.params.resume_id;
    
    client.hgetall(`resume:${resumeId}`, (err, resume) => {
        if (err || !resume) return res.status(404).json({ code: 40402, message: '简历不存在' });
        
        res.json({
            code: 20003,
            data: {
                resumeId,
                name: resume.name,
                createdAt: resume.createdAt,
                userId: resume.userId
            }
        });
    });
});

/**
 * --- 元数据接口 ---
 * 路径格式：/resumes/:resume_id/meta_data
 */
/*
curl -X POST "http://localhost:9000/user/resumes/5f4c946f-9eb7-4a42-a06b-6a5ecd73d8d8/meta_data" \
-H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMGFhOTA1YWMtOTEyMS00ZjQyLWIzYzQtZTI4MjE2Y2RjNjI3IiwiY29udGFjdCI6ImNqdDgwNzkxNkBnbWFpbC5jb20iLCJpYXQiOjE3NDAwNzQ1NjcsImV4cCI6MTc0MDE2MDk2N30.b044UJuuV9gY887atUGLicIjbCp1q-kJ3KZVWvCjCdI" \
-H "Content-Type: application/json" \
-d '{"education": ["清华大学计算机科学硕士"], "work_experience": ["Google高级工程师"]}'

# 获取元数据
curl -X GET "http://localhost:9000/user/resumes/5f4c946f-9eb7-4a42-a06b-6a5ecd73d8d8/meta_data" \
-H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMGFhOTA1YWMtOTEyMS00ZjQyLWIzYzQtZTI4MjE2Y2RjNjI3IiwiY29udGFjdCI6ImNqdDgwNzkxNkBnbWFpbC5jb20iLCJpYXQiOjE3NDAwNzQ1NjcsImV4cCI6MTc0MDE2MDk2N30.b044UJuuV9gY887atUGLicIjbCp1q-kJ3KZVWvCjCdI"

# 删除元数据
curl -X DELETE "http://localhost:9000/user/resumes/5f4c946f-9eb7-4a42-a06b-6a5ecd73d8d8/meta_data" \
-H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMGFhOTA1YWMtOTEyMS00ZjQyLWIzYzQtZTI4MjE2Y2RjNjI3IiwiY29udGFjdCI6ImNqdDgwNzkxNkBnbWFpbC5jb20iLCJpYXQiOjE3NDAwNzQ1NjcsImV4cCI6MTc0MDE2MDk2N30.b044UJuuV9gY887atUGLicIjbCp1q-kJ3KZVWvCjCdI"


*/

router.route('/resumes/:resume_id/meta_data')
    .get(validateResume, (req, res) => {
        const key = `user_data:${req.user.user_id}:${req.params.resume_id}`;

        client.hget(key, 'meta_data', (err, data) => {
            if (err) return res.status(500).json({ code: 50006, message: '获取失败' });
            res.json({ code: 20004, data: data ? JSON.parse(data) : {} });
        });
    })
    .post(validateResume, (req, res) => {
        const key = `user_data:${req.user.user_id}:${req.params.resume_id}`;
        const value = JSON.stringify(req.body);

        client.hset(key, 'meta_data', value, (err) => {
            if (err) return res.status(500).json({ code: 50007, message: '保存失败' });
            res.status(201).json({ code: 20102, data: req.body });
        });
    })
    .delete(validateResume, (req, res) => {
        client.hdel(`user_data:${req.user.user_id}:${req.params.resume_id}`, 'meta_data', 
        (err) => {
            if (err) return res.status(500).json({ code: 50008, message: '删除失败' });
            res.json({ code: 20005, message: '元数据已删除' });
        });
    });

/**
 * --- 聊天记录接口 ---
 * 路径格式：/resumes/:resume_id/chat
 */

/*
curl -X POST "http://localhost:9000/user/resumes/5f4c946f-9eb7-4a42-a06b-6a5ecd73d8d8/chat" \
-H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMGFhOTA1YWMtOTEyMS00ZjQyLWIzYzQtZTI4MjE2Y2RjNjI3IiwiY29udGFjdCI6ImNqdDgwNzkxNkBnbWFpbC5jb20iLCJpYXQiOjE3NDAwNzQ1NjcsImV4cCI6MTc0MDE2MDk2N30.b044UJuuV9gY887atUGLicIjbCp1q-kJ3KZVWvCjCdI" \
-H "Content-Type: application/json" \
-d '{"messages": [{"role": "user", "content": "如何优化我的项目经历描述？"}, {"role": "assistant", "content": "建议使用STAR法则..."}]}'


curl -X GET "http://localhost:9000/user/resumes/5f4c946f-9eb7-4a42-a06b-6a5ecd73d8d8/chat" \
-H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMGFhOTA1YWMtOTEyMS00ZjQyLWIzYzQtZTI4MjE2Y2RjNjI3IiwiY29udGFjdCI6ImNqdDgwNzkxNkBnbWFpbC5jb20iLCJpYXQiOjE3NDAwNzQ1NjcsImV4cCI6MTc0MDE2MDk2N30.b044UJuuV9gY887atUGLicIjbCp1q-kJ3KZVWvCjCdI"

*/

router.route('/resumes/:resume_id/chat')
    .get(validateResume, (req, res) => {
        client.hget(`user_data:${req.user.user_id}:${req.params.resume_id}`, 'chat', 
        (err, data) => {
            if (err) return res.status(500).json({ code: 50009, message: '获取失败' });
            res.json({ code: 20006, data: data ? JSON.parse(data) : [] });
        });
    })
    .post(validateResume, (req, res) => {
        const value = JSON.stringify(req.body);
        client.hset(`user_data:${req.user.user_id}:${req.params.resume_id}`, 'chat', value, 
        (err) => {
            if (err) return res.status(500).json({ code: 50010, message: '保存失败' });
            res.status(201).json({ code: 20103, data: req.body });
        });
    });

module.exports = router;