/**
 * Akt 3 — Recherche-Screensaver.
 * Funde laufen im Rennen mit (weich einfaden) — kein Aufploppen/Spring.
 * Flug Start→Ziel, Orte-Gründe fade, Stage-Pills, Compare-Orbit.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors } from '../../constants/theme';
import type { ResearchSpark, ResearchStep } from '../../reisebuero/types';
import { STAGE_META, theaterChecklistFocus } from '../../reisebuero/research/stageMeta';
import { RESEARCH_STATUS_RAIL } from '../../reisebuero/research/progressPace';
import {
  buildTheaterScene,
  type TheaterCompareNode,
  type TheaterFlight,
  type TheaterMotif,
  type TheaterPill,
  type TheaterPin,
} from '../../reisebuero/research/theaterScene';
import {
  computeMapCrop,
  mapExtentForKind,
} from '../../reisebuero/research/sparkGeo';

const RACE_MS = 480;
const MAX_PINS = 6;
const MAX_PILLS = 4;
const DRIFT_MS = 16000;

const MAP_EU = require('../../assets/reisebuero/europeSilhouette.jpg');
const MAP_WORLD = require('../../assets/reisebuero/worldSilhouette.jpg');

type Props = {
  steps: ResearchStep[];
  sparks: ResearchSpark[];
  verifyProgress: number | null;
  /** Restminuten (gelernt) — null = ausblenden. */
  etaMin?: number | null;
  error?: string | null;
};

