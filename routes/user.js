// user.js
const express = require('express');
const router = express.Router();
const client = require('../utils/redis');

/**
 * --- 元数据接口 --- 
 * 路径格式： /:user_id/meta_data
 */

// 获取用户的元数据
router.get('/:user_id/meta_data', (req, res) => {
    const userId = req.params.user_id;
    client.hget(`${userId}`, 'meta_data', (err, data) => {
        if (err) return res.status(500).send('Error retrieving meta_data');
        if (!data) return res.status(404).send('Meta_data not found');
        try {
            const parsedData = JSON.parse(data);
            res.status(200).json(parsedData);
        } catch (error) {
            res.status(500).send('Error parsing meta_data');
        }
    });
});

// 新增或覆盖元数据
router.post('/:user_id/meta_data', (req, res) => {
    const userId = req.params.user_id;
    const metaData = req.body;
    client.hset(`${userId}`, 'meta_data', JSON.stringify(metaData), (err, reply) => {
        if (err) return res.status(500).send('Error saving meta_data');
        res.status(200).send({ message: 'Meta_data created successfully' });
    });
});

// 更新元数据
router.put('/:user_id/meta_data', (req, res) => {
    const userId = req.params.user_id;
    const metaData = req.body;
    client.hset(`${userId}`, 'meta_data', JSON.stringify(metaData), (err, reply) => {
        if (err) return res.status(500).send('Error updating meta_data');
        res.status(200).send({ message: 'Meta_data updated successfully' });
    });
});

// 删除元数据
router.delete('/:user_id/meta_data', (req, res) => {
    const userId = req.params.user_id;
    client.hdel(`${userId}`, 'meta_data', (err, reply) => {
        if (err || reply === 0) return res.status(404).send('Meta_data not found');
        res.status(200).send({ message: 'Meta_data deleted successfully' });
    });
});

/**
 * --- 聊天数据接口 ---
 */

// 获取用户的聊天数据
router.get('/:user_id/chat', (req, res) => {
    const userId = req.params.user_id;
    client.hget(`${userId}`, 'chat', (err, data) => {
        if (err) return res.status(500).send('Error retrieving chat data');
        if (!data) return res.status(404).send('Chat data not found');
        try {
            const parsedData = JSON.parse(data);
            res.status(200).json(parsedData);
        } catch (error) {
            res.status(500).send('Error parsing chat data');
        }
    });
});

// 新增或覆盖聊天数据
router.post('/:user_id/chat', (req, res) => {
    const userId = req.params.user_id;
    const chatData = req.body;
    client.hset(`${userId}`, 'chat', JSON.stringify(chatData), (err, reply) => {
        if (err) return res.status(500).send('Error saving chat data');
        res.status(200).send({ message: 'Chat data created successfully' });
    });
});

// 更新聊天数据
router.put('/:user_id/chat', (req, res) => {
    const userId = req.params.user_id;
    const chatData = req.body;
    client.hset(`${userId}`, 'chat', JSON.stringify(chatData), (err, reply) => {
        if (err) return res.status(500).send('Error updating chat data');
        res.status(200).send({ message: 'Chat data updated successfully' });
    });
});

// 删除聊天数据
router.delete('/:user_id/chat', (req, res) => {
    const userId = req.params.user_id;
    client.hdel(`${userId}`, 'chat', (err, reply) => {
        if (err || reply === 0) return res.status(404).send('Chat data not found');
        res.status(200).send({ message: 'Chat data deleted successfully' });
    });
});

module.exports = router;