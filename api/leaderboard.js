const { Pool } = require('pg');

// Reused between invocations of the same serverless instance.
const pool = global._pgPool || (global._pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ssl: { rejectUnauthorized: false },
}));

let ready;
const init = () => ready || (ready = pool.query(`
  CREATE TABLE IF NOT EXISTS scores (
    id text PRIMARY KEY,
    name text NOT NULL,
    best integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`));

const MAX_FISH = 32; // 8 ponds x 4 fish

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await init();
    if (req.method === 'GET') {
      const { rows } = await pool.query(
        'SELECT id, name, best FROM scores WHERE best > 0 ORDER BY best DESC, updated_at ASC LIMIT 10');
      return res.status(200).json(rows);
    }
    if (req.method === 'POST') {
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const id = String(b.id || '').slice(0, 64);
      const name = String(b.name || 'Angler').replace(/[<>]/g, '').trim().slice(0, 14) || 'Angler';
      const score = Math.max(0, Math.min(MAX_FISH, parseInt(b.score, 10) || 0));
      if (!id) return res.status(400).json({ error: 'id required' });
      await pool.query(
        `INSERT INTO scores (id, name, best) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           best = GREATEST(scores.best, EXCLUDED.best),
           updated_at = now()`, [id, name, score]);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server error' });
  }
};
