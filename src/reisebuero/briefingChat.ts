/**
 * Phase A — Tischgespräch, keine Tools, keine Suche-Angebote.
 * Board hält die Notizen. Speech = eingehen + eine menschliche Frage.
 */

import { getCachedUserProfile } from '../services/userProfileService';
import {
  briefingPath,
  isBriefComplete,
  nextQuestionKey,
} from './completeness';
import { useReisebueroStore } from './store';
import type { ReiseLedger } from './types';
import { detectTripVibes } from './vibeProbes';
import {
  ensureBriefingQuestion,
  keepTalkingAlreadyNudged,
  pickOpeningGreeting,
  weaveSpokenFacts,
} from './briefingSpeech';

function firstName(): string {
  try {
    return (getCachedUserProfile()?.firstName || '').trim();
  } catch {
    return '';
  }
}

function lastUserLine(): string {
  const chat = useReisebueroStore.getState().trip.chat;
  for (let i = chat.length - 1; i >= 0; i -= 1) {
    if (chat[i]?.role === 'user') return chat[i]!.text;
  }
  return '';
}

function groupWord(ledger: ReiseLedger): 'du' | 'ihr' {
  const n = ledger.adults?.value ?? 0;
  return n > 1 ? 'ihr' : 'du';
}

function fallbackHint(askedKey: string | null, opening: boolean): string {
  if (opening) return 'Erzähl los';
  if (askedKey === 'adults') return 'Allein oder zu mehreren?';
  if (askedKey === 'when') return 'Wann soll’s losgehen?';
  if (askedKey === 'budget') return 'Was schwebt preislich vor?';
  if (askedKey === 'mode') return 'Wie kommt ihr hin?';
  if (askedKey === 'meals') return 'Wie wollt ihr essen?';
  if (askedKey === 'localMove') return 'Wie vor Ort unterwegs?';
  if (askedKey === 'whenTight') return 'Daten noch schärfen?';
  if (askedKey === 'dest') return 'Richtung oder Ort?';
  if (askedKey === 'comfort') return 'Komfort bei Anreise?';
  if (askedKey === 'ages') return 'Alter oder Bahncard?';
  if (askedKey === 'geo') return 'Lage-Wunsch?';
  if (askedKey === 'lodging') return 'Wo wollt ihr unterkommen?';
  if (askedKey === 'departWindow') return 'Los- und Ankunftszeit?';
  if (askedKey === 'directFlight') return 'Direktflug wichtig?';
  if (askedKey === 'bags') return 'Hand- oder Aufgabegepäck?';
  if (askedKey === 'weather') return 'Wie soll das Wetter sein?';
  if (askedKey === 'driveTime') return 'Wie weit darf die Anfahrt sein?';
  if (askedKey === 'purpose') return 'Was soll der Urlaub werden?';
  if (askedKey === 'locationBias') return 'Eher zentral oder ruhig?';
  if (askedKey === 'lastTrip') return 'Highlight vom letzten Urlaub?';
  if (askedKey === 'highlight') return 'Was soll euer Highlight werden?';
  if (askedKey === 'dealbreaker') return 'Was darf nicht passieren?';
  if (askedKey === 'partyStyle') return 'Clubs, Bars oder Open Air?';
  if (askedKey === 'partyGrain') return 'Privat, Bars oder Clubs?';
  if (askedKey === 'spaStyle') return 'Pool, Meer, Massage, Sauna?';
  if (askedKey === 'kidsStyle') return 'Was mögen die Kinder?';
  if (askedKey === 'tripShape') return 'Ein Ort oder mehrere?';
  if (askedKey === 'cruiseCore') return 'Wohin / welche Reederei?';
  if (askedKey === 'cruiseShipVibe') return 'Was soll das Schiff können?';
  if (askedKey === 'cruiseShipPick') return 'Welches Schiff passt?';
  if (askedKey === 'cruiseDepth') return 'Einschiffen und Kabine?';
  if (askedKey === 'ideaHook') return 'Wäre das was für euch?';
  if (askedKey === 'extraWishes') return 'Was ist euch wichtig?';
  if (askedKey === 'rentalCar') return 'Mietwagen dazu?';
  if (askedKey === 'ready_announce') return 'Suche starten?';
  if (askedKey === 'wrap_up') return 'Soll ich suchen?';
  if (askedKey === 'keep_talking') return 'Noch was aufs Board?';
  return 'Was soll noch aufs Board?';
}

