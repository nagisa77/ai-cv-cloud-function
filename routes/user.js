const express = require('express');
const router = express.Router();
const axios = require('axios');
const pool = require('../utils/mysql');
const { v4: uuidv4 } = require('uuid');
const { router: picRouter } = require('./pic');

const SCF_ENDPOINT = process.env.SCF_ENDPOINT || 'http://localhost:9000';

const validateResume = async (req, res, next) => {
  const resumeId = req.params.resume_id;
  const userId = req.user.user_id;
  try {
    const [rows] = await pool.query('SELECT user_id FROM resumes WHERE id=?', [resumeId]);
    if (!rows.length) return res.status(404).json({ code: 40401, message: '简历不存在' });
    if (rows[0].user_id !== userId) return res.status(403).json({ code: 40301, message: '无权限操作' });
    next();
  } catch (err) {
    console.error('[validateResume]', err);
    res.status(500).json({ code: 50001, message: '系统错误' });
  }
};

router.post('/resumes', async (req, res) => {
  const userId = req.user.user_id;
  const { name, templateType, color } = req.body;
  const resumeId = uuidv4();
  const createdAt = new Date();
  const dateStr = createdAt.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const finalName = name || `${dateStr} 创建的简历`;

  try {
    await pool.query(
      'INSERT INTO resumes (id, user_id, name, template_type, color, created_at, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
      [resumeId, userId, finalName, templateType, color, createdAt, createdAt]
    );

    res.status(201).json({ code: 20101, data: { resumeId, name: finalName, createdAt: createdAt.toISOString(), templateType, color } });

    axios.post(
      `${SCF_ENDPOINT}/pic/scf-screenshot`,
      { resumeId, templateType, color },
      { headers: { Authorization: req.headers.authorization } }
    ).catch(err => console.error('[create resume] screenshot fail', err));
  } catch (err) {
    console.error('[create resume]', err);
    res.status(500).json({ code: 50002, message: '创建简历失败' });
  }
});

router.patch('/resumes/:resume_id', validateResume, async (req, res) => {
  const resumeId = req.params.resume_id;
  const fields = [];
  const values = [];
  ['name', 'templateType', 'color'].forEach(field => {
    if (req.body[field]) {
      fields.push(`${field === 'templateType' ? 'template_type' : field}=?`);
      values.push(req.body[field]);
    }
  });
  if (!fields.length) return res.status(400).json({ code: 40001, message: '请求参数错误' });
  fields.push('updated_at=?');
  values.push(new Date());
  try {
    await pool.query(`UPDATE resumes SET ${fields.join(',')} WHERE id=?`, [...values, resumeId]);
    const [rows] = await pool.query('SELECT * FROM resumes WHERE id=?', [resumeId]);
    const resume = rows[0];
    res.json({ code: 20008, data: { resumeId, name: resume.name, templateType: resume.template_type, color: resume.color, createdAt: resume.created_at, updatedAt: resume.updated_at } });
    if (req.body.templateType) {
      axios.post(
        `${SCF_ENDPOINT}/pic/scf-screenshot`,
        { resumeId, templateType: req.body.templateType, color: req.body.color },
        { headers: { Authorization: req.headers.authorization } }
      ).catch(err => console.error('[update resume] screenshot', err));
    }
  } catch (err) {
    console.error('[update resume]', err);
    res.status(500).json({ code: 50012, message: '更新简历失败' });
  }
});

router.get('/resumes', async (req, res) => {
  const userId = req.user.user_id;
  const showTrash = req.query.trash === 'true';
  try {
    const [rows] = await pool.query('SELECT id,name,created_at,template_type,color,screenshot_url,is_deleted FROM resumes WHERE user_id=?', [userId]);
    const list = rows
      .filter(r => (showTrash ? r.is_deleted : !r.is_deleted))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map(r => ({ resumeId: r.id, name: r.name, createdAt: r.created_at, templateType: r.template_type, color: r.color, screenshotUrl: r.screenshot_url, isDeleted: !!r.is_deleted }));
    res.json({ code: 20002, data: list });
  } catch (err) {
    console.error('[list resume]', err);
    res.status(500).json({ code: 50004, message: '获取列表失败' });
  }
});

