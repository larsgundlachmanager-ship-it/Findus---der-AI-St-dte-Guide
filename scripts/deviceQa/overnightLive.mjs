/**
 * Overnight live QA runner: queue asks via askServer + capture UI.
 * Usage (after APK install + adb reverse):
 *   node scripts/deviceQa/askServer.mjs   (terminal 1)
 *   node scripts/deviceQa/overnightLive.mjs
 */
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ADB =
  process.env.ANDROID_HOME
    ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe')
    : path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'platform-tools', 'adb.exe');
const OUT = path.join(process.cwd(), '.cursor', 'live9', 'overnight');
const PORT = 8791;

const SCENARIOS = [
  { id: 'wetter', q: 'Wie ist das Wetter gerade hier?', wait: 18 },
  { id: 'steak', q: 'Wo kann ich in der Naehe gut Steak essen?', wait: 28 },
  { id: 'vegan', q: 'Kein Fleisch bitte, ich will vegan essen', wait: 28 },
  { id: 'speisekarte', q: 'Zeig mir die Speisekarte vom ersten Restaurant', wait: 22 },
  { id: 'hotel', q: 'Hotel mit Pool und Sauna unter 500 Euro fuers Wochenende', wait: 30 },
  { id: 'oepnv', q: 'Wie komme ich mit OEPNV zum Hauptbahnhof Hamburg?', wait: 28 },
  { id: 'taxi', q: 'Morgen Flug nach Wien, bitte mit Taxi zum Flughafen', wait: 30 },
  { id: 'flug', q: 'Finde einen Flug nach Lissabon in drei Wochen', wait: 35 },
  { id: 'compound', q: 'Morgen 9 Uhr los nach Hamburg, fruehstuecken, abends Pannfisch mit Elbblick, Michel rauf — wie hoch, wie teuer, was ist das, zwischendurch eine Tour, Sonnenuntergang.', wait: 45 },
  { id: 'kino', q: 'Welche Filme laufen heute Abend im Kino in der Naehe?', wait: 30 },
  { id: 'london', q: 'Ich plane ein Wochenende in London — Hotel mit guter Lage und was muss man gesehen haben?', wait: 35 },
  { id: 'lisbon_trip', q: 'In drei Wochen will ich nach Lissabon. Such bitte Flug, dann Hotel mit Meerblick, und schlag Aktivitaeten und einen Mietwagen oder Taxi vor.', wait: 45 },
  { id: 'modul1', q: 'Wo bin ich hier gerade? Erzaehl mir was Interessantes.', wait: 30 },
  { id: 'tour', q: 'Wir haben eine Stunde — was haben wir hier noch nicht gesehen?', wait: 30 },
  { id: 'nav', q: 'Navigiere mich zum Bahnhof Prisdorf', wait: 25 },
];

function adb(...args) {
  return spawnSync(ADB, args, { encoding: 'utf8' });
}

function postAsk(q) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ ask: q });
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
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve(d));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function capture(label) {
  fs.mkdirSync(OUT, { recursive: true });
  adb('shell', 'screencap', '-p', '/sdcard/live9.png');
  adb('pull', '/sdcard/live9.png', path.join(OUT, `${label}.png`));
  adb('shell', 'uiautomator', 'dump', '/sdcard/ui.xml');
  adb('pull', '/sdcard/ui.xml', path.join(OUT, `${label}.xml`));
  try {
    spawnSync(
      'python',
      [
        path.join(process.cwd(), '.cursor', 'extract_ui.py'),
        path.join(OUT, `${label}.xml`),
      ],
      { encoding: 'utf8' },
    );
  } catch {
    /* soft */
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
  adb('shell', 'am', 'start', '-n', 'de.findus.app/.MainActivity');
  await sleep(3000);

  const report = [];
  for (const s of SCENARIOS) {
    console.log(`\n=== ${s.id}: ${s.q.slice(0, 80)}`);
    try {
      await postAsk(s.q);
    } catch (e) {
      console.error('askServer missing?', e.message);
      report.push({ id: s.id, ok: false, error: 'askServer' });
      continue;
    }
    await sleep(s.wait * 1000);
    capture(s.id);
    const txtPath = path.join(OUT, `${s.id}-text.txt`);
    const txt = fs.existsSync(txtPath)
      ? fs.readFileSync(txtPath, 'utf8')
      : '';
    const failHints = [];
    if (s.id === 'vegan' && /steakhouse|bulls|rindock/i.test(txt)) {
      failHints.push('vegan→steakhouse');
    }
    if (s.id === 'wetter' && /kein Regen bis Abend/i.test(txt) && /Regen jetzt/i.test(txt) === false) {
      // only fail if stale dry while we expect rain HUD elsewhere — soft
    }
    if (s.id === 'speisekarte' && !/Speisekarte|Schließen|WebView|Browser/i.test(txt)) {
      failHints.push('no speisekarte sheet');
    }
    report.push({
      id: s.id,
      ok: failHints.length === 0,
      failHints,
      snippet: txt.split('\n').slice(0, 25).join(' | '),
    });
    console.log(failHints.length ? `FAIL ${failHints}` : 'captured');
  }

  fs.writeFileSync(
    path.join(OUT, 'report.json'),
    JSON.stringify({ at: new Date().toISOString(), report }, null, 2),
  );
  console.log('\nDone →', path.join(OUT, 'report.json'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
