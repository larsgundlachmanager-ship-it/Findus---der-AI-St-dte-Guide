/**
 * Früher Fake-Karten für die Feature-Tour.
 * Erklärung läuft jetzt 1:1 auf Homescreen-Chrome (Karte, Orte, Popup, Timeline, Settings).
 */

import type { ExplanationHint } from '../i18n';
import type React from 'react';
import type { View } from 'react-native';

type Props = {
  hint: ExplanationHint;
  cityName: string;
  landmarkName?: string | null;
  settingsOpen: boolean;
  settingsAccordion: string | null;
  onToggleAccordion: (id: string) => void;
  helpInteractive?: boolean;
  onHelpAction?: (prompt: string) => void;
  module1Ref?: React.RefObject<View | null>;
  bulletsRef?: React.RefObject<View | null>;
  actionsRef?: React.RefObject<View | null>;
  settingsDemoRef?: React.RefObject<View | null>;
  queueDemoRef?: React.RefObject<View | null>;
  timelineRef?: React.RefObject<View | null>;
  realTimelineOpen?: boolean;
};

export function GuidedFeatureTourOverlays(_props: Props) {
  return null;
}
