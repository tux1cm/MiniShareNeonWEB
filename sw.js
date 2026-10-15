// Static shell only; NEVER cache API calls or bearer tokens.
const CACHE='minishare-p2w3b-static-v1';
const ASSETS=['./','./index.html','./app.js','./style.css','./assets/minishare.ico','./assets/minishare.png','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const req=event.request;const url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin)return;
 event.respondWith(fetch(req).then(res=>{if(res.ok&&ASSETS.some(a=>new URL(a,self.registration.scope).pathname===url.pathname)){const c=res.clone();caches.open(CACHE).then(cache=>cache.put(req,c));}return res;}).catch(()=>caches.match(req)));
});
