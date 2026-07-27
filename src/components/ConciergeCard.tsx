import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing } from '../constants/theme';
import {
  isPartnerAffiliateAction,
} from '../constants/legal';
import type { ConciergeCardState, QuickAction } from '../types/concierge';
import {
  alertActionError,
  dismissConciergeCard,
  handleQuickAction,
} from '../services/actionHandlerService';
import { speechAsksForConfirmation } from '../services/concierge/speechAsksConfirmation';
import { shouldShowConfirmationButton } from '../services/concierge/speechAsksConfirmation';
import { partnerActionShowsAnzeige } from '../services/affiliate/affiliateDisclosure';
import { isCityMapUrl } from '../services/cityMapService';

type Props = {
  card: ConciergeCardState | null;
  onFollowUp?: (prompt: string) => void;
};

function pickYesTarget(actions: QuickAction[], speech: string): QuickAction | null {
  if (/\b(karte|ortsplan|inselplan|inselkarte)\b/iu.test(speech)) {
    const map = actions.find(
      (a) => a.type === 'OPEN_URL' && isCityMapUrl(a.payload.url),
    );
    if (map) return map;
  }
  const nav = actions.find((a) => a.type === 'START_NAVIGATION');
  if (nav) return nav;
  const partner = actions.find((a) => isPartnerAffiliateAction(a));
  if (partner) return partner;
  const reserve = actions.find(
    (a) =>
      a.type === 'CONFIRM_API_RESERVATION' ||
      a.type === 'SEND_RESERVATION_EMAIL' ||
      a.type === 'TRIGGER_AI_CALL',
  );
  return reserve ?? null;
}

/** Kurzer Bestätigungs-Text statt nur „Ja“. */
function yesButtonLabel(
  target: QuickAction | null,
  speech: string,
): string {
  if (target?.type === 'START_NAVIGATION') {
    const name = target.label
      .replace(/^📍\s*/u, '')
      .replace(/^Route:\s*/i, '')
      .trim();
    if (name && name.length <= 22) {
      return `Ja, zu ${name}`;
    }
    return 'Ja, Navigation starten';
  }
  if (target?.type === 'OPEN_URL' && isCityMapUrl(target.payload.url)) {
    return 'Ja, Karte öffnen';
  }
  switch (target?.type) {
    case 'BOOK_STAY22':
      return 'Ja, Unterkünfte zeigen';
    case 'BOOK_BOUNCE_LUGGAGE':
      return 'Ja, Gepäck-Spot öffnen';
    case 'BOOK_CAR_RENTAL':
      return 'Ja, Mietwagen öffnen';
    case 'BOOK_UBER':
      return 'Ja, Uber öffnen';
    case 'OPEN_GYG_WIDGET':
    case 'OPEN_URL':
      return 'Ja, Angebote öffnen';
    case 'CONFIRM_API_RESERVATION':
    case 'SEND_RESERVATION_EMAIL':
    case 'TRIGGER_AI_CALL':
      return 'Ja, Reservierung starten';
    default:
      break;
  }
  if (/\b(kompass|navigation|route|führ|fuehr)\b/iu.test(speech)) {
    return 'Ja, Navigation starten';
  }
  if (/\b(unterkunft|hotel|ferien)\b/iu.test(speech)) {
    return 'Ja, Unterkünfte zeigen';
  }
  if (/\b(tour|ticket|ausflug)\b/iu.test(speech)) {
    return 'Ja, Angebote öffnen';
  }
  return 'Ja, bitte';
}

