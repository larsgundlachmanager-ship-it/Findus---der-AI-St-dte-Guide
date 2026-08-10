/**
 * Kernrollen-Portraits (echte Bilder statt Emoji).
 */

import type { ImageSourcePropType } from 'react-native';
import type { CoreRoleId } from './personalityMatrix';

export const CORE_ROLE_PORTRAITS: Record<CoreRoleId, ImageSourcePropType> = {
  classic_guide: require('../../assets/onboarding/persona-classic-guide.jpg'),
  heartfelt_oldie: require('../../assets/onboarding/persona-heartfelt-oldie.jpg'),
  buddy: require('../../assets/onboarding/persona-buddy.jpg'),
  aristocrat: require('../../assets/onboarding/persona-aristocrat.jpg'),
  nerd: require('../../assets/onboarding/persona-nerd.jpg'),
  innocent_child: require('../../assets/onboarding/persona-innocent-child.jpg'),
};

export const CITY_CARD_HERO = require('../../assets/onboarding/city-card-hero.jpg');
