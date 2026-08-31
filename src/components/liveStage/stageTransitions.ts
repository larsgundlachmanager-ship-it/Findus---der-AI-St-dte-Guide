import {
  FadeInDown,
  FadeInUp,
  FadeOutDown,
  FadeOutUp,
  LinearTransition,
} from 'react-native-reanimated';

/** Shared spring for conflict-free LiveStage reflow. */
export const STAGE_LAYOUT = LinearTransition.springify()
  .damping(22)
  .stiffness(180);

export const BULLETS_ENTERING = FadeInDown.springify().damping(20).stiffness(160);
export const BULLETS_EXITING = FadeOutUp.duration(160);

export const ACTIONS_ENTERING = FadeInUp.springify().damping(20).stiffness(160);
export const ACTIONS_EXITING = FadeOutDown.duration(160);

/**
 * Reserved height for the subtitle slot — 1 Zeile + Schatten/Unterlängen.
 */
export const SUBTITLE_SLOT_H = 40;
