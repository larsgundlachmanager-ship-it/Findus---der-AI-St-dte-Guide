/**
 * Bezahlter Inspiration-Katalog-Batch (Gemini + Search).
 * Schreibt src/reisebuero/research/inspirationHarvest.pack.json
 *
 * Usage:
 *   npm run reisebuero:inspiration-batch
 *   npm run reisebuero:inspiration-batch -- --vibes adventure,family --pro
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PACK_PATH = path.join(
  ROOT,
  'src',
  'reisebuero',
  'research',
  'inspirationHarvest.pack.json',
);

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2]!.trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

function parseArgs(argv: string[]) {
  const vibesArg = argv.find((a) => a.startsWith('--vibes='))?.slice('--vibes='.length);
  const usePro = argv.includes('--pro');
  const vibes = vibesArg
    ? vibesArg
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : undefined;
  return { vibes, usePro };
}

async function main() {
  const { vibes, usePro } = parseArgs(process.argv.slice(2));
  const {
    runInspirationCatalogBatch,
    ALL_INSPIRATION_VIBES,
  } = await import('../src/reisebuero/research/inspirationCatalog');

  const selected = vibes?.length
    ? vibes.filter((v) =>
        (ALL_INSPIRATION_VIBES as readonly string[]).includes(v),
      )
    : [...ALL_INSPIRATION_VIBES];

  if (!selected.length) {
    console.error('No valid vibes. Allowed:', ALL_INSPIRATION_VIBES.join(', '));
    process.exit(1);
  }

  console.log(
    `[inspiration-batch] vibes=${selected.join(',')} pro=${usePro ? 'yes' : 'lite'}`,
  );

  const report = await runInspirationCatalogBatch({
    vibes: selected as import('../src/reisebuero/research/inspirationCatalog').InspirationVibe[],
    usePro,
    persistCache: false,
  });

  const grounded = report.perVibe.reduce((n, r) => n + r.items.length, 0);
  if (grounded < 3) {
    for (const r of report.perVibe) {
      console.error(`  · ${r.vibe}: ${r.items.length}${r.notes ? ` — ${r.notes}` : ''}`);
    }
    console.error(
      `[inspiration-batch] too few grounded hits (${grounded}) — check EXPO_PUBLIC_GEMINI_API_KEY / network`,
    );
    process.exit(2);
  }

  const pack = {
    version: 1,
    generatedAtMs: report.packPayload.generatedAtMs,
    note: `reisebuero inspiration batch · ${selected.join('+')} · ${usePro ? 'pro' : 'lite'}`,
    items: report.packPayload.items,
  };
  fs.writeFileSync(PACK_PATH, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  console.log(
    `[inspiration-batch] wrote ${pack.items.length} items → ${path.relative(ROOT, PACK_PATH)}`,
  );
  for (const r of report.perVibe) {
    console.log(`  · ${r.vibe}: ${r.items.length}${r.notes ? ` — ${r.notes}` : ''}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
