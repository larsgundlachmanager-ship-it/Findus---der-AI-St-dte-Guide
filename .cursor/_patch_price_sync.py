from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\pitch\runPitchModule.ts")
s = p.read_text(encoding="utf-8")
old = """    try {
      const { filterWeakCategoryBullets } = require('./weakCategoryBullet') as {
        filterWeakCategoryBullets: (xs: string[]) => string[];
      };
      bullets = filterWeakCategoryBullets(bullets).slice(0, 3);
    } catch {
      /* soft */
    }
    return {
      id: `pitch_${req.requestId}_${i === 0 ? 'a' : 'b'}`,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      placeId: c.placeId,
      role,
      speechPitch: card.speechPitch,
      bullets,"""
new = """    try {
      const { filterWeakCategoryBullets } = require('./weakCategoryBullet') as {
        filterWeakCategoryBullets: (xs: string[]) => string[];
      };
      bullets = filterWeakCategoryBullets(bullets).slice(0, 3);
    } catch {
      /* soft */
    }
    let speechPitch = card.speechPitch;
    try {
      const { syncPriceEvidence } = require('./priceEvidenceSync') as {
        syncPriceEvidence: (o: {
          speech: string;
          bullets: string[];
          dishPriceHint?: string | null;
          allowPriceInBullets?: boolean;
        }) => { speech: string; bullets: string[] };
      };
      const synced = syncPriceEvidence({
        speech: speechPitch,
        bullets,
        dishPriceHint: c.dishPriceHint ?? priceBullet,
        allowPriceInBullets: true,
      });
      speechPitch = synced.speech;
      bullets = synced.bullets;
    } catch {
      /* soft */
    }
    return {
      id: `pitch_${req.requestId}_${i === 0 ? 'a' : 'b'}`,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      placeId: c.placeId,
      role,
      speechPitch,
      bullets,"""
if old not in s:
    raise SystemExit("block missing")
tmp = p.with_suffix(".ts.patching")
tmp.write_text(s.replace(old, new, 1), encoding="utf-8")
tmp.replace(p)
print("price sync wired")
