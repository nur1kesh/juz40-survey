(function () {
  "use strict";
  const EXP = [
    { k: "full", l: "Толықтай ақтады", s: "Толық" }, { k: "mostly", l: "Көбіне ақтады", s: "Көбіне" },
    { k: "half", l: "Жартылай ақтады", s: "Жартылай" }, { k: "mostlyNot", l: "Көбіне ақтамады", s: "Көбіне ақтамады" },
    { k: "not", l: "Мүлдем ақтамады", s: "Ақтамады" }
  ];
  const AREAS = [
    { k: "system", l: "Курс жүйесі" }, { k: "platform", l: "Платформа" }, { k: "materials", l: "Оқу материалдары" },
    { k: "curator", l: "Куратор жұмысы" }, { k: "teacher", l: "Мұғалімнің біліктілігі" }, { k: "other", l: "Басқа" }
  ];
  const ISSUES = AREAS.concat([{ k: "none", l: "Қиындық болған жоқ" }]);
  const SENT = ["Negative", "Neutral", "Positive"];
  const lab = (list, k) => (list.find(x => x.k === k) || {}).l || k;
  const expShort = k => (EXP.find(x => x.k === k) || {}).s || "—";
  const band = n => (n <= 6 ? "lo" : n <= 8 ? "md" : "hi");
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const p2 = n => String(n).padStart(2, "0");
  const fmtDate = (iso, full) => { if (!iso) return "—"; const d = new Date(iso); return p2(d.getDate()) + "." + p2(d.getMonth() + 1) + (full ? "." + d.getFullYear() + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()) : "." + String(d.getFullYear()).slice(2)); };
  const likedText = r => (r.liked || []).map(k => k === "other" && r.likedOther ? r.likedOther : lab(AREAS, k)).join(", ") || "—";
  const issuesText = r => (r.issues || []).includes("none") ? "—" : (r.issues || []).map(k => lab(AREAS, k)).join(", ") || "—";
  function labelCells() {
    document.querySelectorAll("table.main").forEach(t => {
      const h = [...t.querySelectorAll("thead th")].map(x => x.textContent);
      t.querySelectorAll("tbody tr").forEach(tr => [...tr.children].forEach((td, i) => { td.dataset.label = h[i] || ""; }));
    });
  }
  let toastT;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), 3500); }

  async function api(path, opts) {
    const r = await fetch(path, opts && opts.body ? { ...opts, headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts.body) } : opts);
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== "/api/admin/login") { showLogin(); throw new Error("auth"); }
    if (!r.ok) throw new Error(d.error || "Қате");
    return d;
  }

  let D = { responses: [], digest: null, aiEnabled: false, model: "" };
  const filt = { q: "", exp: "", sent: "", imp: "", sort: "new", limit: 50, from: null, to: null };
  let period = 0;
  function inPeriod() { if (!period) return D.all; const t = Date.now() - period * 864e5; return D.all.filter(r => new Date(r.createdAt).getTime() >= t); }
  const staleNote = c => { const d = D.all.length - (c || 0); return d > 0 ? " · +" + d + " жаңа жауап — жаңартыңыз" : ""; };

  function showLogin() { $("adminView").classList.add("hidden"); $("loginView").classList.remove("hidden"); $("pw").focus(); }
  $("loginForm").onsubmit = async e => {
    e.preventDefault(); $("loginErr").textContent = "";
    try { await api("/api/admin/login", { method: "POST", body: { password: $("pw").value } }); $("pw").value = ""; await load(); }
    catch (err) { $("loginErr").textContent = err.message === "auth" ? "" : err.message; }
  };
  $("logout").onclick = async () => { await fetch("/api/admin/logout", { method: "POST" }); showLogin(); };

  async function load() {
    try { D = await api("/api/admin/data"); } catch (e) { if (e.message !== "auth") toast(e.message); return; }
    D.all = D.responses; D.responses = inPeriod();
    $("loginView").classList.add("hidden"); $("adminView").classList.remove("hidden");
    renderAll();
  }

  /* tabs & filters */
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => {
    document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", String(x === b)));
    $("tab-stats").classList.toggle("hidden", b.dataset.tab !== "stats");
    $("tab-table").classList.toggle("hidden", b.dataset.tab !== "table");
    $("tab-ai").classList.toggle("hidden", b.dataset.tab !== "ai");
  });
  EXP.forEach(e => { const o = document.createElement("option"); o.value = e.k; o.textContent = e.l; $("fExp").appendChild(o); });
  $("fSearch").oninput = e => { filt.q = e.target.value.toLowerCase(); renderTable(); };
  $("fExp").onchange = e => { filt.exp = e.target.value; renderTable(); };
  $("fSent").onchange = e => { filt.sent = e.target.value; renderTable(); };
  $("fImp").onchange = e => { filt.imp = e.target.value; renderTable(); };
  $("fSort").onchange = e => { filt.sort = e.target.value; renderTable(); };
  // күн-уақыт аралығы: сүзгі және жүктеу сілтемелері (Excel/CSV таңдалған аралық үшін)
  const pad2 = n => String(n).padStart(2, "0");
  const toLocalInput = d => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  const rangeBad = () => filt.from != null && filt.to != null && filt.from > filt.to;
  function updateExportLinks() {
    let q = "?tz=" + new Date().getTimezoneOffset();
    if (filt.from != null && !rangeBad()) q += "&from=" + encodeURIComponent(new Date(filt.from).toISOString());
    if (filt.to != null && !rangeBad()) q += "&to=" + encodeURIComponent(new Date(filt.to).toISOString());
    $("xlsxBtn").href = "/api/admin/export.xlsx" + q; $("csvBtn").href = "/api/admin/export.csv" + q;
  }
  function setRange(from, to) {
    $("fFrom").value = from ? toLocalInput(from) : ""; $("fTo").value = to ? toLocalInput(to) : "";
    readRange();
  }
  function readRange() {
    const f = $("fFrom").value, t = $("fTo").value;
    filt.from = f ? new Date(f).getTime() : null;
    filt.to = t ? new Date(t).getTime() + 59999 : null; // таңдалған минуттың соңына дейін қоса
    $("fFrom").classList.toggle("bad", rangeBad()); $("fTo").classList.toggle("bad", rangeBad());
    filt.limit = 50; updateExportLinks(); renderTable();
  }
  $("fFrom").onchange = readRange; $("fTo").onchange = readRange;
  $("fClear").onclick = () => setRange(null, null);
  document.querySelectorAll(".quick [data-q]").forEach(b => { b.onclick = () => {
    const now = new Date(), start = new Date(now);
    if (b.dataset.q === "today") start.setHours(0, 0, 0, 0); else { start.setDate(start.getDate() - (+b.dataset.q)); }
    setRange(start, null);
  }; });
  updateExportLinks();
  $("moreBtn").onclick = () => { filt.limit += 50; renderTable(); };
  $("period").onchange = e => { period = +e.target.value; D.responses = inPeriod(); filt.limit = 50; renderAll(); };
  $("copyLink").onclick = () => {
    const local = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(location.hostname);
    const box = document.createElement("div");
    box.innerHTML = '<div class="scrim"></div><div class="dlg" role="dialog" aria-modal="true" aria-label="Сауалнама сілтемесі"><h3>Сауалнама сілтемесі</h3>' +
      (local ? '<p class="warn">Бұл жергілікті мекенжай (' + esc(location.host) + ') — оқушылар оны аша алмайды. Сайтты хостингке жариялап, админкені сол мекенжаймен ашыңыз.</p>' : "") +
      '<label class="fl" for="lkRef">Ағым белгісі (міндетті емес)</label><input type="text" id="lkRef" maxlength="60" placeholder="мысалы: поток-5">' +
      '<label class="fl" for="lkUrl">Сілтеме</label><input type="text" id="lkUrl" readonly>' +
      '<div class="fu-row" style="margin-top:16px"><button class="btn" id="lkCopy" type="button">Көшіру</button><a class="btn ghost" id="lkOpen" target="_blank" rel="noopener">Ашу</a><button class="btn ghost" id="lkClose" type="button">Жабу</button></div><p class="muted" id="lkMsg" style="margin:12px 0 0;font-size:13px"></p></div>';
    document.body.appendChild(box);
    const url = () => location.origin + "/" + ($("lkRef").value.trim() ? "?ref=" + encodeURIComponent($("lkRef").value.trim()) : "");
    const sync = () => { $("lkUrl").value = url(); $("lkOpen").href = url(); };
    const close = () => { box.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    $("lkRef").oninput = sync; sync();
    box.querySelector(".scrim").onclick = close; $("lkClose").onclick = close;
    $("lkCopy").onclick = async () => {
      const inp = $("lkUrl"); inp.focus(); inp.select();
      let ok = false;
      try { await navigator.clipboard.writeText(inp.value); ok = true; } catch (e) { /* ескі әдіс */ }
      if (!ok) { try { ok = document.execCommand("copy"); } catch (e) { ok = false; } }
      $("lkMsg").textContent = ok ? "Көшірілді ✓" : "Автоматты көшіру мүмкін болмады: сілтеме таңдалды, Ctrl+C басыңыз.";
    };
    $("lkUrl").onfocus = e => e.target.select();
    $("lkCopy").focus();
  };

  const fmtTok = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "k" : String(n);
  function renderUsage() {
    const u = D.usage; if (!u || !D.aiEnabled) { $("usageLine").innerHTML = ""; return; }
    const pct = u.limit ? Math.min(100, Math.round(u.today / u.limit * 100)) : 0;
    $("usageLine").innerHTML = '<span>' + icon("target") + " AI токендері: бүгін <b>" + fmtTok(u.today) + "</b>" + (u.limit ? " / " + fmtTok(u.limit) + " (күндік лимит)" : "") + " · барлығы <b>" + fmtTok(u.total) + "</b>" + (D.autoAnalyze ? " · авто-талдау қосулы" : " · авто-талдау өшірулі") + "</span>" + (u.limit ? '<i class="ubar"><i style="width:' + pct + '%"' + (pct >= 80 ? ' class="hot"' : "") + "></i></i>" : "") + '<button class="btn small ghost" id="aiTest" type="button">Байланысты тексеру</button>';
    $("aiTest").onclick = async () => {
      const b = $("aiTest"); b.disabled = true; b.textContent = "Тексерілуде…";
      try { const d = await api("/api/admin/ai-test", { method: "POST" }); toast("AI жұмыс істейді ✓ · " + d.model + " · " + d.ms + " мс · " + d.tokens + " токен"); await load(); }
      catch (e) { if (e.message !== "auth") toast("AI қатесі: " + e.message); }
      finally { const nb = $("aiTest"); if (nb) { nb.disabled = false; nb.textContent = "Байланысты тексеру"; } }
    };
  }
  const okTokens = (what, tokens) => window.confirm(what + "\n\nШамамен " + fmtTok(tokens) + " токен жұмсалады. Жалғастырамыз ба?");
  function renderAll() { renderMetrics(); renderTable(); renderStats(); renderExtra(); renderInsights(); renderCats(); renderSent(); renderImp(); renderDigest(); renderAiBtn(); renderUsage(); }

  const shownMetric = {};
  function countUp(el, key) {
    const t = el.textContent, mt = t.match(/^(-?\d+(?:\.\d+)?)(%?)$/);
    if (!mt || shownMetric[key] === t || matchMedia("(prefers-reduced-motion: reduce)").matches) { shownMetric[key] = t; return; }
    shownMetric[key] = t;
    const to = parseFloat(mt[1]), dec = (mt[1].split(".")[1] || "").length, t0 = performance.now();
    (function f(now) {
      const p = Math.min(1, (now - t0) / 800), e = 1 - Math.pow(1 - p, 3);
      el.textContent = (to * e).toFixed(dec) + mt[2];
      if (p < 1) requestAnimationFrame(f); else el.textContent = t;
    })(t0);
  }
  function renderMetrics() {
    const r = D.responses, n = r.length;
    const avg = n ? (r.reduce((a, x) => a + x.score, 0) / n).toFixed(1) : "—";
    const pro = r.filter(x => x.score >= 9).length, det = r.filter(x => x.score <= 6).length;
    const nps = n ? Math.round((pro - det) / n * 100) : "—";
    const met = n ? Math.round(r.filter(x => x.expectation === "full" || x.expectation === "mostly").length / n * 100) + "%" : "—";
    const neg = r.filter(x => x.ai && x.ai.sentiment === "Negative").length;
    const high = r.filter(x => x.ai && x.ai.importance === "High").length;
    const m = [[n, "Жауаптар саны", ""], [avg, "Орташа баға", n ? band(Math.round(avg)) === "hi" ? "pos" : band(Math.round(avg)) === "md" ? "mid" : "neg" : ""],
      [nps, "NPS (−100…+100)", n ? (nps >= 30 ? "pos" : nps >= 0 ? "mid" : "neg") : ""], [met, "Күтуі ақталды (толық + көбіне)", ""],
      [neg, "Жағымсыз пікір (AI)", neg ? "neg" : ""], [high, "Маңызды мәселе (AI)", high ? "neg" : ""]];
    const ICS = ["users", "smile", "trending-up", "target", "frown", "alert-triangle"];
    $("metrics").innerHTML = m.map(([v, l, c], i) => '<div class="metric ' + c + '"><span class="mi">' + icon(ICS[i]) + "</span><b>" + esc(v) + "</b><span>" + esc(l) + "</span></div>").join("");
    $("metrics").querySelectorAll("b").forEach((el, i) => countUp(el, m[i][1]));
  }

  function renderTable() {
    const all = D.responses; let list = all.slice();
    if (filt.sort === "new") list.reverse(); else if (filt.sort === "low") list.sort((a, b) => a.score - b.score); else if (filt.sort === "high") list.sort((a, b) => b.score - a.score);
    const bad = rangeBad();
    if (bad) list = [];
    else {
      if (filt.from != null) list = list.filter(r => new Date(r.createdAt).getTime() >= filt.from);
      if (filt.to != null) list = list.filter(r => new Date(r.createdAt).getTime() <= filt.to);
    }
    if (filt.exp) list = list.filter(r => r.expectation === filt.exp);
    if (filt.sent) list = list.filter(r => r.ai && r.ai.sentiment === filt.sent);
    if (filt.imp) list = list.filter(r => r.ai && r.ai.importance === filt.imp);
    if (filt.q) list = list.filter(r => [r.expectationReason, r.likedOther, r.issuesDetail, r.suggestion, likedText(r), issuesText(r), r.ai && r.ai.topic, r.ai && r.ai.category, r.ref].join(" ").toLowerCase().includes(filt.q));
    $("emptyTable").classList.toggle("hidden", all.length > 0);
    const total = list.length; list = list.slice(0, filt.limit);
    $("tblCount").textContent = bad ? "Аралық қате: «Бастап» уақыты «Дейін» уақытынан кейін тұр" : all.length ? (total > list.length ? list.length + " / " + total + " жауап көрсетілді" : total + " жауап") : "";
    $("moreBtn").classList.toggle("hidden", total <= list.length);
    $("tbody").innerHTML = list.map(r => {
      const f = !!r.ai;
      const tag = v => f ? '<span class="tag ' + esc(v) + '">' + esc(v) + "</span>" : '<span class="tag wait">талданбаған</span>';
      return '<tr data-id="' + esc(r.id) + '" tabindex="0"><td class="id">' + r.num + "</td><td>" + fmtDate(r.createdAt) + "</td>" +
        '<td><span class="score ' + band(r.score) + '">' + r.score + "</span></td><td>" + esc(expShort(r.expectation)) + "</td>" +
        '<td class="clip"><div>' + esc(likedText(r)) + "</div></td>" +
        '<td class="clip"><div>' + esc(issuesText(r)) + (r.issuesDetail ? '<br><span class="muted">' + esc(r.issuesDetail) + "</span>" : "") + "</div></td>" +
        '<td class="clip"><div>' + esc(r.suggestion || "—") + "</div></td>" +
        "<td>" + (f ? esc(r.ai.category) : '<span class="muted">—</span>') + "</td><td>" + tag(f && r.ai.sentiment) + "</td><td>" + tag(f && r.ai.importance) + "</td></tr>";
    }).join("");
    $("tbody").querySelectorAll("tr").forEach(tr => { const open = () => openDrawer(tr.dataset.id); tr.onclick = open; tr.onkeydown = e => { if (e.key === "Enter") open(); }; });
    labelCells();
  }

  function barsHTML(items, total, cls, fmt) {
    if (!total) return '<p class="muted" style="margin:0">Дерек жоқ</p>';
    const max = Math.max(1, ...items.map(i => i.w != null ? i.w : i.v));
    return items.map(i => '<div class="bar"><span>' + esc(i.l) + '</span><div class="track"><div class="fill ' + (i.c || cls || "") + '" style="width:' + ((i.w != null ? i.w : i.v) / max * 100) + '%"></div></div><b>' + (fmt ? fmt(i) : i.v + ' <small>' + Math.round(i.v / total * 100) + "%</small>") + "</b></div>").join("");
  }
  function renderStats() {
    const r = D.responses, n = r.length;
    const counts = Array(11).fill(0); r.forEach(x => counts[x.score]++);
    const mx = Math.max(1, ...counts);
    $("scoreCols").innerHTML = counts.map((c, i) => '<div class="col"><span class="n">' + (c || "") + '</span><div class="c" style="height:' + (c / mx * 100) + "%;background:var(--" + (i <= 6 ? "neg" : i <= 8 ? "mid" : "pos") + ')"></div><span class="x">' + i + "</span></div>").join("");
    $("expBars").innerHTML = barsHTML(EXP.map((e, i) => ({ l: e.l, v: r.filter(x => x.expectation === e.k).length, c: i < 2 ? "pos" : i === 2 ? "mid" : "neg" })), n);
    $("likedBars").innerHTML = barsHTML(AREAS.map(o => ({ l: o.l, v: r.filter(x => (x.liked || []).includes(o.k)).length })).sort((a, b) => b.v - a.v), n);
    $("issueBars").innerHTML = barsHTML(ISSUES.map(o => ({ l: o.l, v: r.filter(x => (x.issues || []).includes(o.k)).length, c: o.k === "none" ? "pos" : "neg" })).sort((a, b) => b.v - a.v), n);
  }
  function renderAiBtn() {
    const pend = D.all.filter(x => !x.ai).length;
    $("aiBtn").disabled = !pend || !D.aiEnabled;
    $("aiBtn").textContent = !D.aiEnabled ? "AI өшірулі (OPENAI_API_KEY жоқ)" : pend ? "AI-талдау (" + pend + " жаңа)" : "Барлығы талданды";
    $("digestBtn").disabled = !D.aiEnabled; ["themesBtn", "askBtn"].forEach(id => { $(id).disabled = !D.aiEnabled; });
  }
  function renderDigest() {
    if (!D.digest) return;
    $("digest").classList.remove("muted"); $("digest").textContent = D.digest.text;
    $("digestMeta").textContent = fmtDate(D.digest.at, true) + " · " + D.digest.count + " жауап негізінде · " + (D.model || "") + staleNote(D.digest.count);
  }

  $("aiBtn").onclick = async () => {
    const pendN = D.all.filter(x => !x.ai).length; if (!okTokens(pendN + " жауап AI-талдауға жіберіледі.", pendN * 650)) return;
    const b = $("aiBtn"); b.disabled = true; b.textContent = "Талдануда…";
    try { const d = await api("/api/admin/analyze", { method: "POST" }); toast(d.done + " жауап талданды"); await load(); }
    catch (e) { if (e.message !== "auth") toast(e.message); renderAiBtn(); }
  };
  $("digestBtn").onclick = async () => {
    if (!okTokens("Барлық жауаптар бойынша қорытынды жасалады.", Math.min(D.all.length, 300) * 420)) return;
    const b = $("digestBtn"); b.disabled = true; $("digest").classList.remove("muted"); $("digest").textContent = "Ойлануда…";
    try { D.digest = await api("/api/admin/digest", { method: "POST" }); renderDigest(); }
    catch (e) { if (e.message !== "auth") { toast(e.message); $("digest").textContent = D.digest ? D.digest.text : ""; } }
    finally { b.disabled = !D.aiEnabled; }
  };

  function openDrawer(id) {
    const r = D.responses.find(x => x.id === id); if (!r) return;
    const root = $("drawerRoot"); const prevFocus = document.activeElement;
    root.innerHTML = '<div class="scrim"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="Жауап #' + r.num + '">' +
      '<div class="head"><h2 style="margin:0">Жауап #' + r.num + '</h2><button class="btn small ghost" id="dClose">Жабу</button></div>' +
      '<p class="muted" style="margin:6px 0 0">' + fmtDate(r.createdAt, true) + "</p>" +
      (r.ai ? '<div class="ai-box"><b>AI-талдау</b><div class="tags"><span class="tag wait">' + esc(r.ai.category) + '</span><span class="tag ' + esc(r.ai.sentiment) + '">' + esc(r.ai.sentiment) + '</span><span class="tag ' + esc(r.ai.importance) + '">' + esc(r.ai.importance) + "</span></div>" +
        '<p style="margin:10px 0 0"><span class="muted">Тақырып:</span> ' + esc(r.ai.topic) + "</p>" + (r.ai.summary ? '<p style="margin:6px 0 0">' + esc(r.ai.summary) + "</p>" : "") +
        (r.ai.churnReason ? '<p style="margin:10px 0 0"><span class="muted">Кету себебі:</span> ' + esc(r.ai.churnReason) + "</p>" : "") +
        '<p style="margin:6px 0 0"><span class="muted">Алдын алуға болады:</span> ' + (r.ai.preventable === "Yes" ? "иә" : "жоқ") + ' · <span class="muted">Қайтару әлеуеті:</span> ' + esc(r.ai.returnPotential) + "</p>" +
        (r.ai.action ? '<p style="margin:6px 0 0"><span class="muted">Ұсыныс:</span> ' + esc(r.ai.action) + "</p>" : "") + "</div>" : "") +
      "<dl><dt>Баға</dt><dd><span class=\"score " + band(r.score) + '">' + r.score + "</span> / 10</dd>" +
      "<dt>Күтуі ақталды ма</dt><dd>" + esc(lab(EXP, r.expectation)) + "</dd>" +
      (r.expectationReason ? "<dt>Нені күтті және не ақталмады</dt><dd>" + esc(r.expectationReason) + "</dd>" : "") +
      "<dt>Ұнағаны</dt><dd>" + esc(likedText(r)) + "</dd>" +
      "<dt>Қиындық болған жерлер</dt><dd>" + esc((r.issues || []).map(k => lab(ISSUES, k)).join(", ")) + "</dd>" +
      (r.issuesDetail ? "<dt>Толығырақ</dt><dd>" + esc(r.issuesDetail) + "</dd>" : "") +
      "<dt>Ұсыныс</dt><dd>" + esc(r.suggestion || "—") + "</dd>" + (r.ref ? "<dt>Дереккөз</dt><dd>" + esc(r.ref) + "</dd>" : "") + "</dl>" +
      '<p style="margin-top:32px"><button class="btn small danger" id="dDel">Жауапты өшіру</button></p></aside>';
    const close = () => { root.innerHTML = ""; document.removeEventListener("keydown", onKey); if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus(); };
    const onKey = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    root.querySelector(".scrim").onclick = close; $("dClose").onclick = close; $("dClose").focus();
    const del = $("dDel");
    del.onclick = async () => {
      if (!del.classList.contains("armed")) { del.classList.add("armed"); del.textContent = "Өшіруді растау"; return; }
      del.disabled = true;
      try { await api("/api/admin/responses/" + id, { method: "DELETE" }); close(); toast("Жауап өшірілді"); await load(); }
      catch (e) { del.disabled = false; toast("Өшіру мүмкін болмады"); }
    };
  }

  /* ================= кеңейтілген аналитика ================= */
  const STOP = new Set(("және бірақ сондықтан өте тек сол осы бұл үшін мен сен біз сіз олар болды болып болған болмады болу болса болар бар жоқ емес еді деп деген десе яғни ғана неге немесе сонымен кейін кезде сияқты барлық көп аз ал да де та те ма ме ба бе па пе " +
    "менің сенің біздің сіздің оның олардың бұрын енді қазір тағы үнемі әрі бәрі бәрін өзім өзін біраз сәл что как это для или все так только были было очень когда если потому чтобы был была быть есть нет нам вам мне меня мой моя которые которая более курс курста курсы курсқа курсты").split(/\s+/));
  const cVar = c => "var(--" + c + ")";

  function renderExtra() {
    const r = D.responses, n = r.length;
    // сегменттер
    const seg = [["Жақтаушылар (9–10)", r.filter(x => x.score >= 9).length, "pos"], ["Бейтарап (7–8)", r.filter(x => x.score >= 7 && x.score <= 8).length, "mid"], ["Сынаушылар (0–6)", r.filter(x => x.score <= 6).length, "neg"]];
    if (!n) $("segments").innerHTML = '<p class="muted" style="margin:0">Дерек жоқ</p>';
    else {
      const C = 2 * Math.PI * 42; let off = 0;
      const arcs = seg.map(([, v, c]) => { const len = v / n * C; const a = '<circle cx="60" cy="60" r="42" fill="none" stroke="' + cVar(c) + '" stroke-width="16" stroke-dasharray="' + len + " " + (C - len) + '" stroke-dashoffset="' + -off + '"/>'; off += len; return a; }).join("");
      const nps = Math.round((seg[0][1] - seg[2][1]) / n * 100);
      $("segments").innerHTML = '<div class="donut"><svg viewBox="0 0 120 120" role="img" aria-label="NPS сегменттері"><g transform="rotate(-90 60 60)"><circle cx="60" cy="60" r="42" fill="none" stroke="var(--soft)" stroke-width="16"/>' + arcs + '</g><text x="60" y="62" text-anchor="middle" class="dn">' + nps + '</text><text x="60" y="78" text-anchor="middle" class="dl">NPS</text></svg><div class="legend col">' +
        seg.map(([l, v, c]) => '<span><i style="background:' + cVar(c) + '"></i>' + l + ": <b>" + v + "</b> · " + Math.round(v / n * 100) + "%</span>").join("") + "</div></div>";
    }
    // күшті / әлсіз жақтар
    const sw = AREAS.map(o => ({ l: o.l, L: r.filter(x => (x.liked || []).includes(o.k)).length, I: r.filter(x => (x.issues || []).includes(o.k)).length }));
    const mx = Math.max(1, ...sw.map(x => Math.max(x.L, x.I)));
    $("swot").innerHTML = n ? '<div class="sw head"><span></span><span>Ұнады</span><span>Қиындық болды</span><span></span></div>' + sw.sort((a, b) => (b.L - b.I) - (a.L - a.I)).map(x => {
      const net = x.L - x.I, t = net > 0 ? ["pos", "Күшті жағы"] : net < 0 ? ["neg", "Әлсіз жағы"] : ["mid", "Тең"];
      return '<div class="sw"><span>' + esc(x.l) + '</span><div class="l"><b>' + x.L + '</b><i style="width:' + x.L / mx * 100 + '%"></i></div><div class="r"><i style="width:' + x.I / mx * 100 + '%"></i><b>' + x.I + '</b></div><em class="t ' + t[0] + '">' + t[1] + "</em></div>";
    }).join("") : '<p class="muted" style="margin:0">Дерек жоқ</p>';
    // апталық динамика
    const wk = {};
    r.forEach(x => { const d = new Date(x.createdAt); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const k = d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); (wk[k] = wk[k] || []).push(x.score); });
    const pts = Object.keys(wk).sort().slice(-16).map(k => ({ k, a: wk[k].reduce((t, v) => t + v, 0) / wk[k].length, n: wk[k].length }));
    if (pts.length < 2) $("weekly").innerHTML = '<p class="muted" style="margin:0">' + (pts.length ? "Динамика үшін кемінде 2 апталық дерек керек. Қазір: " + pts[0].a.toFixed(1) + " (" + pts[0].n + " жауап)" : "Дерек жоқ") + "</p>";
    else {
      const xy = pts.map((p, i) => [4 + i / (pts.length - 1) * 92, 44 - p.a / 10 * 40]);
      $("weekly").innerHTML = '<svg class="trend" viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label="Апталық орташа баға"><polyline fill="none" stroke="var(--brand-2)" stroke-width="1.2" vector-effect="non-scaling-stroke" points="' + xy.map(p => p.join(",")).join(" ") + '"/>' +
        xy.map((p, i) => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="1.3" fill="var(--brand)"><title>' + pts[i].k + ": " + pts[i].a.toFixed(1) + " (" + pts[i].n + ")</title></circle>").join("") + '</svg><div class="legend" style="justify-content:space-between"><span>' + pts[0].k + "</span><span>соңғы: " + pts[pts.length - 1].a.toFixed(1) + "</span><span>" + pts[pts.length - 1].k + "</span></div>";
    }
    // жиі сөздер
    const cnt = {};
    r.forEach(x => { const m = (String(x.expectationReason || "") + " " + (x.issuesDetail || "") + " " + (x.suggestion || "") + " " + (x.likedOther || "")).toLowerCase().match(/\p{L}+/gu); (m || []).forEach(w => { if (w.length >= 4 && !STOP.has(w)) cnt[w] = (cnt[w] || 0) + 1; }); });
    const all = Object.entries(cnt);
    const top = all.filter(e => e[1] >= 2 || all.length < 25).sort((a, b) => b[1] - a[1]).slice(0, 36);
    const cm = top.length ? top[0][1] : 1;
    $("cloud").innerHTML = top.length ? top.map(([w, c]) => '<span class="w" style="font-size:' + (13 + c / cm * 14) + 'px;opacity:' + (.55 + c / cm * .45) + '">' + esc(w) + "<sup>" + c + "</sup></span>").join("") : '<p class="muted" style="margin:0">Мәтіндік жауаптар жинала келе осында жиі сөздер шығады</p>';
  }

  /* ================= AI-инсайт ================= */
  function idChips(ids) { return (ids || []).slice(0, 12).map(i => '<button class="idc" data-num="' + esc(i) + '">#' + esc(i) + "</button>").join(""); }
  function renderInsights() {
    const ins = D.insights || {};
    const th = ins.themes;
    $("themes").innerHTML = th && th.items.length ? th.items.map(t => '<article class="theme"><div class="th-top"><span class="tag ' + esc(t.severity) + '">' + esc(t.severity) + '</span><span class="muted">' + t.count + " жауап</span></div><h4>" + esc(t.title) + "</h4><p>" + esc(t.description) + "</p>" + (t.quote ? "<blockquote>" + esc(t.quote) + "</blockquote>" : "") + '<div class="ids">' + idChips(t.ids) + "</div></article>").join("") : '<p class="muted" style="margin:0">Барлық жауаптарды AI ортақ тақырыптарға топтастырады. «Тақырыптарды табу» батырмасын басыңыз.</p>';
    $("themesMeta").textContent = th ? fmtDate(th.at, true) + " · " + th.count + " жауап негізінде" + staleNote(th.count) : "";
    document.querySelectorAll(".idc").forEach(b => { b.onclick = e => { e.stopPropagation(); const r = D.responses.find(x => x.num === b.dataset.num); if (r) openDrawer(r.id); }; });
  }
  /* AI категориялары: басқанда сол санаттың жауаптары сауалнама бойынша толық ашылады */
  let activeCat = null, catLimit = 30;
  function fullCard(r) {
    const a = r.ai;
    const qa = (q, v) => "<div><dt>" + q + "</dt><dd>" + (v ? esc(v) : '<span class="muted">—</span>') + "</dd></div>";
    return '<article class="rcard" data-id="' + esc(r.id) + '"><header><b>#' + esc(r.num) + '</b><span class="muted">' + fmtDate(r.createdAt, true) + '</span><span class="score ' + band(r.score) + '">' + r.score + "</span>" +
      '<span class="tag wait">' + esc(expShort(r.expectation)) + "</span>" + (a ? '<span class="tag ' + esc(a.sentiment) + '">' + esc(a.sentiment) + '</span><span class="tag ' + esc(a.importance) + '">' + esc(a.importance) + "</span>" : "") +
      "</header><dl>" +
      qa("1. Курсқа көңіліңіз қаншалықты толды? (0–10)", r.score + " / 10") +
      qa("2. Бастапқы күтуді қаншалықты ақтады?", lab(EXP, r.expectation)) +
      (r.expectationReason ? qa("Нені күттіңіз және не ақталмай қалды?", r.expectationReason) : "") +
      qa("3. Курста ең ұнағаны", likedText(r)) +
      qa("4. Қиындық немесе қолайсыздық болған жерлер", (r.issues || []).map(k => lab(ISSUES, k)).join(", ")) +
      (r.issuesDetail ? qa("Мәселені толығырақ", r.issuesDetail) : "") +
      qa("5. Курсты жақсарту бойынша ұсыныс", r.suggestion) +
      (r.ref ? qa("Дереккөз", r.ref) : "") + "</dl>" +
      (a ? '<div class="ai"><b>AI-талдау</b> · ' + esc(a.category) + (a.churnReason ? "<br><span class=\"muted\">Кету себебі:</span> " + esc(a.churnReason) : "") + (a.action ? "<br><span class=\"muted\">Ұсыныс:</span> " + esc(a.action) : "") +
        '<br><span class="muted">Алдын алуға болады:</span> ' + (a.preventable === "Yes" ? "иә" : "жоқ") + ' · <span class="muted">Қайтару әлеуеті:</span> ' + esc(a.returnPotential) + "</div>" : "") +
      '<footer><button class="btn small ghost" type="button" data-open="' + esc(r.id) + '">Толық ашу</button></footer></article>';
  }
  function renderCats() {
    const an = D.responses.filter(x => x.ai), box = $("catDetail");
    if (!an.length) { $("catBars").innerHTML = '<p class="muted" style="margin:0">Жауаптар әлі талданбаған. «AI-талдау» батырмасын басыңыз (Аналитика бетінде).</p>'; box.classList.add("hidden"); box.innerHTML = ""; return; }
    const cats = {}; an.forEach(x => { cats[x.ai.category] = (cats[x.ai.category] || 0) + 1; });
    const items = Object.entries(cats).sort((a, b) => b[1] - a[1]), max = items[0][1];
    if (activeCat && !cats[activeCat]) activeCat = null;
    $("catBars").innerHTML = items.map(([l, v]) => '<button type="button" class="bar cat' + (l === activeCat ? " active" : "") + '" data-cat="' + esc(l) + '" aria-expanded="' + (l === activeCat) + '"><span>' + esc(l) + '</span><div class="track"><div class="fill" style="width:' + v / max * 100 + '%"></div></div><b>' + v + " <small>" + Math.round(v / an.length * 100) + "%</small></b></button>").join("");
    $("catBars").querySelectorAll("[data-cat]").forEach(b => { b.onclick = () => { activeCat = activeCat === b.dataset.cat ? null : b.dataset.cat; catLimit = 30; renderCats(); if (activeCat) $("catDetail").scrollIntoView({ behavior: "smooth", block: "nearest" }); }; });
    if (!activeCat) { box.classList.add("hidden"); box.innerHTML = ""; return; }
    fillDetail(box, activeCat, an.filter(x => x.ai.category === activeCat).slice().reverse(), catLimit, () => { activeCat = null; renderCats(); }, () => { catLimit += 30; renderCats(); });
  }
  /* ортақ: жауап карточкаларының тізімін толтыру */
  function bindOpen(root) { root.querySelectorAll("[data-open]").forEach(b => { b.onclick = () => openDrawer(b.dataset.open); }); }
  function fillDetail(box, title, list, limit, onClose, onMore) {
    box.classList.remove("hidden");
    box.innerHTML = '<div class="ch"><h4>' + esc(title) + " — " + list.length + ' жауап</h4><button class="btn small ghost" type="button" data-close>Жабу</button></div><div class="rcards">' + list.slice(0, limit).map(fullCard).join("") + "</div>" +
      (list.length > limit ? '<div style="text-align:center;margin-top:14px"><button class="btn ghost" type="button" data-more>Көбірек көрсету (' + (list.length - limit) + ")</button></div>" : "");
    box.querySelector("[data-close]").onclick = onClose;
    const more = box.querySelector("[data-more]"); if (more) more.onclick = onMore;
    bindOpen(box);
  }

  /* AI: Sentiment — түсті/батырманы басқанда сол тональділіктің жауаптары толық ашылады */
  let activeSent = null, sentLimit = 30;
  const SENT_CLS = { Negative: "neg", Neutral: "mid", Positive: "pos" };
  function renderSent() {
    const an = D.responses.filter(x => x.ai), box = $("sentDetail");
    if (!an.length) { $("sentSplit").innerHTML = ""; $("sentBtns").innerHTML = '<p class="muted" style="margin:0">Жауаптар әлі талданбаған. «AI-талдау» батырмасын басыңыз (Аналитика бетінде).</p>'; box.classList.add("hidden"); box.innerHTML = ""; return; }
    const sc = { Negative: 0, Neutral: 0, Positive: 0 }; an.forEach(x => { sc[x.ai.sentiment] = (sc[x.ai.sentiment] || 0) + 1; });
    $("sentSplit").innerHTML = SENT.filter(k => sc[k]).map(k => '<button type="button" class="seg-' + SENT_CLS[k] + (k === activeSent ? " active" : "") + '" data-s="' + k + '" style="width:' + sc[k] / an.length * 100 + '%" title="' + k + ": " + sc[k] + '" aria-label="' + k + ": " + sc[k] + '"></button>').join("");
    $("sentBtns").innerHTML = SENT.map(k => '<button type="button" class="sbtn' + (k === activeSent ? " active" : "") + '" data-s="' + k + '" aria-expanded="' + (k === activeSent) + '"><i class="dot-' + SENT_CLS[k] + '"></i><span>' + k + "</span><b>" + sc[k] + "</b> <small>" + Math.round(sc[k] / an.length * 100) + "%</small></button>").join("");
    document.querySelectorAll("#sentSplit [data-s], #sentBtns [data-s]").forEach(b => { b.onclick = () => { activeSent = activeSent === b.dataset.s ? null : b.dataset.s; sentLimit = 30; renderSent(); if (activeSent) box.scrollIntoView({ behavior: "smooth", block: "nearest" }); }; });
    if (!activeSent) { box.classList.add("hidden"); box.innerHTML = ""; return; }
    fillDetail(box, activeSent, an.filter(x => x.ai.sentiment === activeSent).slice().reverse(), sentLimit, () => { activeSent = null; renderSent(); }, () => { sentLimit += 30; renderSent(); });
  }

  /* Маңыздылығы бойынша пікірлер: әр жол — қай оқушы екені; басқанда толық сауалнама ашылады */
  let impLevel = "High", impLimit = 20; const openImp = new Set();
  function renderImp() {
    const an = D.responses.filter(x => x.ai);
    const cnt = { High: 0, Medium: 0, Low: 0 }; an.forEach(x => { cnt[x.ai.importance] = (cnt[x.ai.importance] || 0) + 1; });
    $("impTabs").innerHTML = ["High", "Medium", "Low"].map(l => '<button type="button" class="' + (l === impLevel ? "on" : "") + '" data-l="' + l + '">' + l + " <b>" + cnt[l] + "</b></button>").join("");
    $("impTabs").querySelectorAll("[data-l]").forEach(b => { b.onclick = () => { impLevel = b.dataset.l; impLimit = 20; renderImp(); }; });
    const list = an.filter(x => x.ai.importance === impLevel).slice().reverse(), shown = list.slice(0, impLimit);
    const allOpen = shown.length > 0 && shown.every(x => openImp.has(x.id));
    $("impAll").textContent = allOpen ? "Барлығын жабу" : "Барлығын ашу"; $("impAll").disabled = !shown.length;
    $("impAll").onclick = () => { shown.forEach(x => allOpen ? openImp.delete(x.id) : openImp.add(x.id)); renderImp(); };
    $("impList").innerHTML = shown.length ? shown.map(x => {
      const open = openImp.has(x.id);
      return '<div class="imp ' + impLevel + (open ? " open" : "") + '" data-id="' + esc(x.id) + '"><button type="button" class="imp-h" aria-expanded="' + open + '"><span class="imp-t">' + esc(x.ai.summary || x.ai.topic || "—") + '</span><span class="imp-m">#' + esc(x.num) + " · " + esc(x.ai.category) + " · баға " + x.score + " · " + fmtDate(x.createdAt, true) + "</span></button>" + (open ? '<div class="imp-b">' + fullCard(x) + "</div>" : "") + "</div>";
    }).join("") + (list.length > impLimit ? '<div style="text-align:center"><button class="btn ghost" type="button" id="impMore">Көбірек көрсету (' + (list.length - impLimit) + ")</button></div>" : "")
      : '<p class="muted" style="margin:0">' + (an.length ? "Бұл деңгейде пікір жоқ" : "Жауаптар әлі талданбаған. «AI-талдау» батырмасын басыңыз (Аналитика бетінде).") + "</p>";
    const more = $("impMore"); if (more) more.onclick = () => { impLimit += 20; renderImp(); };
    $("impList").querySelectorAll(".imp-h").forEach(b => { b.onclick = () => {
      const wrap = b.parentElement, id = wrap.dataset.id;
      if (openImp.has(id)) { openImp.delete(id); wrap.classList.remove("open"); b.setAttribute("aria-expanded", "false"); const body = wrap.querySelector(".imp-b"); if (body) body.remove(); }
      else { openImp.add(id); wrap.classList.add("open"); b.setAttribute("aria-expanded", "true"); const r = D.responses.find(x => x.id === id); if (r) { const d = document.createElement("div"); d.className = "imp-b"; d.innerHTML = fullCard(r); wrap.appendChild(d); bindOpen(d); } }
      const shownNow = shown.every(x => openImp.has(x.id)); $("impAll").textContent = shownNow ? "Барлығын жабу" : "Барлығын ашу";
    }; });
    bindOpen($("impList"));
  }
  async function runInsight(type, btn) {
    if (!okTokens("Жауаптар тақырыптарға топтастырылады.", Math.min(D.all.length, 300) * 460)) return;
    const old = btn.textContent; btn.disabled = true; btn.textContent = "Ойлануда…";
    try { const d = await api("/api/admin/insight", { method: "POST", body: { type } }); (D.insights = D.insights || {})[type] = d; renderInsights(); }
    catch (e) { if (e.message !== "auth") toast(e.message); }
    finally { btn.textContent = old; btn.disabled = !D.aiEnabled; }
  }
  $("themesBtn").onclick = () => runInsight("themes", $("themesBtn"));
  const QS = ["Ең көп шағым қандай мәселе туралы?", "Кімді қайтаруға болады және қалай?", "Платформаға шағымданғандардың орташа бағасы қандай?", "Курстың 3 басты күшті жағы қандай?", "Кетушілерді азайту үшін не істеу керек?"];
  $("askChips").innerHTML = QS.map(q => '<button type="button" class="chip">' + esc(q) + "</button>").join("");
  $("askChips").querySelectorAll(".chip").forEach(b => { b.onclick = () => { $("askQ").value = b.textContent; $("askForm").requestSubmit(); }; });
  $("askForm").onsubmit = async e => {
    e.preventDefault(); const q = $("askQ").value.trim(); if (!q) return;
    const btn = $("askBtn"); btn.disabled = true; $("askOut").textContent = "Ойлануда…";
    try { $("askOut").textContent = (await api("/api/admin/ask", { method: "POST", body: { question: q } })).answer; }
    catch (err) { $("askOut").textContent = ""; if (err.message !== "auth") toast(err.message); }
    finally { btn.disabled = !D.aiEnabled; }
  };
  hydrateIcons();


  fetch("/api/session").then(r => r.json()).then(s => { if (s.admin) load(); else showLogin(); }).catch(() => showLogin());
})();
