#!/usr/bin/env node
/**
 * Ensure every city pack has a stable Supabase cover (not flaky Wikimedia).
 *
 *   node scripts/cityPack/ensureSupabaseCovers.mjs
 *   node scripts/cityPack/ensureSupabaseCovers.mjs --ids berlin-umland,frankfurt_am_main
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STAEDTE_DIR,
  arg,
  loadEnvFile,
  loadPack,
  savePack,
  writeJson,
} from './lib.mjs';
import { compressCoverForUpload } from './compressCover.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

loadEnvFile();

const url = (
  process.env.SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/$/, '');
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  '';

if (!url || !key) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const QUERY_OVERRIDES = {
  'berlin-umland': [
    'Tempelhofer Feld Berlin',
    'Olympiastadion Berlin',
    'Gaerten der Welt Berlin',
    'Schloss Koepenick',
  ],
  frankfurt_am_main: [
    'Frankfurt am Main Skyline',
    'Frankfurt Roemerberg',
    'Frankfurt Main Tower',
  ],
  hochheim_am_main: [
    'Hochheim am Main Kirche',
    'Hochheim Main Weinberge',
    'Hochheim am Main',
  ],
};

function isBadCoverUrl(u) {
  const s = (u || '').toLowerCase();
  if (!s) return true;
  if (/\.svg(\?|$)/i.test(s)) return true;
  if (/flag_of|coat_of_arms|wappen|logo|icon|map_of|locator/i.test(s)) return true;
  return false;
}

function isSupabaseCover(u) {
  return /supabase\.co\/storage\/v1\/object\/public\/staedte\/covers\//i.test(
    u || '',
  );
}

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
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, {
    headers: { 'User-Agent': 'FindusCityPack/2.0 (cover ensure)' },
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
  return null;
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
  for (const host of ['de.wikipedia.org', 'en.wikipedia.org']) {
    try {
      const res = await fetch(`https://${host}/w/api.php?${q}`, {
        headers: { 'User-Agent': 'FindusCityPack/2.0 (cover ensure)' },
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const page of Object.values(data?.query?.pages || {})) {
        const src = page?.thumbnail?.source;
        if (typeof src === 'string' && !isBadCoverUrl(src)) {
          return src.replace(/\/\d+px-/, '/1280px-');
        }
      }
    } catch {
      /* next */
    }
  }
  return null;
}

async function upload(objectPath, body, contentType) {
  const endpoint = `${url}/storage/v1/object/staedte/${objectPath}`;
  for (const method of ['POST', 'PUT']) {
    const res = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': contentType,
        'x-upsert': 'true',
        'Cache-Control': 'public, max-age=604800',
      },
      body,
    });
    if (res.ok) return;
    if (method === 'PUT') {
      const t = await res.text().catch(() => '');
      throw new Error(`Upload failed ${objectPath}: ${res.status} ${t}`);
    }
  }
}

async function ensureCover(id) {
  const pack = loadPack(id);
  if (!pack) throw new Error(`No pack ${id}`);
  if (isSupabaseCover(pack.cover_url)) {
    console.log(`[skip] ${id} already on supabase`);
    return { id, status: 'ok', url: pack.cover_url };
  }

  const queries =
    QUERY_OVERRIDES[id] ||
    [
      `${pack.name} Skyline`,
      `${pack.name} Altstadt`,
      pack.name,
      id.replace(/_/g, ' '),
    ].filter(Boolean);

  let src = null;
  for (const q of queries) {
    src = (await commonsPhoto(q)) || (await wikiThumb(q));
    if (src) {
      console.log(`[hit] ${id} ← ${q}`);
      break;
    }
  }
  if (!src && pack.cover_url && !isBadCoverUrl(pack.cover_url)) {
    src = pack.cover_url;
    console.log(`[reuse] ${id} existing wikimedia url`);
  }
  if (!src) throw new Error(`No cover source for ${id}`);

  const imgRes = await fetch(src, {
    headers: { 'User-Agent': 'FindusCityPack/2.0 (cover download)' },
    redirect: 'follow',
  });
  if (!imgRes.ok) throw new Error(`Download failed ${id}: ${imgRes.status}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());

  const tmpDir = path.join(ROOT, 'assets', 'onboarding', 'remote-covers');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpIn = path.join(tmpDir, `${id}-src.jpg`);
  fs.writeFileSync(tmpIn, buf);

  const packed = await compressCoverForUpload(tmpIn);
  const stamp = Date.now().toString(36);
  const objectName = `covers/${id}-${stamp}${packed.ext}`;
  await upload(objectName, packed.buffer, packed.contentType);
  fs.writeFileSync(path.join(tmpDir, `${id}.jpg`), packed.buffer);

  const publicUrl = `${url}/storage/v1/object/public/staedte/${objectName}`;
  pack.cover_url = publicUrl;
  pack._meta = {
    ...(pack._meta || {}),
    cover_url: publicUrl,
    cover_source: 'supabase',
    cover_origin: src,
  };
  savePack(pack, { bumpVersion: true });
  console.log(`[ok] ${id} → ${publicUrl}`);
  return { id, status: 'uploaded', url: publicUrl };
}

function rebuildIndex() {
  const indexPath = path.join(STAEDTE_DIR, 'index.json');
  const idx = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  for (const c of idx.available_cities || []) {
    const pack = loadPack(c.id);
    if (!pack) continue;
    const cover = (pack.cover_url || '').trim();
    if (cover) {
      c.cover_url = cover;
      c.coverUrl = cover;
    }
    c.data_version = pack.data_version || c.data_version;
    c.name = pack.name || c.name;
  }
  idx.last_global_update = new Date().toISOString();
  writeJson(indexPath, idx);
  return idx;
}

async function uploadIndex(idx) {
  const body = JSON.stringify(idx);
  const endpoint = `${url}/storage/v1/object/staedte/index.json`;
  for (const method of ['POST', 'PUT']) {
    const res = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
        'x-upsert': 'true',
      },
      body,
    });
    if (res.ok) {
      console.log('[upload] index.json');
      return;
    }
    if (method === 'PUT') throw new Error(`index upload ${res.status}`);
  }
}

async function main() {
  const idsArg = arg('ids');
  let ids = idsArg
    ? idsArg.split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  if (!ids) {
    const idx = JSON.parse(
      fs.readFileSync(path.join(STAEDTE_DIR, 'index.json'), 'utf8'),
    );
    ids = [];
    for (const c of idx.available_cities || []) {
      const p = loadPack(c.id);
      if (!p) continue;
      if (!isSupabaseCover(p.cover_url)) ids.push(c.id);
    }
  }

  console.log('[ensure] ids', ids);
  const results = [];
  for (const id of ids) {
    try {
      results.push(await ensureCover(id));
    } catch (e) {
      console.error(`[fail] ${id}`, e.message || e);
      results.push({ id, status: 'fail', error: String(e.message || e) });
    }
  }
  const idx = rebuildIndex();
  await uploadIndex(idx);
  console.log(JSON.stringify({ results }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
