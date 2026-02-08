const express = require('express');
const { refreshBrief, normalizeParams } = require('../jobs/refresh');

module.exports = (db) => {
  const router = express.Router();

  router.post('/refresh', async (req, res) => {
    try {
      const params = { ...req.query, ...req.body };
      const normalized = normalizeParams(params);
      const result = await refreshBrief(normalized, db);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message || 'internal error' });
    }
  });

  return router;
};
