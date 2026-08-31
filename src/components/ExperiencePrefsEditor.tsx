/**
 * Erleben-Prefs — Legacy-Wrapper um AktuelleReiseEditor (SSOT).
 */

import React from 'react';
import type { UserProfile } from '../types/userProfile';
import { AktuelleReiseEditor } from './settings/AktuelleReiseEditor';

type Mode = 'full' | 'lite';

type Props = {
  draft: UserProfile;
  onChange: (p: Partial<UserProfile>) => void;
  mode?: Mode;
};

/** @deprecated Nutze AktuelleReiseEditor direkt. */
export function ExperiencePrefsEditor({
  draft,
  onChange,
  mode = 'full',
}: Props) {
  return (
    <AktuelleReiseEditor draft={draft} onChange={onChange} mode={mode} />
  );
}
