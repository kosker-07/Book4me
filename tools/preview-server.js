const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '..', 'dist', 'index.html');
const port = Number(process.env.PORT || 3000);
http.createServer((req, res) => {
  if (req.url !== '/' && req.url !== '/index.html' && req.url !== '/health') {
    res.writeHead(404); res.end('Not found'); return;
  }
  if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(500); res.end('Preview build unavailable'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(body);
  });
}).listen(port, '0.0.0.0', () => console.log('BED4BOOK preview on', port));
