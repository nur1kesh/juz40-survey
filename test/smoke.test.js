"use strict";
// Түтін-тест: `npm test`. Нақты OpenAI-ға өтпейді — жергілікті жалған сервер қолданылады.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
// TEST_DATABASE_URL берілсе, барлық сценарий PostgreSQL-да жүреді (`npm run test:pg`), әйтпесе JSON-файлда.
const PG = process.env.TEST_DATABASE_URL || "";
async function resetPg(tables = "analysis, followups, kv, ai_usage, responses") {
  const { Client } = require("pg"); const c = new Client({ connectionString: PG }); await c.connect();
  try { await c.query(`DROP TABLE IF EXISTS ${tables} CASCADE`); } finally { await c.end(); }
}
async function pgQuery(sql, params) {
  const { Client } = require("pg"); const c = new Client({ connectionString: PG }); await c.connect();
  try { return await c.query(sql, params); } finally { await c.end(); }
}
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const good = { score: 6, expectation: "half", expectationReason: "аз практика", liked: ["curator"], issues: ["platform"], issuesDetail: "баяу" };

let mock, mockPort, srv, base, dataDir, cookie = "", logs = "";

function startMock() {
  return new Promise(res => {
    mock = http.createServer((req, rsp) => {
      let b = ""; req.on("data", c => b += c); req.on("end", () => {
        const u = JSON.parse(b).messages.at(-1).content; let content;
        if (u.includes('"items"')) {
          const arr = JSON.parse(u.slice(u.lastIndexOf("Жауаптар:\n") + 10));
          content = JSON.stringify({ items: arr.map(r => ({ id: r.id, category: "Платформа", sentiment: "Negative", topic: "Тест", importance: "High", summary: "т", churn_reason: "с", preventable: "Yes", return_potential: "High", action: "а" })) });
        } else content = "жауап";
        rsp.writeHead(200, { "Content-Type": "application/json" });
        rsp.end(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 1000 } }));
      });
    }).listen(0, "127.0.0.1", () => { mockPort = mock.address().port; res(); });
  });
}
async function startServer(extraEnv = {}, dir = dataDir) {
  const port = await freePort();
  const p = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, NO_DOTENV: "1", PORT: String(port), DATA_DIR: dir, DATABASE_URL: PG, ADMIN_PASSWORD: "pw", OPENAI_API_KEY: "k", OPENAI_BASE_URL: `http://127.0.0.1:${mockPort}`, AUTO_ANALYZE: "0", ...extraEnv } });
  p.stdout.on("data", d => logs += d); p.stderr.on("data", d => logs += d);
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${port}/healthz`)).ok) return { p, port }; } catch (e) { /* ждём */ } await new Promise(r => setTimeout(r, 100)); }
  throw new Error("сервер қосылмады: " + logs);
}
const api = (p, o = {}) => fetch(base + p, { ...o, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...(o.headers || {}) }, body: o.body ? JSON.stringify(o.body) : undefined });

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "juz40-test-"));
  if (PG) await resetPg();
  await startMock();
  const s = await startServer(); srv = s.p; base = `http://localhost:${s.port}`;
});
after(() => { srv && srv.kill(); mock && mock.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test("healthz және статика (CSP, қаріп)", async () => {
  assert.equal((await fetch(base + "/healthz")).status, 200);
  const r = await fetch(base + "/");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  const f = await fetch(base + "/fonts/Onest.woff2");
  assert.equal(f.headers.get("content-type"), "font/woff2");
  assert.equal((await fetch(base + "/..%2fserver.js")).status >= 400, true, "path traversal жабық болуы керек");
  assert.equal((await fetch(base + "/%E0%A4%A")).status, 400);
});

test("сауалнама валидациясы", async () => {
  for (const bad of [{ ...good, score: null }, { ...good, score: "" }, { ...good, score: 11 }, { ...good, expectationReason: "" }, { ...good, liked: [] }, { ...good, issues: ["none", "platform"] }, { ...good, issuesDetail: "" }]) {
    assert.equal((await api("/api/responses", { method: "POST", body: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await api("/api/responses", { method: "POST", body: { ...good, score: 10, expectation: "full", expectationReason: "", issues: ["none"], issuesDetail: "" } })).status, 201);
});

test("honeypot және қайталанған жіберу (cid)", async () => {
  await api("/api/responses", { method: "POST", body: { ...good, website: "spam" } });
  const a = await api("/api/responses", { method: "POST", body: { ...good, cid: "test-cid-12345", ref: "поток-1 <b>" } });
  const b = await api("/api/responses", { method: "POST", body: { ...good, cid: "test-cid-12345" } });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
});

test("админ авторизациясы", async () => {
  assert.equal((await api("/api/admin/data")).status, 401);
  assert.equal((await api("/api/admin/login", { method: "POST", body: { password: "wrong" } })).status, 401);
  const r = await api("/api/admin/login", { method: "POST", body: { password: "pw" } });
  assert.equal(r.status, 200);
  cookie = r.headers.get("set-cookie").split(";")[0];
  assert.match(r.headers.get("set-cookie"), /HttpOnly/);
  assert.equal((await api("/api/admin/data")).status, 200);
});

test("деректер: honeypot сақталмаған, cid бір рет, ref тазаланған", async () => {
  const d = await (await api("/api/admin/data")).json();
  assert.equal(d.responses.length, 2, "1 (full) + 1 (cid), honeypot жоқ, cid қайталанбайды");
  assert.equal(d.responses.find(x => x.cid === "test-cid-12345").ref, "поток-1 b");
  assert.equal(d.autoAnalyze, false);
});

test("CSV инъекциясы, backup, өшіру", async () => {
  await api("/api/responses", { method: "POST", body: { ...good, cid: "csv-inject-1", suggestion: "=SUM(1)" } });
  const d = await (await api("/api/admin/data")).json(); const id = d.responses[0].id;
  assert.equal((await api("/api/admin/followup/" + id, { method: "PATCH", body: {} })).status, 404, "байланыс функциясы жойылған");
  const csv = await (await api("/api/admin/export.csv")).text();
  assert.ok(csv.includes('"\'=SUM(1)"'), "CSV формула инъекциясы экрандалуы керек");
  assert.equal((await api("/api/admin/backup.json")).status, 200);
  assert.equal((await api("/api/admin/responses/" + id, { method: "DELETE" })).status, 200);
  assert.equal((await (await api("/api/admin/data")).json()).responses.length, d.responses.length - 1);
});

test("AI: талдау, токен санағышы; бөлек серверде күндік лимит", async () => {
  const r = await api("/api/admin/analyze", { method: "POST" });
  assert.equal(r.status, 200);
  const d = await (await api("/api/admin/data")).json();
  assert.equal(d.responses[0].ai.category, "Платформа");
  assert.equal(d.usage.total, 1000);
  // лимитпен бөлек сервер: 1-ші сұраныс өтеді (1000 ≥ 500), 2-ші тоқтатылады
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "juz40-test2-"));
  if (PG) await pgQuery("TRUNCATE ai_usage");
  const s2 = await startServer({ AI_DAILY_TOKEN_LIMIT: "500" }, dir2);
  try {
    const b2 = `http://localhost:${s2.port}`; let ck;
    const lg = await fetch(b2 + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw" }) });
    ck = lg.headers.get("set-cookie").split(";")[0];
    const H = { "Content-Type": "application/json", Cookie: ck };
    assert.equal((await fetch(b2 + "/api/responses", { method: "POST", headers: H, body: JSON.stringify(good) })).status, 201);
    assert.equal((await fetch(b2 + "/api/admin/ask", { method: "POST", headers: H, body: JSON.stringify({ question: "1" }) })).status, 200);
    const blocked = await fetch(b2 + "/api/admin/ask", { method: "POST", headers: H, body: JSON.stringify({ question: "2" }) });
    assert.equal(blocked.status, 502); assert.match((await blocked.json()).error, /лимит/);
  } finally { s2.p.kill(); fs.rmSync(dir2, { recursive: true, force: true }); }
});

test("бүлінген db.json: сервер бос базамен жазып жібермейді", { skip: PG ? "тек файл режимі" : false }, async () => {
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), "juz40-test3-"));
  fs.writeFileSync(path.join(dir3, "db.json"), "{ бүлінген");
  const port = await freePort();
  const p = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, NO_DOTENV: "1", DATABASE_URL: "", PORT: String(port), DATA_DIR: dir3, ADMIN_PASSWORD: "pw" } });
  const code = await new Promise(res => p.on("exit", res));
  try {
    assert.equal(code, 1);
    assert.ok(fs.readdirSync(dir3).some(n => n.startsWith("db.json.corrupt-")), "көшірме жасалуы керек");
    assert.equal(fs.readFileSync(path.join(dir3, "db.json"), "utf8"), "{ бүлінген", "түпнұсқа өзгермеуі керек");
  } finally { fs.rmSync(dir3, { recursive: true, force: true }); }
});

