/**
 * Pending Stadt-Cover Queue — Bilder vorm Research merken,
 * nach city:auto / Cover-Agent stylisieren und anwenden.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STAEDTE_DIR, slugify } from './lib.mjs';

export const PENDING_COVERS_DIR = path.join(STAEDTE_DIR, 'pending-covers');
export const PENDING_MANIFEST = path.join(PENDING_COVERS_DIR, 'manifest.json');

export const STYLE_REFS = [
  'assets/onboarding/persona-classic-guide.jpg',
  'assets/onboarding/persona-buddy.jpg',
  'assets/onboarding/persona-aristocrat.jpg',
].map((rel) => path.join(ROOT, rel));

const EMPTY = { version: 1, items: [] };

export function ensurePendingDir() {
  fs.mkdirSync(PENDING_COVERS_DIR, { recursive: true });
}

export function loadManifest() {
  ensurePendingDir();
  if (!fs.existsSync(PENDING_MANIFEST)) return structuredClone(EMPTY);
  try {
    const raw = JSON.parse(fs.readFileSync(PENDING_MANIFEST, 'utf8'));
    if (!raw || !Array.isArray(raw.items)) return structuredClone(EMPTY);
    return raw;
  } catch {
    return structuredClone(EMPTY);
  }
}

export function saveManifest(manifest) {
  ensurePendingDir();
  const out = {
    version: 1,
    updated_at: new Date().toISOString(),
    items: Array.isArray(manifest?.items) ? manifest.items : [],
  };
  fs.writeFileSync(PENDING_MANIFEST, JSON.stringify(out, null, 2) + '\n', 'utf8');
  return out;
}

export function cityDir(cityId) {
  return path.join(PENDING_COVERS_DIR, cityId);
}

export function findPending(cityId) {
  const id = slugify(cityId).toLowerCase();
  const m = loadManifest();
  return m.items.find((x) => x.id === id) || null;
}

export function listPending(opts = {}) {
  const m = loadManifest();
  let items = m.items;
  if (opts.status) {
    items = items.filter((x) => x.status === opts.status);
  }
  return items;
}

/**
 * Copy user image into pending queue.
 * @returns {{ item, created: boolean }}
 */
export function queueCoverImage({
  cityId,
  cityName,
  imagePath,
  note = '',
}) {
  const id = slugify(cityId || cityName || '').toLowerCase();
  if (!id) throw new Error('Need city id or name');
  const abs = path.resolve(imagePath);
  if (!fs.existsSync(abs)) throw new Error(`Image not found: ${abs}`);

  const ext = path.extname(abs).toLowerCase() || '.png';
  const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic']);
  if (!allowed.has(ext)) {
    throw new Error(`Unsupported image type ${ext}`);
  }

  ensurePendingDir();
  const dir = cityDir(id);
  fs.mkdirSync(dir, { recursive: true });

  const sourceRel = path.join('data', 'staedte', 'pending-covers', id, `source${ext}`);
  const sourceAbs = path.join(ROOT, sourceRel);
  fs.copyFileSync(abs, sourceAbs);

  const now = new Date().toISOString();
  const m = loadManifest();
  const existing = m.items.findIndex((x) => x.id === id);
  const item = {
    id,
    city_name: cityName || id,
    source: sourceRel.replace(/\\/g, '/'),
    status: 'queued',
    note: note || '',
    queued_at: now,
    stylized: null,
    applied_at: null,
    updated_at: now,
  };

  if (existing >= 0) {
    const prev = m.items[existing];
    item.queued_at = prev.queued_at || now;
    item.note = note || prev.note || '';
    m.items[existing] = item;
  } else {
    m.items.push(item);
  }
  saveManifest(m);
  return { item, created: existing < 0 };
}

export function markStylized(cityId, stylizedRelPath) {
  const id = slugify(cityId).toLowerCase();
  const m = loadManifest();
  const item = m.items.find((x) => x.id === id);
  if (!item) throw new Error(`No pending cover for ${id}`);
  item.stylized = String(stylizedRelPath).replace(/\\/g, '/');
  item.status = 'stylized';
  item.updated_at = new Date().toISOString();
  saveManifest(m);
  return item;
}

export function markApplied(cityId, extra = {}) {
  const id = slugify(cityId).toLowerCase();
  const m = loadManifest();
  const item = m.items.find((x) => x.id === id);
  if (!item) throw new Error(`No pending cover for ${id}`);
  item.status = 'applied';
  item.applied_at = new Date().toISOString();
  item.updated_at = item.applied_at;
  Object.assign(item, extra);
  saveManifest(m);
  return item;
}

export function pendingBriefSection(cityId) {
  const item = findPending(cityId);
  if (!item || item.status === 'applied') return '';
  return `
## Pending Cover (User-Bild)

Status: **${item.status}** · Quelle: \`${item.source}\`
${item.note ? `Notiz: ${item.note}` : ''}

**Pflicht:** Cover-Agent (Kernrollen-Style) — siehe \`.cursor/skills/findus-city-cover/SKILL.md\`
1. GenerateImage mit Source + Persona-Style-Refs
2. \`npm run city:cover:apply -- --id ${item.id} --from <stylized.png>\`
`;
}
