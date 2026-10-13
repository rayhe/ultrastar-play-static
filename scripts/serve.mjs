// Development helper only. Production consists entirely of static files.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(process.argv[2] || '.');
const port = Number(process.env.PORT || 5173);
const mime = {'.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.txt':'text/plain', '.md':'text/plain', '.wav':'audio/wav', '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.mp4':'video/mp4', '.webm':'video/webm', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg'};
http.createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(root, '.' + path);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const info = await stat(file);
    const headers = {'Content-Type': `${mime[extname(file)] || 'application/octet-stream'}`, 'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff', 'Accept-Ranges':'bytes'};
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    let start = 0, end = info.size - 1, status = 200;
    if (range) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end; status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`; }
    if (start > end || start >= info.size) { res.writeHead(416).end(); return; }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') res.end(); else createReadStream(file, {start, end}).pipe(res);
  } catch { res.writeHead(404, {'Content-Type':'text/plain'}).end('Not found'); }
}).listen(port, '0.0.0.0', () => console.log(`UltraStar Play Static: http://localhost:${port}`));
