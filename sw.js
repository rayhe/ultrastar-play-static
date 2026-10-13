// App shell only. Never cache microphone data, user songs, or remote media here.
// Bump CACHE for every release. An update activates after old tabs are closed.
const CACHE='ultrastar-static-shell-v0.1.0';
const SHELL=['./','./index.html','./style.css','./icon.svg','./icon-192.png','./icon-512.png','./manifest.webmanifest','./songs/catalog.json','./src/app.js','./src/song.js','./src/pitch.js','./src/scoring.js','./src/pitch-worker.js','./src/capture-worklet.js','./src/microphone.js','./src/library.js','./src/zip.js','./src/demo.js','./src/renderer.js'];
const paths=new Set(SHELL.map(path=>new URL(path,self.registration.scope).pathname));
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('ultrastar-static-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||request.headers.has('Range')||!paths.has(url.pathname))return;
  event.respondWith((async()=>{const cached=await caches.match(request,{ignoreSearch:true});if(cached)return cached;return fetch(request);})());
});
