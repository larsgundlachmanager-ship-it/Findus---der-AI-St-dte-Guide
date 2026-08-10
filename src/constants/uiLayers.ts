/**
 * Masterbook LiveStage (top → bottom in document flow):
 * Presence → Bullets → Actions → Subtitles → Mic (outside stage)
 * zIndex only for non-stage overlays (HUD / sheets).
 */
export const UI_LAYER = {
  avatar: 10,
  bullets: 20,
  actions: 30,
  subtitles: 40,
  mic: 50,
  hud: 200,
  sheet: 1000,
  overlay: 10_000,
} as const;
