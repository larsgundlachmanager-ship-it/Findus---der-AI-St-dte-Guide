/**
 * 100 Verdrahtungs-Fälle: Job, Rückfrage, Stichpunkte, Buttons.
 * Stadt-agnostisch — dieselben Blaupausen in HH/Lübeck/Wangerooge/…
 */

import type { FindusJobId } from './types';
import type { LiveInventoryKind } from '../context/shortTermContext';

export type JobCase = {
  id: string;
  q: string;
  job: FindusJobId;
  must?: string;
};

export type FollowCase = {
  id: string;
  prev: { kind: LiveInventoryKind; query: string };
  q: string;
  inherited: boolean;
  kind: LiveInventoryKind | null;
};

/** 55 Jobs — verschiedene Städte, Formulierungen, Intents. */
export const JOB_CASES: JobCase[] = [
  { id: 'j01', q: 'Wo kann ich in Hamburg gut essen?', job: 'dining_open' },
  { id: 'j02', q: 'Ich habe Hunger, Café in Lübeck', job: 'dining_open' },
  { id: 'j03', q: 'Brunch in München bitte', job: 'dining_open' },
  { id: 'j04', q: 'Imbiss in Wangerooge', job: 'dining_open' },
  { id: 'j05', q: 'Welches Restaurant bietet Pannfisch mit Elbblick?', job: 'dining_hard_match', must: 'Pannfisch' },
  { id: 'j06', q: 'glutenfrei essen in Köln', job: 'dining_hard_match', must: 'glutenfrei' },
  { id: 'j07', q: 'Eisdiele mit Spaghetti-Eis', job: 'dining_hard_match', must: 'Spaghetti-Eis' },
  { id: 'j07b', q: 'Restaurant mit Angus-Steak in der Nähe', job: 'dining_hard_match', must: 'Angus' },
  { id: 'j07c', q: 'Gibt es ein Zugrestaurant oder Speisewagen?', job: 'dining_hard_match', must: 'Zugrestaurant' },
  { id: 'j08', q: 'Hotel in Lübeck von heute bis morgen', job: 'stay_search' },
  { id: 'j09', q: 'Unterkunft in Berlin mit Pool und Sauna unter 500 Euro', job: 'stay_search', must: 'Pool' },
  { id: 'j09b', q: 'Hotel all-inclusive mit Massage und Pool unter 800 Euro', job: 'stay_search', must: 'All-inclusive' },
  { id: 'j10', q: 'Hostel in Dresden für zwei Nächte', job: 'stay_search' },
  { id: 'j11', q: 'Ich möchte heute Abend ins Kino, welche Filme laufen?', job: 'tonight_live' },
  { id: 'j12', q: 'Ich will Spider-Man heute im Kino sehen', job: 'tonight_live', must: 'Spider-Man' },
  { id: 'j13', q: 'Kinoprogramm in Flensburg', job: 'tonight_live' },
  { id: 'j14', q: 'Was geht heute Abend in Kiel?', job: 'nightlife_vibe' },
  { id: 'j15', q: 'Party heute in der Stadt', job: 'nightlife_vibe' },
  { id: 'j16', q: 'Wohin zum Feiern gehen in Hamburg?', job: 'nightlife_vibe' },
  { id: 'j17', q: 'Bring mich zum Rathaus', job: 'nav_route' },
  { id: 'j18', q: 'Navigiere zum Tennisclub in Laboe', job: 'nav_route' },
  { id: 'j19', q: 'Führ mich zur Elbphilharmonie', job: 'nav_route' },
  { id: 'j20', q: 'Wie komme ich am schnellsten zum Hauptbahnhof?', job: 'nav_route' },
  { id: 'j21', q: 'S-Bahn nach Hamburg, wann fährt der nächste?', job: 'transit_live' },
  { id: 'j22', q: 'ÖPNV nach Lübeck, Verbindung bitte', job: 'transit_live' },
  { id: 'j23', q: 'Fähre nach Wangerooge Ticket', job: 'transit_live' },
  { id: 'j24', q: 'Letzter Zug nach Kiel', job: 'transit_live' },
  { id: 'j24b', q: 'Ich möchte irgendwo auf den Berg rauffahren', job: 'transit_live' },
  { id: 'j24c', q: 'Quiero subir a la montaña en Sierra Nevada', job: 'transit_live' },
  { id: 'j25', q: 'Uber zum Bahnhof', job: 'taxi_rideshare' },
  { id: 'j26', q: 'Taxi nach Hause bitte', job: 'taxi_rideshare' },
  { id: 'j27', q: 'Wo kann ich in der Nähe parken?', job: 'parking_ev' },
  { id: 'j28', q: 'Parkhaus in der Innenstadt', job: 'parking_ev' },
  { id: 'j29', q: 'E-Scooter leihen', job: 'mobility_rent' },
  { id: 'j30', q: 'Leihfahrrad in Hamburg', job: 'mobility_rent' },
  { id: 'j31', q: 'Mein Freund hat den Fuß gebrochen, wo können wir hin?', job: 'emergency_care' },
  { id: 'j32', q: 'Akute Zahnschmerzen, Notdienst', job: 'emergency_care' },
  { id: 'j33', q: 'Notaufnahme in der Nähe', job: 'emergency_care' },
  { id: 'j34', q: 'Reisepass ist weg, was jetzt?', job: 'safety_lost' },
  { id: 'j35', q: 'Portemonnaie geklaut, Polizei', job: 'safety_lost' },
  { id: 'j36', q: 'Wo ist die nächste Toilette?', job: 'friction_now' },
  { id: 'j37', q: 'Handy laden, Steckdose oder Powerbank', job: 'friction_now' },
  { id: 'j38', q: 'Geldautomat in der Nähe', job: 'friction_now' },
  { id: 'j39', q: 'Was ist das für ein Gebäude vor mir?', job: 'poi_identify' },
  { id: 'j40', q: 'Wo bin ich gerade?', job: 'poi_identify' },
  { id: 'j41', q: 'Sehenswürdigkeiten, ich habe eine Stunde', job: 'sight_recommend' },
  { id: 'j42', q: 'Was habe ich in Laboe noch nicht gesehen?', job: 'sight_recommend' },
  { id: 'j43', q: 'Picasso-Ausstellung, Museum in der Nähe', job: 'museum_theme', must: 'Picasso' },
  { id: 'j44', q: 'Dinosaurier im Museum, T-Rex', job: 'museum_theme', must: 'Dinosaurier' },
  { id: 'j45', q: 'Nächster Aldi bitte', job: 'shopping_errand' },
  { id: 'j46', q: 'Lidl oder Rewe in Prisdorf', job: 'shopping_errand' },
  { id: 'j47', q: 'Souvenir und Briefmarken', job: 'shopping_errand' },
  { id: 'j48', q: 'Surfschule auf Wangerooge', job: 'activity_sport' },
  { id: 'j49', q: 'Wo kann ich bouldern?', job: 'activity_sport' },
  { id: 'j50', q: 'Was soll ich anziehen, Wetter und Jacke', job: 'weather_outfit' },
  { id: 'j51', q: 'Regnet es, Outfit für heute', job: 'weather_outfit' },
  { id: 'j51b', q: 'Wie wird morgen das Wetter, was muss ich anziehen wenn ich einen Städtetrip machen möchte', job: 'weather_outfit' },
  { id: 'j52', q: 'Plane mir den kompletten Tag in Lübeck', job: 'day_plan_budget' },
  { id: 'j53', q: 'Wie hoch ist der Turm, wie viele Stufen?', job: 'fact_number' },
  { id: 'j54', q: 'Wann ist Sonnenuntergang exakt?', job: 'fact_number' },
  { id: 'j55', q: 'Red mal mit mir, ich bin gestresst', job: 'smalltalk_general' },
];

