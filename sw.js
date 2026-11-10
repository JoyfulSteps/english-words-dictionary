// Offline support (F-218). 1c7f93dd48 is filled in by tools/build_dictionary.py, so each build refreshes the app files.
const BUILD = "1c7f93dd48";
const APP_CACHE = "dict-app-" + BUILD;
const AUDIO_CACHE = "dict-audio-v1";
const APP_FILES = ["./", "index.html", "dict.css", "dict.js", "search.js", "search-worker.js", "data.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys()
    .then((names) => Promise.all(names.filter((n) => n.startsWith("dict-app-") && n !== APP_CACHE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.endsWith(".mp3")) {
    ev.respondWith(caches.open(AUDIO_CACHE).then(async (c) => {
      const hit = await c.match(url.href);
      if (hit) return rangeOf(hit, ev.request);
      const res = await fetch(url.href);
      if (res.ok) await c.put(url.href, res.clone());
      return res;
    }));
    return;
  }
  ev.respondWith(caches.match(ev.request, { ignoreSearch: true }).then((hit) => hit || fetch(ev.request)));
});

// Chrome asks for audio with a Range header; a cached 200 must be cut down to a 206 or playback can fail.
async function rangeOf(response, request) {
  const range = request.headers.get("range");
  if (!range) return response;
  const body = await response.arrayBuffer();
  const m = /bytes=(\d+)-(\d*)/.exec(range);
  const start = m ? +m[1] : 0;
  const end = m && m[2] ? +m[2] : body.byteLength - 1;
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: { "Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${body.byteLength}`, "Content-Length": String(end - start + 1) },
  });
}
