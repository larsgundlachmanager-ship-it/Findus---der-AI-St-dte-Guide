/** Grobe Land-Slug-Schaetzung fuer Airalo — nur Hint, nie Fake-Preis. */
function guessEsimCountrySlug(placeName?: string | null, hint?: string | null): string | null {
  const blob = `${placeName || ''} ${hint || ''}`.toLowerCase();
  if (/hellfest|frankreich|france|paris|lyon|nantes|cannes|nice|marseille/.test(blob)) return 'france';
  if (/griech|greece|athen|kreta|korfu|rhodos|santorini|naxos/.test(blob)) return 'greece';
  if (/spanien|spain|mallorca|ibiza|barcelona|madrid|valencia|malaga/.test(blob)) return 'spain';
  if (/italien|italy|rom|milan|florenz|venedig|sizilien/.test(blob)) return 'italy';
  if (/tuerkei|türkei|turkey|antalya|istanbul|bodrum/.test(blob)) return 'turkey';
  if (/portugal|lissabon|porto|algarve/.test(blob)) return 'portugal';
  if (/niederlande|holland|amsterdam/.test(blob)) return 'netherlands';
  if (/oesterreich|österreich|austria|wien|salzburg/.test(blob)) return 'austria';
  if (/kroatien|croatia|split|dubrovnik/.test(blob)) return 'croatia';
  if (/deutschland|germany|berlin|hamburg|muenchen|münchen/.test(blob)) return 'germany';
  return null;
}
