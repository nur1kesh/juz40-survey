"use strict";
// Админкені тексеруге арналған ТЕСТ деректері.
//   node scripts/seed-demo.js            — 48 тест жауап (+ AI-талдау, статустар, қорытынды, тақырыптар) қосады
//   node scripts/seed-demo.js --count=120
//   node scripts/seed-demo.js --remove   — барлық тест деректерін өшіреді (нағыз жауаптарға тимейді)
// Тест жазбалары cid="demo-…" және дереккөзі "demo-…" арқылы танылады. Қайта іске қосу алдыңғы тест деректерін ауыстырады.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..");

try { // .env оқу (server.js сияқты)
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) { /* .env жоқ */ }

const remove = process.argv.includes("--remove");
const N = +((process.argv.find(a => a.startsWith("--count=")) || "").split("=")[1]) || 48;
const store = require("../store")({ DATA_DIR: process.env.DATA_DIR || path.join(ROOT, "data"), DATABASE_URL: process.env.DATABASE_URL || "", DATABASE_SSL: process.env.DATABASE_SSL === "1" });

// детерминді кездейсоқ сан
let seed = 20260930; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const wpick = pairs => { let r = rnd() * pairs.reduce((s, [, w]) => s + w, 0); for (const [v, w] of pairs) if ((r -= w) <= 0) return v; return pairs[0][0]; };

const REASON = {
  mostly: ["Көбіне күткендей болды, тек практика аздау көрінді.", "Жалпы жақсы, бірақ кейбір сабақтар тым жылдам өтті."],
  half: ["Практикалық тапсырмалар күткенімнен аз болды.", "Мұғалім тақырыпты терең түсіндірмеді деп ойлаймын.", "Платформадағы қиындықтар оқуға кедергі келтірді."],
  mostlyNot: ["Жүктеме өте көп болды, жұмыспен қатар үлгере алмадым.", "Материалдар ескірген сияқты, нақты жобалар аз.", "Куратор кеш жауап берді, сұрақтарым жауапсыз қалды."],
  not: ["Күткенімнің ешқайсысы орындалмады: сабақ сапасы төмен.", "Төлеген ақшама сай емес, мазмұны үстірт.", "Курстың құрылымы түсініксіз, не істеу керегін білмедім."]
};
const DETAIL = {
  system: ["Тапсырмалардың мерзімі тым қатаң, демалыссыз үлгеру қиын.", "Курс құрылымы түсініксіз, қай модульден бастау керегі белгісіз.", "Апталық жүктеме шамадан тыс."],
  platform: ["Платформа баяу жұмыс істейді, бейнесабақ жиі тоқтап қалады.", "Жүйеге кіру кезінде қателер шығып тұрды.", "Мобильді нұсқада тапсырманы жіберу мүмкін болмады."],
  materials: ["Оқу материалдары ескірген, мысалдар өмірден алшақ.", "Конспект аз, тек бейне бойынша оқу ыңғайсыз.", "Практикалық тапсырмаларға шешім не талдау берілмейді."],
  curator: ["Куратор сұрағыма 2–3 күн жауап бермеді.", "Тапсырманы тексергенде түсіндірме жазылмайды.", "Куратормен байланыс тек жұмыс уақытында, кешке қиын."],
  teacher: ["Мұғалім тақырыпты жылдам өтіп, мысал келтірмейді.", "Сабақтар көбіне теория, практика аз.", "Түсіндіру стилі маған сәйкес келмеді."],
  other: ["Төлем шарттары түсініксіз болды.", "Курс басталар алдында ақпарат аз берілді."]
};
const SUGGEST = ["Практикалық жобаларды көбейтіңіздер.", "Кураторлар жауапты 24 сағат ішінде беруі керек.", "Платформаны жылдамдатып, мобильді нұсқасын жақсартыңыздар.", "Апталық жүктемені азайтып, мерзімді ұзартыңыздар.", "Материалдарды жаңартып, нақты мысалдар қосыңыздар.", "Курс басында толық жол картасын беріңіздер.", "", "", ""];
const AREAS = ["system", "platform", "materials", "curator", "teacher"];
const SCORE = { full: [9, 10], mostly: [7, 9], half: [5, 7], mostlyNot: [2, 5], not: [0, 3] };
// AI-талдау үлгілері (тек тест үшін, нағыз AI емес)
const CAT = { system: "Оқу жүктемесі", platform: "Платформа", materials: "Оқу материалдары", curator: "Куратор жұмысы", teacher: "Мұғалімнің біліктілігі", other: "Төлем / баға" };
const CHURN = { system: "Жүктеме тым көп, үлгере алмады", platform: "Платформа баяу және қателі", materials: "Материалдар ескірген", curator: "Куратор кеш жауап береді", teacher: "Түсіндіру сапасы төмен", other: "Төлем шарттары түсініксіз" };
const ACTION = { system: "Апталық жүктемені қарап, мерзімді икемдендіру", platform: "Платформа қателерін жөндеп, жылдамдықты тексеру", materials: "Материалдарды жаңартып, нақты мысал қосу", curator: "Кураторға 24 сағаттық жауап нормасын енгізу", teacher: "Мұғаліммен бірге практика үлесін арттыру", other: "Төлем шарттарын анық түсіндіру" };
const PREVENTABLE = new Set(["system", "platform", "materials", "curator", "teacher"]);