test("прототип кілттері және бүлінген кукі қабылданбайды/құлатпайды", async () => {
  for (const bad of [{ ...good, expectation: "constructor" }, { ...good, expectation: "__proto__" }, { ...good, liked: ["constructor"] }, { ...good, issues: ["toString"], issuesDetail: "x" }]) {
    assert.equal((await fetch(base + "/api/responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bad) })).status, 400, JSON.stringify(bad));
  }
  const r = await fetch(base + "/api/session", { headers: { Cookie: "juz40_admin=%E0%A4%A" } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).admin, false);
});

test("Excel (.xlsx) экспорты: жарамды zip, 2 парақ, формула мәтін болып қалады", async () => {
  await api("/api/responses", { method: "POST", body: { ...good, cid: "xlsx-test-1234", suggestion: "=HYPERLINK(1)" } });
  const r = await api("/api/admin/export.xlsx?tz=-300");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /spreadsheetml\.sheet/);
  assert.match(r.headers.get("content-disposition"), /\.xlsx"/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), "PK", "zip қолтаңбасы");
  // қысылған zip: орталық каталогтан файлдарды оқып, deflate-ті ашамыз
  const zlib = require("node:zlib");
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10); let off = buf.readUInt32LE(eocd + 16); const parts = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(off + 10), csize = buf.readUInt32LE(off + 20), usize = buf.readUInt32LE(off + 24), nlen = buf.readUInt16LE(off + 28), lho = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nlen).toString();
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const body = method === 8 ? zlib.inflateRawSync(buf.subarray(start, start + csize)) : buf.subarray(start, start + csize);
    assert.equal(body.length, usize, name + ": өлшем сәйкес"); parts[name] = body.toString("utf8"); off += 46 + nlen;
  }
  for (const part of ["[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) assert.ok(parts[part], part);
  assert.ok(parts["xl/workbook.xml"].includes("Жауаптар") && parts["xl/workbook.xml"].includes("Қорытынды"), "парақ атаулары");
  assert.ok(parts["xl/worksheets/sheet1.xml"].includes('t="inlineStr"') && parts["xl/worksheets/sheet1.xml"].includes("=HYPERLINK(1)"), "формула инъекциясы мәтін ретінде сақталуы керек");
  assert.equal((await fetch(base + "/api/admin/export.xlsx")).status, 401, "кірмей жүктеуге болмайды");
});

// ---------- PostgreSQL-ға тән тексерулер ----------
const pgTest = (name, fn) => test(name, { skip: PG ? false : "TEST_DATABASE_URL жоқ" }, fn);

pgTest("PostgreSQL: сервер кестелерді өзі жасайды, дерек шынымен базада", async () => {
  const t = await pgQuery("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1");
  const names = t.rows.map(r => r.table_name);
  for (const n of ["ai_usage", "analysis", "kv", "responses"]) assert.ok(names.includes(n), n);
  const c = await pgQuery("SELECT count(*)::int AS c FROM responses");
  const d = await (await api("/api/admin/data")).json();
  assert.equal(d.responses.length, c.rows[0].c);
  assert.equal(d.db, "postgres");
  assert.ok((await pgQuery("SELECT count(*)::int AS c FROM analysis")).rows[0].c >= 1, "AI талдау analysis кестесінде");
});

pgTest("PostgreSQL: тұтастық (CHECK, cid UNIQUE, каскадты өшіру)", async () => {
  await assert.rejects(pgQuery("INSERT INTO responses (id, created_at, score, expectation) VALUES (gen_random_uuid(), now(), 11, 'full')"), /check/i);
  const before = (await pgQuery("SELECT count(*)::int AS c FROM responses")).rows[0].c;
  await api("/api/responses", { method: "POST", body: { ...good, cid: "pg-unique-1234" } });
  await api("/api/responses", { method: "POST", body: { ...good, cid: "pg-unique-1234" } });
  assert.equal((await pgQuery("SELECT count(*)::int AS c FROM responses")).rows[0].c, before + 1, "cid бірегей");
  const id = (await pgQuery("SELECT id FROM responses WHERE cid='pg-unique-1234'")).rows[0].id;
  await api("/api/admin/analyze", { method: "POST" });
  assert.equal((await api("/api/admin/responses/" + id, { method: "DELETE" })).status, 200);
  assert.equal((await pgQuery("SELECT count(*) AS c FROM analysis WHERE response_id=$1", [id])).rows[0].c, "0", "байланысты жазбалар өшуі керек");
  assert.equal((await api("/api/admin/responses/not-a-uuid", { method: "DELETE" })).status, 200);
});

pgTest("PostgreSQL: healthz базаны тексереді, кириллица/қазақ әріптері сақталады", async () => {
  assert.equal((await fetch(base + "/healthz")).status, 200);
  const txt = "Қазақша: ӘҒҚҢӨҰҮҺІ — эмодзи 🙂 және 'тырнақша' \"қос\"";
  await api("/api/responses", { method: "POST", body: { ...good, cid: "pg-kazakh-1234", suggestion: txt } });
  const d = await (await api("/api/admin/data")).json();
  assert.equal(d.responses.find(r => r.cid === "pg-kazakh-1234").suggestion, txt);
});

pgTest("JSON → PostgreSQL: ескі data/db.json автоматты көшіріледі", async () => {
  // басқа тесттердің кестелеріне тимеу үшін бөлек схемада жүреді
  await pgQuery("DROP SCHEMA IF EXISTS migtest CASCADE"); await pgQuery("CREATE SCHEMA migtest");
  const migEnv = { DATABASE_URL: PG + (PG.includes("?") ? "&" : "?") + "options=-c%20search_path%3Dmigtest" };
  const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), "juz40-test4-"));
  const uid = "0f3a1b2c-1111-4222-8333-444455556666";
  const old = {
    responses: [
      { id: uid, seq: 5, createdAt: "2026-09-01T10:00:00.000Z", score: 4, expectation: "half", expectationReason: "аз", liked: ["curator"], likedOther: "", issues: ["platform"], issuesDetail: "баяу", suggestion: "жақсартыңдар", ref: "поток-1", cid: "legacy-cid-1234" },
      { id: "legacy-non-uuid", createdAt: "2026-09-02T10:00:00.000Z", score: 9, expectation: "full", expectationReason: "", liked: ["system"], likedOther: "", issues: ["none"], issuesDetail: "", suggestion: "" }
    ],
    analysis: { [uid]: { category: "Платформа", sentiment: "Negative", importance: "High", topic: "т", summary: "с", churnReason: "р", preventable: "Yes", returnPotential: "High", action: "а", v: 2, sourceStamp: "2026-09-01T10:00:00.000Z", analyzedAt: "2026-09-03T10:00:00.000Z" }, "legacy-non-uuid": { category: "Оң пікір", sentiment: "Positive", importance: "Low", topic: "т", summary: "с", v: 1, sourceStamp: "x" } },
    followups: { [uid]: { status: "returned", note: "қайтты", at: "2026-09-04T10:00:00.000Z" } },
    digest: { text: "ескі қорытынды", at: "2026-09-03T10:00:00.000Z", count: 2 },
    insights: { themes: { items: [{ title: "Тақырып" }], at: "2026-09-03T10:00:00.000Z", count: 2 } },
    usage: { total: 12345, days: { "2026-09-03": 5000 } }
  };
  fs.writeFileSync(path.join(dir4, "db.json"), JSON.stringify(old));
  const s4 = await startServer(migEnv, dir4);
  try {
    const b4 = `http://localhost:${s4.port}`;
    const lg = await fetch(b4 + "/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw" }) });
    const H = { Cookie: lg.headers.get("set-cookie").split(";")[0] };
    const d = await (await fetch(b4 + "/api/admin/data", { headers: H })).json();
    assert.equal(d.responses.length, 2);
    const r1 = d.responses.find(r => r.id === uid);
    assert.equal(r1.ref, "поток-1"); assert.equal(r1.num, "005", "бар seq сақталады"); assert.equal(r1.ai.category, "Платформа");
    assert.equal(d.responses[1].num, "006", "seq жоқ жазба келесі нөмірді алады"); assert.equal(d.responses[1].ai, null, "v=1 талдау ескірген — қайта талдау керек");
    assert.equal(d.digest.text, "ескі қорытынды"); assert.equal(d.insights.themes.items[0].title, "Тақырып");
    assert.equal(d.usage.total, 12345, "токен санағышы сақталады");
    const files = fs.readdirSync(dir4);
    assert.ok(!files.includes("db.json") && files.some(n => n.startsWith("db.json.migrated-")), "ескі файл қайта импортталмас үшін ауыстырылады");
    // көшіруден кейінгі жаңа жауап келесі нөмірді алады (setval)
    await fetch(b4 + "/api/responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(good) });
    const d3 = await (await fetch(b4 + "/api/admin/data", { headers: H })).json();
    assert.equal(d3.responses.at(-1).num, "007");
    // қайта іске қосқанда қайталанбайды
    s4.p.kill(); await new Promise(r => setTimeout(r, 300));
    const s5 = await startServer(migEnv, dir4);
    try {
      const lg5 = await fetch(`http://localhost:${s5.port}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "pw" }) });
      const d5 = await (await fetch(`http://localhost:${s5.port}/api/admin/data`, { headers: { Cookie: lg5.headers.get("set-cookie").split(";")[0] } })).json();
      assert.equal(d5.responses.length, 3, "дубль жоқ");
    } finally { s5.p.kill(); }
  } finally { s4.p.kill(); fs.rmSync(dir4, { recursive: true, force: true }); await pgQuery("DROP SCHEMA IF EXISTS migtest CASCADE"); }
});

