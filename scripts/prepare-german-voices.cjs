/**
 * Bereitet Studio-Stimmen vor: nur DE-GGUF + Martin-ONNX.
 *
 * npm run prepare:voices
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'native-assets', 'kokoro');
const VOICES_OUT = path.join(OUT, 'voices');
const TMP = path.join(OUT, '_tmp_voices');

const STYLE_DIM = 256;
const STYLE_FRAMES = 510;
const NEEDED = STYLE_FRAMES * STYLE_DIM;
const NEEDED_BYTES = NEEDED * 4;


/** ONNX + NPZ + 4 native DE-GGUF (Thorsten/Eva/Karl/Puck) — keine EN-Voices. */
const DOWNLOAD_FILES = [
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
  {
    url: 'https://huggingface.co/cstr/kokoro-voices-GGUF/resolve/main/kokoro-voice-dm_martin.gguf',
    dest: path.join(TMP, 'dm_martin.gguf'),
    minBytes: 100_000,
  },
  {
    url: 'https://huggingface.co/cstr/kokoro-voices-GGUF/resolve/main/kokoro-voice-df_victoria.gguf',
    dest: path.join(TMP, 'df_victoria.gguf'),
    minBytes: 100_000,
  },
  {
    url: 'https://huggingface.co/cstr/kokoro-voices-GGUF/resolve/main/kokoro-voice-dm_bernd.gguf',
    dest: path.join(TMP, 'dm_bernd.gguf'),
    minBytes: 100_000,
  },
];

const GGUF_TO_BIN = [
  ['dm_martin.gguf', 'de_thorsten.bin'],
  ['df_victoria.gguf', 'de_eva.bin'],
  ['dm_bernd.gguf', 'de_karl.bin'],
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const file = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;
    const req = client.get(
      url,
      { headers: { 'User-Agent': 'findus-kokoro-fetch/2.0' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {
            /* ignore */
          }
          download(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          file.close();
          try {
            fs.unlinkSync(dest);
          } catch {
            /* ignore */
          }
          reject(new Error(`HTTP ${res.statusCode} ${url}`));
          return;
        }
        const total = Number(res.headers['content-length'] || 0);
        let got = 0;
        let last = -1;
        res.on('data', (chunk) => {
          got += chunk.length;
          if (total > 0) {
            const pct = Math.floor((got / total) * 100);
            if (pct !== last && pct % 10 === 0) {
              last = pct;
              process.stdout.write(`\r  ${path.basename(dest)}: ${pct}%`);
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
        /* ignore */
      }
      reject(err);
    });
  });
}

function stylesFromGguf(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < NEEDED_BYTES) {
    throw new Error(`GGUF zu klein: ${filePath}`);
  }
  const slice = buf.subarray(buf.length - NEEDED_BYTES);
  return Buffer.from(slice);
}

function expandOrTrimFloat32(buf) {
  const floats = new Float32Array(
    buf.buffer,
    buf.byteOffset,
    Math.floor(buf.byteLength / 4),
  );
  if (floats.length >= NEEDED) {
    return Buffer.from(floats.buffer, floats.byteOffset, NEEDED_BYTES);
  }
  if (floats.length >= STYLE_DIM) {
    const out = new Float32Array(NEEDED);
    const base = floats.subarray(0, STYLE_DIM);
    for (let i = 0; i < STYLE_FRAMES; i++) {
      out.set(base, i * STYLE_DIM);
    }
    return Buffer.from(out.buffer);
  }
  throw new Error(`Voice zu klein: ${floats.length}`);
}

async function stylesFromNpz(filePath) {
  const data = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(data);
  const npyName = Object.keys(zip.files).find(
    (n) => n.toLowerCase().endsWith('.npy') && !zip.files[n].dir,
  );
  if (!npyName) throw new Error('NPZ ohne .npy');
  const ab = await zip.files[npyName].async('nodebuffer');
  if (ab[0] !== 0x93) throw new Error('ungültiges NPY');
  const headerLen = ab.readUInt16LE(8);
  const offset = 10 + headerLen;
  const payload = ab.subarray(offset);
  return expandOrTrimFloat32(payload);
}

async function main() {
  ensureDir(OUT);
  ensureDir(VOICES_OUT);
  ensureDir(TMP);

  for (const item of DOWNLOAD_FILES) {
    if (fs.existsSync(item.dest) && fs.statSync(item.dest).size >= item.minBytes) {
      console.log(`OK (cache) ${path.basename(item.dest)}`);
      continue;
    }
    console.log(`Download ${path.basename(item.dest)}…`);
    try {
      await download(item.url, item.dest);
    } catch (e) {
      console.warn(`WARN ${path.basename(item.dest)}:`, e.message);
    }
  }

  // Nur native DE-Voice-Packs (de_thorsten/eva/karl/puck)
  for (const [ggufName, binName] of GGUF_TO_BIN) {
    const src = path.join(TMP, ggufName);
    const dest = path.join(VOICES_OUT, binName);
    if (!fs.existsSync(src)) {
      console.warn(`SKIP ${ggufName}`);
      continue;
    }
    const raw = stylesFromGguf(src);
    const bin = expandOrTrimFloat32(raw);
    fs.writeFileSync(dest, bin);
    console.log(`OK ${binName} (${bin.length} bytes)`);
  }

  const thor = path.join(VOICES_OUT, 'de_thorsten.bin');
  if (!fs.existsSync(thor)) {
    const npz = path.join(OUT, 'voices-martin.npz');
    if (fs.existsSync(npz)) {
      const bin = await stylesFromNpz(npz);
      fs.writeFileSync(thor, bin);
      console.log('OK de_thorsten.bin ← voices-martin.npz');
    }
  }

  console.log('Stimmen bereit:', VOICES_OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
