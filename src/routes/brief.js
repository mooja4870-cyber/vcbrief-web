const express = require('express');
const { get } = require('../db/sqlite');
const { normalizeParams, refreshBrief } = require('../jobs/refresh');

function emptyBrief({ date, mode, level }) {
  return {
    date,
    mode,
    level,
    takeaways_3: ['데이터 없음', '데이터 없음', '데이터 없음'],
    items: [],
    top5_summary: ['특이사항 없음', '특이사항 없음', '특이사항 없음', '특이사항 없음', '특이사항 없음'],
    checklist_5: ['데이터 없음', '데이터 없음', '데이터 없음', '데이터 없음', '데이터 없음'],
  };
}

function applyGlobalQuota(items, itemCount, ratio = 0.2) {
  const all = Array.isArray(items) ? items : [];
  const selected = all.slice(0, itemCount);
  if (!selected.length) return selected;

  const required = Math.ceil(selected.length * ratio);
  if (required <= 0) return selected;

  let globalCount = selected.filter((item) => String(item?.region || '').toLowerCase() === 'global').length;
  if (globalCount >= required) return selected;

  const reserveGlobal = all.filter(
    (item, idx) => idx >= itemCount && String(item?.region || '').toLowerCase() === 'global'
  );
  if (!reserveGlobal.length) return selected;

  const replaceCandidates = selected
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => String(item?.region || '').toLowerCase() !== 'global')
    .sort((a, b) => Number(a.item?.score_total || 0) - Number(b.item?.score_total || 0));

  let reserveIdx = 0;
  for (const candidate of replaceCandidates) {
    if (globalCount >= required) break;
    if (reserveIdx >= reserveGlobal.length) break;
    selected[candidate.idx] = reserveGlobal[reserveIdx];
    reserveIdx += 1;
    globalCount += 1;
  }

  return selected.sort((a, b) => Number(b?.score_total || 0) - Number(a?.score_total || 0));
}

module.exports = (db) => {
  const router = express.Router();

  router.get('/brief', async (req, res) => {
    try {
      const { date, mode, level, itemCount } = normalizeParams(req.query);
      let row = await get(
        db,
        `SELECT json FROM daily_briefs WHERE date = ? AND mode = ? AND level = ?`,
        [date, mode, level]
      );

      if (!row || !row.json) {
        return res.json(emptyBrief({ date, mode, level }));
      }

      try {
        const parsed = JSON.parse(row.json);
        const count = Array.isArray(parsed.items) ? parsed.items.length : 0;

        if (count < itemCount) {
          try {
            await refreshBrief({ date, mode, level, itemCount }, db);
            row = await get(
              db,
              `SELECT json FROM daily_briefs WHERE date = ? AND mode = ? AND level = ?`,
              [date, mode, level]
            );
            if (row && row.json) {
              const refreshed = JSON.parse(row.json);
              return res.json({
                ...refreshed,
                items: applyGlobalQuota(refreshed.items, itemCount, 0.2),
              });
            }
          } catch {
            // Fall back to cached data when refresh is unavailable.
          }
        }

        return res.json({
          ...parsed,
          items: applyGlobalQuota(parsed.items, itemCount, 0.2),
        });
      } catch {
        return res.json(emptyBrief({ date, mode, level }));
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message || 'internal error' });
    }
  });

  return router;
};
