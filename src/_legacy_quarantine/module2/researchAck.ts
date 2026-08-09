/**
 * Frühes Recherche-Ack — delegiert an die Offline-Floskel-Engine.
 * Zero-Latency bei Requests, die voraussichtlich > 2,5 s brauchen.
 */

import {
  analyzeSmartRoute,
  type SmartRouteDecision,
} from '../speech/smartRouteLite';
import {
  detectFloskelCategoryPublic,
  pickFloskelForUserText,
  shouldSpeakLatencyFloskel,
  speakLatencyFloskelFireAndForget,
} from '../speech/floskelEngine';

/** @deprecated Intent-Namen — Kompatibilität für ältere Imports */
export type ResearchAckIntent =
  | 'phone'
  | 'events'
  | 'menu'
  | 'dining'
  | 'compound_togo_sunset'
  | 'sunset'
  | 'location'
  | 'history'
  | 'plan'
  | 'nav'
  | 'weather'
  | 'transit'
  | 'flight'
  | 'booking'
  | 'cinema'
  | 'hotel'
  | 'generic';

export function detectResearchAckIntent(userText: string): ResearchAckIntent {
  const cat = detectFloskelCategoryPublic(userText);
  const map: Record<string, ResearchAckIntent> = {
    phone: 'phone',
    events: 'events',
    nightlife: 'events',
    menu: 'menu',
    dining: 'dining',
    cafe: 'dining',
    compound_togo_sunset: 'compound_togo_sunset',
    sunset: 'sunset',
    location: 'location',
    where_am_i: 'location',
    history: 'history',
    museum: 'history',
    complex_plan: 'plan',
    multi_intent: 'plan',
    leave_by: 'plan',
    nav: 'nav',
    weather: 'weather',
    weather_outfit: 'weather',
    rain_shelter: 'weather',
    transit: 'transit',
    flight: 'flight',
    booking: 'booking',
    reservation: 'booking',
    cinema: 'cinema',
    hotel: 'hotel',
    accommodation_search: 'hotel',
  };
  return map[cat] ?? 'generic';
}

export function pickResearchAckLine(userText: string): string {
  return pickFloskelForUserText(userText).phrase;
}

export function shouldSpeakResearchAck(
  userText: string,
  decision?: SmartRouteDecision,
): boolean {
  return shouldSpeakLatencyFloskel(userText, decision);
}

/**
 * Startet Ack-TTS ohne den Research-Pfad zu blockieren.
 * Nutzt Smart-Router Latency-Gate (>2,5 s) + Anti-Repetition (45 Min).
 */
export function speakResearchAckFireAndForget(userText: string): void {
  const decision = analyzeSmartRoute(userText);
  speakLatencyFloskelFireAndForget(userText, decision);
}
