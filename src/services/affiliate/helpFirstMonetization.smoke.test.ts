/**
 * Help-First Partner-Momente + Call-2 Katalog + Inject — Smoke (Node, ohne RN).
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/affiliate/helpFirstMonetization.smoke.test.ts
 */

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const {
  detectHelpFirstMoments,
  formatAffiliateCatalogForCall2,
  helpFirstQuickActionToModule2Button,
  injectHelpFirstModule2Buttons,
} = require('./helpFirstMonetization') as typeof import('./helpFirstMonetization');

// --- Detect ---
const abroad = detectHelpFirstMoments({
  userText: 'Morgen fliege ich nach Barcelona',
});
assert(
  abroad.some((m) => m.kind === 'abroad_esim'),
  `abroad flight → esim, got ${abroad.map((m) => m.kind).join(',')}`,
);

const michel = detectHelpFirstMoments({
  userText: 'Kann ich auf den Michel rauf?',
});
assert(
  michel.some((m) => m.kind === 'landmark_ticket'),
  `michel → landmark_ticket, got ${michel.map((m) => m.kind).join(',')}`,
);

const wetter = detectHelpFirstMoments({ userText: 'Wie wird das Wetter?' });
assert(
  wetter.length === 0,
  `wetter → no moments, got ${wetter.map((m) => m.kind)}`,
);

const taxi = detectHelpFirstMoments({
  userText: 'Taxi zum Hauptbahnhof bitte',
});
assert(
  !taxi.some((m) => m.kind === 'hotel_transfer'),
  'taxi text should not invent hotel_transfer (Uber nur Taxi-Lane)',
);

const transfer = detectHelpFirstMoments({
  userText: 'Transfer vom Hotel zum Flughafen',
});
assert(
  transfer.some((m) => m.kind === 'hotel_transfer'),
  `hotel transfer moment, got ${transfer.map((m) => m.kind)}`,
);

const reserve = detectHelpFirstMoments({
  userText: 'Kannst du einen Tisch reservieren?',
});
assert(
  reserve.some((m) => m.kind === 'dining_reserve'),
  `reserve → dining_reserve, got ${reserve.map((m) => m.kind)}`,
);

// --- Catalog (Fixture = ready-Partner-Shape; Live lädt RN) ---
const catalog = formatAffiliateCatalogForCall2([
  {
    id: 'travsim',
    category: 'eSIM / Travel-SIM',
    status: 'ready',
    notes: 'Primär BOOK_ESIM',
    conciergeActions: ['BOOK_ESIM'],
  },
  {
    id: 'stay22',
    category: 'Unterkünfte',
    status: 'ready',
    notes: 'Backup Hotel',
    conciergeActions: ['BOOK_STAY22'],
  },
  {
    id: 'tiqets',
    category: 'Tickets',
    status: 'ready',
    notes: 'Attraction tickets',
    conciergeActions: ['OPEN_URL'],
  },
  {
    id: 'discover_cars',
    category: 'Mietwagen',
    status: 'ready',
    notes: 'BOOK_CAR_RENTAL',
    conciergeActions: ['BOOK_CAR_RENTAL'],
  },
  {
    id: 'uber',
    category: 'Lokale Mobilität',
    status: 'ready',
    notes: 'rides',
    conciergeActions: ['BOOK_UBER'],
  },
  {
    id: 'ghost',
    category: 'x',
    status: 'placeholder',
    notes: 'nope',
    conciergeActions: [],
  },
]);
assert(/travsim|esim/i.test(catalog), 'catalog has esim/travsim');
assert(/stay22/i.test(catalog), 'catalog has stay22');
assert(/tiqets/i.test(catalog), 'catalog has tiqets');
assert(/discover_cars/i.test(catalog), 'catalog has discover_cars');
assert(!/ghost|placeholder/i.test(catalog), 'no placeholder partners');
assert(
  /nur expliziter Taxi\/Uber-Intent/i.test(catalog),
  'uber gated in catalog',
);

// --- Inject: BOOK_ESIM ohne Call-2-Text (QuickAction → Module2) ---
const esimQa = {
  type: 'BOOK_ESIM' as const,
  label: '📱 eSIM holen',
  payload: { url: 'https://travsim.com/de/products/spain-esim' },
};
const m2 = helpFirstQuickActionToModule2Button(esimQa, 'hf0');
assert(m2, 'module2 button from esim');
assert(m2!.payload.kind === 'ui', 'ui kind');
assert(
  (m2!.payload as { action?: string }).action === 'BOOK_ESIM',
  'BOOK_ESIM action',
);

// Uber hard-ban
assert(
  helpFirstQuickActionToModule2Button(
    {
      type: 'BOOK_UBER',
      label: 'Uber',
      payload: { url: 'https://m.uber.com/ul/' },
    } as never,
    'x',
  ) == null,
  'BOOK_UBER never from help-first converter',
);

// Inject behält/merged BOOK_ESIM (Converter-Pfad = Code-Inject ohne Call-2-Text)
const injected = injectHelpFirstModule2Buttons({
  buttons: [m2!],
  moments: abroad.filter((m) => m.kind === 'abroad_esim'),
  userText: 'Morgen fliege ich nach Barcelona',
  cityName: 'Barcelona',
});
assert(
  injected.some(
    (b) =>
      b.payload.kind === 'ui' &&
      (b.payload as { action?: string }).action === 'BOOK_ESIM',
  ),
  'inject keeps BOOK_ESIM without Call-2 text',
);
assert(
  !injected.some(
    (b) =>
      b.payload.kind === 'ui' &&
      /UBER/i.test(String((b.payload as { action?: string }).action || '')),
  ),
  'inject never uber',
);

console.log('helpFirstMonetization.smoke.test.ts OK');
