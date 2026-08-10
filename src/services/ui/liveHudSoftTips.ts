/**
 * Sanfte Live-HUD Tipps (Stadt + Nähe) — Aufmerksamkeit ohne Blinken.
 * Incl. Events / Konzerte / Stadt-News (kuratiert, nicht immer).
 * Plus: eingeklemmte Ideen · Erkundung nach Profil.
 */

import { getCachedUserProfile } from '../userProfileService';
import { useSessionPlanStore } from '../../store/useSessionPlanStore';
import { useShoppingTaskStore } from '../../store/useShoppingTaskStore';
import { fitHudMeta } from './hudTextFit';
import type { HudOptionalTheme } from './liveHudThemeCurator';

export type SoftHudTip = {
  id: string;
  title: string;
  meta: string;
  tellMorePrompt: string;
  score: number;
  theme?: HudOptionalTheme;
};

function cityKey(name: string | null | undefined): string {
  return (name ?? '').toLowerCase();
}

/** Schon notiert / eingeklemmt — unaufdringlich erinnern. */
export function pinnedIdeaSoftTips(nowMs = Date.now()): SoftHudTip[] {
  const tips: SoftHudTip[] = [];
  const h = new Date(nowMs).getHours();

  const tasks = useShoppingTaskStore.getState().getOpenTasks();
  const ripe = tasks.filter(
    (t) => nowMs - (t.createdAtMs ?? 0) >= 3 * 60_000,
  );
  if (ripe[0]) {
    const t = ripe[0];
    tips.push({
      id: `pin-task-${t.id}`,
      title: `Noch auf der Liste: ${t.itemLabel}?`,
      meta: fitHudMeta(
        'Hab ich mir gemerkt — nur falls du jetzt Kapazität hast.',
      ),
      tellMorePrompt: `Offener Punkt „${t.itemLabel}“ — konkrete nächste Schritte und Route wenn sinnvoll.`,
      score: h >= 10 && h <= 19 ? 58 : 40,
      theme: 'user_relevant',
    });
  }

  const plan = useSessionPlanStore.getState().getActivePlan();
  const openStop = plan?.stops.find((s) => !s.done);
  if (openStop) {
    tips.push({
      id: `pin-stop-${openStop.id}`,
      title: `${openStop.label} — noch offen?`,
      meta: fitHudMeta(
        'Steckt in deinem Plan. Tippen, wenn ich Route oder Leave-by machen soll.',
      ),
      tellMorePrompt: `Geplanter Stopp „${openStop.label}“ — wann los und Route?`,
      score: openStop.arriveByMs != null ? 62 : 52,
      theme: 'user_relevant',
    });
  }

  const profile = getCachedUserProfile();
  const want = (profile?.wantToExperience ?? '').trim();
  if (want.length >= 8) {
    const short =
      want.length > 42 ? `${want.slice(0, 40).trim()}…` : want;
    tips.push({
      id: 'pin-want',
      title: 'Passt das noch zu deinem Wunsch?',
      meta: fitHudMeta(short),
      tellMorePrompt: `Du wolltest erleben: „${want.slice(0, 160)}“. Was davon geht jetzt in der Nähe — eine konkrete Idee mit Route.`,
      score: 55,
      theme: 'user_relevant',
    });
  }

  return tips;
}

