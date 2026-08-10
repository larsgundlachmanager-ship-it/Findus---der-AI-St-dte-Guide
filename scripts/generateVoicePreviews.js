/**
 * generateVoicePreviews.js
 *
 * Generiert Offline-Hörproben für alle 16 Cartesia-Personas.
 * Usage: node scripts/generateVoicePreviews.js
 *
 * Liest EXPO_PUBLIC_CARTESIA_API_KEY aus .env
 * Sample-Texte: SSOT aus src/constants/cartesiaVoices.ts
 * Schreibt: src/assets/audio/voices/<id>.mp3
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'src', 'assets', 'audio', 'voices');
const ENV_PATH = path.join(ROOT, '.env');
const VOICES_TS = path.join(ROOT, 'src', 'constants', 'cartesiaVoices.ts');

const CARTESIA_URL = 'https://api.cartesia.ai/tts/bytes';
const CARTESIA_VERSION = '2025-04-16';
const MODEL_ID = 'sonic-3.5';

/** Parst CARTESIA_VOICES aus der TS-SSOT (kein Hardcode-Drift). */
function loadVoicesFromTs() {
  const raw = fs.readFileSync(VOICES_TS, 'utf8');
  const block = raw.match(
    /export const CARTESIA_VOICES[\s\S]*?= \[([\s\S]*?)\] as const/,
  );
  if (!block) throw new Error('CARTESIA_VOICES nicht in cartesiaVoices.ts gefunden');
  const voices = [];
  // Einzelne Objekt-Blöcke — Kommentare zwischen Feldern erlaubt
  const objRe = /\{([^{}]*)\}/g;
  let obj;
  while ((obj = objRe.exec(block[1]))) {
    const body = obj[1];
    const id = body.match(/\bid:\s*'([^']+)'/)?.[1];
    const cartesiaVoiceId = body.match(/\bcartesiaVoiceId:\s*'([^']+)'/)?.[1];
    const name = body.match(/\bname:\s*'([^']+)'/)?.[1];
    const sampleM = body.match(/\bsample:\s*'((?:\\'|[^'])*)'/);
    if (!id || !cartesiaVoiceId || !name || !sampleM) continue;
    voices.push({
      id,
      cartesiaVoiceId,
      name,
      sample: sampleM[1]
        .replace(/\\'/g, "'")
        .replace(/\\n/g, '\n')
        .replace(/\\u2014/g, '—'),
    });
  }
  if (voices.length < 16) {
    throw new Error(
      `Zu wenige Stimmen geparst (${voices.length}/16) — Regex/SSOT prüfen`,
    );
  }
  return voices;
}

function loadEnvKey() {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(`.env nicht gefunden: ${ENV_PATH}`);
  }
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const m = raw.match(/^\s*EXPO_PUBLIC_CARTESIA_API_KEY\s*=\s*(.+)\s*$/m);
  if (!m) throw new Error('EXPO_PUBLIC_CARTESIA_API_KEY fehlt in .env');
  const key = m[1].trim().replace(/^["']|["']$/g, '');
  if (!key || key.includes('your-')) {
    throw new Error('EXPO_PUBLIC_CARTESIA_API_KEY ist Platzhalter / leer');
  }
  return key;
}

function synthesizeMp3(apiKey, voiceId, transcript) {
  const body = JSON.stringify({
    model_id: MODEL_ID,
    transcript,
    language: 'de',
    voice: { mode: 'id', id: voiceId },
    output_format: {
      container: 'mp3',
      sample_rate: 44100,
      bit_rate: 128000,
    },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      CARTESIA_URL,
      {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          Authorization: `Bearer ${apiKey}`,
          'Cartesia-Version': CARTESIA_VERSION,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new Error(
                `Cartesia ${res.statusCode}: ${buf.toString('utf8').slice(0, 300)}`,
              ),
            );
            return;
          }
          if (buf.length < 64) {
            reject(new Error('Leere Audio-Antwort'));
            return;
          }
          resolve(buf);
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const apiKey = loadEnvKey();
  const VOICES = loadVoicesFromTs();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const onlyMissing = process.argv.includes('--missing');
  const onlyId = process.argv
    .find((a) => a.startsWith('--only='))
    ?.slice('--only='.length);
  let targets = onlyMissing
    ? VOICES.filter((v) => !fs.existsSync(path.join(OUT_DIR, `${v.id}.mp3`)))
    : VOICES;
  if (onlyId) {
    targets = VOICES.filter((v) => v.id === onlyId);
    if (!targets.length) throw new Error(`Unbekannte Stimme: ${onlyId}`);
  }

  console.log(`[previews] SSOT: ${VOICES_TS} (${VOICES.length} Stimmen)`);
  console.log(`[previews] Ziel: ${OUT_DIR}`);
  console.log(
    `[previews] ${targets.length} Stimmen${onlyMissing ? ' (nur fehlende)' : ''}…`,
  );

  let ok = 0;
  let fail = 0;

  for (const v of targets) {
    const outPath = path.join(OUT_DIR, `${v.id}.mp3`);
    process.stdout.write(`[previews] ${v.id} (${v.name}) … `);
    let succeeded = false;
    for (let attempt = 1; attempt <= 3 && !succeeded; attempt++) {
      try {
        if (attempt > 1) {
          process.stdout.write(`retry ${attempt} … `);
          await new Promise((r) => setTimeout(r, 800 * attempt));
        }
        const buf = await synthesizeMp3(apiKey, v.cartesiaVoiceId, v.sample);
        fs.writeFileSync(outPath, buf);
        console.log(`OK (${buf.length} B) — ${v.sample.slice(0, 48)}…`);
        ok += 1;
        succeeded = true;
      } catch (err) {
        if (attempt === 3) {
          console.log(`FAIL: ${err.message || err}`);
          fail += 1;
        }
      }
    }
  }

  console.log(`[previews] fertig: ${ok} ok, ${fail} fehlgeschlagen`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[previews] fatal:', err);
  process.exit(1);
});
