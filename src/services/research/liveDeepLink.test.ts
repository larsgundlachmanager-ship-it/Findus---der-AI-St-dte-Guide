/**
 * Run: npx --yes tsx src/services/research/liveDeepLink.test.ts
 */
import {
  buildIntentSearchFallback,
  classifyOpenUrlIntent,
  isRedirectToHome,
  looksSoft404Html,
  pathDepth,
  pickBestScoredUrl,
  pickRankedSourceUrls,
  scoreDeepLink,
  shouldSkipLiveProbe,
} from './liveDeepLink';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(pathDepth('https://www.eventim.de/') === 0, 'eventim home depth 0');
assert(
  pathDepth('https://www.eventim.de/de/event/foo-bar-123/') >= 2,
  'eventim event is deep',
);
assert(
  pathDepth('https://gasthaus.de/de/speisekarte-2026.pdf') >= 1,
  'menu pdf has depth',
);

assert(shouldSkipLiveProbe('mailto:a@b.c'), 'skip mailto');
assert(shouldSkipLiveProbe('https://www.google.com/maps/search/?api=1&query=X'), 'skip maps');
assert(!shouldSkipLiveProbe('https://gasthaus.de/speisekarte'), 'probe menu');

assert(
  classifyOpenUrlIntent('🍽 Karte', 'https://x.de/menu') === 'menu',
  'menu intent',
);
assert(
  classifyOpenUrlIntent('🎫 Konzert', 'https://eventim.de/event/x') === 'ticket',
  'ticket intent',
);
assert(
  classifyOpenUrlIntent('🌐 Website', 'https://venue.de/') === 'website',
  'website intent',
);

const now = 2026;
const home = scoreDeepLink('https://www.eventim.de/', {
  intent: 'ticket',
  nowYear: now,
});
const event = scoreDeepLink('https://www.eventim.de/event/sommerfest-luebeck-2026/', {
  intent: 'ticket',
  nowYear: now,
});
assert(event > home, `ticket event ${event} > home ${home}`);

const menuOld = scoreDeepLink('https://wirtshaus.de/speisekarte-2023.pdf', {
  intent: 'menu',
  nowYear: now,
});
const menuNow = scoreDeepLink('https://wirtshaus.de/speisekarte-2026.pdf', {
  intent: 'menu',
  nowYear: now,
});
assert(menuNow > menuOld, `current menu ${menuNow} > old ${menuOld}`);

const restaurantHome = scoreDeepLink('https://wirtshaus.de/', {
  intent: 'menu',
  nowYear: now,
});
assert(
  menuNow > restaurantHome,
  `menu pdf ${menuNow} > restaurant home ${restaurantHome}`,
);

const sameHostMenu = pickBestScoredUrl(
  [
    'https://fremdes-portal.de/events/super-deep-path-2026/xyz',
    'https://wirtshaus.de/speisekarte-2026',
  ],
  {
    intent: 'menu',
    nowYear: now,
    preferHost: 'wirtshaus.de',
  },
);
assert(
  sameHostMenu === 'https://wirtshaus.de/speisekarte-2026',
  `menu stays on venue host, got ${sameHostMenu}`,
);

const picked = pickBestScoredUrl(
  [
    'https://tickets.example/search',
    'https://www.eventim.de/',
    'https://www.eventim.de/event/jazz-nacht-2026/12345/',
  ],
  { intent: 'ticket', nowYear: now },
);
assert(
  picked === 'https://www.eventim.de/event/jazz-nacht-2026/12345/',
  `picked deepest ticket, got ${picked}`,
);

const ranked = pickRankedSourceUrls(
  [
    { url: 'https://ort.de/', title: 'Home', kind: 'html' },
    { url: 'https://ort.de/speisekarte', title: 'Speisekarte', kind: 'html' },
    { url: 'https://ort.de/x', title: 'Quelle (nicht voll lesbar)', kind: 'other' },
  ],
  'Speisekarte vom Restaurant',
  2,
);
assert(ranked[0]?.url === 'https://ort.de/speisekarte', 'ranked menu first');
assert(
  !ranked.some((r) => /nicht voll lesbar/.test(r.url)),
  'unread source not ranked',
);

assert(
  isRedirectToHome(
    'https://ort.de/events/erfunden-slug-xyz',
    'https://ort.de/',
  ),
  'deep slug → home is dead',
);
assert(
  !isRedirectToHome(
    'https://ort.de/speisekarte',
    'https://ort.de/de/speisekarte-2026',
  ),
  'deeper redirect is live',
);

assert(
  looksSoft404Html('<html><title>404 – Seite nicht gefunden</title><body>'),
  'soft 404 title',
);
assert(!looksSoft404Html('<html><title>Speisekarte</title><body>Schnitzel'), 'live html');

const fb = buildIntentSearchFallback({
  intent: 'menu',
  name: 'Gasthaus Adler',
  city: 'Lübeck',
});
assert(/google\.[^/]+\/search/.test(fb) && /Speisekarte/.test(decodeURIComponent(fb)), 'search fallback');

console.log('liveDeepLink.test.ts ok');
