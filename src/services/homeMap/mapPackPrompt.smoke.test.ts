import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const prompt = readFileSync(
  join(process.cwd(), 'src/services/homeMap/mapPackPrompt.ts'),
  'utf8',
);
assert(prompt.includes('promptCityPackDownloadIfNeeded'), 'prompt fn');
assert(prompt.includes('presentCityPackSwitchCard'), 'switch card');
assert(prompt.includes('PROMPT_COOLDOWN_MS'), 'cooldown');
assert(prompt.includes('cityEnter'), 'cityEnter gate');
assert(prompt.includes('if (!input.cityEnter) return false'), 'no pan popup');
assert(prompt.includes('ensureBrowsePackAtViewport'), 'browse feeder ensure');
assert(prompt.includes('ensureBrowseCityPackOnDevice'), 'disk-only browse pack');
assert(prompt.includes('MAP_BROWSE_PACK_SLOTS'), 'browse slot budget');

const host = readFileSync(
  join(process.cwd(), 'src/components/homeMap/HomePresenceMap.tsx'),
  'utf8',
);
assert(host.includes('promptCityPackDownloadIfNeeded'), 'host wired');
assert(host.includes('maybePromptPackAt'), 'host helper');
assert(host.includes('maybePromptPackAt(lat, lng, true)'), 'city-enter prompt');
assert(host.includes('maybeEnsureBrowsePackAt'), 'browse ensure wired');
assert(host.includes('ensureBrowsePackAtViewport'), 'browse ensure import use');
assert(host.includes('yorroContentAt'), 'viewport gate helper');
assert(
  host.includes('if (isVectorBasemapEnabled()) return') &&
    host.slice(host.indexOf('Display-Extract')).includes('if (isVectorBasemapEnabled()) return'),
  'skip display extract in vector',
);

const catalog = readFileSync(
  join(process.cwd(), 'src/services/cityCatalogService.ts'),
  'utf8',
);
assert(
  catalog.includes('ensureBrowseCityPackOnDevice'),
  'browse pack without SQLite switch',
);
assert(
  catalog.includes('Browse-Pack bereit (ohne Aktiv-Switch)'),
  'browse never activates city',
);
assert(
  !catalog
    .slice(catalog.indexOf('ensureBrowseCityPackOnDevice'))
    .slice(0, 1200)
    .includes('replacePoisAndFacts'),
  'browse path must not replace SQLite',
);

console.log('mapPackPrompt.smoke.test.ts OK');
