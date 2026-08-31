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
  /** Ort-Popup auf der Karte — unter Settings/Timeline */
  placePopup: 9_000,
  /** Settings / Timeline / Orte — immer über Map-Popups */
  overlay: 10_000,
  /** Tippen-Frage — über Timeline/Settings-Overlays */
  askSheet: 11_000,
} as const;
