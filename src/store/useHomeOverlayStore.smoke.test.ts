/**
 * Run: npx --yes tsx src/store/useHomeOverlayStore.smoke.test.ts
 */

import {
  HOME_QUESTION_DEFAULT_SUBTITLE,
  useHomeOverlayStore,
} from './useHomeOverlayStore';
import { usePlanCalendarUiStore } from '../module2/timeline/planCalendarUiStore';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function overlayBlocksMap(): boolean {
  const o = useHomeOverlayStore.getState();
  return (
    o.settingsVisible ||
    o.seekVisible ||
    o.passportVisible ||
    o.questionVisible ||
    usePlanCalendarUiStore.getState().calendarVisible
  );
}

function reset(): void {
  useHomeOverlayStore.setState({
    settingsVisible: false,
    settingsMounted: false,
    seekVisible: false,
    seekMounted: false,
    passportVisible: false,
    questionVisible: false,
    questionSubtitle: HOME_QUESTION_DEFAULT_SUBTITLE,
  });
  usePlanCalendarUiStore.getState().setCalendarVisible(false);
}

function run(): void {
  reset();
  assert(overlayBlocksMap() === false, 'ohne Overlay nicht blockiert');

  useHomeOverlayStore.getState().openSettings();
  assert(overlayBlocksMap() === true, 'Settings blockiert die Karte');
  assert(
    useHomeOverlayStore.getState().settingsMounted === true,
    'Settings bleibt nach erstem Open gemountet',
  );
  useHomeOverlayStore.getState().closeSettings();
  assert(overlayBlocksMap() === false, 'Settings zu → frei');
  assert(
    useHomeOverlayStore.getState().settingsMounted === true,
    'Mounted bleibt nach Close',
  );

  usePlanCalendarUiStore.getState().setCalendarVisible(true);
  assert(overlayBlocksMap() === true, 'Timeline blockiert die Karte');
  usePlanCalendarUiStore.getState().setCalendarVisible(false);
  assert(overlayBlocksMap() === false, 'Timeline zu → frei');

  useHomeOverlayStore.getState().openQuestion('Tipp');
  assert(overlayBlocksMap() === true, 'Tippfeld blockiert');
  useHomeOverlayStore.getState().closeQuestion();
  assert(overlayBlocksMap() === false, 'Tippfeld zu → frei');

  console.log('useHomeOverlayStore.smoke.test.ts OK');
}

run();
