/**
 * Fastline — sofortige Buttons (Maps, Route, Hotel-Affiliate, Pending-Slots, Expand).
 */

import type { QuickAction } from '../../types/concierge';
import type {
  ActionBoardInput,
  ActionEntity,
  ActionOpportunity,
  DeepJob,
} from './types';
import {
  MENU_DEEP_TIMEOUT_MS,
  PRESERVED_ACTION_TYPES,
} from './types';
import { labelForOpportunity } from './labels';
import { entityMatchesAction } from './entityBind';
import { shortenActionLabel } from '../concierge/actionLabelShorten';
import {
  buildEsimBoardAction,
  buildHotelBookAction,
  partnerSupportsIntent,
} from './partnerRouter';
import {
  isExpandShowMoreAction,
  shouldOfferExpandMore,
} from './opportunityScan';

function mapsUrl(
  name: string,
  _lat?: number,
  _lng?: number,
  placeId?: string | null,
): string | null {
  try {
    const { mapsUrlForGooglePlace } = require('../research/eventInfoUrl') as {
      mapsUrlForGooglePlace: (o: {
        placeName?: string | null;
        placeId?: string | null;
      }) => string | null;
    };
    return mapsUrlForGooglePlace({ placeName: name, placeId });
  } catch {
    return null;
  }
}

function navAction(entity: ActionEntity, multi: boolean): QuickAction | null {
  if (
    typeof entity.lat !== 'number' ||
    typeof entity.lng !== 'number' ||
    !Number.isFinite(entity.lat) ||
    !Number.isFinite(entity.lng)
  ) {
    return null;
  }
  return {
    type: 'START_NAVIGATION',
    label: labelForOpportunity('route', entity, { multiChoice: multi }),
    payload: {
      destLat: entity.lat,
      destLng: entity.lng,
      destName: entity.name,
      targetPoiId: entity.poiId ?? undefined,
      entityName: entity.name,
      entityRank: entity.rank,
      actionBoardId: `nav:${entity.rank}:${entity.name}`,
    },
  };
}

function mapsAction(entity: ActionEntity, multi: boolean): QuickAction | null {
  const url = mapsUrl(entity.name, entity.lat, entity.lng, entity.placeId);
  if (!url) return null;
  return {
    type: 'OPEN_URL',
    label: labelForOpportunity('maps', entity, { multiChoice: multi }),
    payload: {
      url,
      destName: entity.name,
      entityName: entity.name,
      entityRank: entity.rank,
      actionBoardId: `maps:${entity.rank}:${entity.name}`,
    },
  };
}

function pendingMenuAction(
  entity: ActionEntity,
  kind: 'menu_food' | 'menu_drinks',
  multi: boolean,
): QuickAction {
  return {
    type: 'OPEN_URL',
    label: labelForOpportunity(kind, entity, {
      multiChoice: multi,
      pending: true,
    }),
    payload: {
      pending: true,
      pendingKind: kind,
      destName: entity.name,
      entityName: entity.name,
      entityRank: entity.rank,
      actionBoardId: `${kind}:${entity.rank}:${entity.name}`,
    },
  };
}

function expandAction(
  input: ActionBoardInput,
  entity: ActionEntity | undefined,
): QuickAction | null {
  const user = (input.userText ?? '').trim();
  const speech = (input.speechText ?? '').trim();
  if (
    !shouldOfferExpandMore({
      userText: user,
      speechText: speech,
      module1: input.module1,
    })
  ) {
    return null;
  }

  const activity = Boolean(input.module1?.activity);
  const isPoiCard = Boolean(input.module1);
  // Wissens-/App-Fragen: nie Orts-Historie — nur die User-Frage vertiefen
  const knowledgeAsk =
    !isPoiCard &&
    /\b(app\s*store|apple|developer|review|einreich|xcode|testflight|wie\s+(geht|mach)|was\s+ist|wer\s+ist|erzähl|erzaehl|warum|hilfe|anleit)\b/iu.test(
      `${user} ${speech}`,
    );

  const expandKind = activity
    ? 'activity'
    : isPoiCard
      ? 'poi_history'
      : 'knowledge';

  const question = (user || speech).slice(0, 420);
  const prompt =
    expandKind === 'activity'
      ? `Mehr zu diesem Aktivitäts-Ort — was man hier macht, Preise/Dauer nur wenn belegt. Max 2000 Zeichen. Nichts erfinden, schon Gesagtes nicht wiederholen. Keine Meta-Abschlussfrage.`
        : expandKind === 'poi_history'
        ? `Noch mehr Historie zu diesem Ort — tiefer, was du noch nicht gesagt hast. Max 2000 Zeichen. Am Ort bleiben. Nichts erfinden. Keine Abschlussfrage.`
        : [
            'Vertiefe GENAU diese User-Frage ausführlicher und präziser.',
            `Frage: „${question}“`,
            'Max 2000 Zeichen. Nur belegte Fakten. Schon Gesagtes nicht wiederholen.',
            'NICHT über den aktuellen GPS-/Stadt-Ort sprechen, außer die Frage betrifft genau diesen Ort.',
            'Keine Meta-Abschlussfrage.',
          ].join(' ');

  return {
    type: 'SHOW_MORE',
    label: labelForOpportunity('expand', entity),
    payload: {
      textPrompt: prompt,
      // Nur bei echtem Modul-1-POI-Deep-Dive
      module1DeepDive: isPoiCard && !knowledgeAsk,
      targetPoiId: isPoiCard
        ? input.module1?.poiId ?? undefined
        : undefined,
      expandKind: knowledgeAsk ? 'knowledge' : expandKind,
      entityName: entity?.name,
      actionBoardId: `expand:${entity?.name ?? 'q'}`,
    },
  };
}