/** Erkundungs-Fragen — profilnah, frageförmig, ohne Druck. */
export function exploreNudgeSoftTips(nowMs = Date.now()): SoftHudTip[] {
  const profile = getCachedUserProfile();
  const cityLabel =
    profile?.cityName?.trim() || profile?.cityId || 'der Nähe';
  const prefs = profile?.experiencePrefs ?? {};
  const h = new Date(nowMs).getHours();
  const tips: SoftHudTip[] = [];
  const wantBlob = (profile?.wantToExperience ?? '').toLowerCase();

  tips.push({
    id: 'explore-near',
    title: 'Was lohnt sich hier um die Ecke?',
    meta: fitHudMeta(
      `Kurzer Erkundungs-Vorschlag in ${cityLabel} — nur wenn’s zu dir passt.`,
    ),
    tellMorePrompt: `Ein Erkundungs-Vorschlag in meiner Nähe in ${cityLabel}, der zu meinen Vorlieben passt — kurz warum, Fußweg, Route.`,
    score: h >= 10 && h <= 18 ? 50 : 34,
    theme: 'soft_city',
  });

  if (prefs.museen === 'yes' || /museum|kunst/.test(wantBlob)) {
    tips.push({
      id: 'explore-museum',
      title: 'Museum in Gehweite?',
      meta: fitHudMeta('Du magst Museen — ich checke was offen und nah ist.'),
      tellMorePrompt: `Welches Museum in ${cityLabel} ist jetzt offen und in der Nähe — mit Route.`,
      score: 57,
      theme: 'user_relevant',
    });
  }

  if (
    prefs.natur === 'yes' ||
    prefs.wandern === 'yes' ||
    /park|grün|natur|spazier/.test(wantBlob)
  ) {
    tips.push({
      id: 'explore-park',
      title: 'Kurz grün durchatmen?',
      meta: fitHudMeta('Park oder Ufer in der Nähe — 10–20 Minuten Reset.'),
      tellMorePrompt: `Park oder ruhiger Outdoor-Spot in der Nähe von mir — mit Fußweg und Route.`,
      score: 53,
      theme: 'soft_city',
    });
  }

  if (
    prefs.kulinarik === 'yes' ||
    prefs.lokale_maerkte === 'yes' ||
    /essen|café|cafe|restaurant|kulinar/.test(wantBlob)
  ) {
    tips.push({
      id: 'explore-food',
      title: 'Snack oder Café, das zu dir passt?',
      meta: fitHudMeta('Kein Restaurant-Marathon — ein guter, naher Tipp.'),
      tellMorePrompt: `Ein Café oder Snack in der Nähe, der zu meinen Vorlieben passt — mit Route.`,
      score: h >= 11 && h <= 20 ? 54 : 36,
      theme: 'user_relevant',
    });
  }

  if (prefs.aussichten === 'yes' || prefs.streetart === 'yes') {
    tips.push({
      id: 'explore-photo',
      title: 'Foto-Spot um die Ecke?',
      meta: fitHudMeta(
        'Wenn die Lichtverhältnisse passen — ein Spot, kein Shooting-Plan.',
      ),
      tellMorePrompt: `Ein fotogener Spot in der Nähe — kurz warum und Route.`,
      score: 51,
      theme: 'user_relevant',
    });
  }

  return tips;
}

