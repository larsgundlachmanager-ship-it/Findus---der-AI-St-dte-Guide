/**
 * Rechtliche Texte & Compliance (DSGVO / EU AI Act / Affiliate-Transparenz / AGB).
 * Store-ready Stand — Verantwortlicher: LEGAL_CONTROLLER.
 */

import type { QuickAction } from '../types/concierge';

/** Kurzer Text für Rechtstexte (Einstellungen / Impressum) — nicht als Karten-Footer. */
export const AFFILIATE_DISCLOSURE_SHORT =
  'Buchungs-Buttons zu Partnern sind Anzeigen: Bei einer Buchung darüber kann Yorro eine Provision erhalten — der Preis für dich bleibt gleich.';

/** Einzeiler für den einmaligen Dialog vor dem ersten Partner-Link pro Sitzung. */
export const AFFILIATE_REDIRECT_NOTICE =
  'Du öffnest ein Partner-Angebot. Wenn du darüber buchst, kann Yorro eine Provision erhalten — für dich ändert sich am Preis nichts.';

/**
 * Passus für die Datenschutzerklärung — Tracking bei Weiterleitung zu Partnern.
 */
export const PRIVACY_AFFILIATE_PASSAGE =
  'Wenn du über Yorro zu Partnern weitergeleitet wirst (z. B. GetYourGuide, Musement, Viator, Uber, DiscoverCars, Economy Bookings, Bounce, Stay22, Airalo, Travelpayouts/Klook/Tiqets oder CJ Affiliate), ' +
  'können anonymisierte Tracking-Parameter (Affiliate-/Partner-IDs) in der URL mitübertragen werden. ' +
  'Damit können wir Provisionen zuordnen. Es werden dabei keine personenbezogenen Profildaten an diese Partner übermittelt. ' +
  'Beim Aufruf der Partner-Websites können dort Cookies und ähnliche Technologien gesetzt werden — es gelten die Datenschutzbestimmungen der jeweiligen Partner.';

/** Kurzer Transparenz-Hinweis für Impressum / Rechtliches. */
export const AFFILIATE_TRANSPARENCY_IMPRINT =
  'Yorro kann bei Touren, Tickets, Fahrten, Mietwagen, Gepäckaufbewahrung, eSIM und Unterkünften Partner-Links nutzen. ' +
  'Die Auswahl und Qualität der Empfehlungen orientiert sich an deiner Anfrage; ' +
  'über Partner-Links können wir eine Provision erhalten. Für dich ändert sich am Preis nichts.';

/** Account / Cloud-Sync (Einstellungen & Onboarding). */
export const ACCOUNT_SYNC_NOTICE =
  'Mit Konto speichert Yorro Profil, Stempelkarte, Pläne und Merker verschlüsselt in deiner Cloud (nur für dich, mit Login). ' +
  'Als Gast bleiben alle Daten nur lokal auf dem Gerät.';

/** Newsletter Opt-in — getrennt vom Sync. */
export const NEWSLETTER_OPT_IN_NOTICE =
  'Newsletter nur mit ausdrücklicher Zustimmung. Abmelden jederzeit in den Einstellungen oder über den Link in der Mail. ' +
  'Ohne Konto und Opt-in kein Newsletter.';

/** DSGVO-Hinweis Audio / Mikrofon (Onboarding & Einstellungen). */
export const AUDIO_CONSENT_NOTICE =
  'Audioaufnahmen werden ausschließlich zur Verarbeitung eurer Spracheingaben genutzt und niemals an Dritte zu Werbezwecken verkauft.';

/** EU AI Act — Transparenzhinweis. */
export const AI_TRANSPARENCY_NOTICE =
  'Yorro ist ein KI-gestütztes System. Empfehlungen, Tour-Erklärungen und Antworten werden automatisiert durch Sprachmodelle erzeugt. ' +
  'Bitte prüfe wichtige Angaben (Öffnungszeiten, Preise, Barrierefreiheit, Live-Abfahrten oder Wetterumschwünge) vor Ort oder beim Anbieter.';

/** Account, Cloud-Sync & Gerätewechsel (kurz für Einstellungen / Datenschutz). */
export const ACCOUNT_CLOUD_SYNC_PASSAGE =
  'Mit einem Yorro-Konto (Magic Link, Google oder Apple) kannst du Profil, Stempelkarte, Zeitachse und Merk-Einträge optional in Supabase synchronisieren. ' +
  'Die JSON-Dateien auf deinem Gerät bleiben die primäre Quelle; Uploads erfolgen nur bei Änderungen und nach kurzer Verzögerung. ' +
  'Ohne Login oder im Gastmodus bleibt alles ausschließlich lokal.';

