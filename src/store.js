const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const dataFile = path.resolve(process.env.DATA_FILE || './data/database.json');
const usePg = Boolean(process.env.DATABASE_URL);
let pool;
let state = { tickets: {}, counters: { ticket: 0 }, settings: {} };

function ensureLocal() {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  if (fs.existsSync(dataFile)) {
    try { state = { ...state, ...JSON.parse(fs.readFileSync(dataFile, 'utf8')) }; }
    catch (error) { console.error('Could not read local database:', error.message); }
  } else saveLocal();
}
function saveLocal() {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const temp = `${dataFile}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2));
  fs.renameSync(temp, dataFile);
}
async function initStore() {
  if (!usePg) { ensureLocal(); console.warn('Using local JSON storage. Configure DATABASE_URL for persistent hosted storage.'); return; }
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false } });
  await pool.query(`CREATE TABLE IF NOT EXISTS novex_state (id INTEGER PRIMARY KEY CHECK (id = 1), payload JSONB NOT NULL)`);
  const result = await pool.query('SELECT payload FROM novex_state WHERE id = 1');
  if (result.rowCount) state = { ...state, ...result.rows[0].payload };
  else await pool.query('INSERT INTO novex_state (id, payload) VALUES (1, $1)', [state]);
}
async function persist() {
  if (usePg) await pool.query('INSERT INTO novex_state (id, payload) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload', [state]);
  else saveLocal();
}
function getState() { return state; }
async function closeStore() { if (pool) await pool.end(); }
module.exports = { initStore, persist, getState, closeStore };
