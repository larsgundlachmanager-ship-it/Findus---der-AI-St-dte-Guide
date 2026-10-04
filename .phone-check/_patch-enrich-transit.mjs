import fs from 'fs';

const p = 'src/services/concierge/eventTravelSpeech.ts';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('export async function enrichEventsWithLiveTransit');
const end = s.indexOf('export {\n  parseSpokenClockToMinutes');
if (start < 0 || end < 0) {
  console.error('markers missing', start, end);
  process.exit(1);
}

const replacement = `export async function enrichEventsWithLiveTransit(opts: {
  events: Array<{
    lat?: number | null;
    lng?: number | null;
    venue?: string;
    title?: string;
    startTime?: string | null;
    dateIso?: string | null;
    summary?: string | null;
    liveTransitMin?: number | null;
    liveArrivalAtMs?: number | null;
    liveLeaveAtMs?: number | null;
  }>;
  fromLat: number;
  fromLng: number;
  timeoutMs?: number;
}): Promise<void> {
  const top = opts.events
    .filter(
      (e) =>
        typeof e.lat === 'number' &&
        typeof e.lng === 'number' &&
        Number.isFinite(e.lat) &&
        Number.isFinite(e.lng),
    )
    .slice(0, 2);
  if (!top.length) return;

  const timeoutMs = Math.max(800, opts.timeoutMs ?? 2800);
  const work = async () => {
    const { planTransitHandsFree } = await import(
      '../navigation/handsFreeNav/transitBridge'
    );
    const { rememberJourneyForStart } = await import(
      '../navigation/journeyStartCache'
    );
    const { isLaterPlanSchedule } = await import('../speech/laterPlanSpeech');
    for (let i = 0; i < top.length; i++) {
      const e = top[i]!;
      try {
        const later = isLaterPlanSchedule({
          startTime: e.startTime,
          whenText: \`\${e.summary || ''} \${e.title || ''}\`,
        });
        let arriveBy: Date | null = null;
        if (later && e.startTime) {
          const m = String(e.startTime).match(/^(\\d{1,2}):(\\d{2})$/);
          if (m) {
            const target = new Date();
            if (e.dateIso && /^\\d{4}-\\d{2}-\\d{2}$/.test(e.dateIso)) {
              const [y, mo, d] = e.dateIso.split('-').map(Number);
              target.setFullYear(y!, mo! - 1, d!);
            }
            target.setHours(Number(m[1]), Number(m[2]), 0, 0);
            // ~35 Min Puffer vor Start (entspannt ankommen)
            arriveBy = new Date(target.getTime() - 35 * 60_000);
            if (arriveBy.getTime() <= Date.now() + 5 * 60_000) {
              arriveBy = null;
            }
          }
        }
        const best = await planTransitHandsFree({
          from: { lat: opts.fromLat, lng: opts.fromLng },
          to: { lat: e.lat!, lng: e.lng! },
          arriveBy,
        });
        if (!best) continue;
        const min = Math.max(1, Math.round(best.durationSec / 60));
        e.liveTransitMin = min;
        const end =
          best.endTime instanceof Date
            ? best.endTime
            : best.endTime
              ? new Date(best.endTime)
              : null;
        if (end && Number.isFinite(end.getTime())) {
          e.liveArrivalAtMs = end.getTime();
        }
        const startT =
          best.startTime instanceof Date
            ? best.startTime
            : best.startTime
              ? new Date(best.startTime)
              : null;
        if (startT && Number.isFinite(startT.getTime())) {
          e.liveLeaveAtMs = startT.getTime();
        }
        if (i === 0) {
          rememberJourneyForStart({
            itinerary: best,
            destName: (e.venue || e.title || 'Fest').trim(),
            destLat: e.lat!,
            destLng: e.lng!,
          });
        }
      } catch {
        /* soft */
      }
    }
  };

  await Promise.race([
    work(),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

`;

s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(p, s);
console.log('patched enrichEventsWithLiveTransit');