test("нөмірлер тұрақты: өшірген кезде басқаларының нөмірі өзгермейді, өшкен нөмір қайта берілмейді", async () => {
  const mk = async cid => { await api("/api/responses", { method: "POST", body: { ...good, cid } }); const d = await (await api("/api/admin/data")).json(); return d.responses.find(r => r.cid === cid); };
  const a = await mk("num-stable-a1"), b = await mk("num-stable-b2"), c = await mk("num-stable-c3");
  assert.ok(+b.num === +a.num + 1 && +c.num === +b.num + 1, "нөмірлер ретімен өседі");
  assert.equal((await api("/api/admin/responses/" + b.id, { method: "DELETE" })).status, 200);
  const d = await (await api("/api/admin/data")).json();
  assert.equal(d.responses.find(r => r.cid === "num-stable-a1").num, a.num);
  assert.equal(d.responses.find(r => r.cid === "num-stable-c3").num, c.num, "c-ның нөмірі өзгермеуі керек");
  const e = await mk("num-stable-e5");
  assert.ok(+e.num > +c.num, "өшірілген нөмір қайта қолданылмайды: " + e.num + " > " + c.num);
});

test("экспорт күн аралығы бойынша (from/to)", async () => {
  const lines = async q => (await (await api("/api/admin/export.csv" + q)).text()).split("\r\n").filter(Boolean).length;
  const all = await lines("");
  assert.ok(all >= 2, "барлығы: тақырып + кемінде 1 жауап");
  const future = new Date(Date.now() + 864e5).toISOString(), past = new Date(Date.now() - 864e5).toISOString();
  assert.equal(await lines("?from=" + encodeURIComponent(future)), 1, "болашақтан бастап — тек тақырып");
  assert.equal(await lines("?to=" + encodeURIComponent(past)), 1, "өткенге дейін — тек тақырып");
  assert.equal(await lines("?from=" + encodeURIComponent(past) + "&to=" + encodeURIComponent(future)), all, "аралық барлығын қамтиды");
  assert.equal(await lines("?from=абырвалг"), all, "қате мән елемейді");
  const x = await api("/api/admin/export.xlsx?from=" + encodeURIComponent(future));
  assert.equal(x.status, 200);
});
