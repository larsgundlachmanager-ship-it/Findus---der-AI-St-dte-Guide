/**
 * Pflichtmodule = Job-Backends hinter jobs[], keine zweiten Router-Weichen.
 */

import type { FindusJobId } from '../../jobs/types';

export type ModuleBackend = {
  module:
    | 'm1'
    | 'pitch'
    | 'plan'
    | 'nav'
    | 'handsfree'
    | 'transit'
    | 'flight'
    | 'weather'
    | 'tour'
    | 'geo'
    | 'taxi'
    | 'reserve'
    | 'sunset'
    | 'stay'
    | 'fact'
    | 'care'
    | 'talk';
  backend: string;
};

export const JOB_MODULE_BACKEND: Record<FindusJobId, ModuleBackend> = {
  poi_identify: { module: 'm1', backend: 'packMatchFacts / module1PoiChat' },
  museum_theme: { module: 'm1', backend: 'packMatchFacts' },
  sight_recommend: { module: 'tour', backend: 'pitchFactLane / explore' },
  dining_open: { module: 'pitch', backend: 'pitchFactLane' },
  dining_hard_match: { module: 'pitch', backend: 'pitchFactLane + hardMatch' },
  stay_search: { module: 'stay', backend: 'stayMustHaves + stay22 deeplink' },
  tonight_live: { module: 'pitch', backend: 'cinema / events research' },
  nightlife_vibe: { module: 'pitch', backend: 'nightlife facts' },
  day_plan_budget: { module: 'plan', backend: 'weave only — child jobs stay' },
  nav_route: { module: 'nav', backend: 'amenityNavFacts / fossgis' },
  transit_live: { module: 'transit', backend: 'transit live + leave-by' },
  taxi_rideshare: { module: 'taxi', backend: 'uber deeplink first' },
  parking_ev: { module: 'geo', backend: 'parkingFactLane' },
  mobility_rent: { module: 'nav', backend: 'mobility rent' },
  weather_outfit: { module: 'weather', backend: 'rucksack weather + rainVsOutdoor' },
  fact_number: { module: 'fact', backend: 'web/knowledge — no pack writeback' },
  activity_sport: { module: 'tour', backend: 'activity fill + option forks' },
  shopping_errand: { module: 'care', backend: 'places generic' },
  luggage_practical: { module: 'care', backend: 'practical fill' },
  emergency_care: { module: 'care', backend: 'emergency fill' },
  safety_lost: { module: 'care', backend: 'safety fill' },
  friction_now: { module: 'geo', backend: 'logistics / charge / toilet' },
  smalltalk_general: { module: 'talk', backend: 'smalltalk agent' },
};

export function backendForJob(job: FindusJobId): ModuleBackend {
  return JOB_MODULE_BACKEND[job];
}
