/**
 * Lädt Kokoro-DE-Assets nach native-assets/kokoro/ (für APK-Einbindung).
 * Einmalig ausführen: npm run fetch:kokoro
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'native-assets', 'kokoro');
const VOICES_OUT = path.join(OUT, 'voices');

const FILES = [
  {
    url: 'https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin/resolve/main/kokoro-martin.onnx',
    dest: path.join(OUT, 'kokoro-martin.onnx'),
    minBytes: 50_000_000,
  },
  {
    url: 'https://huggingface.co/Godelaune/Kokoro-82M-ONNX-German-Martin/resolve/main/voices-martin.npz',
    dest: path.join(OUT, 'voices-martin.npz'),
    minBytes: 50_000,
  },
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;

    const req = client.get(
      url,
      {
        headers: { 'User-Agent': 'findus-kokoro-fetch/1.0' },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          file.close();
          fs.unlinkSync(dest);
          download(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const total = Number(res.headers['content-length'] || 0);
        let got = 0;
        let lastPct = -1;
        res.on('data', (chunk) => {
          got += chunk.length;
          if (total > 0) {
            const pct = Math.floor((got / total) * 100);
            if (pct !== lastPct && pct % 5 === 0) {
              lastPct = pct;
              process.stdout.write(
                `\r  ${path.basename(dest)}: ${pct}% (${Math.round(got / 1e6)} MB)`,
              );
            }
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            process.stdout.write('\n');
            resolve();
          });
        });
      },
    );
    req.on('error', (err) => {
      file.close();
      try {
        fs.unlinkSync(dest);
      } catch {
        // ignore
      }
      reject(err);
    });
  });
}

async function main() {
  ensureDir(OUT);
  ensureDir(VOICES_OUT);

  for (const item of FILES) {
    if (fs.existsSync(item.dest)) {
      const size = fs.statSync(item.dest).size;
      if (size >= item.minBytes) {
        console.log(
          `OK (vorhanden): ${path.basename(item.dest)} (${Math.round(size / 1e6)} MB)`,
        );
        continue;
      }
      console.log(`Zu klein, neu laden: ${path.basename(item.dest)}`);
      fs.unlinkSync(item.dest);
    }
    console.log(`Download: ${item.url}`);
    await download(item.url, item.dest);
    const size = fs.statSync(item.dest).size;
    if (size < item.minBytes) {
      throw new Error(
        `${path.basename(item.dest)} zu klein (${size} bytes)`,
      );
    }
    console.log(
      `Fertig: ${path.basename(item.dest)} (${Math.round(size / 1e6)} MB)`,
    );
  }

  console.log('\nAssets bereit unter native-assets/kokoro/');
  console.log('Als Nächstes: npx expo prebuild && npx expo run:android');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
