/**
 * Time-buffer watcher — when leaveBy hits 0, stop Modul 1 free-roam
 * and hand off to Modul 3 (strict navigation toward timed stop).
 */

import { generateGeminiText, hasGeminiApiKey } from '../geminiService';
import { resolveAndStartNavigation } from '../navigation/resolveNavTarget';
import { setRuntimeModule } from '../../runtime/orchestrator';
import { speakRuntimeText } from '../../runtime/speechModule';
import { useSessionPlanStore } from '../../store/useSessionPlanStore';
import { useFuturePlanStore } from '../../module2/timeline/futurePlanState';
import { useFinnusStore } from '../../store/useFinnusStore';
import { getVoiceSettingsForTour } from '../ttsService';
import { computeLeaveByMs } from './activateSessionPlan';

let lastTickMs = 0;
let firing = false;
const TICK_GAP_MS = 8_000;

async function speakLeaveLine(planLabel: string, arriveLocal: string): Promise<void> {
  const store = useFinnusStore.getState();
  if (store.isPlayingAudio || store.isListening || store.isGenerating) return;

  let line =
    'Zeit zu gehen — sonst schaffen wir den Termin nicht. Ich bring dich jetzt hin.';
  if (hasGeminiApiKey()) {
    try {
      const raw = await generateGeminiText(
        [
          'Du bist Yorro. Der User hat noch frei erkundet, jetzt ist der Zeitpuffer für einen Termin aufgebraucht.',
          `Ziel: ${planLabel}. Ankunftszeit: ${arriveLocal}.`,
          'Formuliere GENAU 1–2 kurze Sätze Deutsch (du-Form): freundlich drängen, Aufbruch, Navigation startet.',
          'Keine Listen, kein JSON, max. 40 Wörter.',
        ].join('\n'),
        { task: 'generic', maxTokens: 120, temperature: 0.5 },
      );
      const t = raw.trim();
      if (t.length >= 12) line = t;
    } catch {
      /* keep fallback */
    }
  }

  try {
    const voice = await getVoiceSettingsForTour();
    await speakRuntimeText(
      line,
      {
        voiceId: voice.voiceId,
        speechRate: voice.speechRate,
      },
      { deliveryKind: 'reminder' },
    );
  } catch (err) {
    if (__DEV__) console.warn('[deadline] speak failed:', err);
  }
}

/**
 * Call from GPS / mobility tick. Recalculates leave-by if GPS moved a lot,
 * fires once when buffer ≤ 0.
 */
export async function tickDeadlineWatcher(): Promise<void> {
  const now = Date.now();
  if (now - lastTickMs < TICK_GAP_MS) return;
  lastTickMs = now;
  if (firing) return;

  const store = useSessionPlanStore.getState();
  const plan = store.getActivePlan();
  if (!plan || plan.deadlineFired || !plan.freeRoam) return;

  const live = useFuturePlanStore.getState().plan.stops.filter(
    (s) => s.status !== 'done' && s.kind !== 'nav_leg',
  );
  const undone = plan.stops.filter((s) => !s.done);
  const stillOnTimeline =
    live.length > 0 &&
    undone.some((u) =>
      live.some((s) => {
        const a = (s.title || '').toLowerCase();
        const b = (u.label || '').toLowerCase();
        return (
          s.id === u.id ||
          (b.length >= 4 && a.includes(b.slice(0, 12))) ||
          (a.length >= 4 && b.includes(a.slice(0, 12)))
        );
      }),
    );
  if (!stillOnTimeline) {
    store.clearPlan();
    return;
  }

  const finnus = useFinnusStore.getState();
  const origin =
    finnus.lastGpsLat != null && finnus.lastGpsLng != null
      ? { lat: finnus.lastGpsLat, lng: finnus.lastGpsLng }
      : null;

  // Refresh leave-by as position / done-flags change
  const leaveBy = computeLeaveByMs(plan, now, origin);
  if (leaveBy != null && leaveBy !== plan.leaveByMs) {
    store.setPlan({ ...plan, leaveByMs: leaveBy });
  }

  const effectiveLeave = leaveBy ?? plan.leaveByMs;
  if (effectiveLeave == null) return;
  if (now < effectiveLeave) return;

  // Buffer exhausted
  firing = true;
  try {
    store.markDeadlineFired();
    setRuntimeModule('navigation');

    const next =
      plan.stops.find((s) => s.kind === 'hotel' && !s.done) ??
      plan.stops.find((s) => s.kind === 'fixed' && !s.done);

    const arrive =
      next?.arriveByMs != null
        ? new Date(next.arriveByMs).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';

    await speakLeaveLine(next?.label ?? 'dein Termin', arrive);

    if (next) {
      const result = await resolveAndStartNavigation({
        name: next.label,
        lat: next.lat,
        lng: next.lng,
      });
      if (!result.ok && __DEV__) {
        console.warn('[deadline] nav start failed:', result.message);
      }
    }
  } finally {
    firing = false;
  }
}
