import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('src/components/homeMap/HomePresenceMap.tsx');
const tmp = path.resolve('.cursor/_HomePresenceMap_sticky.tsx');
let s = fs.readFileSync(src, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';

if (!s.includes('sessionPaintedPlaceIdsRef')) {
  s = s.replace(
    `  const placeFillRingCacheRef = useRef<Map<number, LatLngRing>>(new Map());${nl}  /** POIs schon per Tile-Snap versucht`,
    `  const placeFillRingCacheRef = useRef<Map<number, LatLngRing>>(new Map());${nl}  /** Session: einmal gemalte Orte/Icons bleiben bis Stadtwechsel (kein Pan-Reload). */${nl}  const sessionPaintedPlaceIdsRef = useRef<Set<number>>(new Set());${nl}  /** POIs schon per Tile-Snap versucht`,
  );
}

if (!s.includes('sessionPaintedPlaceIdsRef.current.clear()')) {
  s = s.replace(
    `      placeFillRingCacheRef.current.clear();${nl}`,
    `      placeFillRingCacheRef.current.clear();${nl}      sessionPaintedPlaceIdsRef.current.clear();${nl}`,
  );
}

if (!s.includes('sessionPaintedPlaceIdsRef.current.add')) {
  const old = `      const stickyFillIds = placeFillRingCacheRef.current;${nl}      visible = fallback.filter((p) => {${nl}        const inView =${nl}          p.lat >= view.south - padLat &&${nl}          p.lat <= view.north + padLat &&${nl}          p.lng >= view.west - padLng &&${nl}          p.lng <= view.east + padLng;${nl}        if (inView) return true;${nl}        // Session-Fill: schon gezeichnete Story/Fokus-Flächen nicht aus dem${nl}        // GeoJSON werfen — sonst „lädt neu“ beim Zurück-Pannen.${nl}        if (p.ring && p.ring.length >= 3 && stickyFillIds.has(p.id)) return true;${nl}        if (p.keepPin) return true;${nl}        if (skipRings) return false;${nl}        // Außerhalb: nur nah am Viewport-Zentrum (nicht GPS — sonst Heide ohne Orte).${nl}        if (originLat == null || originLng == null) return false;${nl}        return metersBetween(p.lat, p.lng, originLat, originLng) <= radiusM;${nl}      });${nl}      if (visible.length > cap) {${nl}        visible = capMapPlacesForView(visible, cap, (p) =>${nl}          originLat != null && originLng != null${nl}            ? metersBetween(p.lat, p.lng, originLat, originLng)${nl}            : 0,${nl}        );${nl}      }${nl}    }`;

  const neu = `      const stickyFillIds = placeFillRingCacheRef.current;${nl}      const sessionIds = sessionPaintedPlaceIdsRef.current;${nl}      visible = fallback.filter((p) => {${nl}        const inView =${nl}          p.lat >= view.south - padLat &&${nl}          p.lat <= view.north + padLat &&${nl}          p.lng >= view.west - padLng &&${nl}          p.lng <= view.east + padLng;${nl}        if (inView) return true;${nl}        // Session: einmal gemalt (Icon oder Fläche) → bleibt, bis Stadtwechsel.${nl}        if (sessionIds.has(p.id)) return true;${nl}        if (p.ring && p.ring.length >= 3 && stickyFillIds.has(p.id)) return true;${nl}        if (p.keepPin) return true;${nl}        if (skipRings) return false;${nl}        if (originLat == null || originLng == null) return false;${nl}        return metersBetween(p.lat, p.lng, originLat, originLng) <= radiusM;${nl}      });${nl}      // Neu sichtbare merken — Cap darf Session-Orte nicht wieder werfen.${nl}      for (const p of visible) sessionIds.add(p.id);${nl}      if (visible.length > cap) {${nl}        const pinned = visible.filter(${nl}          (p) => p.keepPin || sessionIds.has(p.id) || (p.ring && p.ring.length >= 3),${nl}        );${nl}        const rest = visible.filter(${nl}          (p) => !(p.keepPin || sessionIds.has(p.id) || (p.ring && p.ring.length >= 3)),${nl}        );${nl}        const room = Math.max(0, Math.max(cap, 520) - pinned.length);${nl}        rest.sort((a, b) =>${nl}          originLat != null && originLng != null${nl}            ? metersBetween(a.lat, a.lng, originLat, originLng) -${nl}              metersBetween(b.lat, b.lng, originLat, originLng)${nl}            : 0,${nl}        );${nl}        visible = [...pinned, ...rest.slice(0, room)];${nl}      }${nl}    }`;

  if (!s.includes(old.split(nl)[0] + nl + old.split(nl)[1])) {
    // try softer match
  }
  if (s.includes(old)) {
    s = s.replace(old, neu);
  } else {
    console.log('viewport block not exact — trying alternate');
    // Alternate: just inject sessionIds.has after inView
    if (!s.includes('sessionIds.has(p.id)')) {
      s = s.replace(
        `        if (inView) return true;${nl}        // Session-Fill: schon gezeichnete Story/Fokus-Flächen nicht aus dem${nl}        // GeoJSON werfen — sonst „lädt neu“ beim Zurück-Pannen.${nl}        if (p.ring && p.ring.length >= 3 && stickyFillIds.has(p.id)) return true;`,
        `        if (inView) return true;${nl}        if (sessionPaintedPlaceIdsRef.current.has(p.id)) return true;${nl}        // Session-Fill: schon gezeichnete Story/Fokus-Flächen nicht aus dem${nl}        // GeoJSON werfen — sonst „lädt neu“ beim Zurück-Pannen.${nl}        if (p.ring && p.ring.length >= 3 && stickyFillIds.has(p.id)) return true;`,
      );
      s = s.replace(
        `      });${nl}      if (visible.length > cap) {${nl}        visible = capMapPlacesForView(visible, cap, (p) =>${nl}          originLat != null && originLng != null${nl}            ? metersBetween(p.lat, p.lng, originLat, originLng)${nl}            : 0,${nl}        );${nl}      }`,
        `      });${nl}      for (const p of visible) sessionPaintedPlaceIdsRef.current.add(p.id);${nl}      if (visible.length > cap) {${nl}        const sessionIds = sessionPaintedPlaceIdsRef.current;${nl}        const pinned = visible.filter(${nl}          (p) => p.keepPin || sessionIds.has(p.id) || !!(p.ring && p.ring.length >= 3),${nl}        );${nl}        const rest = visible.filter(${nl}          (p) => !(p.keepPin || sessionIds.has(p.id) || !!(p.ring && p.ring.length >= 3)),${nl}        );${nl}        rest.sort((a, b) =>${nl}          originLat != null && originLng != null${nl}            ? metersBetween(a.lat, a.lng, originLat, originLng) -${nl}              metersBetween(b.lat, b.lng, originLat, originLng)${nl}            : 0,${nl}        );${nl}        const room = Math.max(0, Math.max(cap, 520) - pinned.length);${nl}        visible = [...pinned, ...rest.slice(0, room)];${nl}      }`,
      );
    }
  }
}

fs.writeFileSync(tmp, s);
fs.renameSync(tmp, src);
console.log(
  'ok',
  s.includes('sessionPaintedPlaceIdsRef'),
  s.includes('sessionPaintedPlaceIdsRef.current.has'),
  s.includes('sessionPaintedPlaceIdsRef.current.add'),
);
