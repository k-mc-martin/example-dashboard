import http from 'node:http';
import { feedNames, providerEvent } from './providers.mjs';

http
  .createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && req.url === '/health') return res.end('{"ok":true}');
    const name = req.url?.split('/')[2];
    if (req.method !== 'POST' || !feedNames.includes(name) || req.url !== '/v1/' + name) {
      res.writeHead(404);
      return res.end('{}');
    }
    try {
      const parts = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1024) throw Error('oversize');
        parts.push(chunk);
      }
      const snapshot = providerEvent(name, JSON.parse(Buffer.concat(parts).toString('utf8')));
      res.end(JSON.stringify(snapshot));
    } catch {
      res.writeHead(400);
      res.end('{"error":"Invalid simulation request"}');
    }
  })
  .listen(
    Number(process.env.DUPDASH_PROVIDER_PORT || 5791),
    process.env.DUPDASH_PROVIDER_BIND || '127.0.0.1',
  );
