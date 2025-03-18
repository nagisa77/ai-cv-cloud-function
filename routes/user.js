const express = require('express');
const router = express.Router();
const client = require('../utils/redis');
const { v4: uuidv4 } = require('uuid');
const { router: picRouter, takeScreenshot } = require('./pic');
/**
 * --- 中间件优化 ---
 * 修改验证逻辑，直接使用JWT中的用户ID
 */

// 统一验证简历权限
const validateResume = (req, res, next) => {
    const userId = req.user.user_id; // 从JWT中获取
    const resumeId = req.params.resume_id;
    
    console.log(`[validateResume] 验证权限：用户ID=${userId}, 简历ID=${resumeId}`);

    client.hget(`resume:${resumeId}`, 'userId', (err, storedUserId) => {
        if (err) {
            console.error(`[validateResume] 数据库错误: ${err.message}`);
            return res.status(500).json({ code: 50001, message: '系统错误' });
        }
        if (!storedUserId) {
            console.warn(`[validateResume] 简历不存在: ${resumeId}`);
            return res.status(404).json({ code: 40401, message: '简历不存在' });
        }
        if (storedUserId !== userId) {
            console.warn(`[validateResume] 无权限操作: 请求用户=${userId}, 简历所有者=${storedUserId}`);
            return res.status(403).json({ code: 40301, message: '无权限操作' });
        }
        console.log(`[validateResume] 验证通过: 用户ID=${userId}, 简历ID=${resumeId}`);
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
    const { name, templateType, color } = req.body;
    const resumeId = uuidv4();
    const createdAt = new Date()

    console.log(`[创建简历] 开始: 用户ID=${userId}, 名称="${name}", 模板类型=${templateType}, 颜色=${color}`);

    const dateStr = createdAt.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const defaultName = `${dateStr} 创建的简历`;

    client.hset(
        `resume:${resumeId}`,
        ['userId', userId, 'name', name || defaultName, 'createdAt', createdAt.toISOString(), 'templateType', templateType, 'color', color],
        (err) => {
            if (err) {
                console.error(`[创建简历] 保存简历数据失败: ${err.message}`);
                return res.status(500).json({ code: 50002, message: '创建简历失败' });
            }

            client.sadd(`user:${userId}:resumes`, resumeId, (err) => {
                if (err) {
                    console.error(`[创建简历] 添加到用户简历列表失败: ${err.message}`);
                    return res.status(500).json({ code: 50003, message: '保存列表失败' });
                }
                console.log(`[创建简历] 成功: 简历ID=${resumeId}, 用户ID=${userId}`);
                res.status(201).json({
                    code: 20101,
                    data: { resumeId, name: name || defaultName, createdAt: createdAt.toISOString(), templateType, color }
                });

                // 启动异步任务
                console.log(`[创建简历] 开始异步截图: 简历ID=${resumeId}, 模板类型=${templateType}, 颜色=${color}`);
                takeScreenshot(templateType, resumeId, color, req.headers.authorization)
                    .then(url => {
                        console.log(`[创建简历] 截图成功: 简历ID=${resumeId}, URL=${url}`);
                        client.hset(`resume:${resumeId}`, 'screenshotUrl', url);
                    })
                    .catch(err => console.error(`[创建简历] 截图失败: 简历ID=${resumeId}, 错误: ${err.message}`));
            });
        }
    );
});

// 修改简历基本信息（名称、模板类型等）
router.patch('/resumes/:resume_id', validateResume, (req, res) => {
    const resumeId = req.params.resume_id;
    const color = req.params.color;
    const updates = req.body;
    const validFields = ['name', 'templateType', 'color']; // 允许修改的字段，添加color
    
    console.log(`[更新简历] 开始: 简历ID=${resumeId}, 请求数据=${JSON.stringify(updates)}`);

    // 过滤有效更新字段
    const fieldsToUpdate = Object.keys(updates)
        .filter(key => validFields.includes(key))
        .map(key => [key, updates[key]])
        .flat();

    if (fieldsToUpdate.length === 0) {
        console.warn(`[更新简历] 无有效更新字段: 简历ID=${resumeId}`);
        return res.status(400).json({
            code: 40001,
            message: '请求参数错误，至少需要一个有效字段（name/templateType/color）'
        });
    }

    // 添加更新时间戳
    fieldsToUpdate.push('updatedAt', new Date().toISOString());
    console.log(`[更新简历] 字段更新: 简历ID=${resumeId}, 字段=${JSON.stringify(fieldsToUpdate)}`);

    client.hset(`resume:${resumeId}`, fieldsToUpdate, (err) => {
        if (err) {
            console.error(`[更新简历] 数据库更新失败: 简历ID=${resumeId}, 错误=${err.message}`);
            return res.status(500).json({ code: 50012, message: '更新简历失败' });
        }

        // 返回更新后的完整数据
        client.hgetall(`resume:${resumeId}`, (err, resume) => {
            if (err || !resume) {
                console.error(`[更新简历] 获取更新后数据失败: 简历ID=${resumeId}, 错误=${err ? err.message : '空数据'}`);
                return res.status(500).json({ code: 50013, message: '获取数据失败' });
            }

            console.log(`[更新简历] 成功: 简历ID=${resumeId}, 更新后数据=${JSON.stringify(resume)}`);
            res.json({
                code: 20008,
                data: {
                    resumeId,
                    name: resume.name,
                    templateType: resume.templateType,
                    color: resume.color,
                    createdAt: resume.createdAt,
                    updatedAt: resume.updatedAt
                }
            });
        });

        // 检查模板类型是否变更
        if (req.body.templateType) {
            console.log(`[更新简历] 模板类型已变更，开始重新截图: 简历ID=${resumeId}, 新模板=${req.body.templateType}`);
            takeScreenshot(req.body.templateType, resumeId, color, req.headers.authorization)
                .then(url => {
                    console.log(`[更新简历] 重新截图成功: 简历ID=${resumeId}, URL=${url}`);
                    client.hset(`resume:${resumeId}`, 'screenshotUrl', url);
                })
                .catch(err => console.error(`[更新简历] 重新截图失败: 简历ID=${resumeId}, 错误=${err.message}`));
        }
    });
});

// 获取简历列表
/*
curl -X GET "http://localhost:9000/user/resumes" \
-H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMGFhOTA1YWMtOTEyMS00ZjQyLWIzYzQtZTI4MjE2Y2RjNjI3IiwiY29udGFjdCI6ImNqdDgwNzkxNkBnbWFpbC5jb20iLCJpYXQiOjE3NDAwNzQ1NjcsImV4cCI6MTc0MDE2MDk2N30.b044UJuuV9gY887atUGLicIjbCp1q-kJ3KZVWvCjCdI"

*/
router.get('/resumes', (req, res) => {
    const userId = req.user.user_id;
    console.log(`[获取简历列表] 开始: 用户ID=${userId}`);

    client.smembers(`user:${userId}:resumes`, (err, resumeIds) => {
        if (err) {
            console.error(`[获取简历列表] 获取ID列表失败: 用户ID=${userId}, 错误=${err.message}`);
            return res.status(500).json({ code: 50004, message: '获取列表失败' });
        }

        if (resumeIds.length === 0) {
            console.log(`[获取简历列表] 用户没有简历: 用户ID=${userId}`);
            return res.json({ code: 20001, data: [] });
        }

        console.log(`[获取简历列表] 找到简历IDs: 用户ID=${userId}, 简历数量=${resumeIds.length}, IDs=${resumeIds.join(',')}`);
        
        const pipeline = client.multi();
        resumeIds.forEach(id => pipeline.hgetall(`resume:${id}`));

        pipeline.exec((err, results) => {
            if (err) {
                console.error(`[获取简历列表] 获取简历详情失败: 用户ID=${userId}, 错误=${err.message}`);
                return res.status(500).json({ code: 50004, message: '获取列表失败' });
            }

            // 构造简历数组并排序
            const resumes = results.map((data, index) => ({
                resumeId: resumeIds[index],
                name: data.name,
                createdAt: data.createdAt,
                templateType: data.templateType,
                color: data.color || null,
                screenshotUrl: data.screenshotUrl || null
            })).sort((a, b) => {
                // 将日期字符串转换为时间戳进行比较
                const timeA = new Date(a.createdAt).getTime();
                const timeB = new Date(b.createdAt).getTime();
                return timeB - timeA; // 降序排列（最新在前）
            });

            console.log(`[获取简历列表] 成功: 用户ID=${userId}, 返回简历数量=${resumes.length}`);
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
    const userId = req.user.user_id;
    console.log(`[获取简历详情] 开始: 用户ID=${userId}, 简历ID=${resumeId}`);

    client.hgetall(`resume:${resumeId}`, (err, resume) => {
        if (err || !resume) {
            console.error(`[获取简历详情] 失败: 简历ID=${resumeId}, 错误=${err ? err.message : '简历不存在'}`);
            return res.status(404).json({ code: 40402, message: '简历不存在' });
        }

        console.log(`[获取简历详情] 成功: 简历ID=${resumeId}, 数据=${JSON.stringify(resume)}`);
        res.json({
            code: 20003,
            data: {
                resumeId,
                name: resume.name,
                createdAt: resume.createdAt,
                userId: resume.userId,
                templateType: resume.templateType,
                color: resume.color || null
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
        const resumeId = req.params.resume_id;
        const userId = req.user.user_id;
        const key = `user_data:${userId}:${resumeId}`;
        console.log(`[GET MetaData] 开始: 用户ID=${userId}, 简历ID=${resumeId}, 键=${key}`);

        client.hget(key, 'meta_data', (err, data) => {
            if (err) {
                console.error(`[GET MetaData] 失败: 简历ID=${resumeId}, 错误=${err.message}, 堆栈=${err.stack}`);
                return res.status(500).json({ code: 50006, message: '获取失败' });
            }
            
            const parsedData = data ? JSON.parse(data) : {};
            console.log(`[GET MetaData] 成功: 简历ID=${resumeId}, 数据长度=${Object.keys(parsedData).length}, 原始数据=${data ? data.substring(0, 100) + (data.length > 100 ? '...' : '') : '空'}`);
            res.json({ code: 20004, data: parsedData });
        });
    })
    .post(validateResume, (req, res) => {
        const resumeId = req.params.resume_id;
        const userId = req.user.user_id;
        const key = `user_data:${userId}:${resumeId}`;
        const newMetaData = req.body;
        const newValue = JSON.stringify(newMetaData);
        console.log(`[POST MetaData] 开始: 用户ID=${userId}, 简历ID=${resumeId}, 键=${key}, 数据长度=${Object.keys(newMetaData).length}, 数据预览=${newValue.substring(0, 100) + (newValue.length > 100 ? '...' : '')}`);

        // 先获取旧的元数据，比较是否有变化
        client.hget(key, 'meta_data', (err, oldData) => {
            if (err) {
                console.error(`[POST MetaData] 获取旧数据失败: 简历ID=${resumeId}, 错误=${err.message}, 堆栈=${err.stack}`);
                return res.status(500).json({ code: 50007, message: '保存失败' });
            }
            
            console.log(`[POST MetaData] 获取旧数据: 简历ID=${resumeId}, 旧数据存在=${!!oldData}, 长度=${oldData ? oldData.length : 0}`);
            
            // 保存新数据
            client.hset(key, 'meta_data', newValue, (err) => {
                if (err) {
                    console.error(`[POST MetaData] 保存失败: 简历ID=${resumeId}, 错误=${err.message}, 堆栈=${err.stack}`);
                    return res.status(500).json({ code: 50007, message: '保存失败' });
                }
                
                console.log(`[POST MetaData] 保存成功: 简历ID=${resumeId}, 数据长度=${newValue.length}`);
                res.status(201).json({ code: 20102, data: newMetaData });

                // 若旧数据不存在或与新数据不相同，则调用截图接口
                if (!oldData || oldData !== newValue) {
                    console.log(`[POST MetaData] 数据有变化，准备生成截图: 简历ID=${resumeId}`);
                    client.hmget(`resume:${resumeId}`, ['templateType', 'color'], (err, [templateType, color]) => {
                        if (err) {
                            console.error(`[POST MetaData] 获取模板信息失败: 简历ID=${resumeId}, 错误=${err.message}, 堆栈=${err.stack}`);
                            return;
                        }
                        
                        if (!templateType) {
                            console.warn(`[POST MetaData] 未设置模板类型: 简历ID=${resumeId}, 跳过截图`);
                            return;
                        }
                        
                        console.log(`[POST MetaData] 开始生成截图: 简历ID=${resumeId}, 模板类型=${templateType}, 颜色=${color || '默认'}`);
                        takeScreenshot(templateType, resumeId, color, req.headers.authorization)
                            .then(url => {
                                console.log(`[POST MetaData] 截图成功: 简历ID=${resumeId}, URL=${url}`);
                                client.hset(`resume:${resumeId}`, 'screenshotUrl', url, (err) => {
                                    if (err) {
                                        console.error(`[POST MetaData] 更新截图URL失败: 简历ID=${resumeId}, 错误=${err.message}, 堆栈=${err.stack}`);
                                    } else {
                                        console.log(`[POST MetaData] 更新截图URL成功: 简历ID=${resumeId}`);
                                    }
                                });
                            })
                            .catch(err => {
                                console.error(`[POST MetaData] 截图失败: 简历ID=${resumeId}, 错误=${err.message}, 堆栈=${err.stack}`);
                            });
                    });
                } else {
                    console.log(`[POST MetaData] 数据无变化，跳过截图: 简历ID=${resumeId}`);
                }
            });
        });
    })
    .delete(validateResume, (req, res) => {
        const key = `user_data:${req.user.user_id}:${req.params.resume_id}`;
        console.log(`[DELETE MetaData] 请求用户ID: ${req.user.user_id}, 简历ID: ${req.params.resume_id}`);

        client.hdel(key, 'meta_data', (err) => {
            if (err) {
                console.error(`[DELETE MetaData] 删除失败: ${err.message}`);
                return res.status(500).json({ code: 50008, message: '删除失败' });
            }
            console.log(`[DELETE MetaData] 成功删除元数据`);
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
        const userId = req.user.user_id;
        const resumeId = req.params.resume_id;
        console.log(`[获取聊天记录] 开始: 用户ID=${userId}, 简历ID=${resumeId}`);
        
        client.hget(`user_data:${userId}:${resumeId}`, 'chat',
            (err, data) => {
                if (err) {
                    console.error(`[获取聊天记录] 失败: 简历ID=${resumeId}, 错误=${err.message}`);
                    return res.status(500).json({ code: 50009, message: '获取失败' });
                }
                
                const chatData = data ? JSON.parse(data) : [];
                console.log(`[获取聊天记录] 成功: 简历ID=${resumeId}, 消息数量=${chatData.length || 0}`);
                res.json({ code: 20006, data: chatData });
            });
    })
    .post(validateResume, (req, res) => {
        const userId = req.user.user_id;
        const resumeId = req.params.resume_id;
        const messageCount = req.body.messages ? req.body.messages.length : 0;
        
        console.log(`[保存聊天记录] 开始: 用户ID=${userId}, 简历ID=${resumeId}, 消息数量=${messageCount}`);
        
        const value = JSON.stringify(req.body);
        client.hset(`user_data:${userId}:${resumeId}`, 'chat', value,
            (err) => {
                if (err) {
                    console.error(`[保存聊天记录] 失败: 简历ID=${resumeId}, 错误=${err.message}`);
                    return res.status(500).json({ code: 50010, message: '保存失败' });
                }
                
                console.log(`[保存聊天记录] 成功: 用户ID=${userId}, 简历ID=${resumeId}`);
                res.status(201).json({ code: 20103, data: req.body });
            });
    });

// 添加删除简历接口
router.delete('/resumes/:resume_id', validateResume, (req, res) => {
    const resumeId = req.params.resume_id;
    const userId = req.user.user_id;
    
    console.log(`[删除简历] 开始: 用户ID=${userId}, 简历ID=${resumeId}`);

    // 使用事务处理多个删除操作
    const multi = client.multi()
        .del(`resume:${resumeId}`)
        .srem(`user:${userId}:resumes`, resumeId)
        .del(`user_data:${userId}:${resumeId}`);

    multi.exec((err, results) => {
        if (err) {
            console.error(`[删除简历] 失败: 简历ID=${resumeId}, 错误=${err.message}`);
            return res.status(500).json({ code: 50011, message: '删除失败' });
        }
        
        console.log(`[删除简历] 成功: 用户ID=${userId}, 简历ID=${resumeId}, 操作结果=${JSON.stringify(results)}`);
        res.json({ code: 20007, message: '简历已删除' });
    });
});

module.exports = router;