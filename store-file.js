"use strict";
// Файл-сақтау (JSON) — DATABASE_URL жоқ болғанда қолданылатын қарапайым нұсқа.
const fs = require("fs");
const path = require("path");

const pad = i => String(i + 1).padStart(3, "0");
const dayKey = () => new Date().toISOString().slice(0, 10);

module.exports = function createFileStore({ DATA_DIR }) {
  const DB_FILE = path.join(DATA_DIR, "db.json");
  let db = { responses: [], analysis: {}, digest: null, insights: {}, usage: { total: 0, days: {} }, nextSeq: 0 };
  let saving = Promise.resolve();

  function backupDaily() { // күніне 1 сақтық көшірме, соңғы 14 күн
    try {
      const dir = path.join(DATA_DIR, "backups"); fs.mkdirSync(dir, { recursive: true });
      const f = path.join(dir, "db-" + dayKey() + ".json");
      if (fs.existsSync(f)) return;
      fs.copyFileSync(DB_FILE, f);
      const all = fs.readdirSync(dir).filter(n => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
      while (all.length > 14) fs.unlinkSync(path.join(dir, all.shift()));
    } catch (e) { console.error("Сақтық көшірме қатесі:", e.message); }
  }
  function save() { // true — сәтті, false — қате
    saving = saving.then(() => {
      const tmp = DB_FILE + ".tmp";
      return fs.promises.writeFile(tmp, JSON.stringify(db)).then(() => fs.promises.rename(tmp, DB_FILE)).then(backupDaily).then(() => true);
    }).catch(e => { console.error("Сақтау қатесі:", e); return false; });
    return saving;
  }

  return {
    kind: "file",
    async init() {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      if (fs.existsSync(DB_FILE)) try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) }; }
      catch (e) {
        // бүлінген базаны бос базамен «үстінен жазып» жібермейміз
        const bad = DB_FILE + ".corrupt-" + Date.now();
        try { fs.copyFileSync(DB_FILE, bad); } catch (e2) { /* көшірме жасалмады */ }
        console.error("⚠ data/db.json оқылмады (" + e.message + "). Көшірме: " + bad + ". Файлды тексеріп, сақтық көшірмеден қайтарыңыз (data/backups).");
        process.exit(1);
      }
      db.usage = db.usage || { total: 0, days: {} }; db.insights = db.insights || {}; db.analysis = db.analysis || {};
      // тұрақты нөмір: ескі жазбаларға құрылу ретімен беріледі, өшірілген нөмір қайта қолданылмайды
      let max = Math.max(db.nextSeq || 0, ...db.responses.map(r => r.seq || 0));
      db.responses.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).forEach(r => { if (!r.seq) r.seq = ++max; });
      db.nextSeq = max;
    },
    async ping() { return true; },
    async listResponses() {
      const list = db.responses.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return list.map(r => ({ ...r, num: pad(r.seq - 1), analysis: db.analysis[r.id] || null }));
    },
    async count() { return db.responses.length; },
    async exists(id) { return db.responses.some(r => r.id === id); },
    async addResponse(doc) {
      if (doc.cid && db.responses.some(r => r.cid === doc.cid)) return "duplicate";
      doc.seq = ++db.nextSeq;
      db.responses.push(doc);
      if (!(await save())) { db.responses = db.responses.filter(r => r.id !== doc.id); throw new Error("save_failed"); }
      return "ok";
    },
    async deleteResponse(id) {
      db.responses = db.responses.filter(r => r.id !== id); delete db.analysis[id];
      await save();
    },
    async saveAnalysis(id, a) { db.analysis[id] = a; await save(); },
    async getKV(key) { return key === "digest" ? db.digest || null : key.startsWith("insights.") ? db.insights[key.slice(9)] || null : null; },
    async setKV(key, value) { if (key === "digest") db.digest = value; else if (key.startsWith("insights.")) db.insights[key.slice(9)] = value; await save(); },
    async deleteKV(key) { if (key === "digest") db.digest = null; else if (key.startsWith("insights.")) delete db.insights[key.slice(9)]; await save(); },
    async usage() { return { today: (db.usage.days && db.usage.days[dayKey()]) || 0, total: db.usage.total || 0 }; },
    async addUsage(n) {
      if (!n) return;
      db.usage.total = (db.usage.total || 0) + n; db.usage.days = db.usage.days || {};
      db.usage.days[dayKey()] = (db.usage.days[dayKey()] || 0) + n;
      const keys = Object.keys(db.usage.days).sort(); while (keys.length > 60) delete db.usage.days[keys.shift()];
      await save();
    },
    async exportAll() { return db; },
    async close() { await saving; }
  };
};
