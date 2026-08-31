/** Validate a CityPack for polygon / approach / sub integrity. */

function ringClosed(poly) {
  if (!poly || poly.length < 3) return false;
  const a = poly[0];
  const b = poly[poly.length - 1];
  const latA = a.latitude ?? a.lat;
  const lngA = a.longitude ?? a.lng;
  const latB = b.latitude ?? b.lat;
  const lngB = b.longitude ?? b.lng;
  return latA === latB && lngA === lngB
    ? true
    : poly.length >= 4; // allow open rings; mapper closes conceptually
}

export function validateCityPack(pack) {
  const errors = [];
  const warnings = [];

  if (!pack?.city_id) errors.push('missing city_id');
  if (!Array.isArray(pack.spots) || pack.spots.length === 0) {
    errors.push('spots empty');
  }

  const areaCenters = [];

  for (const spot of pack.spots || []) {
    const id = spot.id || spot.name || '?';
    const bullets = spot.bullets || [];
    const matrixCount = [
      spot.facts?.origin,
      spot.facts?.architecture,
      spot.facts?.now,
      spot.facts?.famousPersonConnected,
    ].filter(Boolean).length;
    if (bullets.length + matrixCount < 2) {
      warnings.push(`${id}: fewer than 2 hard facts (sourced bullets/matrix)`);
    }

    // P1: Haupt-POIs brauchen Offline-Erzählung (general_info ≥20)
    const triggers = pack.trigger_points || pack.triggerPoints || [];
    const related = triggers.filter(
      (t) =>
        t.id === spot.id ||
        (t.name &&
          spot.name &&
          String(t.name).trim().toLowerCase() ===
            String(spot.name).trim().toLowerCase()),
    );
    const infos = [
      spot.general_info,
      ...(related.map((t) => t.general_info).filter(Boolean) || []),
    ]
      .map((s) => String(s || '').trim())
      .filter((s) => s.length >= 20);
    const isTinySpot =
      !spot.polygonCoordinates &&
      !spot.polygon &&
      !(spot.approach_triggers || spot.approachTriggers || []).length;
    if (!infos.length && !isTinySpot) {
      warnings.push(
        `${id}: missing general_info / Offline-[Erzählung] (≥20 chars)`,
      );
    }

    const poly = spot.polygonCoordinates || spot.polygon;
    if (poly) {
      if (!ringClosed(poly) && poly.length < 3) {
        errors.push(`${id}: invalid polygon`);
      }
      const cLat =
        poly.reduce((s, p) => s + (p.latitude ?? p.lat), 0) / poly.length;
      const cLng =
        poly.reduce((s, p) => s + (p.longitude ?? p.lng), 0) / poly.length;
      areaCenters.push({ id, lat: cLat, lng: cLng, poly });
    }

    for (const a of spot.approach_triggers || spot.approachTriggers || []) {
      const lat = a.latitude ?? a.lat;
      const lng = a.longitude ?? a.lng;
      const teaser = a.teaserText || a.teaser_text || '';
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        errors.push(`${id}: approach missing coords`);
      }
      if (!teaser.trim()) warnings.push(`${id}: approach without teaser`);
    }

    for (const s of spot.sub_pois || spot.subPois || []) {
      const lat = s.latitude ?? s.lat;
      const lng = s.longitude ?? s.lng;
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        errors.push(`${id}/${s.id || s.name}: sub missing coords`);
      }
    }
  }

  // crude overlap warning: identical centers
  for (let i = 0; i < areaCenters.length; i++) {
    for (let j = i + 1; j < areaCenters.length; j++) {
      const a = areaCenters[i];
      const b = areaCenters[j];
      const d = Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 70000);
      if (d < 5) warnings.push(`centers almost identical: ${a.id} & ${b.id}`);
    }
  }

  // Spot far outside city → wrong city / bad GPS
  const cityLat = pack.lat;
  const cityLng = pack.lng;
  const cov = pack._coverage;
  if (typeof cityLat === 'number' && typeof cityLng === 'number') {
    for (const c of areaCenters) {
      const dKm =
        Math.hypot(
          (c.lat - cityLat) * 111.32,
          (c.lng - cityLng) *
            111.32 *
            Math.cos((cityLat * Math.PI) / 180),
        );
      if (dKm > 35) {
        errors.push(
          `${c.id}: centroid ${dKm.toFixed(1)} km from city center — likely wrong city/GPS`,
        );
      } else if (dKm > 18) {
        warnings.push(
          `${c.id}: centroid ${dKm.toFixed(1)} km from city center — check GPS`,
        );
      }
      if (
        cov &&
        typeof cov.latMin === 'number' &&
        typeof cov.latMax === 'number' &&
        typeof cov.lngMin === 'number' &&
        typeof cov.lngMax === 'number'
      ) {
        const pad = 0.02; // ~2 km
        if (
          c.lat < cov.latMin - pad ||
          c.lat > cov.latMax + pad ||
          c.lng < cov.lngMin - pad ||
          c.lng > cov.lngMax + pad
        ) {
          warnings.push(
            `${c.id}: outside _coverage BBox (padded) — verify position`,
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
