/**
 * Draft → lokaler Pack-SQLite + Wikipedia-Sätze + Cloud-Inbox für city:auto-Merge.
 */

import { upsertLearnedPoi } from '../../db/learnedPoiOverlay';
import { isHardAmenityNoise } from '../../interests/amenityInterestPolicy';
import { getCachedUserProfile } from '../userProfileService';
import { submitPackSpotToInbox } from './packSpotInbox';
import { fetchWikipediaPlaceExtract } from './wikipediaPlaceExtract';

type DiscoveredDraft = {
  name: string;
  lat: number;
  lng: number;
  category: string | null;
  cityId: string | null;
  facts: Array<{
    text: string;
    sourceUrl?: string | null;
    confidence: 'high' | 'medium' | 'low';
  }>;
  promptBlock: string;
};

const AMENITY_DETOUR_NOISE_RE =
  /\b(fris[oö]r|friseur|coiffeur|haarstudio|barber|nagelsalon|nagelstudio|blumenladen|florist|floristik|\bladen\b|\bshop\b|boutique|kiosk|drogerie|supermarkt)\b/i;

const STORY_PLACE_RE =
  /\b(museum|denkmal|kirche|dom|kapelle|schloss|burg|friedhof|kirchhof|leuchtturm|hafen|rathaus|synagoge|kloster|turm|brücke|bruecke|park|garten|altstadt|ruine|warte|aussicht)\b/i;

function classifyPackRole(
  name: string,
  category: string | null,
  wikiChars: number,
  factCount: number,
): 'story' | 'directory' {
  const noisePoi = {
    id: 0,
    name,
    lat: 0,
    lng: 0,
    radius_meters: 20,
    category,
    tags_json: null,
  };
  if (isHardAmenityNoise(noisePoi)) return 'directory';
  if (AMENITY_DETOUR_NOISE_RE.test(`${category ?? ''} ${name}`)) return 'directory';
  if (/\b(restaurant|café|cafe|bistro|bar|imbiss|hotel|pension|shop|laden)\b/i.test(name)) {
    return 'directory';
  }
  if (STORY_PLACE_RE.test(`${category ?? ''} ${name}`) && (wikiChars >= 120 || factCount >= 3)) {
    return 'story';
  }
  if (wikiChars >= 400 && factCount >= 2) return 'story';
  return 'directory';
}

export async function persistDiscoveredPoiIntoDataset<T extends DiscoveredDraft>(
  draft: T,
  opts?: { skipWiki?: boolean; tags?: string[]; userText?: string },
): Promise<T> {
  try {
    const { shouldWriteCityPack } = require('../../module2/reboot/pipeline/worldFactGuard') as {
      shouldWriteCityPack: (o: { name: string; userText?: string }) => boolean;
    };
    if (!shouldWriteCityPack({ name: draft.name, userText: opts?.userText })) {
      return draft;
    }
  } catch {
    /* soft */
  }
  const profile = getCachedUserProfile();
  const cityName = profile?.cityName ?? null;
  let wikiChars = 0;
  let wikiUrl: string | null = null;
  let wikiExtract: string | null = null;

  if (!opts?.skipWiki) {
    try {
      const wiki = await fetchWikipediaPlaceExtract({
        name: draft.name,
        cityName,
      });
      if (wiki?.extract) {
        wikiExtract = wiki.extract;
        wikiChars = wiki.extract.length;
        wikiUrl = wiki.url;
        draft.facts = [
          {
            text: wiki.extract.slice(0, 900),
            sourceUrl: wiki.url,
            confidence: 'high',
          },
          ...draft.facts,
        ];
        draft.promptBlock = [
          draft.promptBlock,
          `=== WIKIPEDIA (${wiki.lang}: ${wiki.title}) ===`,
          wiki.extract.slice(0, 1200),
          'Nur diese belegten Sätze nutzen — nichts dazuerfinden.',
        ].join('\n');
      }
    } catch {
      /* soft */
    }
  }

  const packRole = classifyPackRole(
    draft.name,
    draft.category,
    wikiChars,
    draft.facts.length,
  );

  try {
    await upsertLearnedPoi({
      cityId: draft.cityId,
      name: draft.name,
      lat: draft.lat,
      lng: draft.lng,
      category: draft.category,
      packRole,
      tags: opts?.tags,
      factTexts: draft.facts.map((f) =>
        f.sourceUrl ? `${f.text} (Quelle)` : f.text,
      ),
      teaserText: draft.facts[0]?.text ?? null,
    });
  } catch (err) {
    if (__DEV__) console.warn('[packGrowth] local sqlite insert failed', err);
  }

  try {
    const { scheduleImmediateCommunityCachePush } = await import(
      '../sync/nightlyCacheSync'
    );
    scheduleImmediateCommunityCachePush();
  } catch {
    /* soft */
  }

  const cityId = (draft.cityId || '').replace(/^soft_/, '').trim();
  if (cityId.length >= 2 && !/^unbekannt/i.test(draft.name)) {
    try {
      await submitPackSpotToInbox({
        cityId,
        cityName,
        name: draft.name,
        lat: draft.lat,
        lng: draft.lng,
        category: draft.category,
        packRole,
        placeTier: packRole === 'story' ? 2 : 4,
        facts: draft.facts.map((f) => ({
          text: f.text,
          sourceUrl: f.sourceUrl ?? null,
        })),
        wikiExtract,
        sourceUrl: wikiUrl,
      });
    } catch {
      /* soft */
    }
    try {
      const { maybePingCityPackDemand } = await import('../cityPackDemand');
      void maybePingCityPackDemand({
        lat: draft.lat,
        lng: draft.lng,
        force: true,
      });
    } catch {
      /* soft */
    }
  }

  return draft;
}
