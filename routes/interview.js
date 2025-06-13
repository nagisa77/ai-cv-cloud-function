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
        JSON.parse(row.platform || '[]').forEach(p => platformSet.add(p));
        JSON.parse(row.categories || '[]').forEach(c => categorySet.add(c));
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
    const [rows] = await pool.query('SELECT * FROM interview_question');
    const { categories, platform } = req.query;

    const categoryFilter = categories ? categories.split(',').map(s => s.trim()).filter(Boolean) : null;
    const platformFilter = platform ? platform.split(',').map(s => s.trim()).filter(Boolean) : null;

    let result = [];

    rows.forEach(row => {
      try {
        row.platform = JSON.parse(row.platform || '[]');
        row.categories = JSON.parse(row.categories || '[]');
        row.sources = JSON.parse(row.sources || '[]');
        row.sourcesCount = Array.isArray(row.sources) ? row.sources.length : 0;
      } catch (e) {
        row.sourcesCount = 0;
      }

      if (categoryFilter && !row.categories.some(c => categoryFilter.includes(c))) {
        return;
      }
      if (platformFilter && !row.platform.some(p => platformFilter.includes(p))) {
        return;
      }
      result.push(row);
    });

    result.sort((a, b) => b.sourcesCount - a.sourcesCount);

    const page = parseInt(req.query.page, 10);
    const pageSize = parseInt(req.query.pageSize, 10);
    let pagedResult = result;
    if (!isNaN(page) && !isNaN(pageSize) && page > 0 && pageSize > 0) {
      const start = (page - 1) * pageSize;
      pagedResult = result.slice(start, start + pageSize);
    }

    res.json({ code: 200, data: pagedResult });
  } catch (err) {
    console.error('[interview/questions] error:', err);
    res.status(500).json({ code: 500, message: 'database error' });
  }
});

module.exports = router;
