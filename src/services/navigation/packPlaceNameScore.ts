/**
 * Pack-POI Name-Score (ohne Expo) — SSOT für softTokenEq / Polizei-Guard.
 */

function softTokenEq(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 5 && longer.includes(shorter)) return true;
  if (a.length >= 6 && b.length >= 6) {
    let shared = 0;
    const n = Math.min(a.length, b.length);
    while (shared < n && a[shared] === b[shared]) shared += 1;
    if (shared >= 5 && shared / Math.min(a.length, b.length) >= 0.7) {
      return true;
    }
  }
  return false;
}

function looksLikePoliceAmenity(name: string): boolean {
  return /\bpolizei|kommissariat|pr[aä]sidium|\bwache\b/i.test(name);
}

function queryWantsPolice(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    /\bpolizei|kommissariat|pr[aä]sidium|\bwache\b/i.test(q) ||
    /^poli(zei)?s?$/i.test(q)
  );
}

/** 0–100: wie gut passt Pack-Name zur User-Query. */
export function packPlaceNameScore(poiName: string, subject: string): number {
  const a = poiName.trim().toLowerCase();
  const b = subject
    .trim()
    .toLowerCase()
    .replace(/\bhamburg\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (looksLikePoliceAmenity(a) && !queryWantsPolice(b)) {
    return 0;
  }
  if (a.includes(b) || b.includes(a)) return 85;
  const at = a.split(/[^a-zäöüß0-9]+/i).filter((t) => t.length > 2);
  const bt = b.split(/[^a-zäöüß0-9]+/i).filter((t) => t.length > 2);
  let hit = 0;
  for (const t of bt) if (at.some((x) => softTokenEq(x, t))) hit += 1;
  if (!bt.length) return 0;
  // Venue-Kern (tennis+club): stark boosten — sonst 3/3 * 55 = 55 und STT-Tippfehler fallen durch
  const venuePair =
    bt.includes('tennis') &&
    (bt.includes('club') || bt.includes('klub') || bt.includes('tcp')) &&
    at.some((x) => x === 'tennis') &&
    at.some((x) => softTokenEq(x, 'club') || softTokenEq(x, 'klub') || x === 'tcp');
  if (venuePair) {
    const cityHit = bt.some(
      (t) =>
        /prisdorf|prsidorf|prisodrf|priesdorf|priestorf/.test(t) &&
        at.some((x) => softTokenEq(x, t) || softTokenEq(x, 'prisdorf')),
    );
    return cityHit || bt.length <= 2 ? 92 : Math.max(78, Math.round((hit / bt.length) * 90));
  }
  if (bt.length === 1 && hit === 1) {
    const t = bt[0]!;
    if (at.some((x) => x === t)) return 90;
    return 50;
  }
  return Math.round((hit / bt.length) * 70);
}
