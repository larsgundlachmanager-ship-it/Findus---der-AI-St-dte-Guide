/**
 * Dev QA: lokale Ask-Queue fürs Handy.
 * App (DEV) pollt http://127.0.0.1:8791/next
 * PC: node scripts/deviceQa/askServer.mjs
 *     curl -X POST http://127.0.0.1:8791/ask -d "Bring mich zum Baecker"
 */
import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.FINDUS_ASK_PORT || 8791);
const queue = [];

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && u.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, queued: queue.length }));
    return;
  }

  if (req.method === 'GET' && u.pathname === '/next') {
    const item = queue.shift() || null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ask: item }));
    if (item) console.log('[askServer] delivered:', item.slice(0, 120));
    return;
  }

  if (req.method === 'POST' && (u.pathname === '/ask' || u.pathname === '/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    let text = raw;
    try {
      const j = JSON.parse(raw);
      text = String(j.q || j.text || j.ask || raw);
    } catch {
      /* plain text body */
    }
    const q = (u.searchParams.get('q') || text || '').trim();
    if (!q) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'empty' }));
      return;
    }
    queue.push(q);
    console.log('[askServer] queued:', q.slice(0, 120), `(n=${queue.length})`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, queued: queue.length }));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[askServer] http://127.0.0.1:${PORT}  POST /ask  GET /next`);
});
