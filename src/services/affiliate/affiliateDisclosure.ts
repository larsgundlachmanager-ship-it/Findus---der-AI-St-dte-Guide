/**
 * Affiliate-Transparenz ohne störenden Karten-Footer:
 * - Button-Kennzeichnung „Anzeige“
 * - einmalige Soft-Bestätigung (persistent) — kein blockierendes Popup bei jedem Tap
 * - voller Text bleibt in Einstellungen → Impressum & Datenschutz
 */

import * as FileSystem from 'expo-file-system';
import type { QuickAction } from '../../types/concierge';
import { isPartnerAffiliateAction } from '../../constants/legal';
import { useFinnusStore } from '../../store/useFinnusStore';

const ACK_PATH = `${FileSystem.documentDirectory}findus-affiliate-ack.json`;

/** Kennzeichnet Partner-Buttons dezent (UWG-übliche Kennzeichnung). */
export function withAnzeigeLabel(label: string): string {
  const t = label.trim();
  if (!t) return 'Anzeige';
  if (/\banzeige\b/i.test(t)) return t;
  return t;
}

export function partnerActionShowsAnzeige(action: QuickAction): boolean {
  return isPartnerAffiliateAction(action);
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

/** Beim Boot: gespeicherte Zustimmung laden. */
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
 * Vor Partner-Link: wenn schon bestätigt (Sitzung oder persistent) → sofort weiter.
 * Sonst soft-ack ohne blockierenden Alert („Anzeige“-Label am Button reicht).
 */
export function confirmAffiliateRedirectIfNeeded(): Promise<boolean> {
  const store = useFinnusStore.getState();
  if (store.affiliateRedirectAcked) return Promise.resolve(true);

  store.setAffiliateRedirectAcked(true);
  void persistAck();
  return Promise.resolve(true);
}
