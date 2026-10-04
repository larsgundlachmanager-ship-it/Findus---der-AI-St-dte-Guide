/**
 * Ask an die Dev-Queue (Phone pollt via adb reverse :8791).
 * Usage: node scripts/deviceQa/ask.mjs "Wo waren wir gestern essen?"
 */
import http from 'node:http';

const PORT = Number(process.env.FINDUS_ASK_PORT || 8791);
const q = process.argv.slice(2).join(' ').trim();
if (!q) {
  console.error('Usage: node scripts/deviceQa/ask.mjs "<frage>"');
  process.exit(1);
}

const body = JSON.stringify({ q });
const req = http.request(
  {
    hostname: '127.0.0.1',
    port: PORT,
    path: '/ask',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  },
  (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      console.log(Buffer.concat(chunks).toString('utf8'));
      if (res.statusCode && res.statusCode >= 400) process.exit(1);
    });
  },
);
req.on('error', (e) => {
  console.error(e.message);
  process.exit(1);
});
req.write(body);
req.end();
