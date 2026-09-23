// Service Worker: macht den Simulator offline nutzbar und installierbar.
// Strategie "Netzwerk zuerst, Cache als Rueckfall": online kommt immer der
// aktuelle Stand vom Server (kein Versionshochzaehlen bei jeder Aenderung
// noetig), offline wird die zuletzt geladene Fassung aus dem Cache bedient.
// Neue Dateien der App gehoeren in APP_FILES, damit sie schon beim ersten
// Besuch fuer den Offline-Betrieb vorgeladen werden.
const CACHE = 'h8-h9-v1';
const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/panel.js',
  'js/h8.js',
  'js/cpu.js',
  'js/h9.js',
  'js/wire.js',
  'js/cassette.js',
  'js/programs.js',
  'js/audio.js',
  'js/data/base64.js',
  'js/data/pam8-rom.js',
  'js/data/extended-basic-tape.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=> c.addAll(APP_FILES)).then(()=> self.skipWaiting()));
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys()
      .then(keys=> Promise.all(keys.filter(k=> k!==CACHE).map(k=> caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', (e)=>{
  const req = e.request;
  if(req.method!=='GET' || new URL(req.url).origin!==location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res=>{
        if(res.ok){ const copy=res.clone(); caches.open(CACHE).then(c=> c.put(req, copy)); }
        return res;
      })
      .catch(()=> caches.match(req, {ignoreSearch:true})
        .then(hit=> hit || (req.mode==='navigate' ? caches.match('index.html') : Response.error())))
  );
});
