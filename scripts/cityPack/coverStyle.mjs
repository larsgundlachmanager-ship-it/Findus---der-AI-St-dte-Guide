/**
 * SSOT: Findus Stadt-Cover Bildstil (Soft-Photo).
 * Alle neuen/überarbeiteten Covers nutzen denselben Look.
 */

export const COVER_STYLE_ID = 'findus_soft_photo_v1';

/** Kurzer Style-Block für GenerateImage-Prompts (englisch = bessere Bildmodelle). */
export const COVER_STYLE_PROMPT = `
STYLE (mandatory, same for every Findus city cover):
- Soft photorealistic travel photograph, 16:9 landscape hero
- Light cinematic color grade only: warm late-day light, gentle contrast
- NOT a painting, NOT illustration, NO oil paint, NO heavy brushstrokes, NO concept art
- Natural photo texture in sky, water, architecture, vegetation
- NO people portraits / NO faces as main subject (tiny distant silhouettes OK)
- NO text, logos, watermarks, UI chrome
- NO bottom gradient / dark fade bar / letterbox / vignette strip at the bottom edge
- Full-bleed photo to all four edges — no semi-transparent black overlay
- Landmark/place must stay recognizable as that city, but composition must NOT be a 1:1 copy of the source photo
`.trim();

export const COVER_TRANSFORM_PROMPT = `
TRANSFORM vs source reference:
1. Prefer a modest camera shift OR keep the same framing if geography must stay exact
2. CHANGE movable things: people, cars, boats, chairs, temporary tents furniture placement, clouds slightly
3. KEEP fixed reality locked: buildings, bridges, landmarks, major trees, real waterways only if they exist in the source photo — NEVER invent rivers/lakes/harbors that are not in the real place
4. Do NOT turn the place into fantasy architecture or postcard fiction
5. Soft photorealistic grade only — no heavy paint
`.trim();

/** Style-Anker: bereits freigegebene Soft-Photo-Covers. */
export const COVER_STYLE_ANCHORS = [
  'assets/onboarding/city-wangerooge-3.png',
  'assets/onboarding/city-laboe-2.png',
];

export function buildCoverPrompt({ cityName, landmarkHint = '', extra = '' }) {
  const place = landmarkHint
    ? `Subject: ${cityName}. Landmark/focus: ${landmarkHint}.`
    : `Subject: ${cityName} city cover showing its characteristic place.`;
  return [
    `Create a Findus city selection cover for ${cityName}.`,
    place,
    COVER_STYLE_PROMPT,
    COVER_TRANSFORM_PROMPT,
    extra,
  ]
    .filter(Boolean)
    .join('\n\n');
}
