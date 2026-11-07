// Runs the search index off the main thread so typing and scrolling stay smooth on a phone (F-218).
self.window = self;
importScripts("search.js", "data.js");
const index = self.DictSearch.createIndex(self.DICT.e);

self.onmessage = ({ data }) => {
  if (data.type === "add") index.addPersonal(data.query, data.id);
  if (data.type === "search") {
    const hits = index.search(data.q, { limit: data.limit }).map((h) => ({ id: h.id, tier: h.tier, matched: h.matched }));
    self.postMessage({ seq: data.seq, hits });
  }
};
self.postMessage({ ready: true });
