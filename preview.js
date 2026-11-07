'use strict';

/* Tiny static file server so you can run the site locally before pushing.
   The real app has no server: GitHub Pages serves public/ and the browser holds
   the data. This only exists so `npm start` works on your machine. */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 12000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveSafe(pathname) {
  const clean = decodeURIComponent(pathname).split('?')[0];
  const target = path.join(ROOT, path.normalize(clean));
  return target.startsWith(ROOT) ? target : null;
}

const server = http.createServer((req, res) => {
  let filePath = resolveSafe(req.url === '/' ? '/index.html' : req.url);
  if (!filePath) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        // Fall back to the 404 page, the way GitHub Pages does.
        const fallback = path.join(ROOT, '404.html');
        fs.readFile(fallback, (fbErr, fbData) => {
          if (fbErr) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('Not found');
          }
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(fbData);
        });
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`DISCIPLINE preview on http://localhost:${PORT}`);
    console.log('Static preview only — the published site stores everything in your browser.');
  });
}

module.exports = server;
