/** Kurze Sofort-Reaktionen für Phase-1-Audio (Kokoro). */
export const POI_INTROS = [
  'Alles klar, ich schaue mir den Ort an.',
  'Moment, ich hole die Fakten heraus.',
  'Interessant – ich erzähl dir gleich mehr dazu.',
  'Kurz warten, ich bereite die Tour vor.',
] as const;

export const QUESTION_INTROS = [
  'Interessante Frage, lass mich nachsehen.',
  'Gute Frage – ich schaue kurz nach.',
  'Alles klar, ich finde eine Antwort.',
  'Moment, ich denke kurz nach.',
] as const;

export function pickIntro(kind: 'poi' | 'question'): string {
  const list = kind === 'poi' ? POI_INTROS : QUESTION_INTROS;
  const index = Math.floor(Math.random() * list.length);
  return list[index] ?? list[0];
}
