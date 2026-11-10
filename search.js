// Dictionary search core (F-218). Pure: no DOM, no network. Classic script so the page also works from file://.
// Results come in strict tiers, so a loose match can never outrank a real one. Example sentences are never indexed.
(function (root) {
  "use strict";

  const nfc = (s) => String(s || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  const flatCache = new Map();
  const flat = (s) => {
    let v = flatCache.get(s);
    if (v === undefined) {
      v = nfc(s).normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").normalize("NFC");
      flatCache.set(s, v);
    }
    return v;
  };
  const WORD_BREAK = /[^\p{L}\p{N}]+/u;
  const tokens = (s) => nfc(s).split(WORD_BREAK).filter(Boolean);
  const squeeze = (s) => nfc(s).replace(/[\s'’-]+/g, "");

  // Vietnamese classifiers: "cái ghế" and "ghế" mean the same lookup.
  const CLASSIFIER = /^(cái|con|chiếc|quả|trái|quyển|cuốn|tấm|bức|sợi|tờ|hòn|sự|việc) (?=\S)/;
  const core = (s) => s.replace(CLASSIFIER, "");

  const EN_STOP = new Set("a an the to of in on at for with and or is are be that this it its you your someone something by from as very not who which where what when how do does did can will used using way kind thing things person people".split(" "));
  const VI_STOP = new Set("cái con một những các của và là để có thứ việc sự khi mà rất cho với ở trong được này đó ai gì nào".split(" "));
  const isStop = (t) => EN_STOP.has(t) || VI_STOP.has(t);

  const IRREGULAR = {
    children: "child", men: "man", women: "woman", feet: "foot", teeth: "tooth", mice: "mouse", geese: "goose", wives: "wife", knives: "knife", leaves: "leaf", lives: "life", shelves: "shelf", wolves: "wolf",
    was: "be", were: "be", been: "be", am: "be", is: "be", are: "be", has: "have", had: "have", did: "do", done: "do", went: "go", gone: "go",
    stood: "stand", understood: "understand", took: "take", taken: "take", made: "make", said: "say", came: "come", ran: "run", ate: "eat", eaten: "eat", saw: "see", seen: "see",
    bought: "buy", thought: "think", brought: "bring", caught: "catch", taught: "teach", fought: "fight", sought: "seek", felt: "feel", left: "leave", kept: "keep", slept: "sleep", swept: "sweep", wept: "weep",
    met: "meet", paid: "pay", laid: "lay", sold: "sell", told: "tell", won: "win", wrote: "write", written: "write", gave: "give", given: "give", got: "get", gotten: "get", knew: "know", known: "know",
    grew: "grow", grown: "grow", threw: "throw", thrown: "throw", flew: "fly", flown: "fly", drew: "draw", drawn: "draw", blew: "blow", blown: "blow", drove: "drive", driven: "drive", rode: "ride", ridden: "ride",
    rose: "rise", risen: "rise", fell: "fall", fallen: "fall", broke: "break", broken: "break", spoke: "speak", spoken: "speak", woke: "wake", woken: "wake", chose: "choose", chosen: "choose", froze: "freeze", frozen: "freeze",
    stole: "steal", stolen: "steal", wore: "wear", worn: "wear", tore: "tear", torn: "tear", swore: "swear", sworn: "swear", began: "begin", begun: "begin", drank: "drink", drunk: "drink", sang: "sing", sung: "sing", sank: "sink", sunk: "sink",
    swam: "swim", swum: "swim", rang: "ring", rung: "ring", hid: "hide", hidden: "hide", bit: "bite", bitten: "bite", held: "hold", sat: "sit", spent: "spend", sent: "send", built: "build", lent: "lend", bent: "bend", lost: "lose", shot: "shoot",
    found: "find", heard: "hear", led: "lead", fed: "feed", bled: "bleed", fled: "flee", read: "read", dealt: "deal", meant: "mean", learnt: "learn", burnt: "burn", dreamt: "dream", better: "good", best: "good", worse: "bad", worst: "bad", further: "far", farther: "far",
  };

  function wordForms(q) {
    const out = new Set();
    const strip = (end, add) => { if (q.endsWith(end) && q.length > end.length + 1) out.add(q.slice(0, -end.length) + add); };
    strip("s", ""); strip("es", ""); strip("ies", "y"); strip("ves", "f"); strip("ves", "fe");
    strip("d", ""); strip("ed", ""); strip("ied", "y"); strip("ing", ""); strip("ing", "e");
    strip("er", ""); strip("er", "e"); strip("ier", "y"); strip("est", ""); strip("est", "e"); strip("iest", "y"); strip("ly", ""); strip("ily", "y");
    const dbl = q.match(/^(.*?)([b-df-hj-np-tv-z])\2(ed|ing|er|est)$/);
    if (dbl) out.add(dbl[1] + dbl[2]);
    return [...out];
  }

  function stem(t) {
    if (!/^[a-z]+$/.test(t) || t.length < 4) return t;
    if (t.endsWith("ies")) return t.slice(0, -3) + "y";
    if (t.endsWith("ing") && t.length > 5) return t.slice(0, -3);
    if (t.endsWith("ed") && t.length > 4) return t.slice(0, -2);
    if (t.endsWith("es") && t.length > 4) return t.slice(0, -2);
    if (t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
    if (t.endsWith("e")) return t.slice(0, -1);
    return t;
  }

  // Damerau-Levenshtein with an early exit once the row minimum exceeds max.
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let before = null;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      let least = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (before && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2] + 1);
        row[j] = v;
        if (v < least) least = v;
      }
      if (least > max) return max + 1;
      before = prev;
      prev = row;
    }
    return prev[b.length];
  }

  function indexOfRun(hay, need) {
    for (let i = 0; i + need.length <= hay.length; i++) {
      if (need.every((x, j) => hay[i + j] === x)) return i;
    }
    return -1;
  }

  function splitMeaning(vi) {
    const text = String(vi || "");
    const notes = [...text.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean);
    const senses = text.replace(/\([^)]*\)/g, " ").split(/[,;/]| hoặc /).map((s) => s.trim()).filter(Boolean);
    return { senses, notes };
  }

  // ---------- sound (IPA) search ----------
  // The same folds run on the data and the query, so stress, length marks and spelling variants never block a match.
  const IPA_DROP = /[ˈˌːˑ˞.'’:\s()\-/[\]]|\p{M}/u;
  const IPA_FOLDS = [["ər", "ɚ"], ["əʊ", "oʊ"], ["ɑɪ", "aɪ"], ["ɝ", "ɚ"], ["ɜ", "ɚ"], ["ɒ", "ɑ"], ["ɛ", "e"], ["ɹ", "r"], ["ɡ", "g"], ["ʧ", "tʃ"], ["ʤ", "dʒ"], ["ɐ", "ə"], ["ɫ", "l"], ["ɾ", "t"], ["ᵻ", "ɪ"]];
  // Canonical sound string plus, for each of its characters, the index in the raw text (for highlighting).
  function ipaCanon(raw) {
    const src = String(raw || "").toLowerCase();
    const kept = [];
    for (let k = 0; k < src.length; k++) if (!IPA_DROP.test(src[k])) kept.push(k);
    let s = "";
    const at = [];
    for (let k = 0; k < kept.length;) {
      const fold = IPA_FOLDS.find(([from]) => [...from].every((c, j) => src[kept[k + j]] === c));
      const to = fold ? fold[1] : src[kept[k]];
      for (const c of to) { s += c; at.push(kept[k]); }
      k += fold ? fold[0].length : 1;
    }
    return { s, at };
  }

  // Keyboard codes for sounds a laptop keyboard can't type. A code also keeps its plain letters,
  // so "th" finds θ, ð and t+h alike and no code can hide a real match.
  const IPA_CODES = [
    ["ae", ["æ"]], ["aa", ["ɑ"]], ["uh", ["ʌ"]], ["er", ["ɚ"]], ["ih", ["ɪ"]], ["oo", ["ʊ", "u"]], ["aw", ["ɔ"]], ["eh", ["e"]],
    ["ei", ["eɪ"]], ["ai", ["aɪ"]], ["oi", ["ɔɪ"]], ["ou", ["oʊ"]], ["au", ["aʊ"]],
    ["th", ["θ", "ð"]], ["dh", ["ð"]], ["sh", ["ʃ"]], ["zh", ["ʒ"]], ["ch", ["tʃ"]], ["ng", ["ŋg", "ŋ"]],
    ["j", ["dʒ"]], ["y", ["j"]], ["c", ["k", "s"]], ["x", ["ks", "gz"]], ["q", ["k"]],
  ];
  // "Sounds similar": vowels learners often mix up, and th voiced/unvoiced.
  // American t between vowels sounds close to d, so t and d count as similar too.
  const IPA_NEAR = { i: "iɪə", ɪ: "ɪiə", u: "uʊ", ʊ: "ʊu", e: "eæ", æ: "æeɑ", ɑ: "ɑɔʌaæ", a: "aɑæʌ", o: "oɔɑ", ɔ: "ɔɑo", ʌ: "ʌəɑ", ə: "əʌɪi", θ: "θð", ð: "ðθ", t: "td", d: "dt" };
  // Plain letters that are also IPA symbols; a code's own letters are shown as a reading only when they are.
  const IPA_ASCII = /^[abdefghijklmnoprstuvwz]+$/;
  const IPA_CHARS = /[æɑʌəɚɝɜɪʊɛɔɒθðʃʒŋˈˌːɡ]/;
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const isIpaQuery = (raw) => /^\s*[/[]/.test(String(raw || "")) || IPA_CHARS.test(String(raw || ""));
  function ipaQuery(raw) {
    if (!isIpaQuery(raw)) return null;
    const s = ipaCanon(String(raw).replace(/@/g, "ə")).s;
    const units = [];
    for (let k = 0; k < s.length;) {
      const code = IPA_CODES.find(([c]) => s.startsWith(c, k));
      if (code) {
        const plain = IPA_ASCII.test(code[0]) ? [code[0]] : [];
        units.push({ show: [...code[1], ...plain].join("/"), alts: [...new Set([...code[1], code[0]])] });
        k += code[0].length;
      } else {
        units.push({ show: s[k], alts: [s[k]] });
        k++;
      }
    }
    const group = (alts) => (alts.length > 1 ? `(?:${alts.join("|")})` : alts[0]);
    const strict = units.map((u) => group(u.alts.map(reEsc))).join("");
    const nearUnits = units.map((u) => group(u.alts.map((a) => [...a].map((c) => (IPA_NEAR[c] ? `[${IPA_NEAR[c]}]` : c === "ɚ" ? "(?:ɚ|r)" : reEsc(c))).join(""))));
    // Last resort: an unstressed ə or ɪ the learner didn't type ("faemli" → fæməli).
    const loose = nearUnits.join("[əɪ]?");
    return { units, show: units.map((u) => (u.show.includes("/") ? `(${u.show})` : u.show)).join(""), strict, near: nearUnits.join(""), loose };
  }

  const TIER = { personal: 0, word: 1, ipa: 1, form: 2, meaning: 3, key: 3, prefix: 4, ipaStart: 4, contains: 5, ipaHas: 5, typo: 6, ipaNear: 6, describe: 7 };

  function createIndex(entries) {
    const docs = entries.map((e, id) => {
      const { senses, notes } = splitMeaning(e.vi);
      const phrase = (text, kind) => {
        const n = nfc(text);
        const toks = n.split(WORD_BREAK).filter(Boolean);
        return { text, kind, toks, flats: toks.map(flat), n, core: core(n) };
      };
      return {
        id, e, key: nfc(e.w), squeezed: squeeze(e.w), own: e.own !== false,
        phrases: [...senses.map((s) => phrase(s, "meaning")), ...(e.keys || []).map((s) => phrase(s, "key")), ...notes.map((s) => phrase(s, "note"))],
      };
    });

    const byWord = new Map();
    const exact = new Map();
    const firstToken = new Map(); // syllable -> phrases containing it (with and without accents)
    const add = (m, k, v) => { if (k) { if (!m.has(k)) m.set(k, []); m.get(k).push(v); } };
    const postings = new Map();
    const lengths = [];
    for (const d of docs) {
      add(byWord, d.key, d);
      if (d.squeezed !== d.key) add(byWord, d.squeezed, d);
      for (const p of d.phrases) {
        p.d = d;
        for (const t of new Set([...p.toks, ...p.flats])) add(firstToken, t, p);
        if (p.kind === "note") continue;
        for (const v of new Set([p.n, p.core])) {
          const alias = v !== p.n;
          add(exact, v, { d, p, alias, accent: true });
          if (flat(v) !== v) add(exact, flat(v), { d, p, alias, accent: false });
        }
      }
      const bag = [...tokens(d.e.def || "").map(stem)];
      for (const p of d.phrases) for (const t of p.toks) { bag.push(t); const f = flat(t); if (f !== t) bag.push(f); }
      const terms = bag.filter((t) => !isStop(t));
      lengths[d.id] = terms.length;
      const tf = new Map();
      for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
      for (const [t, f] of tf) { if (!postings.has(t)) postings.set(t, []); postings.get(t).push([d.id, f]); }
    }
    const avgLen = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);
    const idf = (t) => { const n = postings.get(t)?.length || 0; return n ? Math.log(1 + (docs.length - n + 0.5) / (n + 0.5)) : 0; };

    const personal = new Map();
    const addPersonal = (query, id) => add(personal, nfc(query), id);

    let sounds = null; // built on the first sound search
    function searchIpa(iq, limit) {
      if (!iq.units.length) return [];
      if (!sounds) sounds = docs.filter((d) => d.e.i).map((d) => ({ d, ...ipaCanon(d.e.i) }));
      const strict = new RegExp(iq.strict);
      const near = new RegExp(iq.near);
      const loose = new RegExp(iq.loose);
      const out = [];
      for (const x of sounds) {
        let m = strict.exec(x.s);
        let tier;
        let score;
        if (m) {
          const extra = x.s.length - m[0].length;
          if (!extra) { tier = "ipa"; score = 100; } else if (m.index === 0) { tier = "ipaStart"; score = 80 - Math.min(20, extra); } else { tier = "ipaHas"; score = 60 - Math.min(m.index, 10) - Math.min(10, extra / 2); }
        } else if ((m = near.exec(x.s) || loose.exec(x.s))) {
          const extra = x.s.length - m[0].length;
          score = (!extra ? 45 : m.index === 0 ? 35 - Math.min(10, extra) : 25 - Math.min(m.index, 10)) - Math.min(5, extra / 4) - (near.test(x.s) ? 0 : 12);
          tier = "ipaNear";
        } else continue;
        let end = x.at[m.index + m[0].length - 1] + 1;
        while (end < x.d.e.i.length && /[ːˑ˞]|\p{M}/u.test(x.d.e.i[end])) end++; // keep t̬ and ː whole
        out.push({ id: x.d.id, entry: x.d.e, tier, score: score + (x.d.own ? 0.5 : 0), matched: null, span: [x.at[m.index], end] });
      }
      return out
        .sort((a, b) => TIER[a.tier] - TIER[b.tier] || b.score - a.score || (a.entry.order ?? 1e9) - (b.entry.order ?? 1e9))
        .slice(0, limit);
    }

    function search(raw, { limit = 40 } = {}) {
      const q0 = nfc(raw);
      if (!q0) return [];
      const iq = ipaQuery(raw);
      if (iq) return searchIpa(iq, limit);
      const q = core(q0);
      const hasMark = q !== flat(q);
      const qt = tokens(q);
      const ft = qt.map(flat);
      const hits = new Map();
      const put = (d, tier, score, matched) => {
        const s = score + (d.own ? 0.5 : 0);
        const cur = hits.get(d.id);
        if (!cur || cur.score < s) hits.set(d.id, { id: d.id, entry: d.e, tier, score: s, matched: matched || null });
      };

      for (const id of personal.get(q0) || []) if (docs[id]) put(docs[id], "personal", 110, q0);
      for (const d of byWord.get(q0) || []) put(d, "word", 100);
      for (const d of byWord.get(squeeze(q0)) || []) put(d, "word", 100);

      if (!hasMark && /^[a-z'-]+$/.test(q)) {
        if (IRREGULAR[q]) for (const d of byWord.get(IRREGULAR[q]) || []) put(d, "form", 98);
        for (const f of wordForms(q)) for (const d of byWord.get(f) || []) put(d, "form", 96);
      }

      const seenExact = new Set([q0, q]);
      for (const v of seenExact) {
        for (const x of exact.get(v) || []) {
          const base = x.p.kind === "meaning" ? 92 : 86;
          put(x.d, x.p.kind === "meaning" ? "meaning" : "key", base - (x.alias ? 2 : 0) - (x.accent ? 0 : 6), x.p.text);
        }
      }

      const single = qt.length === 1;
      for (const d of docs) {
        if (!hasMark && single && d.key.startsWith(q) && d.key !== q) put(d, "prefix", 74 - Math.min(10, d.key.length - q.length));
      }
      for (const p of firstToken.get(qt[0]) || (hasMark ? [] : firstToken.get(ft[0]) || [])) {
        let at = indexOfRun(p.toks, qt);
        let base = p.kind === "meaning" ? 72 : p.kind === "key" ? 66 : 48;
        if (at < 0 && !hasMark) { at = indexOfRun(p.flats, ft); base -= 8; }
        if (at >= 0) put(p.d, "contains", base * (0.6 + 0.4 * (qt.length / p.toks.length)) - Math.min(at, 4), p.text);
      }

      // Spelling mistakes only count when nothing real was found.
      const asciiWord = !hasMark && single && /^[a-z'-]{3,}$/.test(q);
      if (asciiWord && ![...hits.values()].some((h) => h.score >= 55)) {
        const max = q.length >= 7 ? 2 : 1;
        for (const d of docs) {
          if (!d.own && max === 1) continue;
          const dist = editDistance(q, d.key, max);
          if (dist <= max) put(d, "typo", 50 - 8 * dist);
        }
      }

      // Description route: its own tier, only for two or more content words, and most of them must match.
      const content = tokens(q0).filter((t) => !isStop(t)).map(stem);
      if (content.length >= 2) {
        const score = new Map();
        const covered = new Map();
        let total = 0;
        for (const t of content) {
          const w = idf(t);
          total += Math.max(w, 1);
          for (const [id, tf] of postings.get(t) || []) {
            score.set(id, (score.get(id) || 0) + w * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * lengths[id] / avgLen)));
            covered.set(id, (covered.get(id) || 0) + Math.max(w, 1));
          }
        }
        for (const [id, s] of score) {
          if (covered.get(id) / total >= 0.6) put(docs[id], "describe", Math.min(40, 16 + s));
        }
      }

      return [...hits.values()]
        .sort((a, b) => b.score - a.score || (a.entry.order ?? 1e9) - (b.entry.order ?? 1e9))
        .slice(0, limit)
        .sort((a, b) => TIER[a.tier] - TIER[b.tier] || b.score - a.score || (a.entry.order ?? 1e9) - (b.entry.order ?? 1e9));
    }

    return { search, addPersonal, size: docs.length };
  }

  root.DictSearch = { createIndex, nfc, flat, tokens, splitMeaning, editDistance, wordForms, stem, TIER, ipaCanon, ipaQuery, isIpaQuery };
})(globalThis);
