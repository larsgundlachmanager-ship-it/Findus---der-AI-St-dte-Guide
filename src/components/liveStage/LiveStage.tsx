/**
 * LiveStage: Chrome über der Presence-Karte (transparent).
 * - Mic ist Yorro (außerhalb, HomeScreen)
 * - Bottom-Dock: Pitch → Bullets + Actions → Subtitles
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { FindusMood } from '../AudioWave';
import type { ConciergeCardState } from '../../types/concierge';
import { spacing } from '../../constants/theme';
import { UI_LAYER } from '../../constants/uiLayers';
import { BulletsSlot } from './BulletsSlot';
import { ActionsSlot } from './ActionsSlot';
import { SubtitlesSlot } from './SubtitlesSlot';
import { SUBTITLE_SLOT_H } from './stageTransitions';
import { inspectConciergeCard } from './inspectConciergeCard';
import { PitchChoiceSlot } from '../PitchChoiceSlot';
import { useLivePitchStore } from '../../module2/pitch/publishPitchUi';
import { useSystemSafePad } from '../../hooks/useSystemSafePad';
import { useUiScaleStore } from '../../services/ui/uiScale';

/** Höhe der Home-Buttons, ohne Home-Indicator. */
export const HOME_DOCK_BAR_H = 56;
/** Spalt zwischen Mic-Unterkante und Dock-Oberkante. */
export const HOME_MIC_DOCK_GAP = 4;
/** Mic-Kreis (Yorro) Basis — mit buttonMul skalieren. */
export const HOME_MIC_BTN = 84;
/**
 * Extra um den Kreis (`MicButton`: btnSize + HOME_MIC_HIT_PAD).
 * Die sichtbare Kugel sitzt mittig — oben bleiben HIT_PAD/2 bis zur Hit-Kante.
 */
export const HOME_MIC_HIT_PAD = 48;
export const HOME_MIC_HINT_RESERVE = 8;
/** Luft zwischen Untertitel-Unterkante und Mic-Oberkante. */
export const HOME_SUBTITLE_ABOVE_MIC = 22;

export const HOME_MIC_CLEARANCE =
  HOME_MIC_BTN +
  Math.round(HOME_MIC_HIT_PAD / 2) +
  HOME_MIC_HINT_RESERVE +
  HOME_MIC_DOCK_GAP +
  HOME_SUBTITLE_ABOVE_MIC;

export function homeMicClearancePx(buttonMul = 1): number {
  const mul = Math.max(1, buttonMul);
  const btn = Math.round(HOME_MIC_BTN * mul);
  const visibleTop = btn + Math.round(HOME_MIC_HIT_PAD / 2);
  return (
    visibleTop +
    HOME_MIC_HINT_RESERVE +
    HOME_MIC_DOCK_GAP +
    HOME_SUBTITLE_ABOVE_MIC
  );
}

type Props = {
  mood: FindusMood;
  card: ConciergeCardState | null;
  subtitleText: string | null;
  isPlayingAudio: boolean;
  onFollowUp?: (prompt: string) => void;
  onAbortBusy?: () => void;
};

export const LiveStage = React.memo(function LiveStage({
  mood: _mood,
  card,
  subtitleText,
  isPlayingAudio: _isPlayingAudio,
  onFollowUp,
}: Props) {
  const { hasBullets, hasActions } = inspectConciergeCard(card);
  // softFail mit 0 Optionen darf nicht unsichtbar bleiben (Dining Must-Miss).
  const hasPitch = useLivePitchStore((s) =>
    Boolean(
      s.requestId && (s.options.length > 0 || s.loading || s.softFail),
    ),
  );
  const safePad = useSystemSafePad();
  const buttonMul = useUiScaleStore((s) => s.buttonMul);
  const showSubtitles = Boolean(subtitleText?.trim());
  const micClearance = useMemo(
    () => homeMicClearancePx(buttonMul),
    [buttonMul],
  );
  const chromeBottom =
    HOME_DOCK_BAR_H + safePad.bottom + micClearance;

  return (
    <View style={styles.stage} pointerEvents="box-none">
      <View
        style={[styles.bottomDock, { bottom: chromeBottom }]}
        pointerEvents="box-none"
      >
        {hasPitch ? <PitchChoiceSlot /> : null}
        {hasBullets && !hasPitch && card ? <BulletsSlot card={card} /> : null}
        {(hasActions) && card && !hasPitch ? (
          <ActionsSlot card={card} onFollowUp={onFollowUp} showDismiss />
        ) : null}
        <View style={styles.subtitleReserve} pointerEvents="none">
          {showSubtitles ? <SubtitlesSlot text={subtitleText} /> : null}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  stage: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  bottomDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    width: '100%',
    paddingHorizontal: spacing.md,
    zIndex: UI_LAYER.bullets,
  },
  subtitleReserve: {
    width: '100%',
    height: SUBTITLE_SLOT_H,
    justifyContent: 'center',
  },
});