/** 20 Rückfragen — erben den letzten Live-Auftrag oder wechseln das Thema. */
export const FOLLOW_CASES: FollowCase[] = [
  { id: 'f01', prev: { kind: 'hotel', query: 'Hotel in Lübeck heute bis morgen' }, q: 'ja', inherited: true, kind: 'hotel' },
  { id: 'f02', prev: { kind: 'hotel', query: 'Hotel in Lübeck heute bis morgen' }, q: 'genau', inherited: true, kind: 'hotel' },
  { id: 'f03', prev: { kind: 'hotel', query: 'Hotel in Lübeck heute bis morgen' }, q: 'wie teuer ist das?', inherited: true, kind: 'hotel' },
  { id: 'f04', prev: { kind: 'hotel', query: 'Hotel in Lübeck heute bis morgen' }, q: 'zeig mir den Partnerlink', inherited: true, kind: 'hotel' },
  { id: 'f05', prev: { kind: 'hotel', query: 'Hotel in Lübeck heute bis morgen' }, q: 'buchen', inherited: true, kind: 'hotel' },
  { id: 'f06', prev: { kind: 'hotel', query: 'Hotel in Lübeck heute bis morgen' }, q: 'wie ist das Wetter?', inherited: false, kind: null },
  { id: 'f07', prev: { kind: 'events', query: 'Was geht heute Abend in Kiel?' }, q: 'wann gehts los?', inherited: true, kind: 'events' },
  { id: 'f08', prev: { kind: 'events', query: 'Was geht heute Abend in Kiel?' }, q: 'erzähl mehr', inherited: true, kind: 'events' },
  { id: 'f09', prev: { kind: 'events', query: 'Was geht heute Abend in Kiel?' }, q: 'läuft das jetzt?', inherited: true, kind: 'events' },
  { id: 'f10', prev: { kind: 'events', query: 'Was geht heute Abend in Kiel?' }, q: 'Eintritt und Programm', inherited: true, kind: 'events' },
  { id: 'f11', prev: { kind: 'events', query: 'Was geht heute Abend in Kiel?' }, q: 'Führ mich zur Elbphilharmonie', inherited: false, kind: null },
  { id: 'f12', prev: { kind: 'pitch_choice', query: 'Kino heute in Hamburg' }, q: 'welche Zeiten?', inherited: true, kind: 'pitch_choice' },
  { id: 'f13', prev: { kind: 'pitch_choice', query: 'Restaurant mit Elbblick' }, q: 'öffnungszeiten', inherited: true, kind: 'pitch_choice' },
  { id: 'f14', prev: { kind: 'pitch_choice', query: 'Restaurant mit Elbblick' }, q: 'ok bitte', inherited: true, kind: 'pitch_choice' },
  { id: 'f15', prev: { kind: 'pitch_choice', query: 'Restaurant mit Elbblick' }, q: 'stell den Wecker', inherited: false, kind: null },
  { id: 'f16', prev: { kind: 'hotel', query: 'günstigstes Hotel Berlin' }, q: 'die Liste raussuchen', inherited: true, kind: 'hotel' },
  { id: 'f17', prev: { kind: 'events', query: 'Weinfest heute' }, q: 'mehr dazu', inherited: true, kind: 'events' },
  { id: 'f18', prev: { kind: 'events', query: 'Weinfest heute' }, q: 'Taxi bitte', inherited: false, kind: null },
  { id: 'f19', prev: { kind: 'hotel', query: 'Hotel Wangerooge Pool' }, q: 'mach das', inherited: true, kind: 'hotel' },
  { id: 'f20', prev: { kind: 'pitch_choice', query: 'Essen in Laboe' }, q: 'was kostet das', inherited: true, kind: 'pitch_choice' },
];
