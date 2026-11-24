// Dictionary page (F-218): book view in print order, search, audio, per-word actions, reports, offline.
// F-231: "In the stories": sentences from the story sites (story-data.js, loaded on first use) with links to the exact sentence.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("dict." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("dict." + k, JSON.stringify(v)); } catch { toast("Couldn't save on this device"); } },
  };

  const entries = window.DICT.e;
  const cards = entries.filter((e) => e.own !== false);
  const idOf = new Map(entries.map((e, i) => [e, i]));
  // The index lives in a worker when the page is served over http(s); from file:// it is built here on first use.
  let worker = null;
  let indexCache = null;
  let searchSeq = 0;
  const getIndex = () => {
    if (!indexCache) {
      indexCache = window.DictSearch.createIndex(entries);
      for (const p of personal) { const id = byWord.get(p.word); if (id !== undefined) indexCache.addPersonal(p.query, id); }
    }
    return indexCache;
  };
  function addPersonalKey(query, id) {
    if (worker) worker.postMessage({ type: "add", query, id });
    else getIndex().addPersonal(query, id);
  }
  const byWord = new Map(entries.map((e, i) => [e.w.toLowerCase(), i]));

  // ---------- settings ----------
  let showAllVi = store.get("viAll", false);
  let textSize = store.get("size", 15);
  const openVi = new Set();
  let reports = store.get("reports", []);
  const personal = store.get("personal", []);

  function applySize() { document.documentElement.style.setProperty("--size", textSize + "px"); }
  function setShowAll(on) {
    showAllVi = on;
    store.set("viAll", on);
    $("viAll").setAttribute("aria-pressed", String(on));
    $("setVi").checked = on;
    document.querySelectorAll("[data-vi]").forEach((el) => { el.hidden = !on && !openVi.has(+el.dataset.vi); });
    document.querySelectorAll('[data-a="vi"]').forEach((b) => b.classList.toggle("on", on || openVi.has(+b.dataset.i)));
  }

  // ---------- rendering ----------
  const tools = (i) => `<span class="tools"><button type="button" data-a="play" data-i="${i}" aria-label="Listen"><svg class="ic" aria-hidden="true"><use href="#i-sound"/></svg></button><button type="button" data-a="story" data-i="${i}" aria-label="In the stories" title="In the stories"><svg class="ic" aria-hidden="true"><use href="#i-book"/></svg></button><button type="button" data-a="vi" data-i="${i}" class="${showAllVi || openVi.has(i) ? "on" : ""}" aria-label="Show Vietnamese meaning">vi</button><button type="button" data-a="more" data-i="${i}" aria-label="More"><svg class="ic" aria-hidden="true"><use href="#i-more"/></svg></button></span>`;
  const ipa = (e, hl) => {
    if (!e.i) return "";
    const body = hl ? `${esc(e.i.slice(0, hl[0]))}<mark>${esc(e.i.slice(hl[0], hl[1]))}</mark>${esc(e.i.slice(hl[1]))}` : esc(e.i);
    return `<span class="ipa">/${body}/${e.a ? "<sup>*</sup>" : ""}</span>`;
  };
  const viHtml = (e, i) => (e.vi ? `<div class="vi" data-vi="${i}"${showAllVi || openVi.has(i) ? "" : " hidden"}>${esc(e.vi)}</div>` : "");

  function cardHtml(i, extra = "", hl = null) {
    const e = entries[i];
    if (e.own === false) return familyAsCard(i, extra, hl);
    let s = `<article class="e" id="w${i}" data-card="${i}">${tools(i)}<span class="w">${esc(e.w)}</span> ${ipa(e, hl)} <i class="pos">${esc(e.p)}</i> <span class="def">${esc(e.def)}</span>${viHtml(e, i)}`;
    if (e.x) s += `<div class="ex">${esc(e.x)}</div>`;
    for (const f of e.f) {
      const m = entries[f];
      s += `<div class="fam" data-card="${f}">${tools(f)}+ <b>${esc(m.w)}</b>${m.b ? ' <span class="bang" title="Meaning differs from the headword">!</span>' : ""} ${ipa(m)} <i class="pos">${esc(m.p)}</i> ${esc(m.def)}${viHtml(m, f)}</div>`;
    }
    if (e.r.length) {
      s += `<div class="xr">↔ ${e.r.map((j) => `<a href="#w${j}" data-a="go" data-i="${j}">${esc(entries[j].w)} <span class="u">${entries[j].u}</span></a>`).join(" · ")}</div>`;
    }
    return s + extra + "</article>";
  }
  function familyAsCard(i, extra, hl) {
    const e = entries[i];
    return `<article class="e" data-card="${i}">${tools(i)}<span class="w">${esc(e.w)}</span>${e.b ? ' <span class="bang">!</span>' : ""} ${ipa(e, hl)} <i class="pos">${esc(e.p)}</i> <span class="def">${esc(e.def)}</span>${viHtml(e, i)}${extra}</article>`;
  }

  // ---------- book view: one section per printed page, filled when near the viewport ----------
  const pageNums = [...new Set(cards.map((c) => c.g))].sort((a, b) => a - b);
  const pageCards = new Map(pageNums.map((p) => [p, []]));
  for (const c of cards) pageCards.get(c.g).push(idOf.get(c));
  const unitFirst = new Map();
  for (const c of cards) if (!unitFirst.has(c.u)) unitFirst.set(c.u, c);
  const book = $("book");
  const sections = new Map();
  const filled = new Set();
  let currentPage = store.get("page", pageNums[0]);
  if (!pageCards.has(currentPage)) currentPage = pageNums[0];

  const estimate = () => {
    const perCard = (textSize * 1.36 * 4.1) + 12;
    const cols = window.innerWidth >= 1100 ? 3 : window.innerWidth >= 760 ? 2 : 1;
    return perCard * 62 / cols;
  };
  for (const p of pageNums) {
    const sec = document.createElement("section");
    sec.className = "page";
    sec.dataset.p = p;
    sec.style.minHeight = estimate() + "px";
    sections.set(p, sec);
    book.append(sec);
  }
  function unitsOn(p) { return [...new Set(pageCards.get(p).map((i) => entries[i].u))]; }
  function fill(p) {
    if (filled.has(p)) return;
    const sec = sections.get(p);
    let unit = null;
    let body = "";
    for (const i of pageCards.get(p)) {
      const c = entries[i];
      if (c.u !== unit) {
        if (unit !== null || unitFirst.get(c.u) === c) body += unitFirst.get(c.u) === c ? `<h2>${c.u}</h2>` : "";
        unit = c.u;
      }
      body += cardHtml(i);
    }
    const us = unitsOn(p);
    sec.innerHTML = `<header><span>${us.length > 1 ? us[0] + " – " + us[us.length - 1] : us[0]}</span><span>Page ${p}</span></header><div class="cols">${body}</div>`;
    sec.style.minHeight = "";
    filled.add(p);
    if (filled.size > 14) trim();
  }
  function trim() {
    const far = [...filled].sort((a, b) => Math.abs(b - currentPage) - Math.abs(a - currentPage)).slice(0, filled.size - 10);
    for (const p of far) {
      if (Math.abs(p - currentPage) < 4) continue;
      const sec = sections.get(p);
      sec.style.minHeight = sec.offsetHeight + "px";
      sec.innerHTML = "";
      filled.delete(p);
    }
  }
  const nearView = new IntersectionObserver((list) => { for (const x of list) if (x.isIntersecting) fill(+x.target.dataset.p); }, { rootMargin: "1400px 0px" });
  const atView = new IntersectionObserver((list) => {
    for (const x of list) {
      if (!x.isIntersecting) continue;
      currentPage = +x.target.dataset.p;
      store.set("page", currentPage);
      showWhere();
    }
  }, { rootMargin: "-20% 0px -75% 0px" });
  sections.forEach((s) => { nearView.observe(s); atView.observe(s); });
  function showWhere() { $("where").textContent = `${unitsOn(currentPage)[0]} · p.${currentPage}`; }

  function goToPage(p) {
    if (!sections.has(p)) return;
    [p - 1, p, p + 1].forEach((n) => sections.has(n) && fill(n));
    sections.get(p).scrollIntoView();
    currentPage = p;
    store.set("page", p);
    showWhere();
  }
  function goToCard(i) {
    const c = entries[i].own === false ? entries[entries[i].h] : entries[i];
    clearSearch();
    fill(c.g);
    const id = idOf.get(c);
    goToPage(c.g);
    const el = $("w" + id);
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    }
  }

  // ---------- search ----------
  const LABEL = {
    personal: "Saved by you", word: "Exact word", form: "Word form", meaning: "Exact meaning", key: "Other meanings and wordings",
    prefix: "Starts with", contains: "Meaning contains", typo: "Did you mean", describe: "By description",
    ipa: "Same sound", ipaStart: "Sound starts with", ipaHas: "Sound contains", ipaNear: "Similar sound",
  };
  const isIpa = (q) => window.DictSearch.isIpaQuery(q);
  const qBox = $("q");
  const results = $("results");
  let lastQuery = "";
  let lastHits = [];
  let shown = 30;

  function runSearch() {
    const q = qBox.value.trim();
    lastQuery = q;
    if (!q) { results.hidden = true; book.hidden = false; return; }
    const seq = ++searchSeq;
    if (worker) {
      worker.postMessage({ type: "search", seq, q, limit: 120 });
      setTimeout(() => {
        if (seq === searchSeq && lastAnswered < seq) showResults('<p class="nope">Preparing search…</p>');
      }, 250);
    } else {
      showHits(getIndex().search(q, { limit: 120 }));
    }
  }
  let lastAnswered = 0;
  function showHits(hits) {
    lastHits = hits;
    shown = 30;
    renderResults();
    results.hidden = false;
    book.hidden = true;
    window.scrollTo(0, 0);
  }
  function showResults(html) {
    results.innerHTML = html;
    results.hidden = false;
    book.hidden = true;
  }
  function renderResults() {
    const q = lastQuery;
    const list = lastHits.slice(0, shown);
    let out = "";
    let tier = null;
    const iq = window.DictSearch.ipaQuery(q);
    const bare = iq && !iq.units.length;
    if (bare) out += '<p class="nope">Type sounds after /, for example <b>/ˈfæməli/</b> or <b>/faemli</b>. Tap <b>ə</b> in the search box for IPA keys.</p>';
    else if (iq) out += `<p class="ipaq">Sound search: <b>/${esc(iq.show)}/</b> · stress and ː don't matter</p>`;
    const realHit = list.find((h) => h.tier === "personal" || h.tier === "word" || h.tier === "form");
    const storyQ = !iq && /^[a-z][a-z'’ -]*$/i.test(q) && q.length >= 2;
    let storyBlock = "";
    if (storyQ && !realHit) {
      if (storyIx) {
        if (storyIx.find(q).total) storyBlock = `<div class="stq"><p class="nope">“${esc(q)}” is not in the word list, but it is in the stories.</p>${storyPanel(q, -1, panelMode.get(q + "|-1") || "full")}</div>`;
      } else whenStories(q);
    }
    if (!list.length && !bare && !storyBlock) out += `<p class="nope">No match for “${esc(q)}”.</p>`;
    out += storyBlock;
    for (const h of list) {
      const label = h.tier === "key" ? "meaning" : h.tier;
      if (label !== tier) { out += `<h3>${h.tier === "key" || h.tier === "meaning" ? "Exact meaning" : LABEL[h.tier]}</h3>`; tier = label; }
      const e = h.entry;
      const i = idOf.get(e);
      const under = e.own === false ? ` · under ${esc(entries[e.h].w)}` : "";
      const pageText = e.g ? `${e.u} · p.${e.g}${under}` : `${e.u}${under}`;
      let meta = `<div class="hitmeta">${h.matched ? `<mark>${esc(h.matched)}</mark>` : ""}<a href="#" data-a="go" data-i="${i}">${pageText}</a></div>`;
      const mode = panelMode.get(e.w + "|" + i);
      if (h === realHit && storyQ && mode !== "closed") {   // the word the person most likely meant: its story sentences right away
        if (storyIx) meta += storyPanel(e.w, i, mode || "compact");
        else whenStories(q);
      }
      out += cardHtml(i, meta, h.span).replace(` id="w${i}"`, "");
    }
    if (lastHits.length > shown) out += `<div class="next"><button type="button" data-a="showmore">Show more (${lastHits.length - shown})</button></div>`;
    const ascii = /^[a-zA-Z' -]+$/.test(q);
    if (!bare) out += `<div class="next"><span>Not the word you need?</span><button type="button" data-a="report-query">Report</button><a href="${esc(askAiUrl(q))}" target="_blank" rel="noopener" data-a="ask">Ask AI</a>${ascii ? `<a href="${esc(cambridgeUrl(q))}" target="_blank" rel="noopener" data-a="ext">Cambridge</a>` : ""}</div>`;
    results.innerHTML = out;
  }
  function clearSearch() { qBox.value = ""; runSearch(); }

  let timer = 0;
  qBox.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(runSearch, 70); });
  // "/" or Ctrl+K (Cmd+K) jumps to the search box from anywhere; Esc clears it, a second Esc leaves it.
  document.addEventListener("keydown", (ev) => {
    const el = document.activeElement;
    const typing = el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    const ctrlK = (ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === "k";
    if ((ctrlK || (ev.key === "/" && !typing && !ev.ctrlKey && !ev.metaKey && !ev.altKey)) && !document.querySelector("dialog[open]")) {
      ev.preventDefault();
      qBox.focus();
      qBox.select();
      return;
    }
    if (ev.key === "Escape" && el === qBox) { if (qBox.value) clearSearch(); else qBox.blur(); }
  });
  // Clear button: one tap empties the box and keeps the keyboard up.
  $("qClear").addEventListener("pointerdown", (ev) => ev.preventDefault());
  $("qClear").addEventListener("click", () => {
    qBox.value = !pad.hidden && isIpa(qBox.value) ? "/" : "";
    runSearch();
    qBox.focus();
  });

  // ---------- IPA keys: tap a sound to add it; the small code is how to type it on a keyboard ----------
  const IPA_KEYS = [["i", "i"], ["ɪ", "ih"], ["e", "e"], ["æ", "ae"], ["ɑ", "aa"], ["ɔ", "aw"], ["ʌ", "uh"], ["ə", "@"], ["ɚ", "er"], ["ʊ", "oo"], ["u", "u"],
    ["eɪ", "ei"], ["aɪ", "ai"], ["ɔɪ", "oi"], ["oʊ", "ou"], ["aʊ", "au"], ["θ", "th"], ["ð", "dh"], ["ʃ", "sh"], ["ʒ", "zh"], ["tʃ", "ch"], ["dʒ", "j"], ["j", "y"], ["ŋ", "ng"]];
  const pad = $("ipaPad");
  $("ipaKeys").innerHTML = IPA_KEYS.map(([s, c]) => `<button type="button" data-ipa="${s}" title="${s}: type ${esc(c)}"><b>${s}</b><small>${esc(c)}</small></button>`).join("");
  function setPad(open) {
    pad.hidden = !open;
    $("ipaBtn").setAttribute("aria-pressed", String(open));
    if (open && !qBox.value.trim()) { qBox.value = "/"; runSearch(); }
    if (!open && qBox.value.trim() === "/") clearSearch();
  }
  $("ipaBtn").addEventListener("click", () => { setPad(pad.hidden); if (!pad.hidden && wide()) qBox.focus(); });
  $("ipaKeys").addEventListener("pointerdown", (ev) => { if (ev.target.closest("[data-ipa]")) ev.preventDefault(); });
  $("ipaKeys").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-ipa]");
    if (!b) return;
    const focused = document.activeElement === qBox;
    const lead = qBox.value.length - qBox.value.trimStart().length;
    let v = qBox.value.trimStart();
    let a = focused ? Math.max(0, qBox.selectionStart - lead) : v.length;
    let z = focused ? Math.max(a, qBox.selectionEnd - lead) : v.length;
    if (!v.startsWith("/")) { v = "/" + v; a++; z++; }
    qBox.value = v.slice(0, a) + b.dataset.ipa + v.slice(z);
    if (focused) qBox.setSelectionRange(a + b.dataset.ipa.length, a + b.dataset.ipa.length);
    runSearch();
  });

  // ---------- links ----------
  const cambridgeUrl = (w) => "https://dictionary.cambridge.org/us/dictionary/english/" + encodeURIComponent(w.trim().toLowerCase().replace(/\s+/g, "-"));
  const clipartUrl = (w) => "https://www.google.com/search?udm=2&q=" + encodeURIComponent("clipart " + w);
  function aiPrompt(q) {
    const what = isIpa(q) ? `It sounds roughly like ${q.trim()} (my rough US IPA; codes like ae = æ, sh = ʃ, th = θ/ð may appear).` : `My description: "${q}".`;
    return `I am a Vietnamese English learner (A2-B1, American English). I'm looking for an English word or phrase. ${what}\n` +
      "Reply in simple English, 1 to 3 lines per candidate:\n**word** /US IPA/: short definition.\n*One natural example sentence.*\nGive up to 3 candidates, best first.";
  }
  const askAiUrl = (q) => "https://claude.ai/new?q=" + encodeURIComponent(aiPrompt(q));
  const wide = () => window.matchMedia("(min-width: 760px) and (hover: hover)").matches;
  function openExternal(ev, a) {
    if (!wide()) return; // phones: normal new tab from target=_blank
    ev.preventDefault();
    const w = Math.min(980, screen.availWidth - 80);
    const h = Math.min(860, screen.availHeight - 80);
    const win = window.open(a.href, a.dataset.a === "ask" ? "dict_ai" : a.dataset.win || "dict_ext", `popup=yes,width=${w},height=${h},left=${screen.availWidth - w - 20},top=40`);
    if (win) win.focus(); else window.open(a.href, "_blank", "noopener");
  }

  // ---------- story sentences (F-231) ----------
  // story-data.js (~1 MB) is loaded the first time it is needed; story-find.js builds the index once.
  let storyIx = null;
  let storyWait = null;
  const panelMode = new Map();   // "word|entry" → compact / full / all / closed, so a re-render keeps what was opened
  function loadStories() {
    if (storyIx) return Promise.resolve(storyIx);
    if (!storyWait) {
      storyWait = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "story-data.js";
        s.onload = () => {
          try { storyIx = window.DictStories.createIndex(window.DICT_STORIES, entries.map((e) => e.w)); resolve(storyIx); } catch (err) { reject(err); }
        };
        s.onerror = () => { storyWait = null; s.remove(); reject(new Error("story-data.js")); };
        document.head.append(s);
      });
    }
    return storyWait;
  }
  function whenStories(q) {   // search results: draw them again once the stories are ready
    loadStories().then(() => { if (lastQuery === q && !results.hidden) renderResults(); }).catch(() => {});
  }
  const LIMITS = { compact: [2, 2], full: [3, 5], all: [1e9, 200] };   // [new-word sentences, other sentences]
  function storyHits(q, mode) {
    const r = storyIx.find(q);
    const [a, b] = LIMITS[mode] || LIMITS.full;
    return { r, isNew: r.isNew.slice(0, a), more: r.more.slice(0, b) };
  }
  function storyLine(h, q, isNew) {
    const v = storyIx.view(h, q);
    const st = storyIx.story(h);
    let text = "";
    let at = 0;
    for (const [a, b] of v.spans) { text += esc(v.plain.slice(at, a)) + "<mark>" + esc(v.plain.slice(a, b)) + "</mark>"; at = b; }
    text += esc(v.plain.slice(at));
    return `<a class="sl${isNew ? " new" : ""}" href="${esc(storyIx.link(h, q))}" target="_blank" rel="noopener" data-a="ext" data-win="dict_story" title="${esc(`${st.series} · ${st.id} · ${st.title} · sentence ${h.n}`)}"><span class="sid">${esc(st.id)}</span>${text}</a>`;
  }
  // q: the word to find (the card's headword, or the search when the word is not in the list); i: its entry, or -1
  function storyPanel(q, i, mode) {
    const { r, isNew, more } = storyHits(q, mode);
    const attrs = `class="st" data-q="${esc(q)}" data-i="${i}" data-mode="${mode}"`;
    const prompt = storyPrompt(q, i, isNew.concat(more));
    const foot = `<div class="stf">` +
      (isNew.length + more.length < r.total ? `<button type="button" data-a="stall">All ${r.total} sentences</button>` : "") +
      `<button type="button" data-a="aicopy">Copy for AI</button><a href="${esc(askUrl(prompt))}" target="_blank" rel="noopener" data-a="askst">Ask AI</a></div>`;
    if (!r.total) return `<div ${attrs}><div class="sth"><b>In the stories</b> · not in the stories yet</div>${foot}</div>`;
    let s = `<div ${attrs}><div class="sth"><b>In the stories</b> · ${r.total} sentence${r.total > 1 ? "s" : ""}${r.stories > 1 ? ` in ${r.stories} stories` : ""}</div>`;
    if (isNew.length) {
      const st = storyIx.story(isNew[0]);
      const one = isNew.every((h) => h.story === isNew[0].story);
      s += `<div class="stg">${one ? `New word in ${esc(st.id)} · ${esc(st.title)}` : "New word in these stories"}</div>` + isNew.map((h) => storyLine(h, q, true)).join("");
    }
    if (more.length) s += `<div class="stg">${isNew.length ? "Also in" : "Sentences"}</div>` + more.map((h) => storyLine(h, q, false)).join("");
    return s + foot + "</div>";
  }
  // A ready-made question for an AI chat: the card, plus the story sentences shown in the panel.
  function storyPrompt(q, i, hits) {
    const e = i >= 0 ? entries[i] : null;
    const word = e ? e.w : q.trim();
    const lines = hits.slice(0, 8).map((h, k) => `${k + 1}. ${storyIx.view(h, q).plain} (${storyIx.story(h).id})`);
    let s = `I'm a Vietnamese learner of English (A2-B1, aiming for IELTS 7.0). I read the word "${word}" and I'm still not sure what it means.\n`;
    const stop = (t) => (/[.!?]$/.test(t) ? t : t + ".");
    if (e) s += `My dictionary says: ${e.w}${e.i ? ` /${e.i}/` : ""}${e.p ? ` (${e.p})` : ""}: ${stop(e.def || "")}${e.vi ? ` Vietnamese: ${e.vi}.` : ""}${e.x ? ` Example: ${e.x}` : ""}\n`;
    else s += "It is not in my word list.\n";
    if (lines.length) s += `Sentences where I met it:\n${lines.join("\n")}\n`;
    const where = lines.length > 1 ? "each sentence above (say if the meaning changes)" : lines.length ? "the sentence above" : "everyday English";
    return s + `\nPlease explain in simple English and give the Vietnamese meaning:\n1. What "${word}" means in ${where}.\n` +
      "2. Is it common? Formal or informal?\n3. Two or three common phrases with it, each with one short example.\n4. A tip to remember it, or a word that is easy to confuse with it.";
  }
  const askUrl = (prompt) => "https://claude.ai/new?q=" + encodeURIComponent(prompt);
  // Card button: open or close the panel under the word (a family word gets its own panel).
  function toggleStories(host, i) {
    const key = entries[i].w + "|" + i;
    const old = host.querySelector(":scope > .st, :scope > .hitmeta > .st");
    if (old) { old.remove(); panelMode.set(key, "closed"); return; }
    const box = document.createElement("div");
    box.className = "st";
    box.innerHTML = '<div class="sth">Loading the stories…</div>';
    host.append(box);
    loadStories().then(() => {
      panelMode.set(key, "full");
      box.outerHTML = storyPanel(entries[i].w, i, "full");
    }).catch(() => { box.innerHTML = "<div class=\"sth\">Couldn't load the stories. Check the connection and try again.</div>"; });
  }
  async function copyForAi(q, i, mode) {
    let text;
    try {
      await loadStories();
      const { isNew, more } = storyHits(q, mode);
      text = storyPrompt(q, i, isNew.concat(more));
    } catch { toast("Couldn't load the stories"); return; }
    copyText(text, "Copied. Paste it into your AI chat");
  }
  // Clipboard API first; then the old copy command; if both are blocked, show the text selected so it can be copied by hand.
  async function copyText(text, done) {
    try { await navigator.clipboard.writeText(text); toast(done); return; } catch { /* try the next way */ }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    if (ok) { toast(done); return; }
    $("copyText").value = text;
    $("copyBox").showModal();
    $("copyText").focus();
    $("copyText").select();
  }

  // ---------- audio: Jon's file first, device voice when there is no file or no network ----------
  const player = new Audio();
  player.preload = "none";
  let playingBtn = null;
  const markPlaying = (b) => { playingBtn?.classList.remove("playing"); playingBtn = b; b?.classList.add("playing"); };
  player.addEventListener("ended", () => markPlaying(null));
  function speakDevice(word, btn) {
    if (!("speechSynthesis" in window)) { markPlaying(null); toast("Audio isn't available offline for this word"); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-US";
    u.onend = () => markPlaying(null);
    markPlaying(btn);
    speechSynthesis.speak(u);
  }
  function play(i, btn) {
    const e = entries[i];
    if (!e.s) { speakDevice(e.w, btn); return; }
    markPlaying(btn);
    player.src = "audio/" + e.s + ".mp3";
    player.currentTime = 0;
    player.play().catch(() => speakDevice(e.w, btn));
    player.onerror = () => speakDevice(e.w, btn);
  }

  // ---------- reports ----------
  let reportCtx = {};
  function openReport(ctx) {
    reportCtx = ctx;
    $("reportTitle").textContent = ctx.word ? `Report: ${ctx.word}` : `Report: “${ctx.query}”`;
    $("reportNote").value = "";
    const def = ctx.type || (ctx.word ? "wrong_content" : "missing_word");
    document.querySelectorAll('[name="rtype"]').forEach((r) => { r.checked = r.value === def; });
    $("report").showModal();
  }
  $("reportSave").addEventListener("click", () => {
    const type = document.querySelector('[name="rtype"]:checked')?.value;
    const e = reportCtx.id !== undefined ? entries[reportCtx.id] : null;
    reports.push({
      type, at: new Date().toISOString(), query: lastQuery || null, word: e?.w ?? null, unit: e?.u ?? null, page: e?.g ?? null,
      note: $("reportNote").value.trim() || null, top_results: lastHits.slice(0, 5).map((h) => h.entry.w),
    });
    store.set("reports", reports);
    $("report").close();
    updateReportState();
    toast("Report saved");
  });
  const reportJson = () => JSON.stringify({ schema: "dict-report/1", exported_at: new Date().toISOString(), build: buildId(), personal_keys: personal, items: reports }, null, 1);
  function updateReportState() {
    const n = reports.length + personal.length;
    $("reportCount").textContent = n ? `${reports.length} report(s), ${personal.length} saved search(es). Send them to the AI to add words and fix results.` : "No reports yet.";
  }
  const buildId = () => $("build").dataset.b || "dev";
  $("reportCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(reportJson()); toast("Copied"); } catch { toast("Couldn't copy. Use Download"); }
  });
  $("reportFile").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([reportJson()], { type: "application/json" }));
    a.download = `dictionary-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("reportShare").addEventListener("click", async () => {
    if (!navigator.share) { $("reportFile").click(); return; }
    const name = `dictionary-report-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([reportJson()], name, { type: "application/json" });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: name });
      else await navigator.share({ title: name, text: reportJson() });
    } catch (err) { if (err.name !== "AbortError") toast("Couldn't share. Use Download"); }
  });
  $("reportClear").addEventListener("click", () => {
    if (!reports.length && !personal.length) return;
    if (!confirm("Delete all reports and saved searches on this device?")) return;
    reports = [];
    personal.length = 0;
    store.set("reports", reports);
    store.set("personal", personal);
    updateReportState();
  });

  // ---------- per-word actions ----------
  function toggleActions(host, i) {
    const old = host.querySelector(":scope > .acts");
    if (old) { old.remove(); return; }
    const e = entries[i];
    const div = document.createElement("div");
    div.className = "acts";
    div.innerHTML = `<a href="${esc(cambridgeUrl(e.w))}" target="_blank" rel="noopener" data-a="ext" data-win="dict_cam">Cambridge</a>` +
      `<a href="${esc(clipartUrl(e.w))}" target="_blank" rel="noopener" data-a="ext" data-win="dict_img">Clipart</a>` +
      `<button type="button" data-a="aicopy" data-i="${i}">Copy for AI</button>` +
      `<button type="button" data-a="report" data-i="${i}">Report</button>` +
      (lastQuery && !results.hidden && !isIpa(lastQuery) && !e.w.toLowerCase().includes(lastQuery.toLowerCase()) ? `<button type="button" data-a="remember" data-i="${i}">Remember “${esc(lastQuery)}”</button>` : "");
    host.append(div);
  }
  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-a]");
    if (!t) return;
    const a = t.dataset.a;
    const i = t.dataset.i === undefined ? -1 : +t.dataset.i;
    if (a === "play") play(i, t);
    else if (a === "story") toggleStories(t.closest("[data-card]"), i);
    else if (a === "stall" || a === "aicopy" || a === "askst") {
      const p = t.closest(".st");
      const q = p ? p.dataset.q : entries[i].w;
      const id = p ? +p.dataset.i : i;
      const mode = p ? p.dataset.mode : "full";
      if (a === "stall") {
        panelMode.set(q + "|" + id, "all");
        p.outerHTML = storyPanel(q, id, "all");
      } else if (a === "aicopy") copyForAi(q, id, mode);
      else {   // Ask AI: the link already carries the question; also copy it in case the chat page drops it
        const { isNew, more } = storyHits(q, mode);
        navigator.clipboard?.writeText(storyPrompt(q, id, isNew.concat(more))).catch(() => {});
        openExternal(ev, t);
      }
    }
    else if (a === "vi") {
      if (openVi.has(i)) openVi.delete(i); else openVi.add(i);
      const on = openVi.has(i);
      document.querySelectorAll(`[data-vi="${i}"]`).forEach((el) => { el.hidden = !on && !showAllVi; });
      document.querySelectorAll(`[data-a="vi"][data-i="${i}"]`).forEach((b) => b.classList.toggle("on", on || showAllVi));
    } else if (a === "more") toggleActions(t.closest("[data-card]"), i);
    else if (a === "go") { ev.preventDefault(); goToCard(i); }
    else if (a === "ext" || a === "ask") {
      if (a === "ask") navigator.clipboard?.writeText(aiPrompt(lastQuery)).catch(() => {});
      openExternal(ev, t);
    } else if (a === "report") openReport({ id: i, word: entries[i].w });
    else if (a === "report-query") openReport({ query: lastQuery });
    else if (a === "showmore") { shown += 60; renderResults(); }
    else if (a === "remember") {
      const word = entries[i].w.toLowerCase();
      personal.push({ query: lastQuery, word });
      store.set("personal", personal);
      addPersonalKey(lastQuery, i);
      t.remove();
      updateReportState();
      toast(`“${lastQuery}” now finds ${entries[i].w}`);
    }
  });

  // ---------- top bar and dialogs ----------
  $("viAll").addEventListener("click", () => setShowAll(!showAllVi));
  $("setVi").addEventListener("change", (ev) => setShowAll(ev.target.checked));
  $("gear").addEventListener("click", () => { updateReportState(); refreshAudioState(); $("settings").showModal(); });
  $("sizeUp").addEventListener("click", () => { textSize = Math.min(22, textSize + 1); store.set("size", textSize); applySize(); });
  $("sizeDown").addEventListener("click", () => { textSize = Math.max(11, textSize - 1); store.set("size", textSize); applySize(); });
  $("where").addEventListener("click", () => { $("jumpPage").value = currentPage; $("jump").showModal(); });
  $("units").innerHTML = [...unitFirst.values()].map((c) => `<button type="button" data-unit="${c.u}" data-p="${c.g}">${c.u}</button>`).join("");
  $("units").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-unit]");
    if (!b) return;
    $("jump").close();
    clearSearch();
    goToCard(idOf.get(unitFirst.get(b.dataset.unit)));
  });
  $("jumpPage").min = pageNums[0];
  $("jumpPage").max = pageNums[pageNums.length - 1];
  function jumpGo() { const p = +$("jumpPage").value; if (sections.has(p)) { $("jump").close(); clearSearch(); goToPage(p); } else toast("That page isn't in the book"); }
  $("jumpGo").addEventListener("click", jumpGo);
  $("jumpPage").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); jumpGo(); } });
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (ev) => { if (ev.target === d) d.close(); }));

  let toastTimer = 0;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------- offline ----------
  const AUDIO_CACHE = "dict-audio-v1";
  const offlineOk = "caches" in window && location.protocol.startsWith("http");
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  const audioNames = [...new Set(entries.filter((e) => e.s).map((e) => e.s))];
  let saving = false;
  async function refreshAudioState() {
    if (!offlineOk) { $("audioAll").hidden = true; return; }
    const c = await caches.open(AUDIO_CACHE);
    const n = (await c.keys()).length;
    if (!saving) $("audioState").textContent = n >= audioNames.length ? "All audio is saved on this device." : `${n} of ${audioNames.length} words saved on this device (all: about 150 MB).`;
    $("audioAll").hidden = n >= audioNames.length;
  }
  $("audioAll").addEventListener("click", async () => {
    if (saving) { saving = false; return; }
    saving = true;
    $("audioAll").textContent = "Stop";
    const c = await caches.open(AUDIO_CACHE);
    const have = new Set((await c.keys()).map((r) => r.url.split("/").pop()));
    const todo = audioNames.filter((s) => !have.has(s + ".mp3"));
    let done = audioNames.length - todo.length;
    let failed = 0;
    const worker = async () => {
      while (saving && todo.length) {
        const s = todo.pop();
        try {
          const url = new URL("audio/" + s + ".mp3", location.href);
          const res = await fetch(url);
          if (res.ok) await c.put(url, res); else failed++;
        } catch { failed++; }
        done++;
        if (done % 20 === 0) $("audioState").textContent = `Saving ${done} of ${audioNames.length}…`;
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    saving = false;
    $("audioAll").textContent = "Save all";
    if (failed) toast(`${failed} files failed. Try Save all again`);
    refreshAudioState();
  });

  // ---------- start ----------
  applySize();
  setShowAll(showAllVi);
  updateReportState();
  fetch("sw.js").then((r) => r.text()).then((t) => {
    const m = t.match(/BUILD = "([^"]+)"/);
    if (m) { $("build").dataset.b = m[1]; $("build").textContent = `Build ${m[1]}.`; }
  }).catch(() => {});
  showWhere();
  goToPage(currentPage);
  if (location.protocol.startsWith("http") && window.Worker) {
    try {
      worker = new Worker("search-worker.js");
      for (const p of personal) { const id = byWord.get(p.word); if (id !== undefined) worker.postMessage({ type: "add", query: p.query, id }); }
      worker.onmessage = ({ data }) => {
        if (data.seq === undefined || data.seq !== searchSeq) return;
        lastAnswered = data.seq;
        showHits(data.hits.map((h) => ({ ...h, entry: entries[h.id] })));
      };
      worker.onerror = () => { worker = null; if (qBox.value.trim()) runSearch(); };
    } catch { worker = null; }
  }
  // #q=<words> opens a search (the story reader and the AI guides link here), also when the page is already open
  const searchFromHash = () => { if (location.hash.startsWith("#q=")) { qBox.value = decodeURIComponent(location.hash.slice(3)); runSearch(); } };
  searchFromHash();
  addEventListener("hashchange", searchFromHash);
})();
