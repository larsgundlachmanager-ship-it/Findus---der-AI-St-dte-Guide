/**
 * Ort-Popup: Titel, Kategorie, Stichpunkte, Navigation + optionale Links
 * (Webseite / Maps / DHL — gleiche Button-Leiste für Pack- und OSM-Orte).
 *
 * Overlay-View (kein RN-Modal): Android + Karten-WebView macht aus
 * `<Modal transparent>` oft ein Mini-Fenster oder einen toten Tap.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSystemSafePad } from '../../hooks/useSystemSafePad';
import { colors, spacing } from '../../constants/theme';
import { UI_LAYER } from '../../constants/uiLayers';
import {
  HOME_DOCK_BAR_H,
  homeMicClearancePx,
} from '../liveStage';
import { useUiScaleStore } from '../../services/ui/uiScale';
import { isUsableHomeMapNavCoord } from '../../services/homeMap/homeMapNavCoord';
import {
  startHomeMapNavigation,
  type HomeMapNavTarget,
} from '../../services/homeMap/homeMapNavStart';
import { shouldOfferNavRetarget } from '../../services/navigation/navRetargetChoice';
import { getCachedUserProfile } from '../../services/userProfileService';
import { useFinnusStore } from '../../store/useFinnusStore';
import { useHomeMapUiStore } from '../../store/useHomeMapUiStore';
import { noteUiVisible } from '../../services/diagnostics/interactionDelay';
import type { MapPlacePreview } from '../../services/homeMap/mapPlacePreview';
import { isEstablishedGoogleMapsPlaceUrl } from '../../services/research/eventInfoUrl';
import {
  airNeedsTransitLookahead,
} from '../../module2/planning/planMobilityPolicy';
import { haversineMeters } from '../../db/database';
import { useGpsStore } from '../../store/useGpsStore';

export type HomeMapPopupAction = {
  label: string;
  url: string;
};

export type HomeMapPopupPlace = MapPlacePreview;

function listedPopupUrl(url: string | null | undefined): string | null {
  const u = (url || '').trim();
  if (!u) return null;
  if (!/maps\.google|google\.[^/\s]+\/maps|maps\.app\.goo\.gl/i.test(u)) {
    return u;
  }
  return isEstablishedGoogleMapsPlaceUrl(u) ? u : null;
}

function clearThinkingUi(): void {
  try {
    const st = useFinnusStore.getState();
    st.setIsGenerating(false);
    st.setActiveConciergeCard(null);
  } catch {
    /* soft */
  }
}

type Props = {
  place: HomeMapPopupPlace | null;
  onClose: () => void;
};

