import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name !== "sw.js") out.push(p);
  }
  return out;
}
const files = await walk("dist");
if (
  files.some(
    (p) =>
      /\.(ppsbank|ppsbackup|pdf|md|jsonl)$/i.test(p) ||
      /\/(Raw|Organized|Working|Reports)\//.test(p),
  )
)
  throw Error("Private corpus found in public build");
const digest = createHash("sha256");
for (const f of files) digest.update(await readFile(f));
digest.update(await readFile(new URL(import.meta.url)));
const version = "pps-" + digest.digest("hex").slice(0, 16),
  urls = files.map((p) => "./" + p.slice(5));
const sw = `const CACHE=${JSON.stringify(version)};const URLS=${JSON.stringify(urls)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>Promise.all(URLS.map(async path=>{const canonical=new URL(path,self.location.href);const fresh=new URL(canonical);fresh.searchParams.set('pps-build',CACHE);const response=await fetch(fresh,{cache:'reload'});if(!response.ok)throw new Error('Offline asset unavailable: '+path);await c.put(canonical,response);})))));
// No skipWaiting or forced reload: an active practice session finishes before upgrade.
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('pps-')&&k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin)return;e.respondWith(caches.open(CACHE).then(async c=>{const hit=await c.match(e.request,{ignoreVary:true});if(hit)return hit;if(e.request.mode==='navigate')return (await c.match(new URL('./index.html',self.location.href),{ignoreVary:true}))||fetch(e.request);return fetch(e.request);}));});`;
await writeFile("dist/sw.js", sw);
console.log(
  "Offline shell:",
  version,
  files.length,
  "files; no private corpus",
);
