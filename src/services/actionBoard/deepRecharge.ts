/**
 * Deep Recharge — Speisekarte/Tickets nachreichen während Audio läuft.
 */

import type { QuickAction } from '../../types/concierge';
import { useFinnusStore } from '../../store/useFinnusStore';
import { searchPlacesByText } from '../navigation/googleMapsNav';
import type { DeepJob } from './types';
import { findDeepestMenuLink, validateMenuUrl } from './menuDeepLink';
import { labelForOpportunity } from './labels';

function patchSlot(
  cardId: string | undefined,
  slotId: string,
  next: QuickAction | null,
): void {
  const store = useFinnusStore.getState();
  const card = store.activeConciergeCard;
  if (!card) return;
  if (cardId && card.id !== cardId) return;

  const actions = [...(card.quickActions ?? [])];
  const idx = actions.findIndex((a) => a.payload.actionBoardId === slotId);
  if (next == null) {
    if (idx >= 0) {
      actions.splice(idx, 1);
      store.setActiveConciergeCard({ ...card, quickActions: actions });
    }
    return;
  }
  if (idx >= 0) {
    actions[idx] = next;
  } else if (actions.length < 4) {
    actions.push(next);
  } else {
    const pIdx = actions.findIndex((a) => a.payload.pending);
    if (pIdx >= 0) actions[pIdx] = next;
    else return;
  }
  store.setActiveConciergeCard({ ...card, quickActions: actions });
}

async function resolveWebsiteUrl(job: DeepJob): Promise<string | null> {
  if (job.websiteUrl && /^https?:\/\//i.test(job.websiteUrl)) {
    return job.websiteUrl;
  }
  try {
    const store = useFinnusStore.getState();
    const lat =
      job.entity.lat ??
      store.lastGpsLat ??
      null;
    const lng =
      job.entity.lng ??
      store.lastGpsLng ??
      null;
    if (lat == null || lng == null) return null;
    const hits = await searchPlacesByText({
      query: job.entity.name,
      lat,
      lng,
      radiusM: 8000,
    });
    const hit =
      hits.find((h) => h.websiteUri) ??
      hits[0];
    return hit?.websiteUri?.trim() || null;
  } catch {
    return null;
  }
}

async function runMenuJob(
  job: DeepJob,
  cardId: string | undefined,
  signal: AbortSignal,
): Promise<void> {
  const website = await resolveWebsiteUrl(job);
  if (!website || signal.aborted) {
    patchSlot(cardId, job.slotId, null);
    return;
  }
  const kind = job.kind === 'menu_drinks' ? 'drinks' : 'food';
  const found = await findDeepestMenuLink({
    websiteUrl: website,
    kind,
    signal,
  });
  if (signal.aborted || !found) {
    patchSlot(cardId, job.slotId, null);
    return;
  }
  const ok = await validateMenuUrl(found.url, signal, { label: found.label });
  if (signal.aborted || !ok) {
    patchSlot(cardId, job.slotId, null);
    return;
  }
  const multi = job.entity.rank === 2;
  const ready: QuickAction = {
    type: 'OPEN_URL',
    label: labelForOpportunity(
      job.kind === 'menu_drinks' ? 'menu_drinks' : 'menu_food',
      job.entity,
      { multiChoice: multi },
    ),
    payload: {
      url: found.url,
      destName: job.entity.name,
      entityName: job.entity.name,
      entityRank: job.entity.rank,
      actionBoardId: job.slotId,
      pending: false,
    },
  };
  patchSlot(cardId, job.slotId, ready);
}

/**
 * Startet Deep-Jobs im Hintergrund. Pending-Chips werden live gepatcht.
 */
export function queueDeepRecharge(opts: {
  jobs: DeepJob[];
  cardId?: string;
}): AbortController {
  const ctrl = new AbortController();
  for (const job of opts.jobs) {
    void (async () => {
      const jobCtrl = new AbortController();
      const onParent = () => jobCtrl.abort();
      ctrl.signal.addEventListener('abort', onParent);
      const timer = setTimeout(() => jobCtrl.abort(), job.timeoutMs);
      try {
        if (job.kind === 'menu_food' || job.kind === 'menu_drinks') {
          await runMenuJob(job, opts.cardId, jobCtrl.signal);
        } else {
          patchSlot(opts.cardId, job.slotId, null);
        }
      } catch {
        patchSlot(opts.cardId, job.slotId, null);
      } finally {
        clearTimeout(timer);
        ctrl.signal.removeEventListener('abort', onParent);
      }
    })();
  }
  return ctrl;
}
