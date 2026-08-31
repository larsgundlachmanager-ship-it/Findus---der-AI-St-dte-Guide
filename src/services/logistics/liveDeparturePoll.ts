/**
 * Live-Abfahrt-Poll für aktive Bus/Bahn-Watches.
 * Liest Verspätung/Ausfall/Gleis neu und meldet an Logistics Guardian.
 */

import { useLogisticsTriggerStore } from '../../store/useLogisticsTriggerStore';
import { getCachedUserProfile } from '../userProfileService';
import { reportConnectionDisruption } from './logisticsGuardian';
import { CLOCK_SNAP_MS, nextMsWithinWindow } from '../time/clockSnap';
import {
  buildTrainArrivingSpeech,
  buildTransitDelaySpeech,
} from '../flights/flightWatchEvents';

let lastPollPassMs = 0;
const MIN_POLL_GAP_MS = 45_000;
const lastAlertKey = new Map<string, string>();

function metaStr(
  meta: Record<string, string | number | boolean | null> | undefined,
  key: string,
): string | null {
  const v = meta?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function metaNum(
  meta: Record<string, string | number | boolean | null> | undefined,
  key: string,
): number | null {
  const v = meta?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function matchLine(a: string, b: string): boolean {
  const x = a.replace(/\s+/g, '').toLowerCase();
  const y = b.replace(/\s+/g, '').toLowerCase();
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

/**
 * Tick: fällige nextPollAtMs → Live-Departures → Delay/Cancel/Platform.
 */
export async function pollLiveDeparturesForWatches(opts?: {
  nowMs?: number;
  force?: boolean;
}): Promise<{ polled: number; updated: number }> {
  const now = opts?.nowMs ?? Date.now();
  if (!opts?.force && now - lastPollPassMs < MIN_POLL_GAP_MS) {
    return { polled: 0, updated: 0 };
  }
  lastPollPassMs = now;

  const store = useLogisticsTriggerStore.getState();
  if (!store.hydrated) return { polled: 0, updated: 0 };

  const events = store
    .getActiveEvents()
    .filter((e) => e.kind === 'bus' || e.kind === 'train');

  let polled = 0;
  let updated = 0;

  for (const event of events) {
    const stopId = metaStr(event.meta, 'stopId');
    if (!stopId) continue;

    // Nur pollen wenn Trigger nextPoll fällig oder Leave < 90 Min
    const leaveBy = metaNum(event.meta, 'leaveByMs');
    const untilLeave = leaveBy != null ? leaveBy - now : null;
    const dueTriggers = store.triggers.filter(
      (t) =>
        t.eventId === event.id &&
        (t.status === 'scheduled' || t.status === 'due') &&
        t.nextPollAtMs != null &&
        t.nextPollAtMs <= now,
    );
    const nearLeave =
      untilLeave != null && untilLeave > 0 && untilLeave <= 90 * 60_000;
    if (!dueTriggers.length && !nearLeave && !opts?.force) continue;

    polled += 1;
    try {
      const { fetchLiveDeparturesForCity } = await import(
        '../transit/adapters'
      );
      const profile = getCachedUserProfile();
      const cityId = profile?.cityId ?? profile?.cityName ?? 'unknown';
      const directionHint =
        metaStr(event.meta, 'directionHint') ||
        metaStr(event.meta, 'destName');
      const live = await fetchLiveDeparturesForCity({
        cityId,
        stopId,
        directionHint,
        limit: 8,
        stationName: metaStr(event.meta, 'stationName'),
      });
      if (!live?.departures?.length) {
        // nextPoll strecken
        bumpPoll(event.id, now + 3 * 60_000);
        continue;
      }

      const lineHint = event.title;
      const plannedBase = metaNum(event.meta, 'baseDepartureMs');
      const lineHits = live.departures.filter((d) => matchLine(d.line, lineHint));
      const targetMs = plannedBase ?? now;
      const best =
        nextMsWithinWindow(
          lineHits,
          (d) => d.when.getTime(),
          targetMs,
          CLOCK_SNAP_MS,
        ) ??
        lineHits
          .filter((d) => d.when.getTime() >= now)
          .sort((a, b) => a.when.getTime() - b.when.getTime())[0] ??
        null;
      if (!best) {
        bumpPoll(event.id, now + 2 * 60_000);
        continue;
      }

      const delayMin =
        best.delaySec != null
          ? Math.max(0, Math.round(best.delaySec / 60))
          : metaNum(event.meta, 'delayMin') ?? 0;
      const prevDelay = metaNum(event.meta, 'delayMin') ?? 0;
      const platform = best.platform?.trim() || null;
      const prevPlatform = metaStr(event.meta, 'platform');
      const untilDepMs = best.when.getTime() - now;
      const depStillLive = untilDepMs > -2 * 60_000;

      // Platform immer merken (auch ohne Delay-Änderung)
      if (platform && platform !== prevPlatform) {
        store.upsertEvent({
          id: event.id,
          kind: event.kind,
          title: event.title,
          detail: event.detail,
          atMs: event.atMs,
          lat: event.lat,
          lng: event.lng,
          status: 'active',
          externalId: event.externalId,
          meta: {
            ...(event.meta ?? {}),
            platform,
          },
        });
        updated += 1;
      }

      if (best.cancelled) {
        const key = `cancel:${event.id}`;
        if (lastAlertKey.get(event.id) !== key) {
          lastAlertKey.set(event.id, key);
          reportConnectionDisruption({
            eventId: event.id,
            status: 'cancelled',
            note: platform
              ? `Ausfall · zuletzt Gleis ${platform}`
              : 'Verbindung fällt aus',
          });
          void import('../notifications/travelAlertNotifications').then(
            ({ notifyTravelAlert }) =>
              notifyTravelAlert({
                id: `travel:cancel:${event.id}`,
                kind: 'cancel',
                title: event.title,
                body: platform
                  ? `Ausfall · zuletzt Gleis ${platform}`
                  : 'Verbindung fällt aus',
                fullText: `${event.title} fällt aus.${
                  platform ? ` Zuletzt Gleis ${platform}.` : ''
                }`,
              }),
          );
          updated += 1;
        }
      } else if (delayMin >= 3 && delayMin !== prevDelay) {
        const key = `delay:${event.id}:${delayMin}:${platform ?? ''}`;
        if (lastAlertKey.get(event.id) !== key) {
          lastAlertKey.set(event.id, key);
          reportConnectionDisruption({
            eventId: event.id,
            status: 'delayed',
            delayMin,
            note: platform
              ? `+${delayMin} Min · Gleis ${platform}`
              : `+${delayMin} Min Verspätung`,
          });
          if (depStillLive) {
            void import('../notifications/travelAlertNotifications').then(
              ({ notifyTravelAlert }) =>
                notifyTravelAlert({
                  id: `travel:delay:${event.id}`,
                  kind: 'delay',
                  title: event.title,
                  body: platform
                    ? `+${delayMin} Min · Gleis ${platform}`
                    : `+${delayMin} Min Verspätung`,
                  fullText: buildTransitDelaySpeech({
                    title: event.title,
                    delayMin,
                    platform,
                  }),
                }),
            );
          }
          updated += 1;
        }
      } else if (
        platform &&
        platform !== prevPlatform &&
        nearLeave &&
        untilLeave != null &&
        untilLeave <= 35 * 60_000
      ) {
        // Gleis-Info als weicher Hinweis (nicht dringend)
        const key = `plat:${event.id}:${platform}`;
        if (lastAlertKey.get(event.id) !== key) {
          lastAlertKey.set(event.id, key);
          try {
            const { scheduleNiceInfoPush } = await import(
              '../notifications/niceInfoNotifications'
            );
            void scheduleNiceInfoPush({
              title: `${event.title} · Gleis ${platform}`,
              body: metaStr(event.meta, 'stationName')
                ? `Abfahrt ${metaStr(event.meta, 'stationName')} — Gleis ${platform}`
                : `Dein Gleis: ${platform}`,
              dataKey: key,
            });
          } catch {
            /* soft */
          }
        }
      }

      if (
        !best.cancelled &&
        depStillLive &&
        (event.kind === 'train' || event.kind === 'bus')
      ) {
        const arriveSpeech = buildTrainArrivingSpeech({
          title: event.title,
          kind: event.kind,
          platform,
        });
        if (untilDepMs > 20_000 && untilDepMs <= 90_000) {
          const key = `arrive:${event.id}:${best.when.getTime()}`;
          if (lastAlertKey.get(event.id) !== key) {
            lastAlertKey.set(event.id, key);
            void import('../notifications/travelAlertNotifications').then(
              ({ notifyTravelAlert }) =>
                notifyTravelAlert({
                  id: `travel:arrive:${event.id}`,
                  kind: 'train',
                  title: event.title,
                  body: platform
                    ? `Fährt in einer Minute ein · Gleis ${platform}`
                    : 'Fährt in einer Minute ein',
                  fullText: arriveSpeech,
                }),
            );
          }
        } else if (untilDepMs > 90_000) {
          void import('../notifications/travelAlertNotifications').then(
            ({ scheduleTravelAlertAt }) =>
              scheduleTravelAlertAt({
                id: `travel:arrive:${event.id}`,
                kind: 'train',
                title: event.title,
                body: platform
                  ? `Fährt gleich ein · Gleis ${platform}`
                  : 'Fährt in einer Minute ein',
                fullText: arriveSpeech,
                fireAtMs: best.when.getTime() - 60_000,
              }),
          );
        }
      }

      const denser =
        delayMin >= 5 ? 60_000 : nearLeave ? 90_000 : 3 * 60_000;
      bumpPoll(event.id, now + denser);
    } catch (err) {
      console.warn('[liveDeparturePoll] failed', event.id, err);
      bumpPoll(event.id, now + 5 * 60_000);
    }
  }

  return { polled, updated };
}

function bumpPoll(eventId: string, nextPollAtMs: number): void {
  const store = useLogisticsTriggerStore.getState();
  const triggers = store.triggers.map((t) =>
    t.eventId === eventId &&
    (t.status === 'scheduled' || t.status === 'due')
      ? { ...t, nextPollAtMs, updatedAtMs: Date.now() }
      : t,
  );
  useLogisticsTriggerStore.setState({ triggers });
}
