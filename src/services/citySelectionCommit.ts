/**
 * Manuelle Stadtübernahme aus den Einstellungen (nach Speichern).
 * Tippen wählt nur den Draft — hier erst Slim-Welcome, Speech, dann Pack.
 */

import type { CityCatalogItem } from './cityCatalogService';
import {
  beginCityCommitProgress,
  endCityCommitProgress,
  setCityCommitProgress,
} from './cityCommitProgress';

export async function commitManualCitySelection(opts: {
  cityId: string;
  cityName: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<void> {
  const cityId = String(opts.cityId || '').trim();
  const cityName = String(opts.cityName || '').trim() || cityId;
  if (!cityId) return;

  // Sofort HUD — auch wenn Aufrufer begin schon gesetzt hat.
  beginCityCommitProgress({ cityId, cityName });

  try {
    const { useUserMemoryStore } = require('../store/useUserMemoryStore') as {
      useUserMemoryStore: {
        getState: () => { clearHotelsOutsideCity: (id: string) => void };
      };
    };
    useUserMemoryStore.getState().clearHotelsOutsideCity(cityId);
  } catch {
    /* soft */
  }

  try {
    const { noteManualCityFocus } = require('./cityProximityService') as {
      noteManualCityFocus: (id: string) => void;
    };
    noteManualCityFocus(cityId);
  } catch {
    /* soft */
  }

  try {
    const soft = await import('./softWorkingCity');
    soft.setSoftWorkingCity({
      id: cityId,
      name: cityName,
      lat: opts.lat ?? null,
      lng: opts.lng ?? null,
      soft: soft.isSoftCityId(cityId),
      source: soft.isSoftCityId(cityId) ? 'gps_soft' : 'manual',
    });
  } catch {
    /* soft */
  }

  try {
    const { maybeOfferTravelPrefsAfterCity } = await import(
      './memory/travelPrefsReview'
    );
    await maybeOfferTravelPrefsAfterCity(cityId);
  } catch {
    /* soft */
  }

  setCityCommitProgress(0.35);

  // Nur Slim-Welcome (~1–3 KB). Kein Mega-Pack-Parse auf dem Hot-Path.
  try {
    const { ensureCityWelcomeFacts } = await import('./cityWelcomeFacts');
    await ensureCityWelcomeFacts(cityId, { allowFullPack: false });
  } catch {
    /* soft */
  }

  setCityCommitProgress(0.92);

  const city: Pick<CityCatalogItem, 'id' | 'name'> &
    Partial<Pick<CityCatalogItem, 'lat' | 'lng'>> = {
    id: cityId,
    name: cityName,
    lat: typeof opts.lat === 'number' ? opts.lat : undefined,
    lng: typeof opts.lng === 'number' ? opts.lng : undefined,
  };

  // Speech startet — Balken fertig. Pack erst danach / parallel im Hintergrund.
  endCityCommitProgress();

  try {
    const { speakCityWelcomeForCity } = await import('./cityWelcomeService');
    void speakCityWelcomeForCity(city, {
      preferSwitch: true,
      manualPick: true,
    }).catch(() => undefined);
  } catch {
    /* soft */
  }

  // Pack nach Welcome-Start — nicht den Speech-/UI-Thread blockieren.
  setTimeout(() => {
    void import('./cityCatalogService')
      .then(({ installCityPack }) =>
        installCityPack(cityId, {
          checkRemote: true,
          reason: 'switch',
        }),
      )
      .catch((err) => {
        console.warn('[citySelectionCommit] pack install failed:', err);
      });
  }, 500);
}
