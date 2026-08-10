// @ts-nocheck
/**
 * Pre-Rendered Audio — Piper CLI samples (Cartesia is live TTS at runtime).
 */
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');
const { spawnSync, execSync } = require('child_process') as typeof import('child_process');

const ROOT = path.resolve(__dirname, '..');
const PIPER_DIR = path.join(ROOT, 'src', 'assets', 'piper');
const AUDIO_ROOT = path.join(ROOT, 'src', 'assets', 'audio');
const SAMPLES_OUT = path.join(AUDIO_ROOT, 'samples');
const TOOLS_DIR = path.join(ROOT, 'native-assets', 'piper-tools');
const PIPER_EXE = path.join(TOOLS_DIR, 'piper', 'piper.exe');

const INTRO_TEXT =
  'Hallo und herzlich willkommen. Ich bin Findus. Ich bin kein normaler Audioguide, der einfach nur Texte vorliest. Ich bin das, was du aus mir machst. Gleich darfst du entscheiden, wie ich klingen soll. Lass uns gemeinsam dein Profil anlegen – damit ich dir die Stadt genauso erklären kann, wie es perfekt zu dir passt. Ich freue mich auf dich.';

const PIPER_VOICES = [
  {
    id: 'standard_m',
    model: 'de_DE-thorsten-medium',
    lengthScale: 1.03,
    sample:
      'Moin! Schön, dass du da bist. Ich bin dein Begleiter für unterwegs und bringe die Geschichten direkt auf den Punkt – ganz ohne Schnickschnack. Egal ob Altstadt, Bahnhof oder historische Orte: Wenn du Bock auf eine entspannte, lebendige Tour hast, wähl mich einfach aus und wir düsen gemeinsam los!',
  },
  {
    id: 'dorfaeltester',
    model: 'de_DE-karl-medium',
    sample:
      'Na, mein Lieber! Weißt du, ich kenne hier wirklich jeden einzelnen Stein und jede alte Gasse. Aber keine Sorge, ich schlafe beim Erzählen nicht ein! Ich hab immer noch ordentlich Humor und die besten Anekdoten von früher auf Lager. Schnapp dir deinen Krückstock und lass uns einfach losgehen!',
  },
  {
    id: 'gen_z',
    model: 'de_DE-thorsten_emotional',
    speaker: 6,
    lengthScale: 0.92,
    pitch: 1.2,
    sample:
      'Yo, real talk: trockenes Museumsgelaber? Absolut kein Bock. Wir checken die coolsten Spots, haben richtig guten Vibe, und ich baller dir die besten Fun Facts und Insider raus. Safe, wähl mich – und ab geht’s!',
  },
    {
    id: 'historiker',
    model: 'de_DE-m_aishel-medium',
    lengthScale: 0.96,
    sample:
      'Schau mal! Vor dir liegt die Geschichte zum Anfassen. Kein staubiges Buch, sondern echte Orte, echte Menschen, echte Geheimnisse. Geh einfach drauf zu, und ich erzähl dir, was dahintersteckt — präzise, spannend, und nur für dich!',
  },
  {
    id: 'erzaehler',
    model: 'de_DE-thorsten-high',
    sample:
      'Tritt näher... Und mach dich bereit. Wenn du deine Tour wie in einem epischen Blockbuster-Film erleben willst, dann bin ich deine Stimme.',
  },
];

function prepSampleText(text) {
  let s = text;
  const pairs = [
    [/fun facts/gi, 'Fan Fäkts'],
    [/\bfreshen\b/gi, 'freschen'],
    [/\bvibe\b/gi, 'Vaib'],
    [/\bsafe\b/gi, 'seef'],
  ];
  for (const [re, rep] of pairs) s = s.replace(re, rep);
  return s.replace(/\s+/g, ' ').trim();
}

function ensurePiperCli() {
  if (fs.existsSync(PIPER_EXE)) return PIPER_EXE;
  const zipPath = path.join(TOOLS_DIR, 'piper_windows_amd64.zip');
  const url =
    'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';
  fs.mkdirSync(TOOLS_DIR, { recursive: true });
  execSync(
    `powershell -NoProfile -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${zipPath}'"`,
    { stdio: 'inherit' },
  );
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${TOOLS_DIR}'"`,
    { stdio: 'inherit' },
  );
  return PIPER_EXE;
}

function synthesize(piperBin, modelBase, text, outWav, opts = {}) {
  const onnx = path.join(PIPER_DIR, `${modelBase}.onnx`);
  if (!fs.existsSync(onnx)) throw new Error(`Modell fehlt: ${onnx}`);
  const args = ['--model', onnx, '--output_file', outWav];
  if (opts.speaker != null) args.push('--speaker', String(opts.speaker));
  if (opts.lengthScale != null) {
    args.push('--length_scale', String(opts.lengthScale));
  }
  const result = spawnSync(piperBin, args, {
    input: text,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    throw new Error(`Piper exit ${result.status}`);
  }
  if (opts.pitch != null && Math.abs(opts.pitch - 1) >= 0.02) {
    pitchShiftWavFile(outWav, opts.pitch);
  }
  console.log(`  OK ${path.basename(outWav)}${opts.pitch ? ` pitch=${opts.pitch}` : ''}`);
}

/** Mono PCM16 WAV: Pitch >1 = höher/jünger (Resample). */
function pitchShiftWavFile(wavPath, pitch) {
  const buf = fs.readFileSync(wavPath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return;
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  if (channels !== 1 || bits !== 16) {
    console.warn(`  skip pitch: ${path.basename(wavPath)} not mono PCM16`);
    return;
  }
  const dataSize = buf.readUInt32LE(40);
  const n = dataSize / 2;
  const samples = new Int16Array(n);
  for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(44 + i * 2);
  const factor = Math.max(0.85, Math.min(1.35, pitch));
  const outLen = Math.max(1, Math.floor(n / factor));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * factor;
    const i0 = Math.floor(src);
    const f = src - i0;
    const a = samples[i0] ?? 0;
    const b = samples[Math.min(i0 + 1, n - 1)] ?? a;
    out[i] = Math.round(a + (b - a) * f);
  }
  const outData = outLen * 2;
  const outBuf = Buffer.alloc(44 + outData);
  buf.copy(outBuf, 0, 0, 44);
  outBuf.writeUInt32LE(36 + outData, 4);
  outBuf.writeUInt32LE(sampleRate, 24);
  outBuf.writeUInt32LE(sampleRate * 2, 28);
  outBuf.writeUInt32LE(outData, 40);
  for (let i = 0; i < outLen; i++) outBuf.writeInt16LE(out[i], 44 + i * 2);
  fs.writeFileSync(wavPath, outBuf);
}

async function main() {
  console.log('[preRenderAudio] Bake — Cartesia/Piper samples');
  fs.mkdirSync(SAMPLES_OUT, { recursive: true });

  const piperBin = ensurePiperCli();
  synthesize(
    piperBin,
    'de_DE-thorsten-medium',
    INTRO_TEXT,
    path.join(AUDIO_ROOT, 'intro.wav'),
    { lengthScale: 1.03 },
  );

  for (const v of PIPER_VOICES) {
    console.log(`[preRenderAudio] Piper ${v.id}…`);
    synthesize(
      piperBin,
      v.model,
      prepSampleText(v.sample),
      path.join(SAMPLES_OUT, `${v.id}.wav`),
      { speaker: v.speaker, lengthScale: v.lengthScale, pitch: v.pitch },
    );
  }

  console.log('[preRenderAudio] Fertig (Cartesia samples).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