function fallbackOpening(): { speech: string; hint: string } {
  const name = firstName();
  const tripId = useReisebueroStore.getState().trip.id || '';
  return pickOpeningGreeting(name, tripId);
}

function isUnclearAnswer(userLine: string): boolean {
  const t = (userLine || '').trim();
  if (!t) return true;
  try {
    const { looksLikeGarbageFact } = require('./parseBriefSlots') as typeof import('./parseBriefSlots');
    if (looksLikeGarbageFact(t)) return true;
  } catch {
    /* soft */
  }
  if (/^(äh+|ähm+|hm+|was\??|hä\??|nochmal|wie\??)$/iu.test(t)) return true;
  return false;
}

function fallbackSpeech(
  ledger: ReiseLedger,
  asked: string[],
  userLine: string,
  opts?: {
    searchReadyAnnounced?: boolean;
    catalogExtras?: import('./questionCatalog').CatalogExtra[];
    /** Letzte gestellte Katalog-Frage — bei Unklarheit nachhaken statt weiter. */
    holdAskKey?: string | null;
  },
): { speech: string; askedKey: string | null; hint: string; holdTopic?: boolean } {
  const gap = nextQuestionKey(ledger, asked, {
    searchReadyAnnounced: opts?.searchReadyAnnounced,
    catalogExtras: opts?.catalogExtras,
    userLine,
  });
  const addr = groupWord(ledger);
  const holdKey = opts?.holdAskKey || null;
  if (holdKey && isUnclearAnswer(userLine)) {
    let hint = fallbackHint(holdKey, false).replace(/\?+\s*$/, '');
    try {
      const { QUESTION_CATALOG } = require('./questionCatalog') as typeof import('./questionCatalog');
      const q = QUESTION_CATALOG.find((x) => x.id === holdKey);
      if (q?.askSeed) hint = q.askSeed.replace(/\?+\s*$/, '');
    } catch {
      /* soft */
    }
    return {
      speech: `Hab ich nicht sauber mitbekommen — kurz nochmal: ${hint}?`,
      askedKey: null,
      hint,
      holdTopic: true,
    };
  }
  const hint = (gap.askSeed || fallbackHint(gap.key, false)).replace(/\?+\s*$/, '');
  try {
    const {
      rememberShelfAsked,
      rememberShelfFromLedger,
    } = require('./shelfAskedPrefs') as typeof import('./shelfAskedPrefs');
    if (asked.length) {
      rememberShelfFromLedger(ledger, asked);
      rememberShelfAsked(asked);
    }
  } catch {
    /* soft */
  }
  let ack = reactFallback(userLine, ledger);
  // Langer Dump / Teil-Inventar: kurzer Recap vor der Lücken-Frage (Struktur, kein Skript)
  try {
    const { inventoryRecapHint, isInventoryGapFill } = require('./inventoryRecap') as typeof import('./inventoryRecap');
    if (isInventoryGapFill(ledger) && userLine.trim().length >= 80) {
      const recap = inventoryRecapHint(ledger);
      if (recap) ack = `${ack} ${recap}.`.replace(/\.\.+/g, '.');
    }
  } catch {
    /* soft */
  }
  // Shelf-Reuse: Themen die wir still abgehakt haben — kurz im Ack andeuten (Struktur)
  try {
    const { shelfReuseTopics } = require('./shelfAskedPrefs') as typeof import('./shelfAskedPrefs');
    const reused = shelfReuseTopics(ledger);
    if (reused.length && asked.length <= 2) {
      ack = `${ack} ${weaveSpokenFacts(reused.slice(0, 3))} wie zuletzt — sag Bescheid wenn anders.`.replace(
        /\.\.+/g,
        '.',
      );
    }
  } catch {
    /* soft */
  }
  if (gap.key === 'ready_announce') {
    let scoreLine = '';
    try {
      const { computeBriefScore } = require('./briefScore') as typeof import('./briefScore');
      const sc = computeBriefScore(ledger);
      const top = sc.missing.slice(0, 2).map((m: { label: string }) => m.label);
      scoreLine = top.length
        ? ` Brief steht bei ${sc.score} Prozent — für noch härter fehlen vor allem ${top.join(' und ')}.`
        : ` Brief steht bei ${sc.score} Prozent.`;
    } catch {
      /* ignore */
    }
    return {
      speech:
        addr === 'ihr'
          ? `${ack}${scoreLine} Fehlt euch für den Urlaub noch was Wichtiges — oder soll ich die Suche starten?`
          : `${ack}${scoreLine} Fehlt dir für den Urlaub noch was Wichtiges — oder soll ich die Suche starten?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'partyGrain') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Feiert ihr eher privat unter euch, oder eher Bars und Clubs?`
          : `${ack} Eher privat unter euch feiern, oder Bars und Clubs?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'purpose') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was soll das für ein Urlaub werden — eher entspannen, Stadt, Strand, oder was ganz anderes?`
          : `${ack} Was soll das für ein Urlaub werden?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'adults') {
    return {
      speech: addr === 'ihr' ? `${ack} Wie viele seid ihr insgesamt?` : `${ack} Bist du allein unterwegs oder sind noch Leute dabei?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'origin') {
    const home = ledger.originCity?.value;
    const last = userLine.replace(/\s+/g, ' ').trim();
    const odd = /\b(kristof|christoph|christopher)\b/iu.test(last);
    return {
      speech: odd
        ? `${ack} Den Startort hab ich nicht erkannt. Welcher Ort — oder von ${home || 'zu Hause'} aus?`
        : home
          ? `${ack} Startet ihr von ${home} aus, oder trefft ihr euch woanders?`
          : addr === 'ihr'
            ? `${ack} Von wo wollt ihr starten?`
            : `${ack} Von wo willst du starten?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'departWindow') {
    return {
      speech: `${ack} Ab wann könnt ihr los, und wie spät dürft ihr ankommen — noch was in der Stadt am Abend?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'budget') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was ist eure Schmerzgrenze beim Budget — grob pro Person?`
          : `${ack} Was schwebt dir preislich vor, grob pro Person?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'when') {
    const monthOnly = Boolean(ledger.dateMonth && !ledger.dateStart);
    const hasDuration = Boolean(ledger.stayDays || ledger.stayNights);
    return {
      speech: monthOnly && !hasDuration
        ? `${ack} Ungefähr wie lange — paar Tage, eine Woche?`
        : monthOnly
          ? `${ack} Monat passt — konkrete Tage schon klar, oder lassen wir’s flexibel?`
          : addr === 'ihr'
            ? `${ack} Wann wollt ihr weg — grob Monat reicht, oder habt ihr schon Tage?`
            : `${ack} Wann soll’s losgehen — Monat reicht, Tage optional?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'mode') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Wie wollt ihr hinkommen — Flug, Bahn oder Auto?`
          : `${ack} Wie willst du hinkommen?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'meals') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Verpflegung — eher selbst kochen, Frühstück, Halbpension, oder All Inclusive?`
          : `${ack} Essen vor Ort — selbst, Frühstück, Halbpension oder All Inclusive?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'localMove') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Vor Ort — eher zu Fuß und ÖPNV, oder lieber Mietwagen?`
          : `${ack} Vor Ort eher zu Fuß/ÖPNV oder Mietwagen?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'whenTight') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Können wir den Zeitraum noch enger machen — konkrete Tage, oder ein klares Fenster?`
          : `${ack} Können wir den Zeitraum noch enger machen?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'comfort') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Bei Flug oder Bahn — Direkt wichtig, max. Umsteigezeit, oder Nachtfahrt okay?`
          : `${ack} Direktflug, kurze Umsteiger, oder ist Nachtfahrt auch okay?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'ages') {
    return {
      speech: `${ack} Für Sparpreise der Bahn — ungefähres Alter der Mitreisenden, und hat jemand eine Bahncard?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'geo') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Lage — eher zentral, ruhig draußen, oder nah an einem bestimmten Spot?`
          : `${ack} Lieber zentral, ruhig, oder nah an einem bestimmten Ort?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'lodging') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was schwebt euch bei der Unterkunft vor — eher Hotel, Ferienhaus oder Apartment?`
          : `${ack} Hotel, Ferienhaus oder Apartment — was liegt dir näher?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'directFlight') {
    return {
      speech: `${ack} Ist euch ein Direktflug wichtig, oder wäre Umsteigen auch okay?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'bags') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was für Gepäck nehmt ihr mit — nur Handgepäck, oder auch Aufgabegepäck? Und ungefähr wie viele?`
          : `${ack} Was für Gepäck nimmst du mit — nur Handgepäck, oder auch Aufgabegepäck? Und ungefähr wie viele?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'locationBias') {
    const path = briefingPath(ledger);
    if (path === 'senior') {
      return {
        speech: `${ack} Darf’s eher eine flache Küste sein, oder seid ihr auch gerne in den Bergen?`,
        askedKey: gap.key,
        hint,
      };
    }
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Abends eher ein paar Restaurants in Gehweite, oder lieber richtig ruhig und abgeschieden?`
          : `${ack} Lieber Restaurants um die Ecke, oder eher Abgeschiedenheit?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'extraWishes') {
    const path = briefingPath(ledger);
    if (path === 'family') {
      return {
        speech: `${ack} Was ist euch wichtig — Ausstattung, Lage, irgendwas Pflicht für die Kleinen?`,
        askedKey: gap.key,
        hint: 'Was ist wichtig?',
      };
    }
    if (path === 'chill') {
      return {
        speech: `${ack} Was ist euch wichtig — und gibt’s ein klares No-Go?`,
        askedKey: gap.key,
        hint: 'Was ist wichtig?',
      };
    }
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was ist euch wichtig auf dem Trip — was muss sitzen?`
          : `${ack} Was ist dir wichtig — was muss sitzen?`,
      askedKey: gap.key,
      hint: 'Was ist wichtig?',
    };
  }
  if (gap.key === 'bookedBits') {
    if (ledger.bookedStay?.value && ledger.bookedFlight == null && ledger.bookedRail == null) {
      return {
        speech: `${ack} Hotel steht — braucht ihr noch den Flug, die Bahn, oder ist die Anreise auch schon durch?`,
        askedKey: gap.key,
        hint: 'Anreise noch?',
      };
    }
    if (ledger.bookedFlight?.value && ledger.bookedStay == null) {
      return {
        speech: `${ack} Flug steht — Unterkunft noch suchen, oder habt ihr die schon?`,
        askedKey: gap.key,
        hint: 'Unterkunft noch?',
      };
    }
    if (ledger.needCar?.value === true) {
      return {
        speech: `${ack} Mietwagen fehlt noch — sonst noch was, oder soll ich den raussuchen?`,
        askedKey: gap.key,
        hint: 'Was fehlt noch?',
      };
    }
    return {
      speech: `${ack} Was ist schon gebucht — und was soll ich noch raussuchen?`,
      askedKey: gap.key,
      hint: 'Was fehlt noch?',
    };
  }
  if (gap.key === 'needCar') {
    return {
      speech: `${ack} Braucht ihr vor Ort noch einen Mietwagen, oder kommt ihr ohne klar?`,
      askedKey: gap.key,
      hint: 'Mietwagen?',
    };
  }
  if (gap.key === 'transfer') {
    return {
      speech: `${ack} Vom Flughafen oder Bahnhof zum Hotel — eher Taxi, ÖPNV, oder Transfer in einer Pauschale?`,
      askedKey: gap.key,
      hint: 'Transfer?',
    };
  }
  if (gap.key === 'rentalCar') {
    return {
      speech: `${ack} Braucht ihr vor Ort noch einen Mietwagen, oder kommt ihr ohne klar?`,
      askedKey: gap.key,
      hint: 'Mietwagen?',
    };
  }
  if (gap.key === 'wrap_up') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Die wichtigen Infos hab ich. Fehlt euch für den Urlaub noch was — oder soll ich zwei Optionen raussuchen?`
          : `${ack} Die wichtigen Infos hab ich. Fehlt dir für den Urlaub noch was — oder soll ich zwei Optionen raussuchen?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'keep_talking') {
    const alreadyNudged = keepTalkingAlreadyNudged(asked, opts?.searchReadyAnnounced);
    // Schon einmal eingeladen → nur kurz ack, kein zweites „Noch was präzisieren?“
    if (alreadyNudged) {
      const shortAck = (ack || 'Notiert.').replace(/\s+/g, ' ').trim();
      return {
        speech: shortAck.endsWith('.') || shortAck.endsWith('!') ? shortAck : `${shortAck}.`,
        askedKey: gap.key,
        hint: 'Noch was — oder suchen?',
      };
    }
    let tip = '';
    try {
      const { computeBriefScore } = require('./briefScore') as typeof import('./briefScore');
      const sc = computeBriefScore(ledger);
      const top = sc.missing.slice(0, 2).map((m: { label: string; points: number }) => m.label);
      if (top.length && sc.score < 100) {
        tip =
          addr === 'ihr'
            ? ` Fehlt euch noch eine Kleinigkeit — z. B. ${top.join(' oder ')} — oder soll ich suchen?`
            : ` Fehlt dir noch eine Kleinigkeit — z. B. ${top.join(' oder ')} — oder soll ich suchen?`;
      } else {
        tip =
          addr === 'ihr'
            ? ' Fehlt euch noch was Wichtiges — oder soll ich zwei Optionen raussuchen?'
            : ' Fehlt dir noch was Wichtiges — oder soll ich zwei Optionen raussuchen?';
      }
    } catch {
      tip = ' Soll ich suchen, oder fehlt noch was?';
    }
    return {
      speech: `${ack}${tip}`.trim(),
      askedKey: gap.key,
      hint: 'Noch was — oder suchen?',
    };
  }
  if (gap.key === 'dest') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Habt ihr eine Richtung im Kopf — oder ist der Ort noch egal?`
          : `${ack} Wohin soll’s gehen — oder ist der Ort noch egal?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'weather') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Soll’s eher warm sein, oder ist das Wetter egal?`
          : `${ack} Soll’s eher warm sein, oder ist das egal?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'driveTime') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Wie lange darf die Anfahrt sein, bis es euch zu viel wird?`
          : `${ack} Wie lange darf die Anfahrt maximal dauern?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'lastTrip') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was war das Highlight vom letzten Urlaub — nur so als Vibe-Check?`
          : `${ack} Was war das Highlight deines letzten Urlaubs?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'highlight') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was soll euer Highlight werden — die eine Sache, die sitzen muss?`
          : `${ack} Was soll dein Highlight werden?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'dealbreaker') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was wollt ihr auf keinen Fall erleben?`
          : `${ack} Was darf auf keinen Fall passieren?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'partyStyle') {
    return {
      speech: addr === 'ihr' ? `${ack} Wie wollt ihr feiern?` : `${ack} Wie willst du feiern?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'spaStyle') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Beim Spa: eher Pool und chillen, Meer und Sand, oder auch Massage und Sauna?`
          : `${ack} Spa eher Pool, Meer, oder auch Massage und Sauna?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'kidsStyle') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was mögen die Kinder denn — und soll das Haus einen Kids-Club haben, wo man sie abgeben kann?`
          : `${ack} Was mag das Kind — Kids-Club, oder eher alles zusammen?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'tripShape') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Ein Ort als Basis, oder mehrere Stationen hintereinander — Roadtrip oder sogar Kreuzfahrt ein Thema?`
          : `${ack} Ein Ort, mehrere Stationen, Roadtrip — oder eher bleiben?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'cruiseCore') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Wohin soll die Kreuzfahrt — Ostsee, Mittelmeer, woanders — und schwebt schon AIDA oder Mein Schiff vor?`
          : `${ack} Wohin soll die Route — und welche Reederei, falls schon klar?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'cruiseShipVibe') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Was soll das Schiff können — Pool, Rutsche, Laufbahn, Sauna, Kids, Teens, Party oder eher ruhig?`
          : `${ack} Was ist dir am Schiff wichtig — Pool, Rutsche, Laufbahn, Sauna, Kids, Teens, Party oder eher ruhig für Rentner?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'cruiseShipPick') {
    let recommend: string | null = null;
    try {
      const {
        matchCruiseShipsFromLedger,
        weaveCruiseShipFitRecommendAsk,
      } = require('./research/cruiseShipFit') as {
        matchCruiseShipsFromLedger: (
          l: ReiseLedger,
          o?: { userText?: string | null },
        ) => import('./research/cruiseShipFit').CruiseShipFitResult;
        weaveCruiseShipFitRecommendAsk: (
          r: import('./research/cruiseShipFit').CruiseShipFitResult,
        ) => string | null;
      };
      const fit = matchCruiseShipsFromLedger(ledger, { userText });
      if (
        fit.fits.length &&
        (fit.wants.length > 0 || fit.audiences.length > 0) &&
        (!ledger.cruiseShipName?.value || ledger.cruiseShipName.value === 'open')
      ) {
        recommend = weaveCruiseShipFitRecommendAsk(fit);
      }
    } catch {
      /* soft */
    }
    return {
      speech: recommend
        ? `${ack} ${recommend}`
        : addr === 'ihr'
          ? `${ack} Habt ihr schon ein konkretes Schiff im Kopf — Mein Schiff 3 oder 7, AIDAnova — oder soll ich passende vorschlagen?`
          : `${ack} Hast du schon ein konkretes Schiff im Kopf — z. B. Mein Schiff 3 oder 7 — oder soll ich passende vorschlagen?`,
      askedKey: gap.key,
      hint: recommend ? 'Welches Schiff?' : hint,
    };
  }
  if (gap.key === 'cruiseDepth') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Einschiff-Hafen, Kabine, eher viele Seetage oder viele Häfen — und Allergien?`
          : `${ack} Einschiff-Hafen, Kabine, Seetage oder viele Häfen — Allergien?`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'ideaHook') {
    return {
      speech: `${ack} ${ideaFallbackQuestion(ledger, addr)}`,
      askedKey: gap.key,
      hint,
    };
  }
  if (gap.key === 'rentalCar') {
    return {
      speech:
        addr === 'ihr'
          ? `${ack} Mietwagen vor Ort, oder kommt ihr ohne klar?`
          : `${ack} Mietwagen vor Ort, oder kommst du ohne klar?`,
      askedKey: gap.key,
      hint,
    };
  }
  return {
    speech: /\b(september|freitag|\d{1,2}\.\s*(september)?)\b/iu.test(userLine)
      ? `${ack} Termin sitzt. Soll ich die Recherche starten?`
      : `${ack} Soll ich die Recherche starten, oder fehlt noch was Wichtiges?`,
    askedKey: 'keep_talking',
    hint,
  };
}

