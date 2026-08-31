/**
 * Speisekarte: Hash-CMS-PDF (Wix ugd) schlägt Homepage; ohne Label kein Fake-PDF.
 * Run: npm exec --yes --package tsx -- tsx src/services/actionBoard/menuPdfHarvest.smoke.test.ts
 */
import {
  collectMenuLinkCandidates,
  pickBestMenuCandidate,
  menuPdfPassesKeywordOrLabel,
  validateMenuUrl,
} from './menuDeepLink';
import { isMenuAssetUrl } from '../../module2/planning/offerActionUtils';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const home = 'https://restaurant.example/';
const hashedPdf =
  'https://restaurant.example/_files/ugd/ab12cd_99ff00ee.pdf';
const keywordPdf = 'https://restaurant.example/speisekarte.pdf';

{
  const html = `
    <html><body>
      <a href="${home}">Home</a>
      <a href="${hashedPdf}">Speisekarte</a>
    </body></html>
  `;
  const cands = collectMenuLinkCandidates({
    baseUrl: home,
    kind: 'food',
    links: [
      { href: home, label: 'Home' },
      { href: hashedPdf, label: 'Speisekarte' },
    ],
    htmlOrText: html,
  });
  const best = pickBestMenuCandidate(cands, home);
  assert(best, 'found a menu candidate');
  assert(best!.url === hashedPdf, `hashed PDF preferred over homepage, got ${best?.url}`);
  assert(
    best!.score >
      (cands.find((c) => c.url === home)?.score ?? 0),
    'PDF score beats homepage',
  );
}

{
  const html = `<html><body><p>Speisekarte</p><script>{"url":"${hashedPdf}"}</script></body></html>`;
  const cands = collectMenuLinkCandidates({
    baseUrl: home,
    kind: 'food',
    links: [{ href: home, label: 'Home' }],
    htmlOrText: html,
  });
  const best = pickBestMenuCandidate(cands, home);
  assert(best, 'hashed PDF harvested from homepage HTML');
  assert(best!.url === hashedPdf, `SPA hashed PDF preferred over homepage, got ${best?.url}`);
}

assert(
  menuPdfPassesKeywordOrLabel(hashedPdf, 'Speisekarte'),
  'hashed PDF + Speisekarte label is valid',
);
assert(
  !menuPdfPassesKeywordOrLabel(hashedPdf, 'PDF'),
  'hashed PDF without menu label is rejected',
);
assert(
  menuPdfPassesKeywordOrLabel(keywordPdf, ''),
  'keyword PDF path is valid without label',
);
assert(isMenuAssetUrl(hashedPdf), 'hashed ugd PDF counts as menu asset');
assert(!isMenuAssetUrl(home), 'homepage is not a menu asset');

void (async () => {
  assert(
    await validateMenuUrl(hashedPdf, undefined, { label: 'Speisekarte' }),
    'validate hashed PDF with Speisekarte label',
  );
  assert(
    !(await validateMenuUrl(hashedPdf, undefined, { label: 'Impressum' })),
    'validate rejects hashed PDF with unrelated label',
  );
  console.log('menuPdfHarvest.smoke.test.ts ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