/** Newsletter — Einwilligung getrennt vom Konto-Sync. */
export const NEWSLETTER_PRIVACY_PASSAGE =
  'Der optionale Yorro-Newsletter (Produkt-Updates, Reise-Tipps) wird nur versendet, wenn du ihn in den Einstellungen aktivierst. ' +
  'Dafür speichern wir E-Mail-Adresse (vom Login), Opt-in-Zeitpunkt und Sprache. Du kannst die Einwilligung jederzeit widerrufen — ohne Auswirkung auf die App-Nutzung.';

/** Lernen & Feedback (Einwilligung). */
export const LEARNING_FEEDBACK_CONSENT =
  'Wenn du Feedback oder ein Problem meldest, können Diagnose- und Nutzungsdaten (z. B. letzte Aktionen, App-Version, grobe Ortsangaben ohne Tracking-Profil) mitgeschickt werden — damit Yorro besser wird. ' +
  'Keine Weitergabe an Werbenetzwerke. Details auch unter Datenschutz.';

/** Verantwortlicher — SSOT für App-Impressum / Datenschutz (wie website/impressum.html). */
export const LEGAL_CONTROLLER = {
  name: 'Lars Gundlach',
  address: 'Heisterhoop 12\n25497 Prisdorf\nDeutschland',
  email: 'lars.gundlach.manager@gmail.com',
  phone: '',
  representative: 'Lars Gundlach',
} as const;

