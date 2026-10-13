import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
const files = ['index.html','style.css','src','icon.svg','icon-192.png','icon-512.png','manifest.webmanifest','sw.js','_headers','songs','LICENSE','NOTICE.md','licenses','docs'];
await rm('dist', {recursive:true, force:true});
await mkdir('dist');
for (const f of files) await cp(f, join('dist',f), {recursive:true});
let count=0, bytes=0;
async function check(dir) { for (const e of await readdir(dir,{withFileTypes:true})) { const p=join(dir,e.name); if(e.isDirectory()) await check(p); else {const s=await stat(p); if(s.size>25*1024*1024) throw Error(`${p} exceeds Cloudflare Pages' 25 MiB per-file limit. Use local import or a separate static media host.`); count++;bytes+=s.size; } } }
await check('dist');
console.log(`Static build: ${count} files, ${(bytes/1024).toFixed(1)} KiB. Deploy dist/ to Cloudflare Pages. No server runtime.`);
