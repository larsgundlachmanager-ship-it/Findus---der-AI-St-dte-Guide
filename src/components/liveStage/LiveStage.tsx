/**
 * LiveStage:
 * - Presence oben (füllt Rest, overflow hidden — Mood-Änderungen schieben nichts)
 * - Bottom-Dock fix unten: Bullets → Actions → Subtitles
 * MicButton bleibt außerhalb, unter der Stage.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { FindusMood } from '../AudioWave';
import type { ConciergeCardState } from '../../types/concierge';
import { spacing } from '../../constants/theme';
import { PresenceCluster } from './PresenceCluster';
import { BulletsSlot } from './BulletsSlot';
import { ActionsSlot } from './ActionsSlot';
import { SubtitlesSlot } from './SubtitlesSlot';
import { SUBTITLE_SLOT_H } from './stageTransitions';
import { inspectConciergeCard } from './inspectConciergeCard';
import { PitchChoiceSlot } from '../PitchChoiceSlot';
import { useLivePitchStore } from '../../module2/pitch/publishPitchUi';

type Props = {
  mood: FindusMood;
  card: ConciergeCardState | null;
  subtitleText: string | null;
  isPlayingAudio: boolean;
  onFollowUp?: (prompt: string) => void;
  /** Doppel-Tipp auf Findus während Denken/Sprechen */
  onAbortBusy?: () => void;
};

export const LiveStage = React.memo(function LiveStage({
  mood,
  card,
  subtitleText,
  isPlayingAudio: _isPlayingAudio,
  onFollowUp,
  onAbortBusy,
}: Props) {
  const { hasBullets, hasActions } = inspectConciergeCard(card);
  const hasPitch = useLivePitchStore((s) =>
    Boolean(s.requestId && (s.options.length > 0 || s.loading)),
  );
  const compact = hasBullets || hasActions || hasPitch;
  const showSubtitles = Boolean(subtitleText?.trim());

  return (
    <View style={styles.stage}>
      <View style={styles.presencePane} pointerEvents="box-none">
        <PresenceCluster
          mood={mood}
          compact={compact}
          onAbortBusy={onAbortBusy}
        />
      </View>

      <View style={styles.bottomDock} pointerEvents="box-none">
        {hasPitch ? <PitchChoiceSlot /> : null}
        {!hasPitch && hasBullets && card ? <BulletsSlot card={card} /> : null}
        {!hasPitch && hasActions && card ? (
          <ActionsSlot
            card={card}
            onFollowUp={onFollowUp}
            showDismiss={!hasBullets}
          />
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
    flex: 1,
    minHeight: 0,
    width: '100%',
    paddingHorizontal: spacing.md,
  },
  /** Nur dieser Bereich reagiert auf Thinking/Speaking — Dock bleibt stehen. */
  presencePane: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    overflow: 'hidden',
  },
  /** Fix am unteren Stage-Rand — kein Layout-Spring mit dem Avatar. */
  bottomDock: {
    width: '100%',
    flexShrink: 0,
  },
  subtitleReserve: {
    width: '100%',
    height: SUBTITLE_SLOT_H,
    justifyContent: 'center',
  },
});
