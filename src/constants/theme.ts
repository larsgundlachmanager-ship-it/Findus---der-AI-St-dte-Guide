export const colors = {
  bg: '#0F2C24',
  bgElevated: '#16362C',
  surface: '#1C4337',
  accent: '#C4A35A',
  accentSoft: 'rgba(196, 163, 90, 0.2)',
  text: '#F4EFE6',
  textMuted: '#A8B5AE',
  danger: '#D96B5C',
  wave: '#7EC8A3',
  /** Yorro online & bereit */
  online: '#3DCF7A',
  /** Yorro offline / Diagnose nötig */
  offline: '#E8913A',
  /** Yorro „Denken“ (nach User spricht) */
  thinking: '#3D7CFF',
  /** Yorro wirklich offline (kein Internetzugang) */
  offlineGray: '#6F7A7A',
  border: 'rgba(244, 239, 230, 0.12)',
};

/** Idle-Licht (Mikro + Presence): grün nur wenn wirklich ok, sonst orange. */
export function presenceIdleColor(
  presence: 'ok' | 'degraded' | 'offline',
): string {
  return presence === 'ok' ? colors.online : colors.offline;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};
