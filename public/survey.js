(function () {
  "use strict";
  if (window.hydrateIcons) hydrateIcons();
  document.getElementById("survey").addEventListener("submit", e => e.preventDefault());
  const EXP = [
    { k: "full", l: "Толықтай ақтады", i: "circle-check-big", t: "pos" },
    { k: "mostly", l: "Көбіне ақтады", i: "thumbs-up", t: "pos" },
    { k: "half", l: "Жартылай ақтады", i: "circle-minus", t: "mid" },
    { k: "mostlyNot", l: "Көбіне ақтамады", i: "thumbs-down", t: "neg" },
    { k: "not", l: "Мүлдем ақтамады", i: "circle-x", t: "neg" }
  ];
  const AREAS = [
    { k: "system", l: "Курс жүйесі", i: "compass" }, { k: "platform", l: "Платформа", i: "monitor" }, { k: "materials", l: "Оқу материалдары", i: "book-open" },
    { k: "curator", l: "Куратор жұмысы", i: "handshake" }, { k: "teacher", l: "Мұғалімнің біліктілігі", i: "graduation-cap" }, { k: "other", l: "Басқа", i: "sparkles" }
  ];
  const ISSUES = AREAS.concat([{ k: "none", l: "Қиындық болған жоқ", i: "check" }]);
  const band = n => (n <= 6 ? "lo" : n <= 8 ? "md" : "hi");
  const FACES = ["angry", "frown", "frown", "annoyed", "meh", "meh", "smile", "smile", "laugh", "laugh", "party-popper"];
  const HUES = [2, 10, 18, 28, 38, 46, 58, 78, 100, 122, 142];
  const READ = { lo: "Пікіріңізді ескеріп, жақсартуға тырысамыз", md: "Жақсы, бірақ жақсартуға болады", hi: "Керемет, рақмет!" };
  const $ = id => document.getElementById(id);

  const st = { score: null, expectation: null, liked: new Set(), issues: new Set() };
  const DRAFT = "juz40_draft", DONE = "juz40_done";
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* жеке режим */ } }, del(k) { try { localStorage.removeItem(k); } catch (e) { /* */ } } };
  const newId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const refParam = (new URLSearchParams(location.search).get("ref") || new URLSearchParams(location.search).get("r") || "").slice(0, 60);
  let cid = newId(), restoring = false;

  function chip(o) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "chip"; b.dataset.k = o.k; b.setAttribute("aria-pressed", "false"); b.innerHTML = icon(o.i); b.appendChild(document.createTextNode(o.l));
    return b;
  }
  function reveal(box, on) {
    if (on && box.classList.contains("hidden")) { box.classList.remove("hidden"); box.classList.add("reveal"); }
    if (!on) box.classList.add("hidden");
  }
  const clearErr = k => { $("err-" + k).textContent = ""; };

  /* 1. Баға 0–10: таңдағанда боялады */
  const sc = $("scale");
  for (let i = 0; i <= 10; i++) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = i; b.style.setProperty("--h", HUES[i]);
    b.setAttribute("role", "radio"); b.setAttribute("aria-checked", "false"); b.setAttribute("aria-label", i + " балл");
    b.onclick = () => {
      st.score = i;
      const cls = band(i);
      [...sc.children].forEach((c, k) => {
        c.setAttribute("aria-checked", String(k === i));
        c.classList.toggle("on", k <= i);
        c.classList.toggle("sel", k === i);
      });
      $("q-score").style.setProperty("--hue", HUES[i]);
      const fc = $("face"); fc.innerHTML = icon(FACES[i]); fc.className = "face h"; void fc.offsetWidth; fc.classList.add("set");
      const bn = $("bignum"); bn.className = "bignum h"; bn.innerHTML = i + "<small>/10</small>";
      const r = $("scaleRead"); r.className = "scale-read h"; r.textContent = READ[cls];
      if (!restoring && navigator.vibrate && navigator.userActivation && navigator.userActivation.hasBeenActive) navigator.vibrate(8);
      clearErr("score"); update();
    };
    sc.appendChild(b);
  }

  /* 2. Күту: «Толықтай ақтады» болмаса — мәтін өрісі */
  const eo = $("expOpts");
  EXP.forEach(e => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "opt"; b.dataset.tone = e.t; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", "false");
    b.innerHTML = '<span class="ic">' + icon(e.i) + '</span><span></span><span class="dot"></span>'; b.children[1].textContent = e.l;
    b.onclick = () => {
      st.expectation = e.k;
      [...eo.children].forEach(c => c.setAttribute("aria-checked", String(c === b)));
      reveal($("reasonBox"), e.k !== "full");
      clearErr("expectation"); update();
    };
    eo.appendChild(b);
  });
  $("expReason").addEventListener("input", () => { clearErr("expectation"); update(); });

  /* 3. Ұнағаны */
  AREAS.forEach(o => {
    const b = chip(o);
    b.onclick = () => {
      st.liked.has(o.k) ? st.liked.delete(o.k) : st.liked.add(o.k);
      b.setAttribute("aria-pressed", String(st.liked.has(o.k)));
      reveal($("likedOtherBox"), st.liked.has("other"));
      clearErr("liked"); update();
    };
    $("likedChips").appendChild(b);
  });
  $("likedOther").addEventListener("input", () => { clearErr("liked"); update(); });

  /* 4. Қиындықтар */
  const ic = $("issueChips");
  ISSUES.forEach(o => {
    const b = chip(o); if (o.k === "none") b.classList.add("none");
    b.onclick = () => {
      if (o.k === "none") { const on = !st.issues.has("none"); st.issues.clear(); if (on) st.issues.add("none"); }
      else { st.issues.delete("none"); st.issues.has(o.k) ? st.issues.delete(o.k) : st.issues.add(o.k); }
      [...ic.children].forEach(c => c.setAttribute("aria-pressed", String(st.issues.has(c.dataset.k))));
      reveal($("issueDetailBox"), st.issues.size > 0 && !st.issues.has("none"));
      clearErr("issues"); update();
    };
    ic.appendChild(b);
  });
  $("issueDetail").addEventListener("input", () => { clearErr("issues"); update(); });
  $("suggestion").addEventListener("input", update);

  function doneMap() {
    const needIssue = st.issues.size > 0 && !st.issues.has("none");
    return {
      score: st.score !== null,
      expectation: !!st.expectation && (st.expectation === "full" || $("expReason").value.trim().length > 0),
      liked: st.liked.size > 0 && (!st.liked.has("other") || $("likedOther").value.trim().length > 0),
      issues: st.issues.size > 0 && (!needIssue || $("issueDetail").value.trim().length > 0),
      suggestion: $("suggestion").value.trim().length > 0
    };
  }
  function setProg(n) { [...$("segs").children].forEach((s, i) => s.classList.toggle("on", i < n)); }
  function update() {
    const d = doneMap();
    document.querySelectorAll(".q").forEach(q => q.classList.toggle("done", d[q.dataset.q]));
    const n = ["score", "expectation", "liked", "issues"].filter(k => d[k]).length;
    $("progress").textContent = n < 4 ? n + " / 4" : "Дайын";
    setProg(n);
    if (!restoring) saveDraft();
  }

  /* қаралама: бет жаңартылса да жауаптар жоғалмайды */
  function saveDraft() {
    const d = { cid, score: st.score, expectation: st.expectation, liked: [...st.liked], issues: [...st.issues], expReason: $("expReason").value, likedOther: $("likedOther").value, issueDetail: $("issueDetail").value, suggestion: $("suggestion").value };
    if (d.score === null && !d.expectation && !d.liked.length && !d.issues.length && !d.expReason && !d.suggestion) { ls.del(DRAFT); return; }
    ls.set(DRAFT, JSON.stringify(d));
  }
  function restoreDraft() {
    let d; try { d = JSON.parse(ls.get(DRAFT) || "null"); } catch (e) { d = null; }
    if (!d) return;
    restoring = true;
    try {
      if (d.cid) cid = d.cid;
      if (Number.isInteger(d.score) && sc.children[d.score]) sc.children[d.score].click();
      const ei = EXP.findIndex(e => e.k === d.expectation); if (ei >= 0) eo.children[ei].click();
      (d.liked || []).forEach(k => { const b = [...$("likedChips").children].find(c => c.dataset.k === k); if (b) b.click(); });
      (d.issues || []).forEach(k => { const b = [...ic.children].find(c => c.dataset.k === k); if (b) b.click(); });
      $("expReason").value = d.expReason || ""; $("likedOther").value = d.likedOther || ""; $("issueDetail").value = d.issueDetail || ""; $("suggestion").value = d.suggestion || "";
    } catch (e) { /* бүлінген қаралама — елемейміз */ }
    restoring = false; update();
  }
  function showThanks(revisit) {
    $("formView").classList.add("hidden"); $("thanksView").classList.remove("hidden");
    $("heroTitle").innerHTML = "Пікіріңіз үшін <em>рақмет!</em>"; $("heroText").textContent = "Сіздің жауабыңыз JUZ40 курсын жақсартуға көмектеседі.";
    $("steps").classList.add("hidden"); $("againBox").classList.toggle("hidden", !revisit); window.scrollTo(0, 0);
  }
  $("again").onclick = () => { ls.del(DONE); location.reload(); };

  function validate() {
    let ok = true, first = null;
    const fail = (k, msg) => { $("err-" + k).textContent = msg; ok = false; if (!first) first = k; };
    if (st.score === null) fail("score", "Бағаны таңдаңыз");
    if (!st.expectation) fail("expectation", "Бір нұсқаны таңдаңыз");
    else if (st.expectation !== "full" && !$("expReason").value.trim()) fail("expectation", "Себебін қысқаша жазыңыз");
    if (!st.liked.size) fail("liked", "Кем дегенде бір нұсқаны таңдаңыз");
    else if (st.liked.has("other") && !$("likedOther").value.trim()) fail("liked", "«Басқа» деп нені айтқыңыз келетінін жазыңыз");
    if (!st.issues.size) fail("issues", "Кем дегенде бір нұсқаны таңдаңыз");
    else if (!st.issues.has("none") && !$("issueDetail").value.trim()) fail("issues", "Мәселені қысқаша жазыңыз");
    if (first) document.querySelector('.q[data-q="' + first + '"]').scrollIntoView({ behavior: "smooth", block: "center" });
    return ok;
  }

  $("submitBtn").onclick = async () => {
    $("err-submit").textContent = "";
    if (!validate()) return;
    const body = {
      score: st.score, expectation: st.expectation,
      expectationReason: st.expectation === "full" ? "" : $("expReason").value.trim(),
      liked: [...st.liked], likedOther: st.liked.has("other") ? $("likedOther").value.trim() : "",
      issues: [...st.issues], issuesDetail: st.issues.has("none") ? "" : $("issueDetail").value.trim(),
      suggestion: $("suggestion").value.trim(), cid, ref: refParam, website: $("website").value
    };
    const btn = $("submitBtn"); btn.disabled = true; btn.textContent = "Жіберілуде…";
    try {
      const r = await fetch("/api/responses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "fail");
      ls.set(DONE, "1"); ls.del(DRAFT);
      showThanks(false); confetti();
      setProg(4);
    } catch (e) {
      $("err-submit").textContent = "Жауап сақталмады. " + (e.message && e.message !== "fail" && e.message !== "Failed to fetch" ? e.message : "Интернетті тексеріп, қайта басыңыз.");
    } finally { btn.disabled = false; btn.innerHTML = "Жауапты жіберу " + icon("arrow-right"); }
  };

  function confetti() {
    const cv = $("confetti"), ctx = cv.getContext("2d"); if (!ctx || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const dpr = window.devicePixelRatio || 1; cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.scale(dpr, dpr);
    const cols = ["#F6B91F", "#12A5B9", "#25915A", "#D2543D", "#7FE0C4", "#fff"];
    const P = Array.from({ length: 140 }, () => ({ x: innerWidth / 2, y: innerHeight * .35, vx: (Math.random() - .5) * 16, vy: -Math.random() * 15 - 3, s: 6 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: cols[Math.random() * cols.length | 0] }));
    let t = 0;
    (function f() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      P.forEach(p => { p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); });
      if (++t < 170) requestAnimationFrame(f); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })();
  }

  $("face").innerHTML = icon("smile");
  const stepsEl = $("steps");
  addEventListener("scroll", () => stepsEl.classList.toggle("show", scrollY > 260), { passive: true });

  document.querySelectorAll(".qn").forEach(n => {
    n.innerHTML = '<span class="qnum">' + n.textContent + '</span><svg class="qring" viewBox="0 0 48 48" aria-hidden="true"><rect x="1.5" y="1.5" width="45" height="45" rx="14.5" pathLength="100"/><path d="M15 25l6.5 6.5L34 18" pathLength="30"/></svg>';
  });
  restoreDraft();
  update();
  if (ls.get(DONE)) showThanks(true);

  /* көрінгенде пайда болу, курсорды қуған жарық, өсетін мәтін өрістері */
  const io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: .05, rootMargin: "0px 0px 18% 0px" }) : null;
  document.querySelectorAll(".q").forEach(q => { if (io) io.observe(q); else q.classList.add("in"); });
  addEventListener("pointermove", e => {
    const c = e.target.closest && e.target.closest(".card");
    if (c) { const r = c.getBoundingClientRect(); c.style.setProperty("--mx", e.clientX - r.left + "px"); c.style.setProperty("--my", e.clientY - r.top + "px"); }
    const hero = document.querySelector(".hero");
    if (hero && e.clientY < hero.offsetHeight) { hero.style.setProperty("--px", e.clientX + "px"); hero.style.setProperty("--py", e.clientY + "px"); }
  }, { passive: true });
  const grow = t => { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 360) + "px"; };
  document.querySelectorAll("textarea").forEach(t => { t.addEventListener("input", () => grow(t)); if (t.value) grow(t); });
})();
