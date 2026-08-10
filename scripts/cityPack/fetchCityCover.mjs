#!/usr/bin/env node
/**
 * Stadt-Cover für die Auswahl-Karten (Wikipedia/Wikimedia Foto).
 *
 * Usage:
 *   node scripts/cityPack/fetchCityCover.mjs --city Hamburg --id hamburg
 *   node scripts/cityPack/fetchCityCover.mjs --id luebeck --title "Lübeck"
 *   node scripts/cityPack/fetchCityCover.mjs --id hamburg --force
 *
 * Schreibt `cover_url` (+ `_meta.cover_url`) ins Pack — App zeigt das Bild
 * in der Stadtauswahl, sofern kein lokales assets/onboarding/city-*.png existiert.
 */

import {
  arg,
  hasFlag,
  loadEnvFile,
  loadPack,
  savePack,
  slugify,
} from './lib.mjs';

loadEnvFile();

function isBadCoverUrl(url) {
  const u = (url || '').toLowerCase();
  if (!u) return true;
  // Fahnen / Wappen / SVG = schlecht als Hero
  if (/\.svg(\?|$)/i.test(u)) return true;
  if (/flag_of|coat_of_arms|wappen|logo|icon|map_of|locator/i.test(u)) return true;
  return false;
}

async function wikiThumb(title) {
  const q = new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'pageimages',
    format: 'json',
    pithumbsize: '1280',
    piprop: 'thumbnail',
    origin: '*',
  });
  const urls = [
    `https://de.wikipedia.org/w/api.php?${q}`,
    `https://en.wikipedia.org/w/api.php?${q}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'FindusCityPack/2.0 (cover fetch)' },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const pages = data?.query?.pages || {};
      for (const page of Object.values(pages)) {
        const src = page?.thumbnail?.source;
        if (typeof src === 'string' && /^https?:\/\//i.test(src) && !isBadCoverUrl(src)) {
          return src.replace(/\/\d+px-/, '/1280px-');
        }
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Wikimedia Commons Bildsuche — echte Fotos bevorzugen. */
async function commonsPhoto(query) {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: '8',
    gsrnamespace: '6',
    prop: 'imageinfo',
    iiprop: 'url|mime|size',
    iiurlwidth: '1280',
    origin: '*',
  });
  const url = `https://commons.wikimedia.org/w/api.php?${q}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FindusCityPack/2.0 (cover fetch)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {});
    pages.sort(
      (a, b) =>
        (b?.imageinfo?.[0]?.width || 0) - (a?.imageinfo?.[0]?.width || 0),
    );
    for (const page of pages) {
      const info = page?.imageinfo?.[0];
      const thumb = info?.thumburl || info?.url;
      const mime = String(info?.mime || '');
      if (!thumb || !/^https?:\/\//i.test(thumb)) continue;
      if (isBadCoverUrl(thumb)) continue;
      if (mime && !/^image\/(jpeg|jpg|png|webp)/i.test(mime)) continue;
      return thumb;
    }
  } catch {
    /* soft */
  }
  return null;
}

function landmarkTitles(pack, cityName) {
  const out = [];
  const spots = Array.isArray(pack?.spots) ? pack.spots : [];
  for (const s of spots.slice(0, 12)) {
    const name = String(s?.name || '').trim();
    const role = String(s?.pack_role || '');
    const tier = Number(s?.place_tier || 99);
    if (!name) continue;
    if (role === 'directory' && tier > 2) continue;
    if (
      /museum|kirche|dom|rathaus|schloss|tor|brücke|bruecke|hafen|strand|markt|philharmonie|turm|burg/i.test(
        name,
      ) ||
      tier <= 2
    ) {
      out.push(name);
    }
  }
  return [
    `${cityName} Skyline`,
    `${cityName} Altstadt`,
    cityName,
    ...out.slice(0, 4),
  ];
}

async function main() {
  const cityName = arg('city') || arg('title') || '';
  const id = (arg('id') || slugify(cityName) || '').trim();
  if (!id) {
    console.error('Need --id or --city');
    process.exit(1);
  }
  const pack = loadPack(id);
  if (!pack) {
    console.error(`No pack data/staedte/${id}.json`);
    process.exit(1);
  }
  const title =
    cityName ||
    pack.name ||
    id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  if (pack.cover_url && !hasFlag('force') && !isBadCoverUrl(pack.cover_url)) {
    console.log(`[cover] already set: ${pack.cover_url} (use --force to refresh)`);
    return;
  }

  console.log(`[cover] searching photo for “${title}”…`);
  let thumb = null;
  for (const q of landmarkTitles(pack, title)) {
    thumb = (await commonsPhoto(q)) || (await wikiThumb(q));
    if (thumb) {
      console.log(`[cover] hit via “${q}”`);
      break;
    }
  }
  if (!thumb) {
    console.error('[cover] no photo found — set cover_url manually in the pack');
    process.exit(2);
  }

  pack.cover_url = thumb;
  pack._meta = {
    ...(pack._meta || {}),
    cover_url: thumb,
    cover_source: 'wikimedia',
  };
  savePack(pack, { bumpVersion: false });
  console.log(`[cover] OK → ${thumb}`);
  console.log(
    '[cover] Optional Premium: PNG nach assets/onboarding/city-' +
      id +
      '.png + Eintrag in src/constants/cityCovers.ts (schlägt URL).',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