router.get('/resumes/:resume_id', validateResume, async (req, res) => {
  const resumeId = req.params.resume_id;
  try {
    const [rows] = await pool.query('SELECT * FROM resumes WHERE id=?', [resumeId]);
    if (!rows.length) return res.status(404).json({ code: 40402, message: '简历不存在' });
    const r = rows[0];
    res.json({ code: 20003, data: { resumeId: r.id, name: r.name, createdAt: r.created_at, userId: r.user_id, templateType: r.template_type, color: r.color, isDeleted: !!r.is_deleted } });
  } catch (err) {
    console.error('[get resume]', err);
    res.status(500).json({ code: 50004, message: '获取失败' });
  }
});

router
  .route('/resumes/:resume_id/meta_data')
  .get(validateResume, async (req, res) => {
    const userId = req.user.user_id;
    const resumeId = req.params.resume_id;
    try {
      const [rows] = await pool.query('SELECT meta_data FROM user_data WHERE user_id=? AND resume_id=?', [userId, resumeId]);
      const data = rows.length ? JSON.parse(rows[0].meta_data || '{}') : {};
      res.json({ code: 20004, data });
    } catch (err) {
      console.error('[get meta]', err);
      res.status(500).json({ code: 50006, message: '获取失败' });
    }
  })
  .post(validateResume, async (req, res) => {
    const userId = req.user.user_id;
    const resumeId = req.params.resume_id;
    const newValue = JSON.stringify(req.body);
    try {
      const [rows] = await pool.query('SELECT meta_data FROM user_data WHERE user_id=? AND resume_id=?', [userId, resumeId]);
      const old = rows.length ? rows[0].meta_data : null;
      if (rows.length) {
        await pool.query('UPDATE user_data SET meta_data=? WHERE user_id=? AND resume_id=?', [newValue, userId, resumeId]);
      } else {
        await pool.query('INSERT INTO user_data (user_id,resume_id,meta_data) VALUES (?,?,?)', [userId, resumeId, newValue]);
      }
      res.status(201).json({ code: 20102, data: req.body });
      if (old !== newValue) {
        const [rRows] = await pool.query('SELECT template_type,color FROM resumes WHERE id=?', [resumeId]);
        const { template_type, color } = rRows[0] || {};
        if (template_type) {
          axios.post(
            `${SCF_ENDPOINT}/pic/scf-screenshot`,
            { resumeId, templateType: template_type, color },
            { headers: { Authorization: req.headers.authorization } }
          ).catch(err => console.error('[meta screenshot]', err));
        }
      }
    } catch (err) {
      console.error('[save meta]', err);
      res.status(500).json({ code: 50007, message: '保存失败' });
    }
  })
  .delete(validateResume, async (req, res) => {
    const userId = req.user.user_id;
    const resumeId = req.params.resume_id;
    try {
      await pool.query('UPDATE user_data SET meta_data=NULL WHERE user_id=? AND resume_id=?', [userId, resumeId]);
      res.json({ code: 20005, message: '元数据已删除' });
    } catch (err) {
      console.error('[delete meta]', err);
      res.status(500).json({ code: 50008, message: '删除失败' });
    }
  });