/** Stadt-Tipps — kurzweilig, konkret. */
export function citySoftTips(nowMs = Date.now()): SoftHudTip[] {
  const profile = getCachedUserProfile();
  const city = cityKey(profile?.cityName ?? profile?.cityId);
  const h = new Date(nowMs).getHours();
  const tips: SoftHudTip[] = [...exploreNudgeSoftTips(nowMs)];

  if (/hamburg/.test(city)) {
    tips.push({
      id: 'tip-hh-ferry',
      title: 'Kostenlos Boot auf der Elbe?',
      meta: fitHudMeta(
        'Mit dem normalen HVV-Ticket kannst du die typischen Hafenfähren nutzen — kurze Elbfahrt inklusive.',
      ),
      tellMorePrompt:
        'Erklär kurz die HVV-Hafenfähren in Hamburg: welche Linien, wo einsteigen, und dass sie im Ticket stecken.',
      score: h >= 10 && h <= 18 ? 62 : 40,
      theme: 'soft_city',
    });
    tips.push({
      id: 'tip-hh-speicher',
      title: 'Speicherstadt entdecken?',
      meta: fitHudMeta(
        'Backstein, Kanäle, Miniatur Wunderland — zu Fuß ein starker Block in unter einer Stunde.',
      ),
      tellMorePrompt:
        'Was lohnt sich in der Speicherstadt jetzt am meisten — kurz und mit Route?',
      score: h >= 11 && h <= 17 ? 55 : 35,
      theme: 'soft_city',
    });
  } else if (/berlin/.test(city)) {
    tips.push({
      id: 'tip-be-spree',
      title: 'Kurz an die Spree?',
      meta: fitHudMeta(
        'Viele Uferwege sind in Gehweite — guter Reset zwischen Museen und Kiezen.',
      ),
      tellMorePrompt: 'Wohin an der Spree in der Nähe lohnt ein kurzer Spaziergang?',
      score: 50,
      theme: 'soft_city',
    });
  } else if (/münchen|munchen/.test(city)) {
    tips.push({
      id: 'tip-muc-park',
      title: 'Englischer Garten?',
      meta: fitHudMeta(
        'Wenn die Beine noch mitmachen: großer Park, Chinesischer Turm, viel Platz zum Durchatmen.',
      ),
      tellMorePrompt: 'Lohnt sich der Englische Garten jetzt — und wo komme ich rein?',
      score: 52,
      theme: 'soft_city',
    });
  } else if (/prisdorf/.test(city)) {
    tips.push({
      id: 'tip-prisdorf-hh',
      title: 'Schnell nach Hamburg?',
      meta: fitHudMeta(
        'Nächste Züge oft alle ~30 Min · Fahrzeit ca. 40–50 Min bis HH.',
      ),
      tellMorePrompt:
        'Nächste konkrete Bahn von Prisdorf nach Hamburg inkl. Abfahrtszeit, Gleis und was sich dort kurz lohnt.',
      score: 48,
      theme: 'soft_city',
    });
  }

  if (h >= 12 && h <= 15) {
    tips.push({
      id: 'tip-pause',
      title: 'Kurze Pause einplanen?',
      meta: fitHudMeta(
        'Wasser, Schatten, Sitzbank — 10 Minuten Reset machen den Nachmittag entspannter.',
      ),
      tellMorePrompt: 'Wo in der Nähe kann ich kurz Pause machen — Café oder Park?',
      score: 42,
      theme: 'soft_city',
    });
  }

  return tips;
}

