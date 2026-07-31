/**
 * Regenfenster + „klüger als der User“-Lücken füllen
 * (Checkout, Check-in, Frühstück, Wartezeiten, Zwischenstopps).
 */

import { useDayPlanStore } from '../../store/useDayPlanStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import {
  clockLabel,
  todayDateKey,
  uid,
  type DayPlanItem,
} from '../../types/dayPlan';
import { getRainWindowsForPlanning, getWeatherTrackerState } from '../logistics/weatherTracker';
import { bufferMinutesForKind, leaveByFromArrive, arriveByFromDeadline } from './bufferMath';
import { parkedCarConstraintMs, syncParkedCarIntoDayPlan } from './parkedCar';

/** Immer Regen als Timeline-Blöcke eintragen. */
export function syncRainIntoDayPlan(dateKey = todayDateKey()): void {
  const windows = getRainWindowsForPlanning();
  const st = getWeatherTrackerState();
  const store = useDayPlanStore.getState();
  const day = store.ensureDay(dateKey);

  // Alte Weather-Items entfernen und neu setzen
  const kept = day.items.filter((i) => i.kind !== 'weather');
  const rainItems: DayPlanItem[] = [];

  if (st?.nextRainAtMs && st.nextRainAtMs > Date.now()) {
    rainItems.push({
      id: uid('rain0'),
      kind: 'weather',
      title: `🌧 Regen ab ${clockLabel(st.nextRainAtMs)}`,
      startMs: st.nextRainAtMs,
      endMs: st.nextRainAtMs + 60 * 60_000,
      timed: true,
      status: 'planned',
      source: 'weather',
      sortOrder: 80,
      notes: st.summaryLine || 'Live-Wetter (OWM)',
    });
  }

  for (const win of windows.slice(0, 4)) {
    if (win.endMs < Date.now()) continue;
    rainItems.push({
      id: uid('rain'),
      kind: 'weather',
      title: `🌧 Regen ${clockLabel(win.startMs)}–${clockLabel(win.endMs)} (~${win.pop}%)`,
      startMs: win.startMs,
      endMs: win.endMs,
      timed: true,
      status: 'planned',
      source: 'weather',
      sortOrder: 81,
      notes: 'In dieser Zeit Indoor / Café / Museum — Outdoor verschieben.',
    });
  }

  if (!rainItems.length && st?.dayStableDry) {
    // einmaliger Hinweis-Punkt ohne Uhr
    if (!kept.some((i) => i.kind === 'weather')) {
      rainItems.push({
        id: uid('dry'),
        kind: 'weather',
        title: 'Wetter heute stabil trocken',
        startMs: null,
        endMs: null,
        timed: false,
        status: 'planned',
        source: 'weather',
        sortOrder: 80,
      });
    }
  }

  store.replaceItems(dateKey, [...kept, ...rainItems]);
  if (rainItems.some((r) => r.timed)) {
    store.addChange(dateKey, {
      summary: 'Regenfenster in den Tagesplan übernommen',
      reason: rainItems
        .filter((r) => r.timed)
        .map((r) => r.title)
        .join(' · '),
      significant: rainItems.some((r) => r.timed && (r.startMs ?? 0) - Date.now() < 3 * 60 * 60_000),
    });
  }
}

/**
 * Fehlende Logistik ergänzen, damit nichts verpasst wird.
 */