/** True, solange noch Platzhalter in LEGAL_CONTROLLER stehen (Shipping-Blocker). */
export function isLegalControllerIncomplete(): boolean {
  const blob = [
    LEGAL_CONTROLLER.name,
    LEGAL_CONTROLLER.address,
    LEGAL_CONTROLLER.email,
    LEGAL_CONTROLLER.representative,
  ].join(' ');
  return /PLACEHOLDER|\[Name|\[Straße|beispiel\.de/i.test(blob);
}

/** Callout nur wenn isLegalControllerIncomplete() — sonst in der UI ausblenden. */
export const LEGAL_PLACEHOLDER_CALLOUT =
  '⛔ SHIPPING-BLOCKER: Die Angaben zum Verantwortlichen sind noch PLATZHALTER. ' +
  'Diese App darf nicht veröffentlicht oder in Stores eingereicht werden, ' +
  'solange LEGAL_CONTROLLER in constants/legal.ts nicht durch echte Unternehmensdaten ersetzt wurde.';

/**
 * Nutzungsbedingungen / AGB — Store-ready Kurzfassung (DE).
 * Kein Ersatz für anwaltliche Prüfung; Inhalt spiegelt App-Funktionen wider.
 */
export const TERMS_OF_SERVICE =
  `Nutzungsbedingungen (AGB) — Yorro\n` +
  `Stand: August 2026\n\n` +
  `1. Anbieter\n` +
  `Anbieter der App „Yorro“ ist ${LEGAL_CONTROLLER.name}, ${LEGAL_CONTROLLER.address.replace(/\n/g, ', ')}. ` +
  `Kontakt: ${LEGAL_CONTROLLER.email}.\n\n` +
  `2. Leistungsbeschreibung\n` +
  `Yorro ist ein digitaler Reise-Concierge: Stadt-Packs, POI-Erzählungen, Planung, Navigation-Hinweise, Spracheingabe und KI-Antworten. ` +
  `Die App ersetzt keine offiziellen Auskünfte von Behörden, Verkehrsunternehmen oder Anbietern vor Ort.\n\n` +
  `3. KI & Haftung für Inhalte\n` +
  AI_TRANSPARENCY_NOTICE +
  `\n` +
  `Buchungen, Reservierungen und Käufe erfolgen nur mit deiner ausdrücklichen Bestätigung und typischerweise bei Drittanbietern. ` +
  `Für Verträge mit Partnern gelten deren AGB.\n\n` +
  `4. Audio & Mikrofon\n` +
  AUDIO_CONSENT_NOTICE +
  `\n\n` +
  `5. Standort & Benachrichtigungen\n` +
  `Standort und Push-Benachrichtigungen werden nur genutzt, wenn du sie freigibst — für Navigation, POI-Erkennung und Erinnerungen (z. B. Leave-by).\n\n` +
  `6. Konto & Daten\n` +
  `Gastmodus: Daten lokal. Mit Konto: optionale Cloud-Sync gemäß Datenschutzerklärung. Du kannst lokale Daten zurücksetzen und Auskunft/Löschung verlangen.\n\n` +
  `7. Partner-Links\n` +
  AFFILIATE_TRANSPARENCY_IMPRINT +
  `\n\n` +
  `8. Nutzungsregeln\n` +
  `Du nutzt Yorro nur rechtmäßig. Missbrauch (z. B. automatisierte Massenabfragen, Umgehung von Sicherheitsmechanismen) ist untersagt. ` +
  `Wir können den Zugang bei grobem Missbrauch einschränken.\n\n` +
  `9. Verfügbarkeit\n` +
  `Wir bemühen uns um stabile Verfügbarkeit, schulden aber keine unterbrechungsfreie Nutzung. Externe APIs (Karten, Wetter, LLM, TTS) können ausfallen.\n\n` +
  `10. Änderungen\n` +
  `Wir können diese Bedingungen anpassen. Wesentliche Änderungen weisen wir in der App aus. Die jeweils aktuelle Fassung findest du unter Einstellungen → Datenschutz, AGB & Impressum.\n\n` +
  `11. Anwendbares Recht\n` +
  `Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss kollisionsrechtlicher Normen, soweit zwingendes Verbraucherschutzrecht am Wohnsitz nicht entgegensteht.\n\n` +
  `12. Kontakt\n` +
  `${LEGAL_CONTROLLER.email}`;

export type LegalChapterId =
  | 'controller'
  | 'dataCollection'
  | 'aiProcessing'
  | 'affiliates'
  | 'userRights'
  | 'aiAct'
  | 'imprint';

export type LegalChapter = {
  id: LegalChapterId;
  title: string;
  body: string;
};

/** Strukturierte Pflichtkapitel für Datenschutz & Impressum. */
export const LEGAL_CHAPTERS: LegalChapter[] = [
  {
    id: 'imprint',
    title: 'Impressum',
    body:
      `Angaben gemäß § 5 TMG / § 18 MStV\n\n` +
      `Verantwortlich:\n${LEGAL_CONTROLLER.name}\n${LEGAL_CONTROLLER.address}\n` +
      `E-Mail: ${LEGAL_CONTROLLER.email}\n` +
      (LEGAL_CONTROLLER.phone
        ? `Telefon: ${LEGAL_CONTROLLER.phone}\n`
        : '') +
      `Vertreten durch: ${LEGAL_CONTROLLER.representative}\n\n` +
      `Haftung für Inhalte\n` +
      `Als Diensteanbieter sind wir gemäß § 7 Abs. 1 TMG für eigene Inhalte nach den allgemeinen Gesetzen verantwortlich. ` +
      `Nach §§ 8 bis 10 TMG sind wir nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen. ` +
      `Verpflichtungen zur Entfernung oder Sperrung nach den allgemeinen Gesetzen bleiben unberührt.\n\n` +
      `Haftung für Links\n` +
      `Die App enthält Links zu externen Websites Dritter. Für deren Inhalte ist stets der jeweilige Anbieter verantwortlich.\n\n` +
      `Urheberrecht\n` +
      `Eigene Inhalte und Werke unterliegen dem deutschen Urheberrecht. Stadt-Pack- und Tour-Texte dürfen nicht ohne Zustimmung außerhalb der App vervielfältigt oder kommerziell verwertet werden.`,
  },
  {
    id: 'controller',
    title: 'Verantwortlicher (Datenschutz)',
    body:
      `Verantwortlich für die Verarbeitung personenbezogener Daten in dieser App ist:\n\n` +
      `${LEGAL_CONTROLLER.name}\n${LEGAL_CONTROLLER.address}\n` +
      `Kontakt: ${LEGAL_CONTROLLER.email}`,
  },
  {
    id: 'dataCollection',
    title: 'Erhebung & Speicherung personenbezogener Daten',
    body:
      'Yorro verarbeitet Daten, die du aktiv angibst oder die für die Kernfunktionen nötig sind:\n\n' +
      '• Profildaten (z. B. Name, E-Mail, Telefon, Alter, Reisepräferenzen, Charakter/Stimme) — lokal auf dem Gerät, ' +
      'um Personalisierung und Reservierungsanfragen zu ermöglichen.\n' +
      '• Audiodaten / Mikrofon: Spracheingaben nur, wenn du das Mikrofon aktiv nutzt ' +
      '(oder einen von dir gewählten Hörmodus freigibst). ' +
      AUDIO_CONSENT_NOTICE +
      '\n' +
      '• Standortdaten: Sehenswürdigkeiten, Navigation, Stadt-/POI-Zuordnung, Wetter und situative Vorschläge — nur mit Freigabe.\n' +
      '• Nutzungsdaten: besuchte Orte, Chatverlauf der Sitzung, Hilfen, Stempel-/Routenstände — zur Kontextführung der KI.\n' +
      '• Benachrichtigungsdaten: lokale Reminder (Bus, Flug, Wecker) und deren Zeitpunkte auf dem Gerät.\n' +
      '• Wetter- und Verbindungsdaten: situationsabhängig externe Quellen für Routen, Regen, Live-Verbindungen, Flugstatus.\n\n' +
      ACCOUNT_CLOUD_SYNC_PASSAGE +
      '\n\n' +
      NEWSLETTER_PRIVACY_PASSAGE +
      '\n\n' +
      'Rechtsgrundlagen je nach Vorgang: Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), Vertrag/Nutzung (lit. b) oder berechtigtes Interesse an stabiler App-Funktion (lit. f).\n\n' +
      'Eine Weitergabe an Dritte zu Werbezwecken findet nicht statt.',
  },
  {
    id: 'aiProcessing',
    title: 'Einsatz von KI-Modellen',
    body:
      'Deine Anfragen und der notwendige Kontext (z. B. Profil-Präferenzen, aktueller Ort) können an ' +
      'LLM-Anbieter (u. a. OpenAI, Google Gemini / Anthropic — je nach Konfiguration) sowie Sprachsynthese-Anbieter (TTS) übermittelt werden, ' +
      'um Antworten und Tour-Inhalte zu erzeugen. ' +
      'Es werden nur die für die Anfrage erforderlichen Daten übertragen. Dazu können je nach Funktion auch Wetter-, Routing-, Verkehrs-, Flug- oder Fähren-Kontexte gehören.\n\n' +
      AI_TRANSPARENCY_NOTICE,
  },
  {
    id: 'affiliates',
    title: 'Affiliate-Links & Tracking',
    body: PRIVACY_AFFILIATE_PASSAGE + '\n\n' + AFFILIATE_TRANSPARENCY_IMPRINT,
  },
  {
    id: 'userRights',
    title: 'Rechte der Nutzerinnen und Nutzer',
    body:
      'Du hast nach der DSGVO insbesondere das Recht auf:\n\n' +
      '• Auskunft über gespeicherte personenbezogene Daten\n' +
      '• Berichtigung unrichtiger Daten\n' +
      '• Löschung („Recht auf Vergessenwerden“), soweit keine gesetzlichen Aufbewahrungspflichten entgegenstehen\n' +
      '• Einschränkung der Verarbeitung\n' +
      '• Datenübertragbarkeit\n' +
      '• Widerruf erteilter Einwilligungen mit Wirkung für die Zukunft (z. B. Audio-Consent, Newsletter)\n' +
      '• Beschwerde bei einer Aufsichtsbehörde (in DE z. B. die Landesbeauftragte für Datenschutz deines Bundeslandes)\n\n' +
      'In der App: Einstellungen → Persönliche Informationen / Allgemeine Einstellungen sowie Zurücksetzen lokaler Daten; ' +
      'Hilfe unter Einstellungen → Erklärungen. ' +
      `Für weitere Anfragen: ${LEGAL_CONTROLLER.email}`,
  },
  {
    id: 'aiAct',
    title: 'Transparenz nach EU AI Act',
    body:
      AI_TRANSPARENCY_NOTICE +
      '\n\n' +
      'Yorro stellt KI-generierte Inhalte transparent dar und ersetzt keine menschliche Beratung in kritischen Situationen ' +
      '(Sicherheit, medizinische Notfälle, verbindliche Reise- oder Rechtsauskünfte).',
  },
];

const PARTNER_URL_RE =
  /getyourguide\.com|musement\.com|viator\.com|tripadvisor\.com|m\.uber\.com|uber\.com|tui\.com|economybookings\.com|discovercars\.com|bounce\.com|stay22\.com|expedia\.com|expedia\.de|airalo\.com|travsim\.com|camping\.info|solmar\.de|\bweg\.de\b|cj\.com|anrdoezrs\.net|tpx\.li|c111\.travelpayouts\.com|kiwi\.com|klook\.com|tiqets\.com|kkday\.com|wegotrip\.com|gocity\.com|saily\.com|yesim\.|drimsim\.|welcomepickups\.com|gettransfer\.com|kiwitaxi\.com|intui\.travel|localrent\.com|getrentacar\.com|autoeurope\.|bikesbooking\.com|radicalstorage\.com|aviasales\.|airhelp\.com|compensair\.com|ektatraveling\.com|qeeq\.com|awin1\.com|travelsecure\.de|gokonfetti\.com|check24\.(de|net)|ab-in-den-urlaub\.(de|at|ch)/i;

/** True, wenn die Action einen Affiliate-/Partner-Kanal öffnet. */
export function isPartnerAffiliateAction(action: QuickAction): boolean {
  if (
    action.type === 'OPEN_GYG_WIDGET' ||
    action.type === 'BOOK_UBER' ||
    action.type === 'BOOK_CAR_RENTAL' ||
    action.type === 'BOOK_BOUNCE_LUGGAGE' ||
    action.type === 'BOOK_STAY22' ||
    action.type === 'BOOK_ESIM'
  ) {
    return true;
  }
  if (action.type !== 'OPEN_URL') return false;
  const url = (action.payload.url ?? '').trim();
  if (!url) return false;
  return PARTNER_URL_RE.test(url);
}
