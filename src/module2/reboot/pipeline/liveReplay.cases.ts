/**
 * ~30 echte Mehrturn-Situationen. Jobs + Avoids, keine Speech-Keyword-Regex.
 */

import type { FindusJobId } from '../../jobs/types';

export type ReplayTurn = {
  q: string;
  mustJobs: FindusJobId[];
  forbidJobs?: FindusJobId[];
  forbidClock?: boolean;
  weaveDayPlan?: boolean;
};

export type ReplaySituation = {
  id: string;
  turns: ReplayTurn[];
};

export const LIVE_REPLAY_SITUATIONS: ReplaySituation[] = [
  {
    id: 'hamburg-monday',
    turns: [
      {
        q: 'Morgen 9 Uhr los nach Hamburg, frühstücken, abends Pannfisch mit Elbblick, Michel rauf — wie hoch, wie teuer, was ist das, zwischendurch eine Tour.',
        mustJobs: ['transit_live', 'dining_open', 'dining_hard_match', 'poi_identify'],
        forbidClock: true,
        weaveDayPlan: true,
      },
    ],
  },
  {
    id: 'weather-and-eta',
    turns: [
      {
        q: 'Wie wird das Wetter und wie lange brauche ich da hin?',
        mustJobs: ['weather_outfit', 'nav_route'],
        forbidJobs: ['day_plan_budget'],
        weaveDayPlan: false,
      },
    ],
  },
  {
    id: 'pope-age',
    turns: [
      {
        q: 'Wie alt ist der Papst?',
        mustJobs: ['fact_number'],
        forbidJobs: ['day_plan_budget'],
        weaveDayPlan: false,
      },
    ],
  },
  {
    id: 'outfit-city-trip',
    turns: [
      {
        q: 'Wie wird morgen das Wetter, was muss ich anziehen wenn ich einen Städtetrip machen möchte',
        mustJobs: ['weather_outfit'],
        forbidJobs: ['day_plan_budget'],
      },
    ],
  },
  {
    id: 'sup-fork',
    turns: [
      { q: 'Darf ich SUP auf der Alster, Verleih oder eigenes Board?', mustJobs: ['activity_sport'] },
      { q: 'Ja', mustJobs: [] },
    ],
  },
  {
    id: 'hunger-not-sticky',
    turns: [
      { q: 'Lust auf Steak', mustJobs: ['dining_hard_match'] },
      { q: 'Ich hab Hunger', mustJobs: ['dining_open'] },
    ],
  },
  {
    id: 'flight-followup-gate',
    turns: [
      { q: 'Wann muss ich am Flughafen sein für den Flug nach Athen', mustJobs: ['nav_route'] },
      { q: 'Guck noch nach Gate und Terminal', mustJobs: ['nav_route'], forbidJobs: ['day_plan_budget'] },
    ],
  },
  {
    id: 'terrace-if-weather',
    turns: [
      {
        q: 'Heute Abend Terrasse, ruhig, lecker — wenn das Wetter mitspielt',
        mustJobs: ['weather_outfit', 'dining_open'],
        forbidJobs: ['day_plan_budget'],
      },
    ],
  },
  {
    id: 'hotel-pool-sauna-view',
    turns: [
      {
        q: 'Hotel mit Pool, Sauna und Blick über Hamburg',
        mustJobs: ['stay_search'],
        forbidJobs: ['day_plan_budget'],
      },
    ],
  },
  {
    id: 'taxi-uber',
    turns: [{ q: 'Ruf mir ein Uber', mustJobs: ['taxi_rideshare'] }],
  },
  {
    id: 'wecker-explicit',
    turns: [{ q: 'Stell mir einen Wecker um 7', mustJobs: [], forbidClock: false }],
  },
  {
    id: 'nine-departure-not-clock',
    turns: [
      {
        q: '9 Uhr los nach Hamburg',
        mustJobs: ['transit_live'],
        forbidClock: true,
      },
    ],
  },
  {
    id: 'picnic-weather-places',
    turns: [
      {
        q: 'Schönes Wetter, wo können wir picknicken',
        mustJobs: ['weather_outfit'],
        forbidJobs: ['day_plan_budget'],
      },
    ],
  },
  {
    id: 'eiffel-world',
    turns: [
      {
        q: 'Wie hoch ist der Eiffelturm?',
        mustJobs: ['fact_number'],
        forbidJobs: ['day_plan_budget'],
        weaveDayPlan: false,
      },
    ],
  },
  {
    id: 'full-moon',
    turns: [
      {
        q: 'Wann ist Vollmond?',
        mustJobs: ['fact_number'],
        forbidJobs: ['day_plan_budget'],
      },
    ],
  },
  {
    id: 'michel-facts',
    turns: [
      {
        q: 'Was ist der Michel, wie hoch, wie teuer der Eintritt',
        mustJobs: ['poi_identify', 'fact_number'],
      },
    ],
  },
  {
    id: 'nav-ulm',
    turns: [{ q: 'Navigier mich nach Ulm, wie lange brauche ich', mustJobs: ['nav_route'] }],
  },
  {
    id: 'sunset-dinner',
    turns: [
      {
        q: 'Essen zum Sonnenuntergang mit Elbblick',
        mustJobs: ['dining_hard_match', 'weather_outfit'],
      },
    ],
  },
  {
    id: 'flight-lh',
    turns: [{ q: 'Wann Boarding LH400, Terminal und Gate', mustJobs: ['nav_route'] }],
  },
  {
    id: 'stay-two-nights',
    turns: [{ q: 'Unterkunft Hamburg Pool Sauna zwei Nächte', mustJobs: ['stay_search'] }],
  },
  {
    id: 'price-after-pitch',
    turns: [
      { q: 'Zwei Cafés zum Frühstück', mustJobs: ['dining_open'] },
      { q: 'wie teuer', mustJobs: [] },
    ],
  },
  {
    id: 'ja-after-sup',
    turns: [
      { q: 'Eigenes SUP oder Verleih?', mustJobs: ['activity_sport'] },
      { q: 'Ja nimm Verleih', mustJobs: [] },
    ],
  },
  {
    id: 'weave-sup-before-fish',
    turns: [
      { q: 'Abends Pannfisch in Hamburg', mustJobs: ['dining_hard_match'] },
      { q: 'vorher noch SUP um 9', mustJobs: ['activity_sport'] },
    ],
  },
  {
    id: 'deictic-no-place',
    turns: [{ q: 'Bring mich da hin', mustJobs: ['nav_route'] }],
  },
  {
    id: 'handsfree-nav',
    turns: [{ q: 'Führ mich zum Rathaus', mustJobs: ['nav_route'] }],
  },
  {
    id: 'transit-live',
    turns: [{ q: 'Nächste S-Bahn nach Hamburg, wann fährt die', mustJobs: ['transit_live'] }],
  },
  {
    id: 'outfit-rain-jacket',
    turns: [{ q: 'Regnet es, was anziehen, Jacke oder nicht', mustJobs: ['weather_outfit'] }],
  },
  {
    id: 'tour-one-hour',
    turns: [{ q: 'Eine Stunde Tour, was ich noch nicht gesehen habe', mustJobs: ['sight_recommend'] }],
  },
  {
    id: 'vegetarian-dinner',
    turns: [{ q: 'Vegetarisch essen gehen heute Abend', mustJobs: ['dining_open'] }],
  },
  {
    id: 'compound-no-clock',
    turns: [
      {
        q: 'Um 9 Uhr los, frühstücken, abends Fisch, eine Tour',
        mustJobs: ['dining_open'],
        forbidClock: true,
        weaveDayPlan: true,
      },
    ],
  },
];
