/**
 * Proactive Reasoning hints — Checkout vs. späteres Event, Hotel-Lücke,
 * Flughafen, Abend frei, Plan-Gaps. Hilfe zuerst (kein Partner-Pitch).
 */

import { useFinnusStore } from '../../store/useFinnusStore';
import { useUserMemoryStore } from '../../store/useUserMemoryStore';
import {
  detectHelpFirstMoments,
  helpFirstMonetizationPromptBlock,
} from '../affiliate/helpFirstMonetization';

const CHECKOUT_RE =
  /\b(auscheck|check[- ]?out|zimmer\s+abgeb|hotel\s+verlass|bis\s+\d{1,2}\s*uhr\s+raus)\b/iu;
const STAY_EVENT_RE =
  /\b(tennis|turnier|match|spiel(?:en)?|donnerstag|mittwoch|übermorgen|uebermorgen|noch\s+mal\s+spiel|wenn\s+ich\s+gewinn)\b/iu;
const WIN_CHAIN_RE =
  /\b(wenn\s+ich\s+(?:morgen\s+)?gewinn|gewinn(?:e|t)?\s+ich|weiter\s+im\s+turnier|nächste\s+runde)\b/iu;

function recentChatBlob(limit = 8): string {
  const hist = useFinnusStore.getState().chatHistory ?? [];
  return hist
    .slice(-limit)
    .map((m) => m.content)
    .join(' \n ');
}

/**
 * Prompt-Block: Mitdenken bei Zeit-/Unterkunfts-Lücken + Hilfe-zuerst-Momente.
 */
export function proactiveReasoningPromptBlock(userText: string): string {
  const t = userText.replace(/\s+/g, ' ').trim();
  const recent = recentChatBlob();
  const blob = `${recent}\n${t}`;
  const hotel = useUserMemoryStore.getState().getConfirmedHotel();
  const lines: string[] = [
    '=== PROACTIVE REASONING (PFLICHT) ===',
    '- Verknüpfe aktuelle Aussage mit vorherigen Turns (Checkout, Hotel, Flüge, Abendpläne).',
    '- Bei Zeitlücken: Hat User Hotel/Transport für den Zeitraum? Sonst Lösung anbieten — als Hilfe, nicht als Pitch.',
    '- Zielgefühl: User denkt „danke, dass du mitdenkst.“',
  ];

  const checkoutInPlay = CHECKOUT_RE.test(blob);
  const eventInPlay = STAY_EVENT_RE.test(blob) || WIN_CHAIN_RE.test(t);

  if (checkoutInPlay && eventInPlay) {
    lines.push(
      '- KONFLIKT ERKANNT: Checkout/Abreise + späteres Event.',
      '- MUSS ansprechen: Braucht User noch eine Nacht? Hotel verlängern ODER Alternative (BOOK_STAY22)?',
      hotel
        ? `- Bekanntes Hotel: ${hotel.name} — Verlängerung nachfragen ODER Stay22-Alternativen anbieten.`
        : '- Kein bestätigtes Hotel — Stay22 / konkrete Unterkunft vorschlagen.',
      '- Echte Actions: BOOK_STAY22 und/oder SHOW_MORE „Hotel verlängern nachfragen“ — KEIN Fake-Turnierplan.',
    );
  } else if (
    WIN_CHAIN_RE.test(t) ||
    (eventInPlay && /\bdonnerstag|mittwoch|übermorgen\b/iu.test(t))
  ) {
    lines.push(
      '- Weiterkommen im Turnier/Event → Planung anpassen + Unterkunft prüfen falls Checkout nah.',
      '- Turnier-/Ansetzungsdaten oft nur vor Ort / Login → ehrlich sagen, KEIN Turnierplan-Button ohne URL.',
      '- Stattdessen: anerkennen + Hotel-Frage + optional Stay22.',
    );
  }

  if (CHECKOUT_RE.test(t)) {
    lines.push(
      '- SILENT BONUS: Bei Checkout in visualBullets Frühstückszeiten ergänzen, NUR wenn live/aus Hotel-Kontext bekannt — nie schätzen.',
    );
  }

  const moments = detectHelpFirstMoments({
    userText: t,
    planBlob: recent,
    checkoutConflict: checkoutInPlay && eventInPlay,
  });
  const helpBlock = helpFirstMonetizationPromptBlock(moments);
  if (helpBlock) lines.push(helpBlock);

  lines.push(
    '- ZERO-FAKE: Kein Button ohne echtes Tool/https-URL. Lieber 0 Buttons.',
  );

  return lines.join('\n');
}