function filterSeed(
  seed: QuickAction[],
  ctx?: {
    speechText?: string;
    userText?: string;
    module1?: ActionBoardInput['module1'];
  },
): QuickAction[] {
  const speech = ctx?.speechText ?? '';
  const user = ctx?.userText ?? '';
  const blob = `${speech} ${user}`.toLowerCase();
  const knowledgeOnly =
    /\b(app\s*store|apple|developer|review|einreich|xcode|testflight|wie\s+(geht|mach)|was\s+ist|wer\s+ist)\b/iu.test(
      blob,
    ) &&
    !/\b(restaurant|hotel|museum|navigier|route|bring\s+mich)\b/iu.test(blob);

  return seed.filter((a) => {
    if (PRESERVED_ACTION_TYPES.has(a.type)) return true;
    if (a.type === 'SHOW_MORE' && a.payload.textPrompt?.startsWith('__')) {
      return true;
    }
    // Expand-„Noch mehr“ nur bei echtem Kontext (Modul 1 / Geschichte)
    if (a.type === 'SHOW_MORE' && isExpandShowMoreAction(a)) {
      return shouldOfferExpandMore({
        userText: user,
        speechText: speech,
        module1: ctx?.module1,
      });
    }
    if (a.type === 'START_NAVIGATION') {
      if (knowledgeOnly) return false;
      const name = String(a.payload.destName || a.label || '');
      if (!name || /koche|morgen\s*b\b/i.test(a.label)) return false;
      return (
        typeof a.payload.destLat === 'number' &&
        typeof a.payload.destLng === 'number'
      );
    }
    if (a.type === 'OPEN_URL') {
      const url = a.payload.url ?? '';
      if (!url || /findus\.local\/pending/i.test(url)) return false;
      if (!openUrlLooksRelevant(url, a.label, speech, user)) return false;
      return true;
    }
    if (a.type === 'BOOK_STAY22') return !knowledgeOnly;
    return false;
  });
}

/** Label/Speech und URL müssen thematisch passen — sonst Drop (kein obsucht.net bei App-Store). */
export function openUrlLooksRelevant(
  url: string,
  label: string,
  speech: string,
  user: string,
): boolean {
  let host = '';
  let path = '';
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    host = u.hostname.replace(/^www\./i, '').toLowerCase();
    path = `${u.pathname}${u.search}`.toLowerCase();
  } catch {
    return false;
  }
  const urlBlob = `${host} ${path}`;
  const topic = `${label} ${speech} ${user}`.toLowerCase();

  // Bekannte Partner / Maps / Flug-Deeplinks immer ok
  if (
    /expedia|stay22|getyourguide|musement|viator|tiqets|awin1|travelsecure|travsim|airalo|google\.[^/]*\/maps|maps\.google|apple\.com|developer\.apple|kiwi\.com|c111\.travelpayouts|tpx\.li|aviasales|discovercars|bounce\.com|(?:^|\.)uber\.com|m\.uber|klook|kkday|welcomepickups|gettransfer|frisonaut|inselflieger/i.test(
      urlBlob,
    )
  ) {
    return true;
  }

  // Buchungs-CTA + Affiliate-Tracker (custom_url=kiwi…) — Label-Tokens stehen nicht im Host
  if (
    /\b(flug|buchen|buchung|ticket)\b/iu.test(`${label} ${speech} ${user}`) &&
    /travelpayouts|tpx\.li|kiwi\.com|aviasales|frisonaut/i.test(urlBlob)
  ) {
    return true;
  }

  // App-Store / Apple-Frage → nur Apple/Developer-URLs
  if (/\b(app\s*store|apple\s+developer|testflight|xcode|einreich)/i.test(topic)) {
    return /apple\.com|appstore|itunes\.apple|developer\.apple/i.test(urlBlob);
  }

  // Mind. ein sinnvolles Token aus Label (≥4) muss in Host/Path vorkommen
  const tokens = (label || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !/^(https|http|www|link|seite|web|öffnen|oeffnen|docs?)$/i.test(t));
  if (tokens.length === 0) {
    // Generisches Label ohne Bezug → ablehnen
    return false;
  }
  const hit = tokens.some(
    (t) => host.includes(t) || path.includes(t) || host.split('.').some((p) => p.startsWith(t.slice(0, 4))),
  );
  return hit;
}

