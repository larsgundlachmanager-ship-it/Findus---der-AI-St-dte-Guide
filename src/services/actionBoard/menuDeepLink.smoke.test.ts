/**
 * Speisekarte: Scoring, Fail-closed Gate, Live-Deep-Link.
 * Run: npx --yes tsx src/services/actionBoard/menuDeepLink.smoke.test.ts
 */

import { looksLikeRealMenu, findDeepestMenuLink } from './menuDeepLink';
import {
  classifyOpenUrlIntent,
  scoreDeepLink,
  pickBestScoredUrl,
} from '../research/liveDeepLink';
import { looksLikeHotelBookOpenUrl } from '../affiliate/openUrlBookingPrefill';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok: ${msg}`);
}

assert(
  looksLikeRealMenu(
    'Vorspeise: Bruschette 7,50 €. Hauptgericht: Pizza Margherita 12,90 €. Dessert Tiramisu.',
  ),
  'real menu text with prices',
);
assert(
  !looksLikeRealMenu('Willkommen im Restaurant. Öffnungszeiten Mo–So.'),
  'homepage is not a menu',
);

assert(
  classifyOpenUrlIntent('🍽 Speisekarte', 'https://wirtshaus.de/speisekarte') ===
    'menu',
  'speisekarte intent',
);
assert(
  !looksLikeHotelBookOpenUrl(
    '🍽 Speisekarte',
    'https://wirtshaus.de/speisekarte',
  ),
  'menu is not hotel book',
);

const now = 2026;
const menuPdf = scoreDeepLink('https://gasthaus.de/speisekarte-2026.pdf', {
  intent: 'menu',
  nowYear: now,
});
const home = scoreDeepLink('https://gasthaus.de/', {
  intent: 'menu',
  nowYear: now,
});
assert(menuPdf > home, `menu pdf ${menuPdf} > home ${home}`);

const venueMenu = pickBestScoredUrl(
  [
    'https://fremdes-portal.de/search?q=menu',
    'https://pannfisch.de/speisekarte',
  ],
  { intent: 'menu', nowYear: now, preferHost: 'pannfisch.de' },
);
assert(
  venueMenu === 'https://pannfisch.de/speisekarte',
  `menu stays on spoken venue host, got ${venueMenu}`,
);

async function liveMenu(): Promise<void> {
  const sites = [
    'https://www.block-house.de/',
    'https://www.gosch.de/',
  ];
  let found: { url: string; site: string } | null = null;
  for (const site of sites) {
    try {
      const hit = await findDeepestMenuLink({
        websiteUrl: site,
        kind: 'food',
      });
      if (hit?.url) {
        found = { url: hit.url, site };
        break;
      }
    } catch (err) {
      console.warn(`live menu skip ${site}:`, err);
    }
  }
  if (!found) {
    console.log('warn: no live menu deep-link (network) — unit checks still ok');
    return;
  }
  assert(/^https?:\/\//i.test(found.url), `live menu url: ${found.url}`);
  assert(
    /speise|menu|karte|pdf/i.test(found.url),
    `live menu looks like a card not homepage: ${found.url}`,
  );
  assert(
    new URL(found.url).hostname.replace(/^www\./, '') ===
      new URL(found.site).hostname.replace(/^www\./, '') ||
      /pdf|ugd/i.test(found.url),
    `menu stays on venue (${found.site}) → ${found.url}`,
  );
  console.log(`live: Speisekarte ${found.site} → ${found.url}`);
}

void liveMenu()
  .then(() => {
    console.log('menuDeepLink.smoke.test.ts ok');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