export function fillLogisticsGaps(dateKey = todayDateKey()): string[] {
  const store = useDayPlanStore.getState();
  const day = store.ensureDay(dateKey);
  const notes: string[] = [];
  const hotel = useUserMemoryStore.getState().getConfirmedHotel();
  const items = [...day.items];
  const hard = items
    .filter((i) => i.hardDeadline && i.startMs != null)
    .sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));

  if (hotel && hard.length) {
    const firstHard = hard[0]!;
    const leaveish = items.find(
      (i) =>
        (i.kind === 'nav' || i.kind === 'transit' || i.kind === 'taxi') &&
        !i.hardDeadline &&
        i.startMs != null &&
        i.startMs < (firstHard.startMs ?? 0),
    );

    if (!items.some((i) => i.kind === 'checkout')) {
      const leaveMs =
        leaveish?.startMs ??
        leaveByFromArrive(firstHard.startMs!, 40);
      const checkoutStart = leaveByFromArrive(
        leaveMs,
        bufferMinutesForKind('checkout'),
      );
      items.push({
        id: uid('out'),
        kind: 'checkout',
        title: `Auschecken ${hotel.name}`,
        startMs: checkoutStart,
        endMs: leaveMs,
        timed: true,
        status: 'planned',
        placeName: hotel.name,
        lat: hotel.lat,
        lng: hotel.lng,
        source: 'module5',
        bufferMin: bufferMinutesForKind('checkout'),
        sortOrder: 40,
        notes: 'Automatisch ergänzt — damit du den Zug/Flug nicht verpasst.',
      });
      notes.push('Checkout ergänzt');
    }

    if (!items.some((i) => i.kind === 'breakfast' && i.timed)) {
      const checkout = items.find((i) => i.kind === 'checkout');
      const end = checkout?.startMs ?? leaveByFromArrive(firstHard.startMs!, 60);
      const start = leaveByFromArrive(end, 40);
      items.push({
        id: uid('bf'),
        kind: 'breakfast',
        title: `Frühstück ${clockLabel(start)}–${clockLabel(end)}`,
        startMs: start,
        endMs: end,
        timed: true,
        status: 'planned',
        placeName: hotel.name,
        source: 'module5',
        sortOrder: 30,
        notes: 'Slot vor Checkout — Fenster eingeengt wegen Deadline.',
      });
      notes.push('Frühstück-Slot ergänzt');
    }

    if (!items.some((i) => i.kind === 'pack')) {
      const checkout = items.find((i) => i.kind === 'checkout');
      if (checkout?.startMs) {
        const packStart = leaveByFromArrive(checkout.startMs, 20);
        items.push({
          id: uid('pack'),
          kind: 'pack',
          title: 'Packen / Zimmer räumen',
          startMs: packStart,
          endMs: checkout.startMs,
          timed: true,
          status: 'planned',
          source: 'module5',
          sortOrder: 35,
        });
        notes.push('Packen ergänzt');
      }
    }

    // Wartezeit am Bahnhof/Flughafen
    if (!items.some((i) => i.kind === 'buffer' && /ankunft|puffer|bahnhof|flughafen/i.test(i.title))) {
      const bufferMin = /flug|airport|flughafen/i.test(firstHard.title)
        ? bufferMinutesForKind('flight_commercial')
        : bufferMinutesForKind('train_hbf');
      const arrive = arriveByFromDeadline(firstHard.startMs!, bufferMin);
      items.push({
        id: uid('wait'),
        kind: 'buffer',
        title: `Warte-/Sicherheits-Puffer (${bufferMin} Min)`,
        startMs: arrive,
        endMs: firstHard.startMs,
        timed: true,
        status: 'planned',
        hardDeadline: false,
        source: 'module5',
        bufferMin,
        sortOrder: 90,
        notes: 'Lieber zu früh als Stress.',
      });
      notes.push('Ankunfts-Puffer ergänzt');
    }
  }

  // Check-in am Ankunftstag (wenn Hotel + kein Checkout-Deadline-Tag)
  if (
    hotel &&
    !hard.length &&
    !items.some((i) => i.kind === 'checkin')
  ) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const checkin = new Date(y!, (m ?? 1) - 1, d ?? 1, 15, 0, 0, 0).getTime();
    items.push({
      id: uid('cin'),
      kind: 'checkin',
      title: `Check-in ${hotel.name} (ab ~15:00)`,
      startMs: checkin,
      endMs: checkin + 30 * 60_000,
      timed: true,
      status: 'planned',
      placeName: hotel.name,
      lat: hotel.lat,
      lng: hotel.lng,
      source: 'module5',
      sortOrder: 20,
      notes: 'Standard 15:00 — live Zeiten werden nachrecherchiert wenn nötig.',
    });
    notes.push('Check-in ergänzt');
  }

  const park = parkedCarConstraintMs();
  if (park.speechHint) notes.push(park.speechHint);
  if (
    park.mustReturnByMs &&
    !items.some((i) => /parkticket|zurück zum auto/i.test(i.title))
  ) {
    items.push({
      id: uid('parkback'),
      kind: 'buffer',
      title: 'Zurück zum Auto (Ticket)',
      startMs: park.mustReturnByMs,
      endMs: park.mustReturnByMs + 15 * 60_000,
      timed: true,
      status: 'planned',
      hardDeadline: true,
      source: 'module5',
      sortOrder: 56,
      notes: park.speechHint ?? undefined,
    });
    notes.push('Park-Rückkehr eingeplant');
  }

  store.replaceItems(dateKey, items);
  // Nach replace: Park-Session wieder eintragen (sonst würde replace sie löschen)
  syncParkedCarIntoDayPlan(dateKey);
  if (notes.length) {
    store.addChange(dateKey, {
      summary: 'Logistik-Lücken geschlossen',
      reason: notes.join(' · '),
      significant: notes.some((n) => /checkout|puffer|park/i.test(n)),
    });
  }
  return notes;
}