export function buildFastline(opts: {
  input: ActionBoardInput;
  opportunities: ActionOpportunity[];
  entities: ActionEntity[];
}): { actions: QuickAction[]; deepJobs: DeepJob[] } {
  const { input, opportunities, entities } = opts;
  const multi = entities.length >= 2;
  const max = input.maxActions ?? 4;
  const actions: QuickAction[] = [];
  const deepJobs: DeepJob[] = [];
  const usedKinds = new Set<string>();

  const push = (a: QuickAction | null | undefined) => {
    if (!a || actions.length >= max) return;
    const id = a.payload.actionBoardId ?? `${a.type}:${a.label}`;
    if (actions.some((x) => (x.payload.actionBoardId ?? x.label) === id)) {
      return;
    }
    actions.push(a);
  };

  // System-Seeds zuerst
  for (const s of filterSeed(input.seedActions ?? [], {
    speechText: input.speechText,
    userText: input.userText,
    module1: input.module1,
  })) {
    if (PRESERVED_ACTION_TYPES.has(s.type)) push(s);
  }

  // Prefill-Buchung (Kiwi / Aviasales / Airline) vor Speech-Mining
  for (const s of filterSeed(input.seedActions ?? [], {
    speechText: input.speechText,
    userText: input.userText,
    module1: input.module1,
  })) {
    if (
      s.type === 'SHOW_MORE' &&
      /\bnimm\s+flug\b/i.test(s.payload.textPrompt ?? '')
    ) {
      push(s);
      continue;
    }
    if (s.type !== 'OPEN_URL' || !s.payload.url) continue;
    if (
      /kiwi\.com|c111\.travelpayouts|aviasales|tpx\.li\/zk7udfoO/i.test(
        s.payload.url,
      ) ||
      /\b(buchen|vergleichen)\b|^Bei\s+/i.test(s.label)
    ) {
      push(s);
    }
  }

  // Research-Hotel-Deeplinks zuerst — nie durch generische Suche ersetzen
  for (const s of filterSeed(input.seedActions ?? [], {
    speechText: input.speechText,
    userText: input.userText,
    module1: input.module1,
  })) {
    if (
      s.type === 'OPEN_URL' &&
      s.payload.url &&
      /expedia|stay22|booking\.com|hotels\.com|vrbo|affiliate/i.test(
        s.payload.url,
      )
    ) {
      push({
        ...s,
        payload: {
          ...s.payload,
          actionBoardId:
            s.payload.actionBoardId ??
            `hotel-seed:${s.payload.entityRank ?? 0}:${s.label}`,
        },
      });
    }
    if (s.type === 'BOOK_STAY22') push(s);
  }

  for (const opp of opportunities) {
    if (actions.length >= max) break;
    const key = `${opp.kind}:${opp.entity?.rank ?? 0}`;
    if (usedKinds.has(key)) continue;

    switch (opp.kind) {
      case 'route': {
        if (!opp.entity) break;
        const nav = navAction(opp.entity, multi);
        if (nav) {
          push(nav);
          usedKinds.add(key);
        } else {
          const maps = mapsAction(opp.entity, multi);
          if (maps) {
            push(maps);
            usedKinds.add(key);
          }
        }
        break;
      }
      case 'maps': {
        if (!opp.entity) break;
        // Nur wenn noch keine Route für diese Entity
        if (
          actions.some(
            (a) =>
              a.payload.entityName &&
              entityMatchesAction(
                opp.entity!.name,
                a.label,
                a.payload.entityName,
              ) &&
              (a.type === 'START_NAVIGATION' ||
                /maps\.google|google\.com\/maps/i.test(a.payload.url ?? '')),
          )
        ) {
          break;
        }
        const maps = mapsAction(opp.entity, multi);
        if (maps) {
          push(maps);
          usedKinds.add(key);
        }
        break;
      }
      case 'hotel_book': {
        if (!opp.entity || !partnerSupportsIntent('hotel_book')) break;
        const ent = opp.entity;
        const alreadyBooked = actions.some(
          (a) =>
            (a.type === 'OPEN_URL' || a.type === 'BOOK_STAY22') &&
            Boolean(a.payload.url) &&
            /expedia|stay22|booking\.com|hotels\.com|vrbo|affiliate/i.test(
              a.payload.url ?? '',
            ) &&
            entityMatchesAction(
              ent.name,
              a.label,
              a.payload.entityName || a.payload.destName || a.payload.destination,
            ),
        );
        if (alreadyBooked) {
          usedKinds.add(key);
          break;
        }
        // Seed-URL für dieses Hotel bevorzugen
        const seedHit = filterSeed(input.seedActions ?? [], {
          speechText: input.speechText,
          userText: input.userText,
          module1: input.module1,
        }).find(
          (a) =>
            a.type === 'OPEN_URL' &&
            a.payload.url &&
            /expedia|stay22|booking\.com|hotels\.com|vrbo|affiliate/i.test(
              a.payload.url,
            ) &&
            entityMatchesAction(
              ent.name,
              a.label,
              a.payload.entityName || a.payload.destName,
            ),
        );
        if (seedHit) {
          push({
            ...seedHit,
            label: labelForOpportunity('hotel_book', ent, {
              multiChoice: multi,
              affiliate: true,
            }),
            payload: {
              ...seedHit.payload,
              destName: ent.name,
              entityName: ent.name,
              entityRank: ent.rank,
              affiliateMarked: true,
              actionBoardId: `hotel:${ent.rank}:${ent.name}`,
              ...(ent.checkin ? { checkin: ent.checkin } : {}),
              ...(ent.checkout ? { checkout: ent.checkout } : {}),
              ...(ent.adults != null ? { adults: ent.adults } : {}),
            },
          });
        } else {
          push(
            buildHotelBookAction(
              {
                ...ent,
                bookUrl: ent.bookUrl || ent.websiteUrl,
              },
              { multiChoice: multi },
            ),
          );
        }
        usedKinds.add(key);
        break;
      }
      case 'menu_food':
      case 'menu_drinks': {
        if (!opp.entity) break;
        const slotId = `${opp.kind}:${opp.entity.rank}:${opp.entity.name}`;
        push(pendingMenuAction(opp.entity, opp.kind, multi));
        deepJobs.push({
          id: `deep:${slotId}`,
          kind: opp.kind,
          entity: opp.entity,
          websiteUrl: opp.entity.websiteUrl,
          timeoutMs: MENU_DEEP_TIMEOUT_MS,
          pendingLabel: labelForOpportunity(opp.kind, opp.entity, {
            multiChoice: multi,
            pending: true,
          }),
          slotId,
        });
        usedKinds.add(key);
        break;
      }
      case 'esim': {
        if (!partnerSupportsIntent('esim')) break;
        push(buildEsimBoardAction());
        usedKinds.add(key);
        break;
      }
      case 'expand': {
        push(expandAction(input, opp.entity ?? entities[0]));
        usedKinds.add(key);
        break;
      }
      case 'wifi_place': {
        if (!opp.entity) break;
        const maps = mapsAction(opp.entity, multi);
        if (!maps) break;
        push({
          ...maps,
          label: labelForOpportunity('wifi_place', opp.entity, {
            multiChoice: multi,
          }),
        });
        usedKinds.add(key);
        break;
      }
      default:
        break;
    }
  }

  // Seed NAV/URL/Expand die Entity-ok sind nachziehen wenn Platz
  for (const s of filterSeed(input.seedActions ?? [], {
    speechText: input.speechText,
    userText: input.userText,
    module1: input.module1,
  })) {
    if (actions.length >= max) break;
    if (PRESERVED_ACTION_TYPES.has(s.type)) continue;
    if (s.type === 'SHOW_MORE' && isExpandShowMoreAction(s)) {
      if (
        shouldOfferExpandMore({
          userText: input.userText,
          speechText: input.speechText,
          module1: input.module1,
        })
      ) {
        push(s);
      }
      continue;
    }
    if (s.type === 'START_NAVIGATION' || s.type === 'OPEN_URL') {
      const relabeled = { ...s };
      if (s.type === 'START_NAVIGATION' && s.payload.destName) {
        const ent: ActionEntity = {
          name: String(s.payload.destName),
          rank: (actions.filter((a) => a.type === 'START_NAVIGATION').length ===
          0
            ? 1
            : 2) as 1 | 2,
          lat: s.payload.destLat,
          lng: s.payload.destLng,
        };
        relabeled.label = labelForOpportunity('route', ent, {
          multiChoice: multi || ent.rank === 2,
        });
        relabeled.payload = {
          ...s.payload,
          entityName: ent.name,
          entityRank: ent.rank,
          actionBoardId: `nav:${ent.rank}:${ent.name}`,
        };
      } else if (s.type === 'OPEN_URL') {
        relabeled.label = shortenActionLabel(s.label);
      }
      push(relabeled);
    }
  }

  return { actions: actions.slice(0, max), deepJobs };
}
