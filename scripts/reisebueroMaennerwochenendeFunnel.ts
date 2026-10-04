/**
 * Headless Männerwochenende-Funnel mit Live-APIs (kein UI/Gerät).
 *
 * Usage:
 *   npx tsx scripts/reisebueroMaennerwochenendeFunnel.ts
 *   npx tsx scripts/reisebueroMaennerwochenendeFunnel.ts --out .cursor/live9/maennerwochenende-funnel.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
require('./reisebueroNodeMocks.cjs');

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

// RN/Expo globals that store/funnel may touch
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const CHUNKS = [
  'Männerwochenende, 3 Personen, langes Wochenende',
  'Donnerstag 15.10. ab 16:30 Flieger, Bahn ab 14:15 auch ok, Freitag entspannt je nach Preis; zurück Montag oder besser Dienstag',
  'Fliegen von Hamburg, Berlin, Bremen oder Hannover — günstigste',
  'Warm, max 400 Euro p.P.; All-Inclusive-Hotel am geilsten, sonst Apartment — kein normales Hotel mit Halbpension; günstiges Bier, Party, Pool',
  'Bitte Transfer Flughafen zur Unterkunft klar mit Preis; wenn Mietwagen sinnvoll, sag das ehrlich. Wunsch: Padel spielen und gute Clubs — belegt raussuchen. Pauschalreise nur wenn sie wirklich besser passt, sonst einzeln buchen.',
];

type IdealScore = {
  place: string;
  packageHardOk: boolean;
  wishHardOk: boolean;
  packageIssues: string[];
  wishIssues: string[];
  hasStay: boolean;
  hasFlight: boolean;
  hasTransfer: boolean;
  hasOutboundBeat: boolean;
  hasTransferBeat: boolean;
  metWishChapters: number;
  hasPackageCompare: boolean;
  noAbPrice: boolean;
  buyInEur: number | null;
  stayPriceEur: number | null;
  flightPriceEur: number | null;
  transferEur: number | null;
  speechLen: number;
};

function parseArgs(argv: string[]) {
  const outArg = argv.find((a) => a.startsWith('--out='))?.slice('--out='.length);
  const out =
    outArg ||
    path.join(ROOT, '.cursor', 'live9', 'maennerwochenende-funnel.json');
  return { out };
}

function scoreOption(
  opt: import('../src/reisebuero/types').ReiseOption,
  ledger: import('../src/reisebuero/types').ReiseLedger,
  checkPackageComplete: typeof import('../src/reisebuero/research/qualityGates').checkPackageComplete,
  checkWishesMet: typeof import('../src/reisebuero/research/qualityGates').checkWishesMet,
): IdealScore {
  const pkg = checkPackageComplete(opt, ledger);
  const wishes = checkWishesMet(opt, ledger);
  const blob = `${opt.whyBlurb ?? ''} ${opt.speechSummary ?? ''} ${opt.experienceSummary ?? ''} ${(opt.decisionNotes ?? []).join(' ')}`;
  const hasPackageCompare =
    Boolean(opt.packageBookUrl) ||
    (opt.bookingChecklist ?? []).some((b) =>
      /check24|pauschal|package/i.test(`${b.label} ${b.kind} ${b.url ?? ''}`),
    ) ||
    /pauschal|einzeln|check24/i.test(blob);
  return {
    place: opt.placeName || opt.title || opt.id,
    packageHardOk: pkg.hardOk,
    wishHardOk: wishes.hardOk,
    packageIssues: pkg.issues.map((i) => `${i.severity}:${i.code}`),
    wishIssues: wishes.issues.map((i) => `${i.severity}:${i.code}`),
    hasStay: Boolean(opt.stayName || opt.stays?.[0]?.name) && (opt.stayPriceEur ?? opt.stays?.[0]?.priceEur ?? 0) > 0,
    hasFlight:
      opt.flightPriceEur != null ||
      Boolean(opt.flightBookUrl) ||
      (opt.transports ?? []).some((t) => t.kind === 'flight'),
    hasTransfer: (opt.transferEur != null && opt.transferEur > 0) || Boolean(opt.transferBookUrl),
    hasOutboundBeat: (opt.journeyBeats ?? []).some((b) =>
      /flight|train|outbound|anreise/i.test(`${b.kind} ${b.title}`),
    ),
    hasTransferBeat: (opt.journeyBeats ?? []).some(
      (b) => b.kind === 'transfer' || /transfer|taxi|mietwagen|shuttle/i.test(b.title),
    ),
    metWishChapters: (opt.wishChapters ?? []).filter((c) => c.met).length,
    hasPackageCompare,
    noAbPrice: !/\bab\s*\d+\s*€/i.test(blob),
    buyInEur: opt.buyInEur ?? opt.pricePerPerson ?? null,
    stayPriceEur: opt.stayPriceEur ?? opt.stays?.[0]?.priceEur ?? null,
    flightPriceEur: opt.flightPriceEur ?? null,
    transferEur: opt.transferEur ?? null,
    speechLen: (opt.speechSummary || '').length,
  };
}

async function main() {
  const { out } = parseArgs(process.argv.slice(2));
  const t0 = Date.now();

  const gemini =
    process.env.EXPO_PUBLIC_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_API_KEY;
  console.log(
    `[funnel-live] gemini=${gemini ? 'yes' : 'NO'} stay22=${process.env.EXPO_PUBLIC_STAY22_AID || process.env.STAY22_AID ? 'yes' : 'soft'}`,
  );

  const { useReisebueroStore } = await import('../src/reisebuero/store');
  const { computeBriefScore } = await import('../src/reisebuero/briefScore');
  const { isBriefComplete } = await import('../src/reisebuero/completeness');
  const { buildFlipchartNotes } = await import('../src/reisebuero/flipchartNotes');
  const { runReisebueroFunnel } = await import('../src/reisebuero/research/funnel');
  const { checkPackageComplete, checkWishesMet, runEndControls } = await import(
    '../src/reisebuero/research/qualityGates'
  );

  const store = useReisebueroStore.getState();
  store.startNewTrip();
  for (const chunk of CHUNKS) {
    useReisebueroStore.getState().ingestUserText(chunk);
  }

  const ledger = useReisebueroStore.getState().trip.ledger;
  const brief = computeBriefScore(ledger);
  const board = buildFlipchartNotes(ledger);
  const ready = isBriefComplete(ledger) || brief.score >= 80;

  console.log(
    `[funnel-live] brief score=${brief.score} ready=${ready} stickers=${board.length} dates=${ledger.dateStart?.value}→${ledger.dateEnd?.value} origins=${(ledger.originCities?.value ?? []).join('|')}`,
  );

  if (!ready && brief.score < 70) {
    console.error('[funnel-live] brief too thin — abort before live APIs');
    process.exit(2);
  }

  useReisebueroStore.getState().markRecapDone();
  useReisebueroStore.getState().setPhase('research');

  console.log('[funnel-live] starting runReisebueroFunnel (deadline 15 min)…');
  await runReisebueroFunnel();

  const trip = useReisebueroStore.getState().trip;
  const options = trip.options ?? [];
  const scores = options.map((o) =>
    scoreOption(o, trip.ledger, checkPackageComplete, checkWishesMet),
  );
  const end = runEndControls(options, trip.ledger);

  const idealPass = scores.filter(
    (s) =>
      s.packageHardOk &&
      s.hasStay &&
      s.hasFlight &&
      s.hasTransfer &&
      s.hasOutboundBeat &&
      s.hasTransferBeat &&
      s.metWishChapters >= 1 &&
      s.noAbPrice,
  );

  const report = {
    ok: options.length > 0 && end.pass,
    elapsedMs: Date.now() - t0,
    brief: {
      score: brief.score,
      ready,
      stickers: board.length,
      purpose: ledger.purpose?.value,
      adults: ledger.adults?.value,
      budgetEur: ledger.budgetEur?.value,
      dates: [ledger.dateStart?.value, ledger.dateEnd?.value],
      origins: ledger.originCities?.value,
      mode: ledger.mode?.value,
      meals: ledger.meals?.value,
      mustHaves: ledger.mustHaves?.value,
      wishHaves: ledger.wishHaves?.value,
    },
    funnelLog: trip.funnelLog ?? [],
    searchError: trip.searchError,
    endControls: {
      pass: end.pass,
      summary: end.summary,
      passingIds: end.passingIds,
      failingIds: end.failingIds,
    },
    optionCount: options.length,
    idealPassCount: idealPass.length,
    scores,
    options: options.map((o) => ({
      id: o.id,
      placeName: o.placeName,
      title: o.title,
      matchScore: o.matchScore,
      buyInEur: o.buyInEur ?? o.pricePerPerson,
      stayName: o.stayName,
      stayPriceEur: o.stayPriceEur,
      flightPriceEur: o.flightPriceEur,
      transferEur: o.transferEur,
      transferMinutes: o.transferMinutes,
      packageBookUrl: o.packageBookUrl,
      stayBookUrl: o.stayBookUrl,
      flightBookUrl: o.flightBookUrl,
      transferBookUrl: o.transferBookUrl,
      speechSummary: o.speechSummary,
      experienceSummary: o.experienceSummary,
      decisionNotes: o.decisionNotes,
      journeyBeats: o.journeyBeats,
      wishChapters: o.wishChapters,
      facts: o.facts,
      gaps: o.gaps,
      bookingChecklist: o.bookingChecklist,
      stays: o.stays,
      transports: o.transports,
    })),
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');

  console.log(`[funnel-live] wrote ${out}`);
  console.log(
    JSON.stringify(
      {
        ok: report.ok,
        elapsedMs: report.elapsedMs,
        optionCount: report.optionCount,
        idealPassCount: report.idealPassCount,
        endPass: end.pass,
        endSummary: end.summary,
        places: scores.map((s) => s.place),
        scores: scores.map((s) => ({
          place: s.place,
          packageHardOk: s.packageHardOk,
          wishHardOk: s.wishHardOk,
          hasStay: s.hasStay,
          hasFlight: s.hasFlight,
          hasTransfer: s.hasTransfer,
          beats: [s.hasOutboundBeat, s.hasTransferBeat],
          wishesMet: s.metWishChapters,
          buyIn: s.buyInEur,
          pkgIssues: s.packageIssues,
          wishIssues: s.wishIssues,
        })),
      },
      null,
      2,
    ),
  );

  if (!options.length) process.exit(1);
  if (!end.pass && idealPass.length === 0) process.exit(1);
}

main().catch((e) => {
  console.error('[funnel-live] fatal', e);
  process.exit(1);
});