export function ConciergeCard({ card, onFollowUp }: Props) {
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  const onAction = useCallback(
    async (action: QuickAction) => {
      if (busyLabel) return;
      setBusyLabel(action.label);
      try {
        const result = await handleQuickAction(action);
        if (result.message) {
          if (!result.ok) {
            alertActionError(result.message);
          } else if (
            action.type === 'CONFIRM_API_RESERVATION' ||
            action.type === 'SEND_RESERVATION_EMAIL' ||
            action.type === 'TRIGGER_AI_CALL'
          ) {
            alertActionError(result.message);
          }
        }
        if (result.followUpPrompt) {
          dismissConciergeCard();
          onFollowUp?.(result.followUpPrompt);
        }
        if (result.ok && action.type === 'START_NAVIGATION') {
          dismissConciergeCard();
        }
        if (result.ok && isPartnerAffiliateAction(action)) {
          dismissConciergeCard();
        }
      } finally {
        setBusyLabel(null);
      }
    },
    [busyLabel, onFollowUp],
  );

  const showYes = useMemo(() => {
    if (!card) return false;
    return shouldShowConfirmationButton(card.speechText, card.quickActions);
  }, [card]);

  const yesTarget =
    showYes && card ? pickYesTarget(card.quickActions, card.speechText) : null;
  const yesLabel =
    showYes && card
      ? yesButtonLabel(yesTarget, card.speechText)
      : 'Ja, bitte';

  const onYes = useCallback(async () => {
    if (!card || busyLabel) return;
    const target = pickYesTarget(card.quickActions, card.speechText);
    if (target) {
      await onAction(target);
      return;
    }
    setBusyLabel(yesLabel);
    try {
      dismissConciergeCard();
      onFollowUp?.('Ja');
    } finally {
      setBusyLabel(null);
    }
  }, [busyLabel, card, onAction, onFollowUp, yesLabel]);

  if (!card) return null;
  if (
    card.visualBullets.length === 0 &&
    card.quickActions.length === 0 &&
    !showYes
  ) {
    return null;
  }

  // Weitere Actions ohne den „Ja“-Ziel-Button doppelte Darstellung vermeiden
  const otherActions = yesTarget
    ? card.quickActions.filter(
        (a) =>
          !(
            a.type === yesTarget.type &&
            a.label === yesTarget.label &&
            String(a.payload.targetPoiId ?? '') ===
              String(yesTarget.payload.targetPoiId ?? '') &&
            (a.payload.url ?? '') === (yesTarget.payload.url ?? '')
          ),
      )
    : card.quickActions;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.title} numberOfLines={1}>
            {card.cardTitle?.trim() || 'Spickzettel'}
          </Text>
          <Pressable
            onPress={dismissConciergeCard}
            hitSlop={10}
            accessibilityLabel="Karte schließen"
          >
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        {card.visualBullets.length > 0 ? (
          <ScrollView
            style={styles.bulletsScroll}
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.bullets}>
              {card.visualBullets.slice(0, 3).map((b, i) => (
                <Text key={`${i}-${b.slice(0, 12)}`} style={styles.bullet}>
                  • {b}
                </Text>
              ))}
            </View>
          </ScrollView>
        ) : null}

        {showYes ? (
          <Pressable
            onPress={() => void onYes()}
            disabled={!!busyLabel}
            style={({ pressed }) => [
              styles.yesBtn,
              pressed && styles.actionBtnPressed,
              (busyLabel === yesLabel ||
                (yesTarget && busyLabel === yesTarget.label)) &&
                styles.actionBtnBusy,
            ]}
            accessibilityRole="button"
            accessibilityLabel={yesLabel}
          >
            {busyLabel === yesLabel ||
            (yesTarget && busyLabel === yesTarget.label) ? (
              <ActivityIndicator color={colors.bg} size="small" />
            ) : (
              <Text style={styles.yesLabel} numberOfLines={2}>
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
              const busy = busyLabel === action.label;
              const isAd = partnerActionShowsAnzeige(action);
              return (
                <Pressable
                  key={`${action.type}-${i}-${action.label}`}
                  onPress={() => void onAction(action)}
                  disabled={!!busyLabel}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    pressed && styles.actionBtnPressed,
                    busy && styles.actionBtnBusy,
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.bg} size="small" />
                  ) : (
                    <View style={styles.actionInner}>
                      <Text style={styles.actionLabel} numberOfLines={2}>
                        {action.label}
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    zIndex: 8,
    flexShrink: 1,
  },
  card: {
    backgroundColor: 'rgba(12, 28, 22, 0.94)',
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(196, 163, 90, 0.35)',
    maxHeight: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  title: {
    flex: 1,
    color: colors.accent,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginRight: spacing.sm,
  },
  close: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  bulletsScroll: {
    maxHeight: 96,
    marginBottom: spacing.sm,
  },
  bullets: {
    gap: 6,
  },
  bullet: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  yesBtn: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    minHeight: 48,
  },
  yesLabel: {
    color: colors.bg,
    fontSize: 16,
    fontWeight: '800',
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
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: 220,
    minHeight: 40,
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(196, 163, 90, 0.45)',
  },
  actionBtnPressed: {
    opacity: 0.85,
  },
  actionBtnBusy: {
    minWidth: 88,
  },
  actionLabel: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  actionInner: {
    alignItems: 'center',
    gap: 2,
  },
  anzeigeMark: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});
