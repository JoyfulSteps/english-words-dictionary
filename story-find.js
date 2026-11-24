// Story sentences for the dictionary (F-231). Pure: no DOM, no network. Classic script so the page also works from file://.
// Data: story-data.js (window.DICT_STORIES), built by tools/build_dictionary.py from story exports (schema word-stories/1).
// A word is matched by its forms (stood → stand, boxes → box), never by a different word that only looks like a form
// (card is not a form of car): a token that is itself a dictionary word is never cut down to another word.
(function (root) {
  "use strict";

  // base → irregular forms (same list as stories/_tools/build.py, plus a few)
  const IRR = `be was were been being am is are|go went gone goes|come came|take took taken|give gave given|do did does done|
have had has|drink drank drunk|bring brought|meet met|make made|get got gotten|see saw seen|say said says|tell told|
think thought|know knew known|find found|leave left|eat ate eaten|buy bought|sell sold|teach taught|catch caught|
fight fought|run ran|swim swam swum|sing sang sung|begin began begun|write wrote written|ride rode ridden|
drive drove driven|speak spoke spoken|break broke broken|choose chose chosen|forget forgot forgotten|
freeze froze frozen|steal stole stolen|wake woke woken|hide hid hidden|bite bit bitten|fall fell fallen|
feel felt|keep kept|sleep slept|sweep swept|weep wept|lend lent|send sent|spend spent|build built|bend bent|
lose lost|hold held|stand stood|understand understood|sit sat|win won|hang hung|dig dug|stick stuck|
strike struck|sting stung|swing swung|light lit|lead led|feed fed|bleed bled|flee fled|shoot shot|
pay paid|lay laid|lie lay lain|hear heard|mean meant|draw drew drawn|grow grew grown|throw threw thrown|
blow blew blown|fly flew flown flies|show showed shown|wear wore worn|tear tore torn|bear bore born borne|swear swore sworn|
shake shook shaken|rise rose risen|arise arose arisen|seek sought|bind bound|grind ground|forgive forgave forgiven|
deal dealt|dream dreamt|burn burnt|learn learnt|spell spelt|spill spilt|smell smelt|sink sank sunk|ring rang rung|
child children|man men|woman women|tooth teeth|foot feet|mouse mice|person people|wife wives|knife knives|
life lives|leaf leaves|thief thieves|half halves|shelf shelves|wolf wolves|ox oxen|goose geese|crisis crises|
analysis analyses|phenomenon phenomena|criterion criteria|medium media|stimulus stimuli|
fungus fungi|cactus cacti|nucleus nuclei|thesis theses|hypothesis hypotheses|index indices|
good better best|bad worse worst|far further farther furthest farthest|little less least|many more most|much more most`;
  const BASES = new Map();   // form → [base, …]
  for (const grp of IRR.replace(/\n/g, "").split("|")) {
    const [base, ...forms] = grp.trim().split(/\s+/);
    for (const f of forms) { if (!BASES.has(f)) BASES.set(f, []); BASES.get(f).push(base); }
  }

  // Suffix rules, tried in this order; the first result that is a dictionary word wins.
  const RULES = [["ies", "y"], ["ied", "y"], ["ier", "y"], ["iest", "y"], ["ily", "y"], ["ves", "f"], ["ves", "fe"],
    ["s", ""], ["es", ""], ["d", ""], ["ed", ""], ["ing", "e"], ["ing", ""], ["er", "e"], ["er", ""], ["est", "e"], ["est", ""], ["ly", ""]];
  const DOUBLE = /^(.*?)([b-df-hj-np-tv-z])\2(ed|ing|er|est)$/;   // stopped → stop, bigger → big

  const TOKEN = /[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu;
  const norm = (s) => String(s || "").normalize("NFC").replace(/[’‘]/g, "'").toLowerCase().replace(/\s+/g, " ").trim();
  const isUpper = (c) => c !== c.toLowerCase() && c === c.toUpperCase();

  // "Grandma **Rose** said…" → plain text, bold ranges and tokens with their place in the plain text.
  function parse(raw) {
    let plain = "";
    const bold = [];
    const parts = String(raw).split("**");
    parts.forEach((p, k) => {
      if (k % 2 && p) bold.push([plain.length, plain.length + p.length]);
      plain += p;
    });
    const low = plain.replace(/[’‘]/g, "'").toLowerCase();
    const toks = [];
    TOKEN.lastIndex = 0;
    for (let m = TOKEN.exec(low); m; m = TOKEN.exec(low)) {
      const a = m.index, b = a + m[0].length;
      toks.push({ t: m[0], a, b, cap: isUpper(plain[a]), first: !toks.length, bold: bold.some(([x, y]) => a < y && b > x) });
    }
    return { plain, toks };
  }

  function createIndex(data, headwords) {
    const D = data || {};
    const series = D.series || [];
    const stories = D.stories || [];
    const sents = D.s || [];
    const heads = new Set();
    const capHeads = new Set();   // words the dictionary writes with a capital: Monday, TV, English
    for (const w of headwords || []) {
      const k = norm(w);
      heads.add(k);
      if (isUpper(String(w).trim()[0] || "")) capHeads.add(k);
    }
    const storyOf = new Int32Array(sents.length);
    stories.forEach((st, k) => {
      const end = k + 1 < stories.length ? stories[k + 1].a : sents.length;
      for (let i = st.a; i < end; i++) storyOf[i] = k;
    });

    // Dictionary keys a token counts for.
    const keyCache = new Map();
    function lemmas(t) {
      let v = keyCache.get(t);
      if (v) return v;
      const out = new Set([t]);
      for (const b of BASES.get(t) || []) out.add(b);
      if (t.endsWith("'s") || t.endsWith("s'")) for (const k of lemmas(t.endsWith("'s") ? t.slice(0, -2) : t.slice(0, -1))) out.add(k);
      if (!heads.has(t) && /^[a-z][a-z'-]*$/.test(t)) {
        const cands = [];
        const dbl = DOUBLE.exec(t);
        if (dbl) cands.push(dbl[1] + dbl[2]);
        for (const [end, add] of RULES) if (t.length > end.length + 1 && t.endsWith(end)) cands.push(t.slice(0, -end.length) + add);
        const known = cands.find((c) => heads.has(c));
        if (known) out.add(known);
        else for (const c of cands) if (c.length >= 3) out.add(c);   // only reachable by typing that exact spelling
      }
      v = [...out];
      keyCache.set(t, v);
      return v;
    }
    // One pass over all sentences: where each spelling occurs, split by how it is written —
    // lower case, capital inside a sentence, capital as the first word.
    const occ = [new Map(), new Map(), new Map()];   // 0 lower, 1 capital mid-sentence, 2 capital first word
    const bare = (t) => (t.indexOf("'") < 0 ? t : t.replace(/'s$/, "").replace(/'$/, ""));   // Rose's → rose
    const seen = [new Map(), new Map()];   // bare spelling → how many times in lower case / with a capital mid-sentence
    for (let i = 0; i < sents.length; i++) {
      const raw = sents[i].indexOf("*") < 0 ? sents[i] : sents[i].replace(/\*\*/g, "");
      const low = raw.replace(/[’‘]/g, "'").toLowerCase();
      TOKEN.lastIndex = 0;
      let first = true;
      for (let m = TOKEN.exec(low); m; m = TOKEN.exec(low)) {
        const kind = isUpper(raw[m.index]) ? (first ? 2 : 1) : 0;
        first = false;
        const map = occ[kind];
        let arr = map.get(m[0]);
        if (!arr) map.set(m[0], (arr = []));
        if (arr[arr.length - 1] !== i) arr.push(i);
        if (kind < 2) { const b = bare(m[0]); seen[kind].set(b, (seen[kind].get(b) || 0) + 1); }
      }
    }
    // Names are kept apart from dictionary words: "Grandma Rose" must not show up under rose or rise, "Grace" under grace.
    // A capital inside a sentence is a name when the dictionary has the word only in lower case; a capital first word
    // is a name when the word is mostly written with a capital in the stories.
    function isName(t, kind) {
      if (!kind) return false;
      const b = bare(t);
      if (capHeads.has(b) || !heads.has(b)) return false;
      return kind === 1 || (seen[1].get(b) || 0) > (seen[0].get(b) || 0);
    }
    // key → the spellings that count for it (made from the few thousand distinct spellings, not from every token)
    const index = new Map();   // spelling → sentence numbers where it is a word, not a name
    for (let kind = 0; kind < 3; kind++) {
      for (const [t, ids] of occ[kind]) {
        if (isName(t, kind)) continue;
        const cur = index.get(t);
        index.set(t, cur ? cur.concat(ids) : ids);
      }
    }
    const spellings = new Map();
    for (const t of index.keys()) {
      for (const k of lemmas(t)) {
        if (!spellings.has(k)) spellings.set(k, []);
        spellings.get(k).push(t);
      }
    }
    const idsFor = (k) => (spellings.get(k) || []).flatMap((t) => index.get(t));

    // What a query matches: the word itself, plus its base form when it is not a dictionary word ("podcasts" → podcast).
    function queryKeys(q) {
      const k = norm(q);
      return heads.has(k) ? [k] : lemmas(k);
    }
    // Places in a parsed sentence where the query (one word or a phrase) matches: [[start, end], …] in plain text.
    function spansIn(p, words) {
      const out = [];
      const ok = (tk, keys) => !isName(tk.t, tk.cap ? (tk.first ? 2 : 1) : 0) && lemmas(tk.t).some((x) => keys.includes(x));
      for (let j = 0; j + words.length <= p.toks.length; j++) {
        if (words.every((keys, n) => ok(p.toks[j + n], keys))) out.push([p.toks[j].a, p.toks[j + words.length - 1].b, j]);
      }
      return out;
    }

    function wordsOf(q) {
      const parts = norm(q).split(" ").filter(Boolean);
      return parts.length > 1 ? parts.map((w) => [...new Set([w, ...lemmas(w)])]) : [queryKeys(q)];
    }

    // All sentences with the query. New-word sentences (the word is **bold** there) come first, then one sentence
    // per story in reading order (the clearest one: about 14 words), then the rest.
    function find(q) {
      const words = wordsOf(q);
      if (!words.length || !words[0].length) return { total: 0, stories: 0, isNew: [], more: [] };
      const ids = new Set();
      for (const k of words[0]) for (const i of idsFor(k)) ids.add(i);
      const hits = [];
      for (const i of [...ids].sort((a, b) => a - b)) {
        const raw = sents[i];
        let bold = false;
        if (words.length > 1 || raw.includes("**")) {   // a sentence without ** can only be a plain match
          const p = parse(raw);
          const sp = spansIn(p, words);
          if (!sp.length) continue;
          bold = sp.some(([a, b]) => p.toks.some((tk) => tk.bold && tk.a >= a && tk.b <= b));
        }
        hits.push({ id: i, story: storyOf[i], n: i - stories[storyOf[i]].a + 1, bold, len: raw.length });
      }
      const isNew = hits.filter((h) => h.bold);
      const rest = hits.filter((h) => !h.bold);
      const best = new Map();
      const fit = (h) => Math.abs(h.len - 80) + (h.len > 200 ? 100 : 0);
      for (const h of rest) {
        const cur = best.get(h.story);
        if (!cur || fit(h) < fit(cur)) best.set(h.story, h);
      }
      const first = [...best.values()].sort((a, b) => a.id - b.id);
      const chosen = new Set(first);
      const more = first.concat(rest.filter((h) => !chosen.has(h)));
      return { total: hits.length, stories: new Set(hits.map((h) => h.story)).size, isNew, more };
    }

    // Text of one hit with the matched words: { plain, spans, form } — form is the word as written there (for the link).
    function view(hit, q) {
      const p = parse(sents[hit.id]);
      const sp = spansIn(p, wordsOf(q));
      return { plain: p.plain, spans: sp.map(([a, b]) => [a, b]), form: sp.length ? p.plain.slice(sp[0][0], sp[0][1]) : "" };
    }

    function link(hit, q) {
      const st = stories[hit.story];
      const se = series[st.z] || {};
      const form = view(hit, q).form || norm(q);
      const tpl = se.link || "#{id}?s={s}&w={w}";
      return (se.url || "") + tpl.replace("{id}", encodeURIComponent(st.id)).replace("{s}", String(hit.n)).replace("{w}", encodeURIComponent(form.toLowerCase()));
    }

    const story = (hit) => {
      const st = stories[hit.story];
      return { id: st.id, title: st.t, series: (series[st.z] || {}).name || "" };
    };
    return { find, view, link, story, has: (q) => find(q).total > 0, size: sents.length, storyCount: stories.length, seriesCount: series.length };
  }

  root.DictStories = { createIndex, parse, norm };
})(globalThis);
