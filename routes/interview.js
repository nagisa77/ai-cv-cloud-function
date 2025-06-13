const express = require('express');
const router = express.Router();
const pool = require('../utils/mysql');

// 接口0: 获取元信息（平台列表和分类列表）
router.get('/meta', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT platform, categories FROM interview_question');
    const platformSet = new Set();
    const categorySet = new Set();

    rows.forEach(row => {
      try {
        (Array.isArray(row.platform) ? row.platform : []).forEach(platform => platformSet.add(platform));
        (Array.isArray(row.categories) ? row.categories : []).forEach(category => categorySet.add(category));
      } catch (e) {
        // ignore parse errors
      }
    });

    res.json({ code: 200, data: { platforms: Array.from(platformSet), categories: Array.from(categorySet) } });
  } catch (err) {
    console.error('[interview/meta] error:', err);
    res.status(500).json({ code: 500, message: 'database error' });
  }
});

// 接口1: 获取面试题列表
router.get('/questions', async (req, res) => {
  try {
    const { categories, platform, page, pageSize } = req.query;

    const categoryFilter = categories ? categories.split(',').map(s => s.trim()).filter(Boolean) : [];
    const platformFilter = platform ? platform.split(',').map(s => s.trim()).filter(Boolean) : [];

    let sql = 'SELECT id, question, categories, platform, add_ts, JSON_LENGTH(sources) AS sourcesCount FROM interview_question';
    const params = [];
    const conditions = [];

    if (categoryFilter.length) {
      conditions.push('(' + categoryFilter.map(() => 'JSON_CONTAINS(categories, JSON_QUOTE(?))').join(' OR ') + ')');
      params.push(...categoryFilter);
    }

    if (platformFilter.length) {
      conditions.push('(' + platformFilter.map(() => 'JSON_CONTAINS(platform, JSON_QUOTE(?))').join(' OR ') + ')');
      params.push(...platformFilter);
    }

    if (conditions.length) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY JSON_LENGTH(sources) DESC';

    const pageNum = parseInt(page, 10);
    const sizeNum = parseInt(pageSize, 10);
    if (!isNaN(pageNum) && !isNaN(sizeNum) && pageNum > 0 && sizeNum > 0) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(sizeNum, (pageNum - 1) * sizeNum);
    }

    // const [rows] = await pool.query(sql, params);

    // rows.forEach(row => {
    //   try {
    //     row.sources = JSON.parse(row.sources || '[]');
    //   } catch (e) {
    //     row.sources = [];
    //   }
    // });

    res.json({ code: 200, data: rows });
  } catch (err) {
    console.error('[interview/questions] error:', err);
    res.status(500).json({ code: 500, message: 'database error' });
  }
});

module.exports = router;