/** Events / Konzerte / Stadt-News — soft, ohne Live-Scraping-Pflicht. */
export function curatedCityPulseTips(nowMs = Date.now()): SoftHudTip[] {
  const profile = getCachedUserProfile();
  const city = cityKey(profile?.cityName ?? profile?.cityId);
  const cityLabel = profile?.cityName?.trim() || profile?.cityId || 'deiner Stadt';
  const h = new Date(nowMs).getHours();
  const tips: SoftHudTip[] = [...pinnedIdeaSoftTips(nowMs)];

  tips.push({
    id: 'pulse-events',
    title: 'Was geht heute Abend?',
    meta: fitHudMeta(
      `Kurz checken, was in ${cityLabel} heute noch offen ist — Konzert, Markt, Open Air.`,
    ),
    tellMorePrompt: `Was geht heute Abend in ${cityLabel}? Echte Termine, Orte, Eintritt — und Route.`,
    score: h >= 14 && h <= 22 ? 58 : 36,
    theme: 'events',
  });

  tips.push({
    id: 'pulse-concerts',
    title: 'Live-Musik in der Nähe?',
    meta: fitHudMeta(
      'Bands, Clubs, Kirchenkonzerte — wenn was läuft, lohnt ein früher Blick auf Startzeit.',
    ),
    tellMorePrompt: `Gibt es heute oder morgen ein Konzert in ${cityLabel}, das zu mir passt?`,
    score: h >= 16 || h <= 1 ? 54 : 32,
    theme: 'concerts',
  });

  tips.push({
    id: 'pulse-news',
    title: `Neu in ${cityLabel}?`,
    meta: fitHudMeta(
      'Baustellen, Sperrungen, neue Spots — kurzer Stadt-Pulse, der den Tag leichter macht.',
    ),
    tellMorePrompt: `Was ist gerade neu oder wichtig in ${cityLabel} — für mich als Gast/Bewohner?`,
    score: 44,
    theme: 'city_news',
  });

  const want = (profile?.wantToExperience ?? '').toLowerCase();
  const prefs = profile?.experiencePrefs ?? {};
  if (prefs.museen === 'yes' || /museum|kunst/.test(want)) {
    tips.push({
      id: 'pulse-user-museum',
      title: 'Museum, das zu dir passt?',
      meta: fitHudMeta(
        'Du magst Museen — ich kann das nächste Offene mit kurzer Route nennen.',
      ),
      tellMorePrompt: `Welches Museum in ${cityLabel} passt jetzt zu mir — offen, lohnenswert, Route?`,
      score: 60,
      theme: 'user_relevant',
    });
  }
  if (
    prefs.kulinarik === 'yes' ||
    prefs.lokale_maerkte === 'yes' ||
    /essen|café|cafe|restaurant|kulinar/.test(want)
  ) {
    tips.push({
      id: 'pulse-user-food',
      title: 'Essen nach deinem Geschmack?',
      meta: fitHudMeta(
        'Dein Profil sagt: Gastronomie lohnt — zwei konkrete Tipps wären drin.',
      ),
      tellMorePrompt: `Zwei Essens-Tipps in ${cityLabel}, die zu meinen Vorlieben passen — mit Route.`,
      score: h >= 11 && h <= 21 ? 57 : 38,
      theme: 'user_relevant',
    });
  }
  if (prefs.kirchen === 'yes' || /kirche|geschichte|histor/.test(want)) {
    tips.push({
      id: 'pulse-user-history',
      title: 'Geschichte um die Ecke?',
      meta: fitHudMeta(
        'Du magst Geschichte — ein kurzer Spot in Gehweite kann sich lohnen.',
      ),
      tellMorePrompt: `Ein historischer Ort in ${cityLabel} in der Nähe — kurz und mit Kontext.`,
      score: 52,
      theme: 'user_relevant',
    });
  }

  if (/hamburg/.test(city)) {
    tips.push({
      id: 'pulse-hh-elphi',
      title: 'Elbphilharmonie-News?',
      meta: fitHudMeta(
        'Führungen, Konzerte, Plaza — lohnt ein Blick, ob heute was freies Slot hat.',
      ),
      tellMorePrompt:
        'Was läuft heute an der Elbphilharmonie — Konzert, Führung, Plaza?',
      score: 50,
      theme: 'concerts',
    });
  }

  return tips;
}

/** Abendessen-Vorschläge (2 Namen). */
export function dinnerHudPair(cityName: string | null | undefined): {
  title: string;
  meta: string;
  tellMorePrompt: string;
} | null {
  const city = cityKey(cityName);
  let a = 'Lokales Bistro';
  let aDesc = 'Tageskarte und entspannt';
  let b = 'Nachbarschaftskneipe';
  let bDesc = 'Hausmannskost';

  if (/hamburg/.test(city)) {
    a = 'Fischhaus am Hafen';
    aDesc = 'Klassiker mit Elbblick';
    b = 'Speicherstadt-Brasserie';
    bDesc = 'Abendmenü, zentral';
  } else if (/berlin/.test(city)) {
    a = 'Kiez-Trattoria';
    aDesc = 'Pasta und Wein';
    b = 'Markt-Restaurant';
    bDesc = 'Saisonal, unkompliziert';
  } else if (/münchen|munchen/.test(city)) {
    a = 'Wirtshaus Altstadt';
    aDesc = 'Bayerisch und gemütlich';
    b = 'Isar-Bistro';
    bDesc = 'Leichtes Abendessen';
  } else if (/prisdorf/.test(city)) {
    a = 'Dorfwirtschaft';
    aDesc = 'Nähe Bahnhof';
    b = 'Italienisch um die Ecke';
    bDesc = 'Pizza und Pasta';
  }

  return {
    title: 'Abendessen',
    meta: fitHudMeta(`${a} — ${aDesc}\n${b} — ${bDesc}`),
    tellMorePrompt: `Zwei konkrete Abendessen-Tipps in ${cityName || 'der Stadt'}: ${a} und ${b} — kurz mit Warum und Route.`,
  };
}
