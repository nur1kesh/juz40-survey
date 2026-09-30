"use strict";
// PostgreSQL сақтауы. DATABASE_URL болғанда қолданылады.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayKey = () => new Date().toISOString().slice(0, 10);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS responses (
  id uuid PRIMARY KEY,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL,
  cid text UNIQUE,
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 10),
  expectation text NOT NULL,
  expectation_reason text NOT NULL DEFAULT '',
  liked text[] NOT NULL DEFAULT '{}',
  liked_other text NOT NULL DEFAULT '',
  issues text[] NOT NULL DEFAULT '{}',
  issues_detail text NOT NULL DEFAULT '',
  suggestion text NOT NULL DEFAULT '',
  ref text NOT NULL DEFAULT ''
);
ALTER TABLE responses ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX IF NOT EXISTS responses_seq_idx ON responses (seq);
CREATE INDEX IF NOT EXISTS responses_created_idx ON responses (created_at);
CREATE TABLE IF NOT EXISTS analysis (
  response_id uuid PRIMARY KEY REFERENCES responses(id) ON DELETE CASCADE,
  category text, sentiment text, importance text, topic text, summary text,
  churn_reason text, preventable text, return_potential text, action text,
  v int NOT NULL, source_stamp text NOT NULL, analyzed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kv (
  key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_usage (
  day date PRIMARY KEY, tokens bigint NOT NULL DEFAULT 0
);`;

module.exports = function createPgStore({ DATABASE_URL, DATABASE_SSL, DATA_DIR }) {
  const { Pool } = require("pg");
  // таймауттар: база қолжетімсіз болса сайт мәңгі қатып қалмай, жылдам қате қайтарады
  const pool = new Pool({ connectionString: DATABASE_URL, max: 5, ssl: DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5000, query_timeout: 20000, idleTimeoutMillis: 30000, keepAlive: true });
  pool.on("error", e => console.error("PostgreSQL pool қатесі:", e.message));
  const q = (text, params) => pool.query(text, params);

  const rowToResponse = r => ({
    id: r.id, createdAt: r.created_at.toISOString(), ...(r.cid ? { cid: r.cid } : {}), score: r.score, expectation: r.expectation,
    expectationReason: r.expectation_reason, liked: r.liked, likedOther: r.liked_other, issues: r.issues, issuesDetail: r.issues_detail,
    suggestion: r.suggestion, ref: r.ref, num: String(r.seq).padStart(3, "0"),
    analysis: r.a_v == null ? null : { category: r.category, sentiment: r.sentiment, importance: r.importance, topic: r.topic, summary: r.summary, churnReason: r.churn_reason, preventable: r.preventable, returnPotential: r.return_potential, action: r.action, v: r.a_v, sourceStamp: r.source_stamp, analyzedAt: r.analyzed_at.toISOString() }
  });

  // бар JSON базасын PostgreSQL-ға бір рет көшіру (кесте бос болғанда)
  async function importJson(file) {
    const old = JSON.parse(fs.readFileSync(file, "utf8"));
    const client = await pool.connect();
    const idMap = new Map();
    // тұрақты нөмір: бар seq сақталады, жоқтарына құрылу ретімен жаңа беріледі
    const rs = (old.responses || []).slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    let maxSeq = Math.max(old.nextSeq || 0, 0, ...rs.map(r => r.seq || 0));
    rs.forEach(r => { if (!r.seq) r.seq = ++maxSeq; });
    try {
      await client.query("BEGIN");
      for (const r of rs) {
        const id = UUID.test(r.id) ? r.id : crypto.randomUUID(); idMap.set(r.id, id);
        await client.query(
          `INSERT INTO responses (id, seq, created_at, cid, score, expectation, expectation_reason, liked, liked_other, issues, issues_detail, suggestion, ref)
           OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
          [id, r.seq, r.createdAt, r.cid || null, r.score, r.expectation, r.expectationReason || "", r.liked || [], r.likedOther || "", r.issues || [], r.issuesDetail || "", r.suggestion || "", r.ref || ""]);
      }
      if (rs.length) await client.query("SELECT setval(pg_get_serial_sequence('responses','seq'), $1, true)", [Math.max(maxSeq, 1)]);
      for (const [oid, a] of Object.entries(old.analysis || {})) {
        const id = idMap.get(oid); if (!id || !a) continue;
        await client.query(
          `INSERT INTO analysis (response_id, category, sentiment, importance, topic, summary, churn_reason, preventable, return_potential, action, v, source_stamp, analyzed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
          [id, a.category, a.sentiment, a.importance, a.topic, a.summary, a.churnReason || null, a.preventable || null, a.returnPotential || null, a.action || null, a.v || 1, a.sourceStamp || "", a.analyzedAt || new Date().toISOString()]);
      }
      if (old.digest) await client.query("INSERT INTO kv (key, value) VALUES ('digest', $1) ON CONFLICT DO NOTHING", [old.digest]);
      for (const [k, v] of Object.entries(old.insights || {})) if (v) await client.query("INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING", ["insights." + k, v]);
      for (const [d, t] of Object.entries((old.usage && old.usage.days) || {})) await client.query("INSERT INTO ai_usage (day, tokens) VALUES ($1,$2) ON CONFLICT DO NOTHING", [d, t]);
      const days = Object.values((old.usage && old.usage.days) || {}).reduce((s, n) => s + n, 0);
      const extra = Math.max(0, ((old.usage && old.usage.total) || 0) - days);
      if (extra) await client.query("INSERT INTO kv (key, value) VALUES ('usage_offset', $1) ON CONFLICT DO NOTHING", [extra]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; } finally { client.release(); }
    const moved = file + ".migrated-" + Date.now();
    fs.renameSync(file, moved);
    console.log(`✔ ${(old.responses || []).length} жауап data/db.json-нан PostgreSQL-ға көшірілді. Ескі файл: ${moved}`);
  }

  return {
    kind: "postgres",
    async init() {
      // қазақ әріптері (Қ, Ғ, Ә…) тек UTF8 кодтауында сақталады; Windows-та әдепкі WIN1251 болуы мүмкін
      const enc = (await q("SELECT pg_encoding_to_char(encoding) AS e, current_database() AS d FROM pg_database WHERE datname = current_database()")).rows[0];
      if (enc && enc.e !== "UTF8") {
        throw new Error(`"${enc.d}" дерекқорының кодтауы ${enc.e}, ал қазақ әріптері үшін UTF8 керек. Жаңа база жасаңыз: CREATE DATABASE ${enc.d}_utf8 ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C';`);
      }
      await q(SCHEMA);
      if (process.env.MIGRATE_FROM_JSON === "0") return;
      const file = path.join(DATA_DIR, "db.json");
      const { rows } = await q("SELECT count(*)::int AS c FROM responses");
      if (rows[0].c === 0 && fs.existsSync(file)) await importJson(file);
    },
    async ping() { // /healthz үшін: 3 секундта жауап бермесе — база жоқ
      await Promise.race([q("SELECT 1"), new Promise((_, rej) => setTimeout(() => rej(new Error("ping timeout")), 3000).unref())]);
      return true;
    },
    async listResponses() {
      const { rows } = await q(`
        SELECT r.*,
               a.category, a.sentiment, a.importance, a.topic, a.summary, a.churn_reason, a.preventable, a.return_potential, a.action,
               a.v AS a_v, a.source_stamp, a.analyzed_at
        FROM responses r LEFT JOIN analysis a ON a.response_id = r.id
        ORDER BY r.created_at, r.id`);
      return rows.map(rowToResponse);
    },
    async count() { return (await q("SELECT count(*)::int AS c FROM responses")).rows[0].c; },
    async exists(id) { if (!UUID.test(id)) return false; return (await q("SELECT 1 FROM responses WHERE id = $1", [id])).rowCount > 0; },
    async addResponse(d) {
      const res = await q(
        `INSERT INTO responses (id, created_at, cid, score, expectation, expectation_reason, liked, liked_other, issues, issues_detail, suggestion, ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (cid) DO NOTHING RETURNING id`,
        [d.id, d.createdAt, d.cid || null, d.score, d.expectation, d.expectationReason, d.liked, d.likedOther, d.issues, d.issuesDetail, d.suggestion, d.ref]);
      return res.rowCount ? "ok" : "duplicate";
    },
    async deleteResponse(id) { if (!UUID.test(id)) return; await q("DELETE FROM responses WHERE id = $1", [id]); },
    async saveAnalysis(id, a) {
      await q(
        `INSERT INTO analysis (response_id, category, sentiment, importance, topic, summary, churn_reason, preventable, return_potential, action, v, source_stamp, analyzed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (response_id) DO UPDATE SET category=$2, sentiment=$3, importance=$4, topic=$5, summary=$6, churn_reason=$7, preventable=$8, return_potential=$9, action=$10, v=$11, source_stamp=$12, analyzed_at=$13`,
        [id, a.category, a.sentiment, a.importance, a.topic, a.summary, a.churnReason, a.preventable, a.returnPotential, a.action, a.v, a.sourceStamp, a.analyzedAt]);
    },
    async getKV(key) { const r = await q("SELECT value FROM kv WHERE key = $1", [key]); return r.rowCount ? r.rows[0].value : null; },
    async setKV(key, value) { await q("INSERT INTO kv (key, value, updated_at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()", [key, value]); },
    async deleteKV(key) { await q("DELETE FROM kv WHERE key = $1", [key]); },
    async usage() {
      const t = await q("SELECT COALESCE(SUM(tokens),0)::bigint AS total FROM ai_usage");
      const d = await q("SELECT COALESCE(SUM(tokens),0)::bigint AS today FROM ai_usage WHERE day = $1::date", [dayKey()]);
      const off = await q("SELECT value FROM kv WHERE key = 'usage_offset'");
      return { today: Number(d.rows[0].today), total: Number(t.rows[0].total) + (off.rowCount ? Number(off.rows[0].value) : 0) };
    },
    async addUsage(n) {
      if (!n) return;
      await q("INSERT INTO ai_usage (day, tokens) VALUES ($1::date, $2) ON CONFLICT (day) DO UPDATE SET tokens = ai_usage.tokens + EXCLUDED.tokens", [dayKey(), n]);
    },
    async exportAll() {
      const list = await this.listResponses();
      const out = { responses: [], analysis: {}, digest: await this.getKV("digest"), insights: { themes: await this.getKV("insights.themes") }, usage: await this.usage() };
      for (const { num, analysis, ...r } of list) { out.responses.push(r); if (analysis) out.analysis[r.id] = analysis; }
      return out;
    },
    async close() { await pool.end(); }
  };
};
