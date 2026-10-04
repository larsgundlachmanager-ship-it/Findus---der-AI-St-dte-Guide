from pathlib import Path

p = Path(r"src/module2/pitch/candidatePool.ts")
t = p.read_text(encoding="utf-8")
marker = "  const namedVenue = namedVenueFromWishes(req.wishes);\n  const expandM ="
if marker not in t:
    raise SystemExit("marker missing")
# only first occurrence in placesCandidates — find after placesCandidates function
idx = t.find("async function placesCandidates")
if idx < 0:
    raise SystemExit("fn missing")
sub = t[idx:]
mpos = sub.find(marker)
if mpos < 0:
    raise SystemExit("marker in fn missing")
old_start = idx + mpos
old_end_token = "    for (const h of hits ?? []) {"
epos = t.find(old_end_token, old_start)
if epos < 0:
    raise SystemExit("end missing")
old = t[old_start:epos]
new = r'''  const namedVenue = namedVenueFromWishes(req.wishes);
  const ayceMust = req.wishes.some(
    (w) =>
      w.hardness === 'must' &&
      w.kind === 'amenity' &&
      /all_you_can_eat|ayce|buffet|schlemmer/i.test(w.text),
  );
  const expandM =
    typeof req.liveExpandRadiusM === 'number' &&
    Number.isFinite(req.liveExpandRadiusM) &&
    req.liveExpandRadiusM > 0
      ? Math.min(120_000, Math.floor(req.liveExpandRadiusM))
      : 0;
  // Sight/Interesse: Pack leer lokal → Places 50–100 km
  // AYCE: Metro-Radius 55 km+, nicht am Dorf-GPS bei ~12–25 km hängen
  const radiusM = expandM
    ? Math.max(bound, expandM)
    : namedVenue
      ? 50_000
      : ayceMust
        ? Math.max(bound, 55_000)
      : interestSight
        ? Math.max(bound, 80_000)
        : gastroLive
          ? Math.max(bound, req.searchMode === 'city_best' ? 15_000 : 12_000)
          : req.searchMode === 'city_best'
            ? Math.max(bound, 15_000)
            : req.searchMode === 'here_now'
              ? Math.max(
                  bound,
                  HERE_NOW_RINGS_M[HERE_NOW_RINGS_M.length - 1] ?? bound,
                )
              : Math.max(bound, 2_500);
  const seen = new Set<string>();
  const out: PitchCandidate[] = [];
  const q = queryFor(req);
  let searchLat = req.anchor.lat;
  let searchLng = req.anchor.lng;
  if (
    (ayceMust || req.searchMode === 'city_best') &&
    (req.cityHint || '').trim() &&
    !/\bhier\b/i.test(req.cityHint || '')
  ) {
    try {
      const { geocodePlaceName } = require('../../services/navigation/googleMapsNav') as {
        geocodePlaceName: (
          q: string,
          o?: { cityHint?: string | null },
        ) => Promise<{ lat: number; lng: number } | null>;
      };
      const geo = await geocodePlaceName(String(req.cityHint).trim(), {
        cityHint: req.cityHint,
      });
      if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
        searchLat = geo.lat;
        searchLng = geo.lng;
      }
    } catch {
      /* soft */
    }
  }
  try {
    const hits = await searchPlacesByText({
      query: q,
      lat: searchLat,
      lng: searchLng,
      radiusM,
      enrich: true,
      forVisitMs: req.visitAtMs,
    });
    let extraHits: typeof hits = [];
    if (ayceMust && (hits?.length ?? 0) < 4) {
      try {
        extraHits =
          (await searchPlacesByText({
            query: `All you can eat Sushi Buffet Restaurant ${req.cityHint || ''}`.trim(),
            lat: searchLat,
            lng: searchLng,
            radiusM: Math.max(radiusM, 60_000),
            enrich: true,
            forVisitMs: req.visitAtMs,
          })) ?? [];
      } catch {
        extraHits = [];
      }
    }
    for (const h of [...(hits ?? []), ...extraHits]) {
'''
p.write_text(t[:old_start] + new + t[epos + len(old_end_token) :], encoding="utf-8")
print("patched", len(old), "->", len(new))