router
  .route('/resumes/:resume_id/chat')
  .get(validateResume, async (req, res) => {
    const userId = req.user.user_id;
    const resumeId = req.params.resume_id;
    try {
      const [rows] = await pool.query('SELECT chat FROM user_data WHERE user_id=? AND resume_id=?', [userId, resumeId]);
      const data = rows.length ? JSON.parse(rows[0].chat || '[]') : [];
      res.json({ code: 20006, data });
    } catch (err) {
      console.error('[get chat]', err);
      res.status(500).json({ code: 50009, message: '获取失败' });
    }
  })
  .post(validateResume, async (req, res) => {
    const userId = req.user.user_id;
    const resumeId = req.params.resume_id;
    const value = JSON.stringify(req.body);
    try {
      const [rows] = await pool.query('SELECT chat FROM user_data WHERE user_id=? AND resume_id=?', [userId, resumeId]);
      if (rows.length) {
        await pool.query('UPDATE user_data SET chat=? WHERE user_id=? AND resume_id=?', [value, userId, resumeId]);
      } else {
        await pool.query('INSERT INTO user_data (user_id,resume_id,chat) VALUES (?,?,?)', [userId, resumeId, value]);
      }
      res.status(201).json({ code: 20103, data: req.body });
    } catch (err) {
      console.error('[save chat]', err);
      res.status(500).json({ code: 50010, message: '保存失败' });
    }
  });

router.post('/resumes/:resume_id/recycle', validateResume, async (req, res) => {
  const resumeId = req.params.resume_id;
  try {
    await pool.query('UPDATE resumes SET is_deleted=1 WHERE id=?', [resumeId]);
    res.json({ code: 20007, message: '已移入回收站' });
  } catch (err) {
    console.error('[recycle]', err);
    res.status(500).json({ code: 50011, message: '移动到回收站失败' });
  }
});

router.post('/resumes/:resume_id/restore', validateResume, async (req, res) => {
  const resumeId = req.params.resume_id;
  try {
    await pool.query('UPDATE resumes SET is_deleted=0 WHERE id=?', [resumeId]);
    res.json({ code: 20007, message: '已恢复' });
  } catch (err) {
    console.error('[restore]', err);
    res.status(500).json({ code: 50011, message: '恢复失败' });
  }
});

router.delete('/resumes/:resume_id', validateResume, async (req, res) => {
  const resumeId = req.params.resume_id;
  const userId = req.user.user_id;
  try {
    await pool.query('DELETE FROM resumes WHERE id=? AND user_id=?', [resumeId, userId]);
    await pool.query('DELETE FROM user_data WHERE resume_id=? AND user_id=?', [resumeId, userId]);
    res.json({ code: 20007, message: '简历已删除' });
  } catch (err) {
    console.error('[delete resume]', err);
    res.status(500).json({ code: 50011, message: '删除失败' });
  }
});

router.post('/resumes-batch/recycle', async (req, res) => {
  const userId = req.user.user_id;
  const { resumeIds } = req.body;
  if (!Array.isArray(resumeIds) || !resumeIds.length) {
    return res.status(400).json({ code: 40001, message: '请提供 resumeIds 数组' });
  }
  try {
    const [result] = await pool.query(
      `UPDATE resumes SET is_deleted=1 WHERE user_id=? AND id IN (${resumeIds.map(() => '?').join(',')})`,
      [userId, ...resumeIds]
    );
    res.json({ code: 20007, data: { count: result.affectedRows } });
  } catch (err) {
    console.error('[batch recycle]', err);
    res.status(500).json({ code: 50011, message: '移动到回收站失败' });
  }
});

router.delete('/resumes-batch', async (req, res) => {
  const userId = req.user.user_id;
  const { resumeIds } = req.body;
  if (!Array.isArray(resumeIds) || !resumeIds.length) {
    return res.status(400).json({ code: 40001, message: '请提供 resumeIds 数组' });
  }
  try {
    await pool.query(
      `DELETE FROM user_data WHERE user_id=? AND resume_id IN (${resumeIds.map(() => '?').join(',')})`,
      [userId, ...resumeIds]
    );
    const [result] = await pool.query(
      `DELETE FROM resumes WHERE user_id=? AND id IN (${resumeIds.map(() => '?').join(',')})`,
      [userId, ...resumeIds]
    );
    res.json({ code: 20007, data: { count: result.affectedRows } });
  } catch (err) {
    console.error('[batch delete]', err);
    res.status(500).json({ code: 50011, message: '删除失败' });
  }
});

module.exports = router;
