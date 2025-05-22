// user.js
const express = require('express');
const router = express.Router();
const axios = require('axios');  // 新增：通过 axios 发起 HTTP 请求
const client = require('../utils/redis');
const { v4: uuidv4 } = require('uuid');
const { router: picRouter } = require('./pic');

// 如需使用环境变量配置 SCF 服务地址，可自行修改
const SCF_ENDPOINT = process.env.SCF_ENDPOINT || 'http://localhost:9000';

// 统一验证简历权限中间件
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
 * 路径格式：/resumes
 */

// 创建简历
router.post('/resumes', (req, res) => {
    const userId = req.user.user_id;
    const { name, templateType, color } = req.body;
    const resumeId = uuidv4();
    const createdAt = new Date();

    console.log(`[创建简历] 开始: 用户ID=${userId}, 名称="${name}", 模板类型=${templateType}, 颜色=${color}`);

    const dateStr = createdAt.toLocaleDateString('zh-CN', { 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    const defaultName = `${dateStr} 创建的简历`;

    client.hset(
        `resume:${resumeId}`,
        [
            'userId', userId,
            'name', name || defaultName,
            'createdAt', createdAt.toISOString(),
            'templateType', templateType,
            'color', color,
            'isDeleted', 0
        ],
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
                    data: {
                        resumeId,
                        name: name || defaultName,
                        createdAt: createdAt.toISOString(),
                        templateType,
                        color
                    }
                });

                // ----- 异步调用新的截图接口 (pic.js 中封装的 SCF) -----
                console.log(`[创建简历] 开始异步截图: 简历ID=${resumeId}, 模板类型=${templateType}, 颜色=${color}`);
                axios.post(`${SCF_ENDPOINT}/pic/scf-screenshot`, 
                    { 
                        resumeId, 
                        templateType, 
                        color 
                    },
                    {
                        headers: { 
                            Authorization: req.headers.authorization 
                        }
                    }
                )
                .then(() => {
                    console.log(`[创建简历] 已通知SCF截图成功: 简历ID=${resumeId}`);
                })
                .catch(err => {
                    console.error(`[创建简历] 通知SCF截图失败: 简历ID=${resumeId}, 错误: ${err.message}`);
                });
            });
        }
    );
});

// 修改简历基本信息（名称、模板类型、颜色等）
router.patch('/resumes/:resume_id', validateResume, (req, res) => {
    const resumeId = req.params.resume_id;
    const updates = req.body;
    const validFields = ['name', 'templateType', 'color'];
    
    console.log(`[更新简历] 开始: 简历ID=${resumeId}, 请求数据=${JSON.stringify(updates)}`);

    // 过滤有效字段
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

        // 获取更新后的完整数据
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

        // 如果模板类型变更，需要重新截图
        if (req.body.templateType) {
            // color 也有可能变化，所以从 body 中读取最新值
            const color = req.body.color;
            console.log(`[更新简历] 模板类型已变更，开始异步通知SCF截图: 简历ID=${resumeId}, 新模板=${req.body.templateType}`);

            axios.post(`${SCF_ENDPOINT}/pic/scf-screenshot`,
                {
                    resumeId,
                    templateType: req.body.templateType,
                    color
                },
                {
                    headers: { Authorization: req.headers.authorization }
                }
            )
            .then(() => {
                console.log(`[更新简历] 已通知SCF重新截图: 简历ID=${resumeId}`);
            })
            .catch(err => {
                console.error(`[更新简历] 通知SCF重新截图失败: 简历ID=${resumeId}, 错误=${err.message}`);
            });
        }
    });
});

// 获取简历列表
router.get('/resumes', (req, res) => {
    const userId = req.user.user_id;
    const showTrash = req.query.trash === 'true';
    console.log(`[获取简历列表] 开始: 用户ID=${userId}, trash=${showTrash}`);

    client.smembers(`user:${userId}:resumes`, (err, resumeIds) => {
        if (err) {
            console.error(`[获取简历列表] 获取ID列表失败: 用户ID=${userId}, 错误=${err.message}`);
            return res.status(500).json({ code: 50004, message: '获取列表失败' });
        }

        if (resumeIds.length === 0) {
            console.log(`[获取简历列表] 用户没有简历: 用户ID=${userId}`);
            return res.json({ code: 20001, data: [] });
        }

        console.log(`[获取简历列表] 找到简历IDs: ${resumeIds.join(',')}`);
        
        const pipeline = client.multi();
        resumeIds.forEach(id => pipeline.hgetall(`resume:${id}`));

        pipeline.exec((err, results) => {
            if (err) {
                console.error(`[获取简历列表] 获取简历详情失败: 用户ID=${userId}, 错误=${err.message}`);
                return res.status(500).json({ code: 50004, message: '获取列表失败' });
            }

            // 构造简历数组并排序
            let resumes = results.map((data, index) => ({
                resumeId: resumeIds[index],
                name: data.name,
                createdAt: data.createdAt,
                templateType: data.templateType,
                color: data.color || null,
                screenshotUrl: data.screenshotUrl || null,
                isDeleted: data.isDeleted === '1'
            }));

            resumes = resumes.filter(r => showTrash ? r.isDeleted : !r.isDeleted)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            console.log(`[获取简历列表] 成功: 用户ID=${userId}, 返回简历数量=${resumes.length}`);
            res.json({ code: 20002, data: resumes });
        });
    });
});

// 获取简历详情
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
                color: resume.color || null,
                isDeleted: resume.isDeleted === '1'
            }
        });
    });
});

/**
 * --- 元数据接口 ---
 * 路径格式：/resumes/:resume_id/meta_data
 */
