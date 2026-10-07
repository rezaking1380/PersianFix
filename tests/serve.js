// Zero-dependency static file server for the PersianFix feedback loop.
// Usage: node tests/serve.js [port]
// Serves the extension root so fixtures can <script src="../../content.js">.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2] || 8731);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const target = path.join(ROOT, rel === '/' ? 'tests/fixtures/claude-like.html' : rel);
  if (!target.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(target, (err, buf) => {
    if (err) { res.writeHead(404).end('not found: ' + rel); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(target)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(PORT, () => console.log('PersianFix loop server on http://127.0.0.1:' + PORT + '/'));