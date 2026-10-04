/**
 * Magazin-Karte: Stay + Hub + Tages-Spots mit Tag-Nummern (+ Layout %).
 */

import type { DayPlan, ReiseOption, StoryStop } from './types';

export type MagazineMapPin = {
  id: string;
  dayNum: number | null;
  label: string;
  kind: 'stay' | 'hub' | 'day' | 'activity';
  lat: number;
  lng: number;
  bookUrl?: string | null;
};

export type MagazineMapLayoutPin = MagazineMapPin & {
  xPct: number;
  yPct: number;
};

function finite(lat?: number | null, lng?: number | null): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  );
}

/** Tag-Nummer aus dayKey-Reihenfolge. */
export function buildMagazineMapPins(opt: ReiseOption): MagazineMapPin[] {
  const pins: MagazineMapPin[] = [];
  const baseLat = opt.lat;
  const baseLng = opt.lng;

  if (finite(baseLat, baseLng)) {
    pins.push({
      id: `stay_${opt.id}`,
      dayNum: null,
      label: opt.stayName || opt.placeName || 'Stay',
      kind: 'stay',
      lat: baseLat!,
      lng: baseLng!,
      bookUrl: opt.stayBookUrl,
    });
  }

  const days = opt.days ?? [];
  days.forEach((day, i) => {
    const dayNum = i + 1;
    const stop = (opt.stops ?? []).find((s) => s.dayKey === day.dayKey && finite(s.lat, s.lng));
    if (stop && finite(stop.lat, stop.lng)) {
      pins.push({
        id: `day_${day.dayKey}`,
        dayNum,
        label: day.weekdayLabel
          ? `${day.weekdayLabel} · ${day.title.split('·')[0]?.trim() || `Tag ${dayNum}`}`
          : day.title.split('·')[0]?.trim() || `Tag ${dayNum}`,
        kind: 'day',
        lat: stop.lat!,
        lng: stop.lng!,
        bookUrl: day.blocks?.find((b) => b.bookUrl)?.bookUrl,
      });
      return;
    }
    // Ohne Geo: leichte Spirale um Stay (nur wenn Stay-Geo da)
    if (finite(baseLat, baseLng)) {
      const a = (i * 0.7) % (Math.PI * 2);
      const r = 0.008 + i * 0.002;
      pins.push({
        id: `day_approx_${day.dayKey}`,
        dayNum,
        label: day.weekdayLabel
          ? `${day.weekdayLabel} · Tag ${dayNum}`
          : `Tag ${dayNum}`,
        kind: 'day',
        lat: baseLat! + Math.sin(a) * r,
        lng: baseLng! + Math.cos(a) * r,
        bookUrl: day.blocks?.find((b) => b.bookUrl)?.bookUrl,
      });
    }
  });

  for (const s of (opt.stops ?? []).slice(0, 6)) {
    if (!finite(s.lat, s.lng)) continue;
    if (pins.some((p) => p.lat === s.lat && p.lng === s.lng)) continue;
    pins.push({
      id: `stop_${s.id}`,
      dayNum: s.dayIndex ?? null,
      label: s.title,
      kind: s.kind === 'stay' ? 'stay' : s.kind === 'transfer' ? 'hub' : 'activity',
      lat: s.lat!,
      lng: s.lng!,
    });
  }

  return pins.slice(0, 12);
}

/**
 * Lat/Lng → Prozent im Magazin-Kartenrahmen (Padding 10–90).
 * Eine Stadt / enger Cluster → leichte Spreizung, damit Nummern lesbar bleiben.
 */
export function layoutMagazineMapPins(pins: MagazineMapPin[]): MagazineMapLayoutPin[] {
  if (!pins.length) return [];
  let latMin = Infinity;
  let latMax = -Infinity;
  let lngMin = Infinity;
  let lngMax = -Infinity;
  for (const p of pins) {
    latMin = Math.min(latMin, p.lat);
    latMax = Math.max(latMax, p.lat);
    lngMin = Math.min(lngMin, p.lng);
    lngMax = Math.max(lngMax, p.lng);
  }
  const latPad = Math.max(0.02, (latMax - latMin) * 0.25 || 0.04);
  const lngPad = Math.max(0.02, (lngMax - lngMin) * 0.25 || 0.04);
  latMin -= latPad;
  latMax += latPad;
  lngMin -= lngPad;
  lngMax += lngPad;
  const latSpan = Math.max(0.001, latMax - latMin);
  const lngSpan = Math.max(0.001, lngMax - lngMin);

  const laid = pins.map((p, i) => {
    let xPct = 10 + ((p.lng - lngMin) / lngSpan) * 80;
    let yPct = 10 + (1 - (p.lat - latMin) / latSpan) * 80;
    // Stay etwas mittiger, Tages-Pins lesbar
    if (p.kind === 'stay') {
      xPct = xPct * 0.85 + 50 * 0.15;
      yPct = yPct * 0.85 + 52 * 0.15;
    } else if (p.dayNum != null) {
      const a = ((p.dayNum - 1) * 0.9) % (Math.PI * 2);
      xPct = Math.max(12, Math.min(88, xPct + Math.cos(a) * 3));
      yPct = Math.max(12, Math.min(88, yPct + Math.sin(a) * 3));
    }
    // Entzerr-Pass gegen Stacking
    xPct = Math.max(8, Math.min(92, xPct + (i % 3) * 0.4));
    yPct = Math.max(8, Math.min(92, yPct + (i % 2) * 0.5));
    return { ...p, xPct, yPct };
  });

  // Einfache Deconflict
  for (let i = 0; i < laid.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = laid[i]!;
      const b = laid[j]!;
      const dx = a.xPct - b.xPct;
      const dy = a.yPct - b.yPct;
      const d = Math.hypot(dx, dy);
      if (d < 9 && d > 0) {
        const push = (9 - d) / 2;
        a.xPct = Math.max(8, Math.min(92, a.xPct + (dx / d) * push));
        a.yPct = Math.max(8, Math.min(92, a.yPct + (dy / d) * push));
        b.xPct = Math.max(8, Math.min(92, b.xPct - (dx / d) * push));
        b.yPct = Math.max(8, Math.min(92, b.yPct - (dy / d) * push));
      }
    }
  }
  return laid;
}

/** DayPlan um weekdayLabel ergänzen falls fehlend. */
export function ensureDayWeekdayLabels(days: DayPlan[]): DayPlan[] {
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const;
  return (days ?? []).map((d) => {
    if (d.weekdayLabel) return d;
    if (!/^\d{4}-\d{2}-\d{2}/.test(d.dayKey)) return d;
    const wd = WD[new Date(`${d.dayKey.slice(0, 10)}T12:00:00`).getDay()];
    return { ...d, weekdayLabel: wd ?? null };
  });
}

/** StoryStops mit Tag-Nummern für Magazin-Karte. */
export function storyStopsWithDayNums(opt: ReiseOption): StoryStop[] {
  const dayIndex = new Map((opt.days ?? []).map((d, i) => [d.dayKey, i + 1]));
  return (opt.stops ?? []).map((s) => ({
    ...s,
    dayIndex: s.dayIndex ?? (s.dayKey ? dayIndex.get(s.dayKey) : undefined),
  }));
}
