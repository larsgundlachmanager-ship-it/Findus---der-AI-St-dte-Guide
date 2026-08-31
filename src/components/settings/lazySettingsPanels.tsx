/**
 * Settings-Abschnitte erst laden, wenn das Accordion aufgeht.
 * Qualität unverändert — nur Parse-/Mount-Kosten später.
 */

import React, { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { colors, spacing } from '../../constants/theme';

function PanelFallback() {
  return (
    <View style={{ paddingVertical: spacing.md, alignItems: 'center' }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

function wrapNamed(
  loader: () => Promise<React.ComponentType<any>>,
): React.ComponentType<any> {
  const Lazy = React.lazy(async () => {
    const Cmp = await loader();
    return { default: Cmp };
  });
  return function LazyPanel(props: any) {
    return (
      <Suspense fallback={<PanelFallback />}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}

export const LazyVoiceSelectorList = wrapNamed(() =>
  import('../VoiceSelectorList').then((m) => m.VoiceSelectorList),
);

export const LazyPersonalityMatrixStep = wrapNamed(() =>
  import('../../onboarding/PersonalityMatrixStep').then(
    (m) => m.PersonalityMatrixStep,
  ),
);

export const LazyAgeLifeSlider = wrapNamed(() =>
  import('../../onboarding/AgeLifeSlider').then((m) => m.AgeLifeSlider),
);

export const LazyHelpCatalogBrowser = wrapNamed(() =>
  import('../legal/HelpGuideView').then((m) => m.HelpCatalogBrowser),
);

export const LazyFeedbackSection = wrapNamed(() =>
  import('../feedback/FeedbackSection').then((m) => m.FeedbackSection),
);

export const LazyConciergePrefsEditor = wrapNamed(() =>
  import('../ConciergePrefsEditor').then((m) => m.ConciergePrefsEditor),
);

export const LazyExperiencePrefsEditor = wrapNamed(() =>
  import('../ExperiencePrefsEditor').then((m) => m.ExperiencePrefsEditor),
);

export const LazyLiveQualityPanel = wrapNamed(() =>
  import('../LiveQualityPanel').then((m) => m.LiveQualityPanel),
);

export const LazyHandsFreeActivationSettings = wrapNamed(() =>
  import('./HandsFreeActivationSettings').then(
    (m) => m.HandsFreeActivationSettings,
  ),
);

export const LazyModule1BackgroundSpeechSettings = wrapNamed(() =>
  import('./Module1BackgroundSpeechSettings').then(
    (m) => m.Module1BackgroundSpeechSettings,
  ),
);

export const LazyStartBaseSettingsBlock = wrapNamed(() =>
  import('./StartBaseSettingsBlock').then((m) => m.StartBaseSettingsBlock),
);

export const LazyLearnedProfilePanel = wrapNamed(() =>
  import('./InternalSettingsPanels').then((m) => m.LearnedProfilePanel),
);

export const LazyLogisticsPanel = wrapNamed(() =>
  import('./InternalSettingsPanels').then((m) => m.LogisticsPanel),
);

export const LazyPushTriggersPanel = wrapNamed(() =>
  import('./InternalSettingsPanels').then((m) => m.PushTriggersPanel),
);

export const LazyUserTriggersPanel = wrapNamed(() =>
  import('./InternalSettingsPanels').then((m) => m.UserTriggersPanel),
);

export const LazyBetaSituationsPanel = wrapNamed(() =>
  import('./InternalSettingsPanels').then((m) => m.BetaSituationsPanel),
);

/** JS-Module vorwärmen — identische import()-Pfade wie die Lazy-Panels. */
const SECTION_MODULE_LOADERS: Record<string, Array<() => Promise<unknown>>> = {
  travel: [
    () => import('../ConciergePrefsEditor'),
    () => import('./StartBaseSettingsBlock'),
  ],
  general: [
    () => import('./HandsFreeActivationSettings'),
    () => import('./Module1BackgroundSpeechSettings'),
  ],
  explanations: [() => import('../legal/HelpGuideView')],
  triggers: [() => import('./InternalSettingsPanels')],
  personal: [
    () => import('../../onboarding/AgeLifeSlider'),
    () => import('../ConciergePrefsEditor'),
    () => import('../ExperiencePrefsEditor'),
  ],
  character: [
    () => import('../VoiceSelectorList'),
    () => import('../../onboarding/PersonalityMatrixStep'),
  ],
  internal: [() => import('./InternalSettingsPanels')],
  legal: [() => import('../../constants/legal')],
};

export async function prefetchSettingsSectionModules(
  id: string,
): Promise<void> {
  const loaders = SECTION_MODULE_LOADERS[id];
  if (!loaders?.length) return;
  await Promise.all(loaders.map((load) => load().catch(() => undefined)));
}