const isDemo = r => (r.cid || "").startsWith("demo-");

async function removeDemo() {
  const list = await store.listResponses(); let n = 0;
  for (const r of list) if (isDemo(r)) { await store.deleteResponse(r.id); n++; }
  for (const k of ["digest", "insights.themes", "insights.actions"]) { const v = await store.getKV(k); if (v && v.demo) await store.deleteKV(k); }
  return n;
}

async function main() {
  await store.init();
  const removed = await removeDemo();
  if (remove) { console.log(`Өшірілді: ${removed} тест жауап (нағыз жауаптар сақталды).`); return; }
  if (removed) console.log(`Алдыңғы ${removed} тест жауап ауыстырылды.`);

  // 1) жауаптарды құру (уақыт бойынша өсу ретімен, сонда нөмірлер де ретімен)
  const now = Date.now(), items = [];
  for (let i = 0; i < N; i++) {
    const expectation = wpick([["full", 20], ["mostly", 25], ["half", 22], ["mostlyNot", 18], ["not", 15]]);
    const score = between(...SCORE[expectation]);
    const positive = expectation === "full" || (expectation === "mostly" && chance(.4));
    const issues = positive && chance(.75) ? ["none"] : [...new Set(Array.from({ length: between(1, 2) }, () => pick(chance(.08) ? [...AREAS, "other"] : AREAS)))];
    const liked = [...new Set(Array.from({ length: between(1, 3) }, () => pick(["curator", "materials", "system", "platform", "teacher", "other"])))];
    const daysAgo = Math.pow(rnd(), 1.4) * 45;
    items.push({
      t: now - daysAgo * 864e5 - between(0, 86e3) * 1000 % 864e5, expectation, score, issues, liked,
      reason: expectation === "full" ? "" : pick(REASON[expectation]),
      likedOther: liked.includes("other") ? "Чаттағы қауымдастық ұнады" : "",
      detail: issues[0] === "none" ? "" : issues.map(a => pick(DETAIL[a])).join(" "),
      suggestion: pick(SUGGEST), ref: "demo-" + pick(["поток-1", "поток-1", "поток-2", "сайт", "instagram"])
    });
  }
  items.sort((a, b) => a.t - b.t);
  const docs = items.map((x, i) => ({
    id: crypto.randomUUID(), createdAt: new Date(x.t).toISOString(), cid: "demo-" + String(i + 1).padStart(4, "0") + "-" + crypto.randomBytes(3).toString("hex"),
    score: x.score, expectation: x.expectation, expectationReason: x.reason, liked: x.liked, likedOther: x.likedOther, issues: x.issues,
    issuesDetail: x.detail, suggestion: x.suggestion, ref: x.ref
  }));
  for (const d of docs) await store.addResponse(d);

  // 2) AI-талдау (тест үлгісі), статустар
  const list = (await store.listResponses()).filter(isDemo);
  const byCat = {};
  for (const r of list) {
    const area = r.issues[0] === "none" ? null : r.issues[0];
    const positive = !area;
    const a = {
      category: positive ? "Оң пікір" : CAT[area], sentiment: r.score <= 6 ? "Negative" : r.score <= 8 ? "Neutral" : "Positive",
      importance: positive ? "Low" : r.score <= 3 ? "High" : r.score <= 6 ? "Medium" : "Low",
      topic: positive ? "Оң баға" : CAT[area], summary: positive ? "Оқушы курсқа көңілі толғанын айтты." : (r.issuesDetail.split(". ")[0] || "").slice(0, 200),
      churnReason: positive ? "" : CHURN[area], preventable: positive ? "No" : PREVENTABLE.has(area) ? "Yes" : "No",
      returnPotential: positive ? "Low" : PREVENTABLE.has(area) && r.score >= 6 ? "High" : PREVENTABLE.has(area) && r.score >= 4 ? "Medium" : "Low",
      action: positive ? "" : ACTION[area], v: 2, sourceStamp: r.createdAt, analyzedAt: new Date().toISOString()
    };
    await store.saveAnalysis(r.id, a);
    if (!positive) (byCat[a.category] = byCat[a.category] || []).push(r);
  }

  // 3) қорытынды, тақырыптар, жоспар (тест мәтіні; жауап нөмірлері шынайы)
  const ids = cat => (byCat[cat] || []).slice(-6).map(r => r.num);
  const cnt = cat => (byCat[cat] || []).length;
  const at = new Date().toISOString(), total = await store.count();
  const avg = (list.reduce((s, r) => s + r.score, 0) / list.length).toFixed(1);
  await store.setKV("digest", { demo: true, at, count: total, text:
    `[ТЕСТ ДЕРЕК] Жалпы көңіл-күй: орташа баға ${avg}/10, күтуі толық немесе көбіне ақталғандар шамамен ${Math.round(list.filter(r => ["full", "mostly"].includes(r.expectation)).length / list.length * 100)}%.\n` +
    `Негізгі мәселелер: 1) Платформа баяулығы мен қателер (${cnt("Платформа")} жауап, ${ids("Платформа").slice(0, 3).map(n => "#" + n).join(", ")}); 2) Куратор жауабының кешігуі (${cnt("Куратор жұмысы")}, ${ids("Куратор жұмысы").slice(0, 3).map(n => "#" + n).join(", ")}); 3) Оқу жүктемесі (${cnt("Оқу жүктемесі")}).\n` +
    `Ұнағаны: кураторлардың қолдауы, оқу материалдары.\nҰсыныс: платформаны тұрақтандыру, куратор жауабына 24 сағаттық норма, апталық жүктемені азайту.` });
  const th = (title, cat, description, quote, sev) => ({ title, description, count: cnt(cat), severity: sev, quote, ids: ids(cat) });
  await store.setKV("insights.themes", { demo: true, at, count: total, items: [
    th("Платформа баяулығы", "Платформа", "Оқушылар бейнесабақтың тоқтап қалуын және кіру қателерін атап өтті. Бұл оқуды тікелей кідіртеді.", "Платформа баяу жұмыс істейді, бейнесабақ жиі тоқтап қалады.", "High"),
    th("Куратор жауабының кешігуі", "Куратор жұмысы", "Сұрақтарға 2–3 күн жауап берілмейді, кешкі уақытта байланыс жоқ.", "Куратор сұрағыма 2–3 күн жауап бермеді.", "High"),
    th("Оқу жүктемесі", "Оқу жүктемесі", "Мерзімдер қатаң, жұмыспен қатар үлгеру қиын.", "Апталық жүктеме шамадан тыс.", "Medium"),
    th("Ескірген материалдар", "Оқу материалдары", "Мысалдар өмірден алшақ, практикалық тапсырмаларға талдау жоқ.", "Оқу материалдары ескірген, мысалдар өмірден алшақ.", "Medium"),
    th("Түсіндіру сапасы", "Мұғалімнің біліктілігі", "Теория көп, практика аз, мысал жетіспейді.", "Сабақтар көбіне теория, практика аз.", "Low")
  ].filter(t => t.count > 0) });
  const fin = await store.listResponses();
  console.log(`Қосылды: ${docs.length} тест жауап (жалпы ${fin.length}), ${list.filter(r => true).length} AI-талдау, қорытынды + ${(await store.getKV("insights.themes")).items.length} тақырып.`);
  console.log("Өшіру: node scripts/seed-demo.js --remove");
}
main().then(() => store.close()).then(() => process.exit(0)).catch(e => { console.error("Қате:", e.message); process.exit(1); });