export const HomeMapPlacePopup = React.memo(function HomeMapPlacePopup({
  place,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  const busyRef = React.useRef(false);
  const safePad = useSystemSafePad();
  const buttonMul = useUiScaleStore((s) => s.buttonMul);
  const navActive = useFinnusStore((s) => s.navActive);
  const hasTour = useFinnusStore((s) =>
    Boolean(s.multiStopTour?.stops?.some((st) => !st.done)),
  );
  const retarget =
    Boolean(place) &&
    (navActive || hasTour) &&
    shouldOfferNavRetarget({
      name: place?.name,
      lat: place?.lat,
      lng: place?.lng,
      poiId: place && place.id > 0 ? place.id : null,
    });

  const offerTransit = (() => {
    if (!place || retarget) return false;
    const gps = useGpsStore.getState();
    const st = useFinnusStore.getState();
    const lat = gps.lat ?? st.lastGpsLat;
    const lng = gps.lng ?? st.lastGpsLng;
    if (
      lat == null ||
      lng == null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      return false;
    }
    const airM = haversineMeters(lat, lng, Number(place.lat), Number(place.lng));
    return airNeedsTransitLookahead({ airMeters: airM, preferBike: false });
  })();

  useEffect(() => {
    if (place) noteUiVisible('mapPlace');
  }, [place]);

  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => {
      busyRef.current = false;
      setBusy(false);
    }, 8000);
    return () => clearTimeout(t);
  }, [busy]);

  const speakAt = React.useRef(0);
  const speakFail = useCallback((reason: string) => {
    const now = Date.now();
    if (now - speakAt.current < 2500) return;
    speakAt.current = now;
    const text =
      reason === 'no_gps'
        ? 'Sorry, GPS hängt kurz. Geh ein paar Schritte ins Freie — dann starte ich die Route.'
        : reason === 'bad_dest'
          ? 'Für den Ort fehlen gültige Koordinaten. Versuch’s nochmal mit einem anderen Pin.'
          : 'Die Route hat nicht geklappt. Versuch’s nochmal mit dem Ort.';
    void import('../../services/ttsService')
      .then((m) => m.speakAssistantText(text))
      .catch(() => undefined);
  }, []);

  const dismissInstant = useCallback(() => {
    clearThinkingUi();
    try {
      useHomeMapUiStore.getState().setPlacePopup(null);
    } catch {
      /* soft */
    }
    onClose();
  }, [onClose]);

  const runNav = useCallback(
    (mode?: 'replace' | 'add' | 'transit') => {
      if (!place || busyRef.current) return;
      if (!isUsableHomeMapNavCoord(Number(place.lat), Number(place.lng))) {
        speakFail('bad_dest');
        return;
      }
      busyRef.current = true;
      setBusy(true);
      // Sofort weg — Mic wieder blau, kein klebendes Textfeld.
      dismissInstant();

      const target: HomeMapNavTarget = {
        name: place.name,
        lat: Number(place.lat),
        lng: Number(place.lng),
        poiId: place.id > 0 ? place.id : -1,
        spotKey: place.spotKey,
      };

      requestAnimationFrame(() => {
        void (async () => {
          try {
            if (mode === 'transit') {
              const gps = useGpsStore.getState();
              const st = useFinnusStore.getState();
              const originLat = gps.lat ?? st.lastGpsLat;
              const originLng = gps.lng ?? st.lastGpsLng;
              if (
                originLat == null ||
                originLng == null ||
                !isUsableHomeMapNavCoord(originLat, originLng)
              ) {
                speakFail('no_gps');
                return;
              }
              try {
                const { setPreferredTravelMode } = await import(
                  '../../services/navigation/travelModeContext'
                );
                setPreferredTravelMode('transit');
                const { startTransitHandsFree } = await import(
                  '../../services/navigation/handsFreeNav/transitBridge'
                );
                const tr = await startTransitHandsFree({
                  from: { lat: originLat, lng: originLng },
                  to: { lat: target.lat, lng: target.lng },
                  destName: target.name,
                });
                if (!tr.ok) speakFail('nav_failed');
              } catch {
                speakFail('nav_failed');
              }
              return;
            }

            const res = await startHomeMapNavigation(
              target,
              getCachedUserProfile(),
              {
                replaceRoute: mode === 'replace',
                addStop: mode === 'add',
              },
            );
            if (
              !res.ok &&
              !useFinnusStore.getState().navActive &&
              !useFinnusStore.getState().navRouteLoading
            ) {
              speakFail(res.reason);
            }
          } catch {
            speakFail('nav_failed');
          } finally {
            clearThinkingUi();
            setTimeout(() => {
              busyRef.current = false;
              setBusy(false);
            }, 400);
          }
        })();
      });
    },
    [dismissInstant, place, speakFail],
  );

  const openUrl = useCallback((url: string) => {
    const u = url.trim();
    if (!u) return;
    void Linking.openURL(u);
  }, []);

  if (!place) return null;

  const bullets = (place.bullets ?? []).slice(0, 2);
  const linkActions: HomeMapPopupAction[] = [];
  const seen = new Set<string>();
  const pushLink = (label: string, url: string | null | undefined) => {
    const u = (url || '').trim();
    if (!u || seen.has(u)) return;
    seen.add(u);
    linkActions.push({ label, url: u });
  };
  pushLink('Webseite', listedPopupUrl(place.websiteUrl));
  for (const a of place.extraActions ?? []) {
    pushLink(a.label, listedPopupUrl(a.url));
  }

  return (
    <View pointerEvents="auto" collapsable={false} style={styles.root}>
      <Pressable
        style={styles.backdrop}
        onPressIn={() => {
          if (busyRef.current) return;
          dismissInstant();
        }}
        accessibilityLabel="Ort-Vorschau schließen"
      />
      <View
        style={[
          styles.card,
          {
            marginBottom:
              HOME_DOCK_BAR_H +
              Math.max(safePad.bottom, 8) +
              homeMicClearancePx(buttonMul) +
              8,
          },
        ]}
        pointerEvents="auto"
        collapsable={false}
      >
        <Text style={styles.title} numberOfLines={2}>
          {place.name}
        </Text>
        <Text style={styles.cat}>{place.category}</Text>
        {bullets.map((b, i) => (
          <Text key={i} style={styles.bullet} numberOfLines={3}>
            · {b}
          </Text>
        ))}
        <View style={styles.row}>
          {retarget ? (
            <>
              <Pressable
                style={[styles.btn, styles.btnSecondary]}
                onPressIn={() => runNav('replace')}
                onPress={() => runNav('replace')}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Route neu starten"
              >
                {busy ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text style={styles.btnSecondaryText}>Route neu</Text>
                )}
              </Pressable>
              <Pressable
                style={[styles.btn, styles.btnPrimary]}
                onPressIn={() => runNav('add')}
                onPress={() => runNav('add')}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Als Stopp hinzufügen"
              >
                {busy ? (
                  <ActivityIndicator color={colors.bg} />
                ) : (
                  <Text style={styles.btnPrimaryText}>Stopp hinzu</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={[styles.btn, styles.btnPrimary]}
                onPressIn={() => runNav()}
                onPress={() => runNav()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Navigation starten"
              >
                {busy ? (
                  <ActivityIndicator color={colors.bg} />
                ) : (
                  <Text style={styles.btnPrimaryText}>Navigation</Text>
                )}
              </Pressable>
              {offerTransit ? (
                <Pressable
                  style={[styles.btn, styles.btnSecondary]}
                  onPressIn={() => runNav('transit')}
                  onPress={() => runNav('transit')}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="Mit ÖPNV fahren"
                >
                  {busy ? (
                    <ActivityIndicator color={colors.text} />
                  ) : (
                    <Text style={styles.btnSecondaryText}>ÖPNV</Text>
                  )}
                </Pressable>
              ) : null}
            </>
          )}
        </View>
        {linkActions.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.linkRow}
          >
            {linkActions.map((a) => (
              <Pressable
                key={`${a.label}_${a.url}`}
                style={[styles.btn, styles.btnSecondary, styles.linkBtn]}
                onPress={() => openUrl(a.url)}
                accessibilityRole="button"
                accessibilityLabel={a.label}
              >
                <Text style={styles.btnSecondaryText} numberOfLines={1}>
                  {a.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: UI_LAYER.askSheet,
    elevation: UI_LAYER.askSheet,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  card: {
    marginHorizontal: spacing.md,
    backgroundColor: colors.bgElevated,
    borderRadius: 16,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    zIndex: 1,
    elevation: 12,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  cat: {
    color: colors.accent,
    fontSize: 13,
    marginTop: 4,
    marginBottom: 8,
  },
  bullet: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  linkRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingRight: 4,
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkBtn: {
    flex: 0,
    paddingHorizontal: 14,
    minWidth: 88,
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  btnPrimaryText: {
    color: colors.bg,
    fontWeight: '700',
    fontSize: 15,
  },
  btnSecondary: {
    backgroundColor: 'rgba(244,239,230,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  btnSecondaryText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 15,
  },
});
