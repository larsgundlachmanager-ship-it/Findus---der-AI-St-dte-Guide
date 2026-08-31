import type { ConciergeCardState } from '../../types/concierge';
import { shouldShowConfirmationButton } from '../../services/concierge/speechAsksConfirmation';

/** Lightweight visibility probe — no action state. */
export function inspectConciergeCard(card: ConciergeCardState | null): {
  hasBullets: boolean;
  hasActions: boolean;
  canShare: boolean;
} {
  if (!card) {
    return { hasBullets: false, hasActions: false, canShare: false };
  }
  const hasBullets = card.visualBullets.length > 0;
  const showYes = shouldShowConfirmationButton(
    card.speechText,
    card.quickActions,
  );
  const hasActions = showYes || card.quickActions.length > 0;
  return { hasBullets, hasActions, canShare: false };
}
