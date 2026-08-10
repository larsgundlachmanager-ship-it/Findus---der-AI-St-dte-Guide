import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { colors, spacing } from '../../constants/theme';
import { UI_LAYER } from '../../constants/uiLayers';
import type { ConciergeCardState } from '../../types/concierge';
import { dismissConciergeCard } from '../../services/actionHandlerService';
import { partnerActionShowsAnzeige } from '../../services/affiliate/affiliateDisclosure';
import { useConciergeActions } from './useConciergeActions';
import {
  ACTIONS_ENTERING,
  ACTIONS_EXITING,
} from './stageTransitions';
import { useUiScaleStore } from '../../services/ui/uiScale';
import {
  MAPS_ACTION_EMOJI,
  stripMapsActionPrefix,
} from '../../services/concierge/actionLabelShorten';

function isGoogleMapsActionUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /google\.[^/]*\/maps|maps\.google|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(
    url,
  );
}

type Props = {
  card: ConciergeCardState;
  onFollowUp?: (prompt: string) => void;
  /** When bullets are absent, show a dismiss control here. */
  showDismiss?: boolean;
};

/**
 * Quick Actions im Bottom-Dock. Mount/Unmount fadet — kein Layout-Spring.
 */
export const ActionsSlot = React.memo(function ActionsSlot({
  card,
  onFollowUp,
  showDismiss = false,
}: Props) {
  const {
    busyKey,
    showYes,
    yesTarget,
    yesLabel,
    onYes,
    onAction,
    otherActions,
  } = useConciergeActions(card, onFollowUp);

  const yesBusy = busyKey === `yes:${yesLabel}` || (yesTarget != null && busyKey?.startsWith(`${yesTarget.type}:`));
  const textMul = useUiScaleStore((s) => s.textMul);
  const buttonMul = useUiScaleStore((s) => s.buttonMul);
  const labelFs = Math.round(14 * textMul);
  const btnPadV = Math.round(7 * buttonMul);
  const btnPadH = Math.round(12 * buttonMul);
  const btnMinH = Math.round(34 * buttonMul);

  return (
    <Animated.View
      entering={ACTIONS_ENTERING}
      exiting={ACTIONS_EXITING}
      style={styles.wrap}
      pointerEvents="box-none"
    >
      {showDismiss ? (
        <View style={styles.dismissRow}>
          <Pressable
            onPress={dismissConciergeCard}
            hitSlop={10}
            accessibilityLabel="Aktionen schließen"
          >
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {showYes ? (
        <Pressable
          onPress={() => void onYes()}
          disabled={!!busyKey}
          style={({ pressed }) => [
            styles.yesBtn,
            {
              paddingVertical: Math.round(10 * buttonMul),
              minHeight: Math.round(40 * buttonMul),
            },
            pressed && styles.actionBtnPressed,
            yesBusy && styles.actionBtnBusy,
          ]}
          accessibilityRole="button"
          accessibilityLabel={yesLabel}
        >
          {yesBusy ? (
            <ActivityIndicator color={colors.bg} size="small" />
          ) : (
            <Text
              style={[styles.yesLabel, { fontSize: labelFs }]}
              numberOfLines={1}
            >
              {yesLabel}
            </Text>
          )}
        </Pressable>
      ) : null}

      {otherActions.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.actionsRow}
        >
          {otherActions.map((action, i) => {
            const key = `${action.type}:${i}:${action.payload?.destName ?? action.payload?.url ?? action.label}`;
            const busy = busyKey === key;
            const pending = action.payload?.pending === true;
            const isAd =
              partnerActionShowsAnzeige(action) ||
              action.payload?.affiliateMarked === true;
            return (
              <Pressable
                key={key}
                onPress={() => void onAction(action, i)}
                disabled={!!busyKey || pending}
                style={({ pressed }) => [
                  styles.actionBtn,
                  {
                    paddingHorizontal: btnPadH,
                    paddingVertical: btnPadV,
                    minHeight: btnMinH,
                  },
                  pressed && styles.actionBtnPressed,
                  (busy || pending) && styles.actionBtnBusy,
                ]}
                accessibilityState={{ disabled: pending, busy: pending }}
                accessibilityLabel={
                  pending
                    ? `${action.label} wird geladen`
                    : action.label
                }
              >
                {busy || pending ? (
                  <View style={styles.actionInner}>
                    <ActivityIndicator color={colors.bg} size="small" />
                    {pending ? (
                      <Text
                        style={[
                          styles.actionLabel,
                          { fontSize: labelFs, marginLeft: 6, opacity: 0.85 },
                        ]}
                        numberOfLines={1}
                      >
                        {action.label}
                      </Text>
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.actionInner}>
                    {action.type === 'OPEN_URL' &&
                    isGoogleMapsActionUrl(action.payload?.url) ? (
                      <Text
                        style={{
                          fontSize: Math.max(14, Math.round(14 * buttonMul)),
                          marginRight: 2,
                        }}
                        accessibilityLabel="Karte"
                      >
                        {MAPS_ACTION_EMOJI}
                      </Text>
                    ) : null}
                    <Text
                      style={[styles.actionLabel, { fontSize: labelFs }]}
                      numberOfLines={1}
                    >
                      {action.type === 'OPEN_URL' &&
                      isGoogleMapsActionUrl(action.payload?.url)
                        ? stripMapsActionPrefix(action.label)
                        : action.label}
                    </Text>
                    {isAd ? (
                      <Text style={styles.anzeigeMark}>Anzeige</Text>
                    ) : null}
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    flexShrink: 1,
    zIndex: UI_LAYER.actions,
    elevation: UI_LAYER.actions,
    marginBottom: spacing.sm,
  },
  dismissRow: {
    alignItems: 'flex-end',
    marginBottom: spacing.xs,
  },
  close: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  yesBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    minHeight: 40,
  },
  yesLabel: {
    color: colors.bg,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 2,
    paddingRight: 8,
  },
  actionBtn: {
    backgroundColor: 'rgba(196, 163, 90, 0.22)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexShrink: 0,
    minHeight: 34,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(196, 163, 90, 0.45)',
  },
  actionBtnPressed: {
    opacity: 0.85,
  },
  actionBtnBusy: {
    minWidth: 72,
  },
  actionLabel: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  actionInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  anzeigeMark: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});
