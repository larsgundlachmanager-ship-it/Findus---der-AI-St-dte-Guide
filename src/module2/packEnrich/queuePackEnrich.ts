/**
 * Pack-Miss → Staging enrich queue (Gate + upload later).
 */

export type PackEnrichQueued = {
  id: string;
  userText: string;
  lat: number;
  lng: number;
  createdAt: string;
  status: 'staging';
};

const queue: PackEnrichQueued[] = [];

export function queuePackEnrichFromMiss(opts: {
  userText: string;
  lat: number;
  lng: number;
}): PackEnrichQueued {
  const item: PackEnrichQueued = {
    id: `enrich_${Date.now().toString(36)}`,
    userText: opts.userText.slice(0, 240),
    lat: opts.lat,
    lng: opts.lng,
    createdAt: new Date().toISOString(),
    status: 'staging',
  };
  queue.push(item);
  if (__DEV__) {
    console.log(
      '[packEnrich] staged miss — research+gate+upload later:',
      item.id,
      item.userText.slice(0, 60),
    );
  }
  return item;
}

export function listPackEnrichQueue(): PackEnrichQueued[] {
  return [...queue];
}
