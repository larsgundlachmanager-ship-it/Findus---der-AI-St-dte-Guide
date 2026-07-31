/**
 * Geführte Feature-Tour nach persönlichem Opener.
 * On-Screen-Demos + Sprach-Segmente (SSOT für Onboarding-Erklärung).
 */

import type { ExplanationHint, ExplanationSegment } from '../../i18n';

export type GuidedTourSegment = ExplanationSegment & {
  /** Kurzer UI-Titel für Demo-Overlay */
  demoTitle?: string;
};

/**
 * Feste UI-Tour — unabhängig von Gemini (damit Demos 1:1 zur Sprache passen).
 */
export function buildGuidedFeatureTourSegments(opts: {
  cityName: string;
}): GuidedTourSegment[] {
  const city = opts.cityName.trim() || 'deiner Stadt';
  return [
    {
      hint: 'module1',
      demoTitle: 'Modul 1 · Vor Ort',
      text:
        `Wenn du an einem Wahrzeichen vorbeikommst — zum Beispiel dem Wahrzeichen von ${city} — springt Findus an: ` +
        `das Element leuchtet grün, und ich erzähl dir kurz die Geschichte: wer, was, warum, und was heute noch davon übrig ist.`,
    },
    {
      hint: 'bullets',
      demoTitle: 'Stichpunkte',
      text:
        `Darunter siehst du Stichpunkte — die wichtigsten Fakten auf einen Blick, ` +
        `damit du nicht alles mitschreiben musst.`,
    },
    {
      hint: 'actions',
      demoTitle: 'Action-Buttons',
      text:
        `Und darunter Action-Buttons: damit reagierst du blitzschnell — Route starten, mehr erfahren, Speisekarte öffnen — ` +
        `ohne lange tippen zu müssen.`,
    },
    {
      hint: 'mic',
      demoTitle: 'Mikrofon',
      text:
        `Hast du Fragen zum Ort, willst du woanders hin, einen Tisch reservieren oder wissen, was heute Abend geht? ` +
        `Drück einfach aufs Mikrofon und frag mich — zum Beispiel „Führ mich zum Hotel“, „Wo gibt’s guten Kaffee?“ oder „Reservier uns für acht.“`,
    },
    {
      hint: 'planning',
      demoTitle: 'Tagesplan',
      text:
        `Oben siehst du das Kalender-Symbol — das ist die Planung. Hier ist deine Timeline: ` +
        `die Linie „Jetzt“ trennt Vergangenheit und Zukunft. Alles darüber ist die Zeitachse — wo warst du wirklich? ` +
        `Alles darunter ist der Plan, den wir aushecken, damit ${city} sich richtig anfühlt. ` +
        `Du kannst auch lange Sprachnachrichten diktieren: Hotel, Anreise, Orte, die du erleben willst — wir bauen daraus einen Plan.`,
    },
    {
      hint: 'settings',
      demoTitle: 'Einstellungen',
      text:
        `Rechts daneben das Zahnrad: Einstellungen. Unter Einrichtung und „Über dich“ stellst du Stimme, Charakter und Interessen ein. ` +
        `Es gibt Sparmodus und Stummmodus — zum Beispiel im Museum. ` +
        `Unter Erklärungen findest du alles nochmal nachlesbar. ` +
        `Und wenn etwas hakt: Feedback und Probleme melden — damit hilfst du dir und allen anderen Findus-Nutzern.`,
    },
    {
      hint: 'live_hud',
      demoTitle: 'Live-Anzeige',
      text:
        `Oben links die Live-Anzeige: wo du gerade bist, wohin du navigierst, und kurze Vorschläge mit wichtigen Infos — ohne dass du ständig die Karte aufklappen musst.`,
    },
    {
      hint: 'passport',
      demoTitle: 'Stempelkarte',
      text:
        `Tippe auf die Live-Anzeige, öffnet sich die Stempelkarte: was du schon entdeckt hast, wie viel Fläche der Stadt freigeruckelt ist, und welche Kategorien du noch einblenden willst.`,
    },
    {
      hint: 'nav_queue',
      demoTitle: 'Stopp-Queue',
      text:
        `Während einer Navigation siehst du rechts deine Stopps — verschieben, löschen, umsortieren. So bleibt die Tour in deiner Hand.`,
    },
    {
      hint: 'none',
      text:
        `Das sind die wichtigsten Funktionen — den Rest findest du ganz schnell selbst. ` +
        `Findus ist für Hands-free gemacht: Kopfhörer rein, Handy in die Tasche, und lass uns das Abenteuer in ${city} beginnen.`,
    },
  ];
}