router.route('/resumes/:resume_id/meta_data')
    .get(validateResume, (req, res) => {
        const resumeId = req.params.resume_id;
        const userId = req.user.user_id;
        const key = `user_data:${userId}:${resumeId}`;
        console.log(`[GET MetaData] 开始: 用户ID=${userId}, 简历ID=${resumeId}, 键=${key}`);

        client.hget(key, 'meta_data', (err, data) => {
            if (err) {
                console.error(`[GET MetaData] 失败: 简历ID=${resumeId}, 错误=${err.message}`);
                return res.status(500).json({ code: 50006, message: '获取失败' });
            }
            
            const parsedData = data ? JSON.parse(data) : {};
            console.log(`[GET MetaData] 成功: 简历ID=${resumeId}, 数据长度=${Object.keys(parsedData).length}`);
            res.json({ code: 20004, data: parsedData });
        });
    })
    .post(validateResume, (req, res) => {
        const resumeId = req.params.resume_id;
        const userId = req.user.user_id;
        const key = `user_data:${userId}:${resumeId}`;
        const newMetaData = req.body;
        const newValue = JSON.stringify(newMetaData);

        console.log(`[POST MetaData] 开始: 用户ID=${userId}, 简历ID=${resumeId}, 键=${key}`);

        // 先获取旧的元数据
        client.hget(key, 'meta_data', (err, oldData) => {
            if (err) {
                console.error(`[POST MetaData] 获取旧数据失败: 简历ID=${resumeId}, 错误=${err.message}`);
                return res.status(500).json({ code: 50007, message: '保存失败' });
            }
            
            // 保存新数据
            client.hset(key, 'meta_data', newValue, (err) => {
                if (err) {
                    console.error(`[POST MetaData] 保存失败: 简历ID=${resumeId}, 错误=${err.message}`);
                    return res.status(500).json({ code: 50007, message: '保存失败' });
                }
                
                console.log(`[POST MetaData] 保存成功: 简历ID=${resumeId}`);
                res.status(201).json({ code: 20102, data: newMetaData });

                // 若数据有变化，异步触发截图
                if (!oldData || oldData !== newValue) {
                    console.log(`[POST MetaData] 数据有变化，准备通知SCF截图: 简历ID=${resumeId}`);

                    // 获取当前的 templateType 和 color
                    client.hmget(`resume:${resumeId}`, ['templateType', 'color'], (err, [templateType, color]) => {
                        if (err) {
                            console.error(`[POST MetaData] 获取模板信息失败: 简历ID=${resumeId}, 错误=${err.message}`);
                            return;
                        }
                        
                        if (!templateType) {
                            console.warn(`[POST MetaData] 未设置模板类型, 跳过截图: 简历ID=${resumeId}`);
                            return;
                        }
                        
                        axios.post(`${SCF_ENDPOINT}/pic/scf-screenshot`,
                            {
                                resumeId,
                                templateType,
                                color
                            },
                            {
                                headers: { Authorization: req.headers.authorization }
                            }
                        )
                        .then(() => {
                            console.log(`[POST MetaData] 已通知SCF截图: 简历ID=${resumeId}`);
                        })
                        .catch(error => {
                            console.error(`[POST MetaData] 通知SCF截图失败: 简历ID=${resumeId}, 错误=${error.message}`);
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
router.route('/resumes/:resume_id/chat')
    .get(validateResume, (req, res) => {
        const userId = req.user.user_id;
        const resumeId = req.params.resume_id;
        console.log(`[获取聊天记录] 开始: 用户ID=${userId}, 简历ID=${resumeId}`);
        
        client.hget(`user_data:${userId}:${resumeId}`, 'chat', (err, data) => {
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
        client.hset(`user_data:${userId}:${resumeId}`, 'chat', value, (err) => {
            if (err) {
                console.error(`[保存聊天记录] 失败: 简历ID=${resumeId}, 错误=${err.message}`);
                return res.status(500).json({ code: 50010, message: '保存失败' });
            }
            
            console.log(`[保存聊天记录] 成功: 用户ID=${userId}, 简历ID=${resumeId}`);
            res.status(201).json({ code: 20103, data: req.body });
        });
    });

// 将简历移入回收站
router.post('/resumes/:resume_id/recycle', validateResume, (req, res) => {
    const resumeId = req.params.resume_id;
    const userId = req.user.user_id;
    console.log(`[回收简历] 开始: 用户ID=${userId}, 简历ID=${resumeId}`);

    client.hset(`resume:${resumeId}`, 'isDeleted', 1, (err) => {
        if (err) {
            console.error(`[回收简历] 失败: 简历ID=${resumeId}, 错误=${err.message}`);
            return res.status(500).json({ code: 50011, message: '移动到回收站失败' });
        }
        console.log(`[回收简历] 成功: 简历ID=${resumeId}`);
        res.json({ code: 20007, message: '已移入回收站' });
    });
});

// 从回收站恢复简历
router.post('/resumes/:resume_id/restore', validateResume, (req, res) => {
    const resumeId = req.params.resume_id;
    const userId = req.user.user_id;
    console.log(`[恢复简历] 开始: 用户ID=${userId}, 简历ID=${resumeId}`);

    client.hset(`resume:${resumeId}`, 'isDeleted', 0, (err) => {
        if (err) {
            console.error(`[恢复简历] 失败: 简历ID=${resumeId}, 错误=${err.message}`);
            return res.status(500).json({ code: 50011, message: '恢复失败' });
        }
        console.log(`[恢复简历] 成功: 简历ID=${resumeId}`);
        res.json({ code: 20007, message: '已恢复简历' });
    });
});

// 删除简历接口
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