function uniqueSparks(sparks: ResearchSpark[]): ResearchSpark[] {
  const seen = new Set<string>();
  const out: ResearchSpark[] = [];
  for (const s of sparks) {
    const k = `${s.kind}:${s.label.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function weatherHintFromSparks(sparks: ResearchSpark[]): string | null {
  for (const s of sparks) {
    if (s.kind !== 'vibe') continue;
    const blob = `${s.label} ${s.sub || ''}`;
    if (/\d{1,2}\s*°/.test(blob)) return blob;
    if (/wetter|warm|kühl|kalt|sonne|klima/i.test(blob)) return blob;
  }
  return null;
}

function pillCaption(p: TheaterPill): string {
  if (p.tone === 'flight') return p.label;
  if (p.tone === 'stay') return `${p.emoji || '🏊'} ${p.label}`;
  return `${p.emoji || '✨'} ${p.label}`;
}

export function ResearchTheater({ steps, sparks, verifyProgress, etaMin, error }: Props) {
  const { width, height } = useWindowDimensions();
  const byStage = useMemo(() => {
    const m = new Map<string, ResearchStep>();
    for (const s of steps) m.set(s.stage, s);
    return m;
  }, [steps]);
  const rail = useMemo(
    () =>
      RESEARCH_STATUS_RAIL.map((r) => {
        const step = byStage.get(r.stage);
        return {
          stage: r.stage,
          title: r.title,
          status: (step?.status ?? 'pending') as ResearchStep['status'],
          emoji: step?.emoji || STAGE_META[r.stage]?.emoji || '🔎',
        };
      }),
    [byStage],
  );
  const active =
    steps.find((s) => s.status === 'active') || steps.find((s) => s.status === 'pivot');
  /** Checkliste-Fokus: Rail-Titel + Statussatz — kein gelbes Kategorie-Hero. */
  const focus = theaterChecklistFocus(steps);
  const pct = Math.max(4, Math.min(100, Math.round((verifyProgress ?? 0.08) * 100)));
  const stage = active?.stage || null;
  const etaLabel =
    etaMin == null
      ? null
      : etaMin <= 0
        ? 'gleich fertig'
        : etaMin === 1
          ? 'noch ~1 Min'
          : `noch ~${etaMin} Min`;

  const doneCount = rail.filter((s) => s.status === 'done').length;
  const allDone =
    rail.length > 0 &&
    doneCount >= Math.max(1, rail.length - 1) &&
    !active &&
    pct >= 90;
  // Fertig-Overlay nur wenn Checkliste wirklich durch — nie nur wegen hohem %
  const showComplete = allDone || (pct >= 99 && doneCount >= rail.length - 1);

  const incoming = useMemo(() => uniqueSparks(sparks), [sparks]);
  const shownIds = useRef(new Set<string>());
  const queue = useRef<ResearchSpark[]>([]);
  const [visible, setVisible] = useState<ResearchSpark[]>([]);

  useEffect(() => {
    shownIds.current = new Set();
    queue.current = [];
    setVisible([]);
  }, []);

  useEffect(() => {
    const byId = new Map(incoming.map((s) => [s.id, s]));
    // Live-Geo / Sub nachziehen — Pin erscheint im Rennen, nicht als Spät-Plopp
    queue.current = queue.current.map((s) => byId.get(s.id) || s);
    setVisible((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        const u = byId.get(s.id);
        if (!u) return s;
        if (u.lat !== s.lat || u.lng !== s.lng || u.sub !== s.sub || u.label !== s.label) {
          changed = true;
          return { ...s, lat: u.lat, lng: u.lng, sub: u.sub, label: u.label, emoji: u.emoji };
        }
        return s;
      });
      return changed ? next : prev;
    });
    for (const s of incoming) {
      if (shownIds.current.has(s.id)) continue;
      shownIds.current.add(s.id);
      queue.current.push(s);
    }
  }, [incoming]);

  useEffect(() => {
    const tick = setInterval(() => {
      const next = queue.current.shift();
      if (!next) return;
      setVisible((prev) => [next, ...prev].slice(0, MAX_PINS + MAX_PILLS + 8));
    }, RACE_MS);
    return () => clearInterval(tick);
  }, []);

  const scene = useMemo(
    () =>
      buildTheaterScene(visible, {
        maxPins: MAX_PINS,
        maxPills: MAX_PILLS,
        maxFlights: 3,
        stage,
        weatherHint: weatherHintFromSparks(visible) || weatherHintFromSparks(incoming),
      }),
    [visible, stage, incoming],
  );

  const mapSrc = scene.view.mapKind === 'europe' ? MAP_EU : MAP_WORLD;
  const crop = useMemo(() => {
    const extent = mapExtentForKind(scene.view.mapKind);
    return computeMapCrop(scene.view.bounds, extent);
  }, [scene.view.mapKind, scene.view.bounds]);
  const showCompare = stage === 'compare' && !showComplete;
  const showDiscoverReasons = stage === 'discover' || stage === 'soft' || !stage;

  const bar = useRef(new Animated.Value(pct)).current;
  const completeOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(bar, {
      toValue: pct,
      duration: 520,
      useNativeDriver: false,
    }).start();
  }, [bar, pct]);

  useEffect(() => {
    Animated.timing(completeOpacity, {
      toValue: showComplete ? 1 : 0,
      duration: 700,
      useNativeDriver: true,
    }).start();
  }, [completeOpacity, showComplete]);

  const mapScale = crop.scale;
  const mapTX = (0.5 - crop.anchorX) * width * crop.scale;
  const mapTY = (0.5 - crop.anchorY) * height * crop.scale;
  const barWidth = bar.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.stage} pointerEvents="none">
        {/*
          Pins/Flüge IN der Map-Transform — sonst driftet Geo bei cover/crop
          (Palma landet optisch in Nordafrika statt auf den Balearen).
        */}
        <Animated.View
          style={[
            styles.mapWrap,
            {
              transform: [
                { translateX: mapTX },
                { translateY: mapTY },
                { scale: mapScale },
              ],
            },
          ]}
        >
          <Image source={mapSrc} style={styles.mapImg} resizeMode="stretch" />

          {!showCompare
            ? scene.motifs.map((m) => <MotifBubble key={m.id} motif={m} />)
            : null}

          {!showCompare
            ? scene.flights.map((f) => (
                <FlightRoute key={`arc-${f.id}`} flight={f} width={width} height={height} />
              ))
            : null}

          {!showCompare
            ? scene.pins.map((p, i) => (
                <MapPin
                  key={p.id}
                  pin={p}
                  newest={i === 0}
                  showReason={i === 0 && (showDiscoverReasons || stage === 'stay')}
                />
              ))
            : null}
        </Animated.View>

        {showCompare ? <CompareOrbit nodes={scene.compareNodes} /> : null}
      </View>

      {/* Während Suche: nur Checkliste-Fokus — kein gelbes Kategorie-Hero */}
      <View style={styles.focusHud} pointerEvents="none">
        {showComplete ? (
          <Text style={styles.focusStep}>Fertig</Text>
        ) : showCompare ? (
          <>
            <Text style={styles.focusStep}>Vergleich</Text>
            <Text style={styles.focusStatus} numberOfLines={2}>
              Pakete gegeneinander — gleich kommt der Favorit.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.focusStep} numberOfLines={1}>
              {focus.stepTitle}
            </Text>
            <Text style={styles.focusStatus} numberOfLines={2}>
              {focus.statusLine}
            </Text>
          </>
        )}
      </View>

      {/* Palette/Pills erst im Vergleich — während Suche nur Checkliste */}
      {showCompare && scene.pills.length ? (
        <View style={styles.pillRow} pointerEvents="none">
          {scene.pills.map((p) => (
            <View
              key={p.id}
              style={[
                styles.pill,
                p.tone === 'flight' ? styles.pillFlight : null,
                p.tone === 'stay' ? styles.pillStay : null,
              ]}
            >
              <Text
                style={[styles.pillText, p.tone === 'flight' ? styles.pillTextFlight : null]}
                numberOfLines={1}
              >
                {pillCaption(p)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <Animated.View
        style={[styles.completeCard, { opacity: completeOpacity }]}
        pointerEvents="none"
      >
        <View style={styles.completeRing}>
          <Text style={styles.completeCheck}>✓</Text>
        </View>
        <Text style={styles.completeTitle}>Recherche fertig</Text>
      </Animated.View>

      {error ? <Text style={styles.err}>{error}</Text> : null}

      <View style={styles.statusRail} pointerEvents="none">
        {rail.map((row) => {
          const tone =
            row.status === 'done'
              ? styles.railDone
              : row.status === 'active' || row.status === 'pivot'
                ? styles.railActive
                : styles.railPending;
          return (
            <View key={row.stage} style={styles.railRow}>
              <Text style={[styles.railMark, tone]}>
                {row.status === 'done' ? '✓' : row.status === 'active' || row.status === 'pivot' ? '●' : '○'}
              </Text>
              <Text style={[styles.railTitle, tone]} numberOfLines={1}>
                {row.title}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.progressBlock} pointerEvents="none">
        <View style={styles.pctRow}>
          {etaLabel ? <Text style={styles.eta}>{etaLabel}</Text> : <View />}
          <Text style={styles.pct}>{pct}%</Text>
        </View>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: barWidth }]} />
        </View>
      </View>
    </View>
  );
}

function MotifBubble({ motif }: { motif: TheaterMotif }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, motif.id]);

  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] });

  return (
    <Animated.View
      style={[
        styles.motif,
        {
          left: `${motif.xPct}%` as unknown as number,
          top: `${motif.yPct}%` as unknown as number,
          opacity,
          transform: [{ translateX: -22 }, { translateY: -22 }, { scale }],
        },
      ]}
    >
      <View style={styles.motifDisk}>
        <Text style={styles.motifEmoji}>{motif.emoji}</Text>
      </View>
      {motif.label ? (
        <Text style={styles.motifLabel} numberOfLines={1}>
          {motif.label}
        </Text>
      ) : null}
    </Animated.View>
  );
}

function MapPin({
  pin,
  newest,
  showReason,
}: {
  pin: TheaterPin;
  newest: boolean;
  showReason: boolean;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const reasonAnim = useRef(new Animated.Value(0)).current;
  const side = pin.labelSide || 'below';

  useEffect(() => {
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 780,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [opacity, pin.id]);

  useEffect(() => {
    if (!showReason || !pin.reason) {
      reasonAnim.setValue(0);
      return;
    }
    reasonAnim.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(reasonAnim, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(1600),
        Animated.timing(reasonAnim, {
          toValue: 0,
          duration: 700,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(500),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pin.id, pin.reason, reasonAnim, showReason]);

  const labelBox =
    side === 'above'
      ? styles.pinLabelAbove
      : side === 'left'
        ? styles.pinLabelLeft
        : side === 'right'
          ? styles.pinLabelRight
          : styles.pinLabelBelow;

  return (
    <Animated.View
      style={[
        styles.pin,
        {
          left: `${pin.xPct}%` as unknown as number,
          top: `${pin.yPct}%` as unknown as number,
          opacity,
          transform: [{ translateX: -36 }, { translateY: -14 }],
        },
      ]}
    >
      <View style={[styles.pinDot, newest ? styles.pinDotNew : null]}>
        <Text style={styles.pinEmoji}>{pin.emoji || '📍'}</Text>
      </View>
      <View style={[styles.pinLabel, labelBox, newest ? styles.pinLabelNew : null]}>
        <Text style={styles.pinLabelText} numberOfLines={1}>
          {pin.label}
        </Text>
      </View>
      {showReason && pin.reason ? (
        <Animated.Text style={[styles.reasonFloat, { opacity: reasonAnim }]} numberOfLines={1}>
          {pin.reason}
        </Animated.Text>
      ) : null}
    </Animated.View>
  );
}

function FlightRoute({
  flight,
  width,
  height,
}: {
  flight: TheaterFlight;
  width: number;
  height: number;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 3200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
        Animated.delay(400),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, flight.id]);

  const x0 = (flight.from.xPct / 100) * width;
  const y0 = (flight.from.yPct / 100) * height;
  const x1 = (flight.to.xPct / 100) * width;
  const y1 = (flight.to.yPct / 100) * height;
  // ✈️ emoji points ~NE; +offset so nose follows the route
  const angleDeg = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI + 45;

  const planeX = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [x0 - 12, x1 - 12],
  });
  const planeY = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [y0 - 12, y1 - 12],
  });
  const glow = pulse.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0.3, 1, 1, 0.35] });

  const midX = (flight.mid.xPct / 100) * width;
  const midY = (flight.mid.yPct / 100) * height;
  const dist = Math.hypot(x1 - x0, y1 - y0);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View
        style={[
          styles.airportPin,
          {
            left: `${flight.from.xPct}%` as unknown as number,
            top: `${flight.from.yPct}%` as unknown as number,
          },
        ]}
      >
        <Text style={styles.airportDot}>🛫</Text>
        <Text style={styles.airportText} numberOfLines={1}>
          {flight.from.label}
        </Text>
      </View>

      <View
        style={[
          styles.airportPin,
          {
            left: `${flight.to.xPct}%` as unknown as number,
            top: `${flight.to.yPct}%` as unknown as number,
          },
        ]}
      >
        <Text style={styles.airportDot}>🛬</Text>
        <Text style={styles.airportText} numberOfLines={1}>
          {flight.to.label}
        </Text>
      </View>

      <View
        style={[
          styles.arcLineAbs,
          {
            left: midX - dist / 2,
            top: midY,
            width: Math.max(40, dist),
            transform: [{ rotate: `${angleDeg}deg` }],
          },
        ]}
      />

      <Animated.Text
        style={[
          styles.planeAbs,
          {
            opacity: glow,
            transform: [
              { translateX: planeX },
              { translateY: planeY },
              { rotate: `${angleDeg}deg` },
            ],
          },
        ]}
      >
        ✈️
      </Animated.Text>

      <View style={[styles.priceChip, { left: midX - 70, top: midY + 14 }]}>
        <Text style={styles.priceChipText} numberOfLines={1}>
          {flight.price ? `${flight.label} · ${flight.price}` : flight.label}
        </Text>
      </View>
    </View>
  );
}

function CompareOrbit({ nodes }: { nodes: TheaterCompareNode[] }) {
  const spin = useRef(new Animated.Value(0)).current;
  const reasonTick = useRef(new Animated.Value(0)).current;
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 14000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  useEffect(() => {
    if (!nodes.length) return;
    const id = setInterval(() => {
      setFocus((f) => (f + 1) % nodes.length);
    }, 2200);
    return () => clearInterval(id);
  }, [nodes.length]);

  useEffect(() => {
    reasonTick.setValue(0);
    Animated.sequence([
      Animated.timing(reasonTick, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.delay(900),
      Animated.timing(reasonTick, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, [focus, reasonTick]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const counterRotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '-360deg'],
  });

  const focused = nodes[focus];

  return (
    <View style={styles.compareWrap} pointerEvents="none">
      <Animated.View style={[styles.compareRing, { transform: [{ rotate }] }]}>
        {nodes.slice(0, 5).map((n, i) => {
          const angle = (i / Math.max(1, Math.min(5, nodes.length))) * Math.PI * 2 - Math.PI / 2;
          const r = 98;
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r;
          const tone =
            n.status === 'in' ? styles.nodeIn : n.status === 'out' ? styles.nodeOut : styles.nodeMaybe;
          const size = n.status === 'in' ? 1.15 : n.status === 'out' ? 0.82 : 1;
          return (
            <View
              key={n.id}
              style={[
                styles.compareNode,
                tone,
                {
                  transform: [{ translateX: x }, { translateY: y }, { scale: size }],
                },
              ]}
            >
              <Animated.View style={{ transform: [{ rotate: counterRotate }] }}>
                <Text style={styles.compareEmoji}>{n.emoji}</Text>
                <Text style={styles.compareLabel} numberOfLines={1}>
                  {n.label}
                </Text>
                {n.hint ? (
                  <Text style={styles.compareHint} numberOfLines={1}>
                    {n.hint}
                  </Text>
                ) : null}
              </Animated.View>
            </View>
          );
        })}
      </Animated.View>
      <View style={styles.compareCenter}>
        <Text style={styles.compareCenterTitle}>Kombi</Text>
        {focused ? (
          <Animated.Text style={[styles.compareReason, { opacity: reasonTick }]} numberOfLines={2}>
            {focused.reason || focused.label}
          </Animated.Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#061612',
    overflow: 'hidden',
  },
  stage: {
    ...StyleSheet.absoluteFillObject,
  },
  mapWrap: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  mapImg: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  hud: {
    position: 'absolute',
    top: 18,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  focusHud: {
    position: 'absolute',
    top: 16,
    left: 18,
    right: 18,
    alignItems: 'flex-start',
  },
  focusStep: {
    color: 'rgba(243, 235, 224, 0.92)',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.2,
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  focusStatus: {
    marginTop: 4,
    color: 'rgba(200, 214, 206, 0.9)',
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 18,
    maxWidth: '92%',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  kicker: {
    color: colors.accent,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  vibe: {
    marginTop: 6,
    color: colors.text,
    fontWeight: '700',
    fontSize: 18,
    lineHeight: 24,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  motif: {
    position: 'absolute',
    width: 72,
    alignItems: 'center',
  },
  motifDisk: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(8, 28, 22, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(126, 200, 163, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  motifEmoji: { fontSize: 22 },
  motifLabel: {
    marginTop: 3,
    color: colors.text,
    fontSize: 10,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  pin: {
    position: 'absolute',
    width: 72,
    alignItems: 'center',
    zIndex: 2,
  },
  pinDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(12, 40, 32, 0.94)',
    borderWidth: 1.5,
    borderColor: 'rgba(126, 200, 163, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDotNew: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(196,163,90,0.22)',
  },
  pinEmoji: { fontSize: 12 },
  pinLabel: {
    maxWidth: 100,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 9,
    backgroundColor: 'rgba(8, 22, 18, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  pinLabelBelow: {
    marginTop: 4,
  },
  pinLabelAbove: {
    position: 'absolute',
    bottom: 30,
  },
  pinLabelLeft: {
    position: 'absolute',
    right: 70,
    top: 2,
  },
  pinLabelRight: {
    position: 'absolute',
    left: 70,
    top: 2,
  },
  pinLabelNew: {
    borderColor: 'rgba(196,163,90,0.45)',
  },
  pinLabelText: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 10,
    textAlign: 'center',
  },
  reasonFloat: {
    marginTop: 4,
    maxWidth: 110,
    color: colors.textMuted || colors.text,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  airportPin: {
    position: 'absolute',
    width: 88,
    marginLeft: -44,
    marginTop: -8,
    alignItems: 'center',
    zIndex: 1,
  },
  airportDot: { fontSize: 14 },
  airportText: {
    marginTop: 2,
    color: colors.text,
    fontSize: 9,
    fontWeight: '800',
    backgroundColor: 'rgba(6, 20, 16, 0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  arcLineAbs: {
    position: 'absolute',
    height: 2,
    borderRadius: 2,
    backgroundColor: 'rgba(62, 207, 122, 0.4)',
  },
  planeAbs: {
    position: 'absolute',
    left: 0,
    top: 0,
    fontSize: 18,
  },
  priceChip: {
    position: 'absolute',
    width: 140,
    backgroundColor: 'rgba(244, 239, 230, 0.95)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
  },
  priceChipText: {
    color: '#12241e',
    fontWeight: '800',
    fontSize: 10,
  },
  compareWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compareRing: {
    width: 260,
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compareNode: {
    position: 'absolute',
    width: 88,
    marginLeft: -44,
    marginTop: -36,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  nodeIn: {
    backgroundColor: 'rgba(20, 80, 48, 0.9)',
    borderColor: colors.online,
  },
  nodeMaybe: {
    backgroundColor: 'rgba(90, 70, 20, 0.88)',
    borderColor: colors.accent,
  },
  nodeOut: {
    backgroundColor: 'rgba(90, 30, 28, 0.85)',
    borderColor: colors.danger,
  },
  compareEmoji: { fontSize: 16, marginBottom: 2 },
  compareLabel: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 11,
    textAlign: 'center',
  },
  compareHint: {
    marginTop: 2,
    color: colors.textMuted,
    fontSize: 9,
    textAlign: 'center',
  },
  compareCenter: {
    position: 'absolute',
    width: 140,
    alignItems: 'center',
  },
  compareCenterTitle: {
    color: colors.accent,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  compareReason: {
    marginTop: 8,
    color: colors.text,
    fontWeight: '700',
    fontSize: 14,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  pillRow: {
    position: 'absolute',
    bottom: 56,
    left: 12,
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  pill: {
    backgroundColor: 'rgba(244, 239, 230, 0.94)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillFlight: {
    backgroundColor: 'rgba(61, 124, 255, 0.92)',
  },
  pillStay: {
    backgroundColor: 'rgba(244, 239, 230, 0.96)',
  },
  pillText: {
    color: '#12241e',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.2,
  },
  pillTextFlight: {
    color: '#F4EFE6',
  },
  completeCard: {
    position: 'absolute',
    alignSelf: 'center',
    top: '38%',
    width: 168,
    paddingVertical: 22,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(12, 36, 28, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(126, 200, 163, 0.35)',
    alignItems: 'center',
  },
  completeRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 3,
    borderColor: colors.online,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  completeCheck: {
    color: colors.online,
    fontSize: 26,
    fontWeight: '800',
  },
  completeTitle: {
    color: colors.text,
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.3,
  },
  err: {
    position: 'absolute',
    bottom: 78,
    left: 20,
    right: 20,
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  statusRail: {
    position: 'absolute',
    left: 14,
    top: 108,
    maxWidth: 168,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(8,12,18,0.55)',
    gap: 3,
  },
  railRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  railMark: {
    width: 12,
    fontSize: 10,
    fontWeight: '700',
  },
  railTitle: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  railPending: {
    color: 'rgba(230,236,245,0.38)',
  },
  railActive: {
    color: colors.thinking,
  },
  railDone: {
    color: colors.online,
  },
  progressBlock: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 18,
  },
  pctRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  eta: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  pct: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  progressTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.thinking,
  },
});
