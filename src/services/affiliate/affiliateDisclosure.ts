/**
 * Affiliate-Transparenz ohne störenden Karten-Footer:
 * - Button-Kennzeichnung mit Sternchen (★), kein „Anzeige“-Wort
 * - einmalige Soft-Bestätigung (persistent)
 * - voller Text in Einstellungen
 */

import * as FileSystem from 'expo-file-system';
import type { QuickAction } from '../../types/concierge';
import { isPartnerAffiliateAction } from '../../constants/legal';
import { useFinnusStore } from '../../store/useFinnusStore';

const ACK_PATH = `${FileSystem.documentDirectory}findus-affiliate-ack.json`;

/** Partner-Buttons dezent mit ★ (Settings erklären das Sternchen). */
export function withAnzeigeLabel(label: string): string {
  const t = label.trim();
  if (!t) return '★';
  if (/★/.test(t) || /\banzeige\b/i.test(t)) {
    return t.replace(/\banzeige\b/gi, '★').trim();
  }
  return `${t} ★`.slice(0, 20);
}

export function partnerActionShowsAnzeige(action: QuickAction): boolean {
  return (
    isPartnerAffiliateAction(action) ||
    action.payload?.affiliateMarked === true
  );
}

async function persistAck(): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      ACK_PATH,
      JSON.stringify({ acked: true, at: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

export async function hydrateAffiliateRedirectAck(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(ACK_PATH);
    if (!info.exists) return;
    const raw = await FileSystem.readAsStringAsync(ACK_PATH);
    const parsed = JSON.parse(raw) as { acked?: boolean };
    if (parsed?.acked) {
      useFinnusStore.getState().setAffiliateRedirectAcked(true);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Vor Partner-Link: soft-ack; Sternchen am Button reicht als Kennzeichnung.
 */
export function confirmAffiliateRedirectIfNeeded(): Promise<boolean> {
  const store = useFinnusStore.getState();
  if (store.affiliateRedirectAcked) return Promise.resolve(true);

  store.setAffiliateRedirectAcked(true);
  void persistAck();
  return Promise.resolve(true);
}