function ideaFallbackQuestion(ledger: ReiseLedger, addr: 'du' | 'ihr'): string {
  const v = detectTripVibes(ledger);
  const you = addr === 'ihr' ? 'ihr' : 'du';
  const want = addr === 'ihr' ? 'wollt ihr' : 'willst du';
  if (v.kids && v.sport) {
    return `Wenn ${you} sowas mögt: Tennis-Camp oder Reiterurlaub — ${want} sowas überhaupt?`;
  }
  if (v.kids) {
    return `Wäre so ein Haus mit Kids-Club oder eher alles zusammen was für ${addr === 'ihr' ? 'euch' : 'dich'}?`;
  }
  if (v.wine) {
    return `Ein Hub, oder mehrere Orte hintereinander abklappern — ${want} sowas?`;
  }
  if (v.water) {
    return `Tour, Kanu, oder sogar eine Kreuzfahrt — klingt irgendwas davon?`;
  }
  if (v.hop) {
    return `Mehrere Städte abhaken oder ein Roadtrip — ${want} in die Richtung?`;
  }
  return `Wäre rumreisen, eine Tour oder ein Roadtrip irgendwas — oder lieber an einem Ort bleiben?`;
}

function reactFallback(userLine: string, ledger: ReiseLedger): string {
  const t = (userLine || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (/\b(nicht\s+campen|kein(?:en)?\s+camping|kein(?:es)?\s+zelt|nicht\s+zelten)\b/iu.test(t)) {
    return 'Camping streiche ich — bleibt vom Tisch.';
  }
  const budget = ledger.budgetEur?.value;
  if (
    budget != null &&
    (/\b(euro|€|budget|pro\s+person)\b/iu.test(t) || new RegExp(`\\b${budget}\\b`).test(t))
  ) {
    if (budget < 280) return 'Okay, dann müssen wir schon ein bisschen gucken, dass es sitzt.';
    if (budget < 500) return 'Solides Budget für ein Wochenende — damit lässt sich was machen.';
    return 'Damit können wir auf jeden Fall was reißen.';
  }
  if (/\b(bahncard|bahnkarte)\b/iu.test(t)) {
    return ledger.bahncard?.value && ledger.bahncard.value !== 'none'
      ? 'Bahncard notiert — das rechnet die Suche mit.'
      : 'Sparpreise der Bahn hab ich im Blick.';
  }
  if (/\bpool\b/iu.test(t) && /egal|frei/iu.test(t)) {
    return 'Verstehe — Typ ist zweitrangig, ein Pool wäre der Bonus.';
  }
  if (/\bpool\b/iu.test(t)) return 'Pool kommt als Wunsch aufs Board.';
  if (/\b(club|clubs|disco)\b/iu.test(t) && /\b(party|selber|privat|haus)\b/iu.test(t)) {
    return 'Beides notiert: Party selbst und Clubs — dann ist der Brief klar.';
  }
  if (/\b(selber\s+party|hausparty|privat)\b/iu.test(t)) {
    return 'Hausparty unter euch — steht als eigener Punkt.';
  }
  if (/\b(club|clubs|disco)\b/iu.test(t)) return 'Clubs hab ich extra drauf.';
  if (/\b(september|oktober|freitag|montag|samstag|anreise|los)\b/iu.test(t) && /\b\d{1,2}\b/.test(t)) {
    return 'Termin sitzt.';
  }
  if (/\begal\s+wann\s+(?:wir\s+)?(?:wieder|zurück|zurueck)/iu.test(t)) {
    return 'Rückreise bleibt flexibel — Anreise ist der Anker.';
  }
  if (/\b(optional|nicht\s+zwingend|wäre\s+cool|notfalls)\b/iu.test(t)) {
    return 'Als Optional, nicht als Muss — klar.';
  }
  if (/\b(unser\s+baby|neugeboren|\d{1,2}\s+monate)\b/iu.test(t)) {
    return 'Glückwunsch zum Nachwuchs — dann wird’s eher ruhig.';
  }
  if (/\bgünstig(?:e|es)?\s+bier|bierpreis|billig(?:es)?\s+bier\b/iu.test(t)) {
    return 'Günstiges Bier — klar, das bleibt im Blick.';
  }
  if (/\bapartment\b/iu.test(t) && /\bhotel\b/iu.test(t)) {
    return 'Apartment bevorzugt, Hotel als Alternative — hab ich getrennt.';
  }
  if (/\b(direktflug|umsteigen)\b/iu.test(t)) return 'Flug-Komfort notiert.';
  if (/\bparty|feiern|kneipe|männerwochenende|jungs\b/iu.test(t) && !ledger.purpose) {
    return 'Party und Entspannung — merke ich als Mix.';
  }
  if (/\b(spa|wellness|massage|sauna)\b/iu.test(t)) return 'Entspannen — nice, steht drauf.';
  if (/\b(kind|kinder|kids)\b/iu.test(t)) return 'Mit den Kleinen, klar.';
  if (/\b(wein|weinfest)\b/iu.test(t)) return 'Wein — notiert.';
  if (/\bgünstig|guenstig\b/iu.test(t)) return 'Günstig, okay — dann rechne ich knapp.';
  if (/\b(selber\s+einkaufen|selbst\s+kochen|eigene\s+küche)\b/iu.test(t)) {
    return 'Selbstverpflegung — dann brauchts eine Küche.';
  }
  if (/\b(direktflug|umsteigen|loslegen)\b/iu.test(t) && /\b(auch|egal|okay|ok)\b/iu.test(t)) {
    return 'Direkt wäre schön, Umsteigen geht auch — merke ich als weich.';
  }
  try {
    const { looksLikeGarbageFact } = require('./parseBriefSlots') as typeof import('./parseBriefSlots');
    if (looksLikeGarbageFact(t)) {
      return 'Das hab ich nicht klar verstanden — sag’s nochmal in einem Satz.';
    }
  } catch { /* soft */ }
  const echo = t.replace(/\s+/g, ' ').trim();
  if (echo.length >= 12 && echo.length <= 48) {
    return `Okay, ${echo.replace(/[.!?]+$/, '')} — steht.`;
  }
  return 'Okay, merke ich mir.';
}

function ensureQuestion(speech: string, question: string): string {
  return ensureBriefingQuestion(speech, question);
}

export function composeBriefingFallback(
  ledger: ReiseLedger,
  asked: string[],
  userLine: string,
): { speech: string; askedKey: string | null; hint: string } {
  return fallbackSpeech(ledger, asked, userLine);
}

export async function runOpeningGreeting(): Promise<string> {
  const { trip, appendAssistant } = useReisebueroStore.getState();
  if (trip.chat.length) return trip.chat[0]?.text ?? '';
  const fb = fallbackOpening();
  appendAssistant(fb.speech, fb.hint);
  return fb.speech;
}

export async function runBriefingReply(): Promise<string> {
  const store = useReisebueroStore.getState();
  const { trip, appendAssistant, markAsked, markSearchReadyAnnounced, syncSearchReadySticky } = store;
  syncSearchReadySticky();
  if (trip.phase === 'recap') {
    return trip.recapText || 'Passt das so?';
  }
  if (trip.ledger.recapDone?.value && trip.phase === 'research') {
    const speech = 'Alles klar — ich starte die Recherche.';
    appendAssistant(speech, 'Recherche');
    return speech;
  }
  const userLine = lastUserLine();
  const wasReady = trip.searchReadySticky || isBriefComplete(trip.ledger);
  const lastAsk = trip.askedSlotKeys[trip.askedSlotKeys.length - 1] ?? null;
  const fb = fallbackSpeech(trip.ledger, trip.askedSlotKeys, userLine, {
    searchReadyAnnounced: trip.searchReadyAnnounced,
    catalogExtras: trip.catalogExtras,
    holdAskKey: lastAsk,
  });
  // Fast path: lokale Speech sofort — kein Gemini-/Taste-Warten im Ping-Pong.
  // (Polish war bis 10s Race und hat die Antwort spürbar verzögert.)
  const speech = ensureQuestion(fb.speech, `${fb.hint}?`);
  const hint = fb.hint;
  if (fb.askedKey && !fb.holdTopic) markAsked(fb.askedKey);
  // Extra-Fragen: wenn User vage/mehrdeutig antwortet → Katalog ergänzen
  if (!fb.holdTopic) {
    try {
      const { maybeProposeCatalogExtra } = require('./questionCatalog') as typeof import('./questionCatalog');
      const extra = maybeProposeCatalogExtra(trip.ledger, userLine, fb.askedKey || lastAsk);
      if (extra) useReisebueroStore.getState().addCatalogExtra(extra);
    } catch {
      /* soft */
    }
  }
  if (fb.askedKey === 'ready_announce' || (wasReady && !trip.searchReadyAnnounced && isBriefComplete(trip.ledger))) {
    markSearchReadyAnnounced();
  }
  useReisebueroStore.getState().syncSearchReadySticky();
  appendAssistant(speech, hint);
  return speech;
}

/** Kompakte Recap vor finaler Recherche — flüssig mit Trip-Titel, Flipchart bleibt in der UI. */
export async function runRecapSpeech(opts?: { forceFull?: boolean }): Promise<string> {
  const { trip, appendAssistant, setRecapText, setPhase } = useReisebueroStore.getState();
  const { composeRecapSpeech, composeRecapPatchAck } = require('./recapSpeech') as typeof import('./recapSpeech');
  const already = trip.recapSpokenOnce && !opts?.forceFull;
  const speech = (already ? composeRecapPatchAck(trip.ledger) : composeRecapSpeech(trip.ledger)).trim();
  setRecapText(speech);
  setPhase('recap');
  if (!already) {
    useReisebueroStore.setState({
      trip: { ...useReisebueroStore.getState().trip, recapSpokenOnce: true },
    });
  }
  appendAssistant(speech, 'Passt das so?');
  return speech;
}

