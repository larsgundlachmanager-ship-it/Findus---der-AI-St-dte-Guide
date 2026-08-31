/**
 * ActionBoard — öffentlicher Entry.
 */

export type {
  ActionBoardInput,
  ActionBoardResult,
  ActionEntity,
  ActionOpportunity,
  DeepJob,
} from './types';
export {
  MENU_DEEP_TIMEOUT_MS,
  COMPLEX_DEEP_TIMEOUT_MS,
  OPPORTUNITY_SCORE_MIN,
} from './types';
export { extractActionEntities, entityMatchesAction } from './entityBind';
export {
  scanOpportunities,
  isTrivialExpandQuery,
  shouldOfferExpandMore,
  isExpandShowMoreAction,
} from './opportunityScan';
export {
  listActivePartners,
  rankHotelPartner,
  ACTION_BOARD_PARTNERS,
  buildHotelBookAction,
} from './partnerRouter';
export { findDeepestMenuLink } from './menuDeepLink';
export {
  runActionBoard,
  applyActionBoardToResponse,
  rebuildActionsWithBoard,
  abortActionBoardDeep,
  startActionBoardDeep,
} from './runActionBoard';
export { queueDeepRecharge } from './deepRecharge';
export { medalIntentLabel, singleEntityLabel, labelForOpportunity } from './labels';
