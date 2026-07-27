/**
 * Rechtliche Texte & Compliance (DSGVO / EU AI Act / Affiliate-Transparenz).
 * Platzhalter für Verantwortlichen bitte vor Veröffentlichung ersetzen.
 */

import type { QuickAction } from '../types/concierge';

/** Kurzer Text für Rechtstexte (Einstellungen / Impressum) — nicht als Karten-Footer. */
export const AFFILIATE_DISCLOSURE_SHORT =
  'Buchungs-Buttons zu Partnern sind Anzeigen: Bei einer Buchung darüber kann Findus eine Provision erhalten — der Preis für dich bleibt gleich.';

/** Einzeiler für den einmaligen Dialog vor dem ersten Partner-Link pro Sitzung. */
export const AFFILIATE_REDIRECT_NOTICE =
  'Du öffnest ein Partner-Angebot. Wenn du darüber buchst, kann Findus eine Provision erhalten — für dich ändert sich am Preis nichts.';

/**
 * Passus für die Datenschutzerklärung — Tracking bei Weiterleitung zu Partnern.
 */
export const PRIVACY_AFFILIATE_PASSAGE =
  'Wenn du über Findus zu Partnern weitergeleitet wirst (z. B. GetYourGuide, Musement, Viator, Uber, Economy Bookings, Bounce, Stay22 oder CJ Affiliate), ' +
  'können anonymisierte Tracking-Parameter (Affiliate-/Partner-IDs) in der URL mitübertragen werden. ' +
  'Damit können wir Provisionen zuordnen. Es werden dabei keine personenbezogenen Profildaten an diese Partner übermittelt. ' +
  'Beim Aufruf der Partner-Websites können dort Cookies und ähnliche Technologien gesetzt werden — es gelten die Datenschutzbestimmungen der jeweiligen Partner.';

/** Kurzer Transparenz-Hinweis für Impressum / Rechtliches. */
export const AFFILIATE_TRANSPARENCY_IMPRINT =
  'Findus kann bei Touren, Tickets, Fahrten, Mietwagen, Gepäckaufbewahrung und Unterkünften Partner-Links nutzen. ' +
  'Die Auswahl und Qualität der Empfehlungen orientiert sich an deiner Anfrage; ' +
  'über Partner-Links können wir eine Provision erhalten. Für dich ändert sich am Preis nichts.';

/** DSGVO-Hinweis Audio / Mikrofon (Onboarding & Einstellungen). */
export const AUDIO_CONSENT_NOTICE =
  'Audioaufnahmen werden ausschließlich zur Verarbeitung eurer Spracheingaben genutzt und niemals an Dritte zu Werbezwecken verkauft.';

/** EU AI Act — Transparenzhinweis. */
export const AI_TRANSPARENCY_NOTICE =
  'Findus ist ein KI-gestütztes System. Empfehlungen, Tour-Erklärungen und Antworten werden automatisiert durch Sprachmodelle erzeugt. ' +
  'Bitte prüfe wichtige Angaben (Öffnungszeiten, Preise, Barrierefreiheit) vor Ort oder beim Anbieter.';

/** Platzhalter Verantwortlicher — vor Live-Gang ersetzen. */
export const LEGAL_CONTROLLER = {
  name: '[Name / Firma eintragen]',
  address: '[Straße, PLZ Ort eintragen]',
  email: '[datenschutz@beispiel.de]',
  phone: '[Telefon optional]',
  representative: '[Vertretungsberechtigte Person]',
} as const;

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
      `Hinweis: Bitte ersetze die Platzhalter vor der Veröffentlichung durch deine echten Unternehmensangaben.`,
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
      'Findus verarbeitet Daten, die du aktiv angibst oder die für die Kernfunktionen nötig sind:\n\n' +
      '• Profildaten (z. B. Name, E-Mail, Telefon, Alter, Reisepräferenzen) — lokal auf dem Gerät gespeichert, ' +
      'um Personalisierung und Reservierungsanfragen zu ermöglichen.\n' +
      '• Audiodaten / Mikrofon: Spracheingaben werden nur verarbeitet, wenn du das Mikrofon aktiv nutzt ' +
      '(oder einen von dir gewählten Hörmodus freigibst). ' +
      AUDIO_CONSENT_NOTICE +
      '\n' +
      '• Standortdaten: zur Erkennung von Sehenswürdigkeiten und Navigation, sofern du den Standort freigibst.\n' +
      '• Nutzungsdaten: z. B. besuchte Orte in der aktuellen Tour, Chatverlauf der Sitzung — zur Kontextführung der KI.\n\n' +
      'Eine Weitergabe an Dritte zu Werbezwecken findet nicht statt.',
  },
  {
    id: 'aiProcessing',
    title: 'Einsatz von KI-Modellen',
    body:
      'Deine Anfragen und der notwendige Kontext (z. B. Profil-Präferenzen, aktueller Ort) können an ' +
      'LLM-Anbieter (u. a. OpenAI, Google Gemini / Anthropic — je nach Konfiguration) übermittelt werden, ' +
      'um Antworten und Tour-Inhalte zu erzeugen. ' +
      'Es werden nur die für die Anfrage erforderlichen Daten übertragen.\n\n' +
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
      '• Widerruf erteilter Einwilligungen mit Wirkung für die Zukunft (z. B. Audio-Consent)\n' +
      '• Beschwerde bei einer Aufsichtsbehörde\n\n' +
      'In der App kannst du unter Einstellungen → Einrichtung die App zurücksetzen und lokale Profildaten löschen. ' +
      `Für weitere Anfragen: ${LEGAL_CONTROLLER.email}`,
  },
  {
    id: 'aiAct',
    title: 'Transparenz nach EU AI Act',
    body: AI_TRANSPARENCY_NOTICE,
  },
];

const PARTNER_URL_RE =
  /getyourguide\.com|musement\.com|viator\.com|tripadvisor\.com|m\.uber\.com|uber\.com|tui\.com|economybookings\.com|bounce\.com|stay22\.com|cj\.com|anrdoezrs\.net/i;

/** True, wenn die Action einen Affiliate-/Partner-Kanal öffnet. */
export function isPartnerAffiliateAction(action: QuickAction): boolean {
  if (
    action.type === 'OPEN_GYG_WIDGET' ||
    action.type === 'BOOK_UBER' ||
    action.type === 'BOOK_CAR_RENTAL' ||
    action.type === 'BOOK_BOUNCE_LUGGAGE' ||
    action.type === 'BOOK_STAY22'
  ) {
    return true;
  }
  if (action.type !== 'OPEN_URL') return false;
  const url = (action.payload.url ?? '').trim();
  if (!url) return false;
  return PARTNER_URL_RE.test(url);
}
