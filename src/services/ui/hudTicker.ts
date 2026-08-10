/**
 * Kontextzeilen für das Live-HUD — Facade über die Proaktive HUD-Engine.
 */

export {
  evaluateProactiveHud,
  getActiveHudTip,
  getHudTickerLines,
  subscribeHudTip,
  HUD_ENGINE_INTERVAL_MS,
  type HudTipCandidate,
} from './proactiveHudEngine';

export {
  getLiveHudReminderLines,
  tickProactiveReminderEngine,
  REMINDER_ENGINE_INTERVAL_MS,
} from './proactiveReminderEngine';
