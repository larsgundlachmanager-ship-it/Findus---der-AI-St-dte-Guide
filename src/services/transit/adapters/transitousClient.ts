/**
 * Transitous MOTIS 2 HTTP-Client (https://transitous.org).
 * Kostenloses EU-ÖPNV-Routing inkl. GTFS-RT Live-Verspätungen.
 */

import { env } from '../../../config/env';

const DEFAULT_BASE = 'https://api.transitous.org/api';
const FETCH_MS = 14_000;
const USER_AGENT = 'Findus/2.0 (https://findus.app; contact@findus.app)';

export function transitousBaseUrl(): string {
  const fromEnv = (
    env.transitousBaseUrl?.() ||
    env.get('EXPO_PUBLIC_TRANSITOUS_BASE_URL') ||
    ''
  )
    .trim()
    .replace(/\/$/, '');
  return fromEnv || DEFAULT_BASE;
}

export function placeTuple(lat: number, lng: number): string {
  return `${lat},${lng}`;
}

export async function transitousFetchJson(
  pathAndQuery: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const base = transitousBaseUrl();
  const url = pathAndQuery.startsWith('http')
    ? pathAndQuery
    : `${base}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`;

  const ctrl = signal ? null : new AbortController();
  const timer = ctrl
    ? setTimeout(() => ctrl.abort(), FETCH_MS)
    : null;
  try {
    const res = await fetch(url, {
      signal: signal ?? ctrl!.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) {
      if (__DEV__) {
        console.warn(`[transitous] ${res.status} ${url.slice(0, 120)}`);
      }
      return null;
    }
    return await res.json();
  } catch (err) {
    if (__DEV__) {
      console.warn('[transitous] fetch failed', err);
    }
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function parseIsoDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function delaySecFromTimes(
  live: Date | null,
  scheduled: Date | null,
): number | null {
  if (!live || !scheduled) return null;
  return Math.round((live.getTime() - scheduled.getTime()) / 1000);
}
