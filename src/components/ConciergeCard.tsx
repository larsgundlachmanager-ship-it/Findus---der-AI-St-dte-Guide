import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ConciergeCardState } from '../types/concierge';
import { BulletsSlot } from './liveStage/BulletsSlot';
import { ActionsSlot } from './liveStage/ActionsSlot';
import { inspectConciergeCard } from './liveStage/inspectConciergeCard';

type Props = {
  card: ConciergeCardState | null;
  onFollowUp?: (prompt: string) => void;
};

/**
 * @deprecated Prefer LiveStage slots on HomeScreen.
 * Thin wrapper kept for any non-stage callers.
 */
export const ConciergeCard = React.memo(function ConciergeCard({
  card,
  onFollowUp,
}: Props) {
  const { hasBullets, hasActions } = inspectConciergeCard(card);
  if (!card || (!hasBullets && !hasActions)) {
    return null;
  }

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {hasBullets ? <BulletsSlot card={card} /> : null}
      {hasActions ? (
        <ActionsSlot
          card={card}
          onFollowUp={onFollowUp}
          showDismiss={!hasBullets}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    flexShrink: 1,
  },
});
