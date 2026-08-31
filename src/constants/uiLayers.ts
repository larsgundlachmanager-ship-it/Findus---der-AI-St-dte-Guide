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
  /**
   * Ort-Popup auf der Karte — über Map-Inhalt, unter Chrome.
   * Nie über Dock/Mic/Header: sonst frisst das absoluteFill alle Taps
   * (Settings/Timeline/Mic tot, Karte „flüssig aber tot“).
   */
  placePopup: 120,
  /** Dock, Header, Explore-Chip, Kompass — immer über Place-Popup */
  hud: 200,
  /** Mic-Float / Sheets — über HUD */
  sheet: 1000,
  /** Settings / Timeline / Orte — immer über Map-Popups + Chrome */
  overlay: 10_000,
  /** Tippen-Frage — über Timeline/Settings-Overlays */
  askSheet: 11_000,
} as const;
