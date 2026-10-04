/**
 * Akt 4 — kleine Reisebüro-Landing (Papier-Look, Hero, Nav, Timeline).
 * Inhalt bleibt dynamisch aus der Option; kein Stadt-/Satz-Hardcode.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageStyle,
  type StyleProp,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing } from '../../constants/theme';
import type {
  BookingCheckItem,
  JourneyBeat,
  ReiseOption,
  StayChoice,
  StorySectionId,
  WishChapter,
} from '../../reisebuero/types';
import { useReisebueroStore } from '../../reisebuero/store';
import { pushOptionToTimeline } from '../../reisebuero/timelineHandoff';
import {
  formatFinalPriceEur,
  clampChars,
  resolveOptionPhoto,
} from '../../reisebuero/research/storyMagazine';
import { incompleteBuyInUiHint } from '../../reisebuero/research/tripPackageSpine';
import {
  extractMagazinePalette,
  MAGAZINE_PALETTE_FALLBACK,
  type MagazinePalette,
} from '../../reisebuero/magazinePalette';
import { buildMagazineMapPins, layoutMagazineMapPins } from '../../reisebuero/magazineMapPins';
import { flightWindowBadge } from '../../reisebuero/flightWindowVariants';
import { ConfirmSheet } from './ConfirmSheet';
type Props = {
  opt: ReiseOption;
  siblings: ReiseOption[];
  onClose: () => void;
  onSwitch: (id: string) => void;
  onExit?: () => void;
};

const GOLD_FALLBACK = colors.accent;
const PAPER = MAGAZINE_PALETTE_FALLBACK.paper;
const INK = MAGAZINE_PALETTE_FALLBACK.ink;
const MUTED = MAGAZINE_PALETTE_FALLBACK.muted;
const CARD = MAGAZINE_PALETTE_FALLBACK.card;
const GOLD = GOLD_FALLBACK;
const FOREST = MAGAZINE_PALETTE_FALLBACK.header;

const SECTION_ORDER: StorySectionId[] = [
  'hero',
  'anreise',
  'stay',
  'momente',
  'tage',
  'rueckflug',
  'kosten',
  'buchen',
];

function SafeImage({
  uri,
  style,
  fallback,
  blurRadius,
}: {
  uri?: string | null;
  style: StyleProp<ImageStyle>;
  fallback?: React.ReactNode;
  blurRadius?: number;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  if (!uri || failed) {
    return (
      <View style={[style, styles.heroPh]}>
        {fallback ?? <Text style={styles.phLabel}>Foto folgt</Text>}
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={style}
      blurRadius={blurRadius}
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
    />
  );
}

function beatIcon(kind: JourneyBeat['kind']): React.ComponentProps<typeof Feather>['name'] {
  if (kind === 'flight_out' || kind === 'flight_return') return 'send';
  if (kind === 'train_out' || kind === 'train_return') return 'navigation';
  if (kind === 'car_out') return 'truck';
  if (kind === 'stay') return 'home';
  if (kind === 'destination' || kind === 'activity') return 'map-pin';
  if (kind === 'transfer') return 'map';
  return 'arrow-right';
}

function nightsLine(nights: number | null | undefined, adults: number): string {
  const bits: string[] = [];
  if (nights != null && nights > 0) {
    bits.push(nights === 1 ? '1 Nacht' : `${nights} Nächte`);
  }
  bits.push(adults === 1 ? '1 Person' : `${adults} Personen`);
  return bits.join('  ·  ');
}

export function TripStoryScroll({
  opt,
  siblings,
  onClose,
  onSwitch,
  onExit,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const yMap = useRef<Partial<Record<StorySectionId, number>>>({});
  const snapMap = useRef<Map<string, number>>(new Map());
  const pendingChildren = useRef<Partial<Record<StorySectionId, Array<[string, number]>>>>({});
  const [dayIdx, setDayIdx] = useState(0);
  const [activeSection, setActiveSection] = useState<StorySectionId>('hero');
  const [theme, setTheme] = useState<MagazinePalette>(MAGAZINE_PALETTE_FALLBACK);
  const [notice, setNotice] = useState<null | {
    title: string;
    body: string;
    zone: 'red' | 'yellow' | 'green';
  }>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const preferStay = useReisebueroStore((s) => s.preferStay);
  const markBookingClicked = useReisebueroStore((s) => s.markBookingClicked);
  const ledger = useReisebueroStore((s) => s.trip.ledger);
  const adults = ledger.adults?.value ?? 2;

  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 320, useNativeDriver: true }).start();
  }, [opt.id, fade]);

  useEffect(() => {
    yMap.current = {};
    snapMap.current = new Map();
    pendingChildren.current = {};
    setActiveSection('hero');
    setDayIdx(0);
    setTheme(MAGAZINE_PALETTE_FALLBACK);
  }, [opt.id]);

  const anchors = (opt.sectionAnchors?.length
    ? opt.sectionAnchors
    : [
        { id: 'hero' as const, label: 'Reise' },
        { id: 'anreise' as const, label: 'Anreise' },
        { id: 'stay' as const, label: 'Haus' },
        { id: 'momente' as const, label: 'Momente' },
        { id: 'kosten' as const, label: 'Preis' },
        { id: 'buchen' as const, label: 'Buchen' },
      ]
  ).filter((a) => a.id !== 'tage' || (opt.days?.length ?? 0) > 0);

  const nav = useMemo(
    () =>
      anchors
        .filter((a) => SECTION_ORDER.includes(a.id) && a.id !== 'rueckflug')
        .map((a) =>
          a.id === 'hero'
            ? { ...a, label: 'Reise' }
            : a.id === 'kosten'
              ? { ...a, label: 'Preis' }
              : a.id === 'tage'
                ? { ...a, label: 'Tage' }
                : a,
        ),
    [anchors],
  );

  const outbound = opt.journeyBeats ?? [];
  const inbound = opt.returnBeats ?? [];
  const chapters = (opt.wishChapters ?? []).filter((c) => c.met);
  const openWishes = (opt.wishChapters ?? []).filter((c) => !c.met);
  const days = opt.days ?? [];
  const safeDayIdx = Math.min(dayIdx, Math.max(0, days.length - 1));
  const day = days[safeDayIdx];
  const showDays = days.length > 0;
  const dayTabsRef = useRef<ScrollView | null>(null);
  const stayChoices = opt.stays ?? [];
  const featuredStay: StayChoice | null =
    stayChoices.find((x) => x.id === opt.selectedStayId) || stayChoices[0] || null;
  const otherStays = stayChoices.filter((s) => s.id !== featuredStay?.id).slice(0, 3);
  // Alle übrigen Magazin-Karten (Policy setzt max. 4) — nicht künstlich auf 3 kürzen
  const otherIdeas = siblings.filter((s) => s.id !== opt.id);
  const heroUri = resolveOptionPhoto(opt);
  const ambientUri = heroUri || featuredStay?.photoUrl || null;
  const mapPins = buildMagazineMapPins(opt);
  const mapLayout = layoutMagazineMapPins(mapPins);
  const windowBadge = flightWindowBadge(opt);

  useEffect(() => {
    let cancelled = false;
    setTheme(MAGAZINE_PALETTE_FALLBACK);
    if (!ambientUri) return;
    void (async () => {
      const next = await extractMagazinePalette(ambientUri);
      if (!cancelled && next) setTheme(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [opt.id, ambientUri]);

  const onLayoutSection = useCallback((id: StorySectionId, y: number) => {
    yMap.current[id] = y;
    snapMap.current.set(`sec:${id}`, y);
    const pending = pendingChildren.current[id];
    if (pending) {
      for (const [childKey, childY] of pending) {
        snapMap.current.set(childKey, y + childY);
      }
    }
  }, []);

  const onLayoutChildSnap = useCallback(
    (sectionId: StorySectionId, childKey: string, childY: number) => {
      const bag = pendingChildren.current[sectionId] ?? [];
      const next = bag.filter(([k]) => k !== childKey);
      next.push([childKey, childY]);
      pendingChildren.current[sectionId] = next;
      const sectionY = yMap.current[sectionId];
      if (sectionY != null) snapMap.current.set(childKey, sectionY + childY);
    },
    [],
  );

  const jumpTo = useCallback((id: StorySectionId) => {
    const y = yMap.current[id];
    if (y == null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
    setActiveSection(id);
  }, []);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y + 72;
    let current: StorySectionId = 'hero';
    for (const id of SECTION_ORDER) {
      const top = yMap.current[id];
      if (top != null && y >= top) current = id;
    }
    setActiveSection(current);
  }, []);

  const openUrl = async (url: string | null | undefined) => {
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      /* soft */
    }
  };

  const openBook = async (item: BookingCheckItem) => {
    try {
      const { briefParamsReady } = require('../../reisebuero/completeness') as {
        briefParamsReady: (l: typeof ledger) => boolean;
      };
      const { mayOpenBookingCheckItem } = require('../../reisebuero/research/bookCtaGate') as {
        mayOpenBookingCheckItem: (it: BookingCheckItem) => boolean;
      };
      if (!briefParamsReady(ledger)) {
        setNotice({
          title: 'Noch nachziehen',
          body: 'Im Brief fehlen noch Buchungs-Angaben (z. B. Gepäck bei Flug) — danach hole ich das konkrete Angebot.',
          zone: 'yellow',
        });
        return;
      }
      if (!mayOpenBookingCheckItem(item)) {
        setNotice({
          title: 'Noch nachziehen',
          body: 'Konkretes Angebot fehlt noch — Zimmer braucht Expedia-ID oder Airbnb-Room, Flug Carrier+Nummer.',
          zone: 'yellow',
        });
        return;
      }
    } catch {
      if (!item.url) return;
      try {
        const { isHollowPartnerUrl } = require('../../services/affiliate/hollowPartnerUrl') as {
          isHollowPartnerUrl: (u: string) => boolean;
        };
        if (isHollowPartnerUrl(item.url)) return;
      } catch {
        /* soft */
      }
    }
    markBookingClicked(opt.id, item.id);
    // Club/Event: bei Entscheidung konkreten Preis + Direktlink nachziehen
    if (item.kind === 'activity') {
      try {
        const { lookupVenueLivePrice, formatWishPriceLabel, mergePriceIntoLabel } = await import(
          '../../reisebuero/research/wishPrice'
        );
        const venueName = (item.label || '').split('·')[0]!.trim();
        const quote = await lookupVenueLivePrice({
          venueName,
          city: opt.placeName,
          dateKey: ledger.dateStart?.value || null,
          kind: /club|disco/i.test(item.label) ? 'club' : 'event',
        });
        const priceLabel = formatWishPriceLabel({
          priceEur: quote.priceEur,
          priceMinEur: quote.priceMinEur,
          priceMaxEur: quote.priceMaxEur,
        });
        const nextUrl = quote.eventUrl || item.url;
        if (priceLabel || quote.eventUrl) {
          const { useReisebueroStore } = await import('../../reisebuero/store');
          const snap = useReisebueroStore.getState().trip;
          useReisebueroStore.setState({
            trip: {
              ...snap,
              options: snap.options.map((o) => {
                if (o.id !== opt.id) return o;
                const bookingChecklist = (o.bookingChecklist ?? []).map((b) =>
                  b.id === item.id
                    ? {
                        ...b,
                        url: nextUrl,
                        priceLabel: priceLabel || b.priceLabel,
                        label: mergePriceIntoLabel(venueName, priceLabel || b.priceLabel),
                      }
                    : b,
                );
                const wishChapters = (o.wishChapters ?? []).map((c) => {
                  if (
                    !c.title.toLowerCase().includes(venueName.slice(0, 8).toLowerCase()) &&
                    c.bookUrl !== item.url
                  ) {
                    return c;
                  }
                  return {
                    ...c,
                    bookUrl: nextUrl || c.bookUrl,
                    priceEur: quote.priceEur ?? c.priceEur,
                    priceMinEur: quote.priceMinEur ?? c.priceMinEur,
                    priceMaxEur: quote.priceMaxEur ?? c.priceMaxEur,
                    costHint: priceLabel || c.costHint,
                  };
                });
                return { ...o, bookingChecklist, wishChapters };
              }),
            },
          });
        }
        await openUrl(nextUrl);
        return;
      } catch {
        /* soft — normaler Link */
      }
    }
    await openUrl(item.url);
  };

  const pushTimeline = () => {
    try {
      const res = pushOptionToTimeline(opt);
      setNotice({
        title: 'In Timeline',
        body:
          res.days > 1
            ? `${opt.title} — ${res.count} Stopps auf ${res.days} Tagen (ab ${res.dayKey}).`
            : `${opt.title} — ${res.count} Stopps für ${res.dayKey} übernommen.`,
        zone: 'green',
      });
    } catch {
      setNotice({
        title: 'Timeline',
        body: 'Konnte die Reise gerade nicht übernehmen.',
        zone: 'red',
      });
    }
  };

  const buyIn = opt.buyInEur ?? opt.pricePerPerson;
  const breakdown = opt.priceBreakdown?.length
    ? opt.priceBreakdown
    : [
        ...(opt.flightPriceEur != null
          ? [{ id: 'f', label: 'Flug', amountEur: opt.flightPriceEur, scope: 'per_person' as const }]
          : []),
        ...(opt.transferEur != null && opt.transferEur > 0
          ? [{ id: 't', label: 'Transfer', amountEur: opt.transferEur, scope: 'group' as const }]
          : []),
        ...(opt.stayPriceEur != null
          ? [{ id: 's', label: 'Unterkunft', amountEur: opt.stayPriceEur, scope: 'group' as const }]
          : []),
      ];
  const incompleteHint = incompleteBuyInUiHint(ledger, opt.gaps ?? []);
  const summary = opt.experienceSummary
    ? opt.experienceSummary
    : clampChars(opt.fitLine || opt.whyBlurb || '', 300);
  const nights = ledger.stayNights?.value ?? null;

  return (
    <Animated.View
      style={[styles.wrap, { opacity: fade, backgroundColor: theme.header }]}
    >
      {ambientUri ? (
        <View style={styles.ambientLayer} pointerEvents="none">
          <SafeImage uri={ambientUri} style={styles.ambientImg} blurRadius={56} />
          <View style={[styles.ambientFrost, { backgroundColor: theme.frost }]} />
        </View>
      ) : null}
      <View style={[styles.siteBar, { backgroundColor: theme.header }]}>
        <Pressable onPress={onClose} hitSlop={8} style={styles.siteBarBtn} accessibilityLabel="Alle Ideen">
          <Feather name="chevron-left" size={20} color={PAPER} />
          <Text style={styles.siteBarBack}>Ideen</Text>
        </Pressable>
        <Text style={[styles.siteBarBrand, { color: theme.accent }]} numberOfLines={1}>
          Yorro Reisebüro
        </Text>
        {onExit ? (
          <Pressable onPress={onExit} hitSlop={8} style={styles.siteBarBtn} accessibilityLabel="Schließen">
            <Feather name="x" size={20} color={PAPER} />
          </Pressable>
        ) : (
          <View style={styles.siteBarBtn} />
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.nav, { backgroundColor: theme.header }]}
        contentContainerStyle={styles.navInner}
      >
        {nav.map((a) => (
          <Pressable
            key={a.id}
            onPress={() => jumpTo(a.id)}
            style={[styles.navItem, activeSection === a.id && styles.navItemOn]}
          >
            <Text style={[styles.navLabel, activeSection === a.id && styles.navLabelOn]}>{a.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        ref={scrollRef}
        style={[styles.scroll, { backgroundColor: 'transparent' }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
        nestedScrollEnabled
      >
        <View onLayout={(e) => onLayoutSection('hero', e.nativeEvent.layout.y)}>
          <View style={[styles.heroWrap, { backgroundColor: theme.header }]}>
            <SafeImage
              uri={ambientUri}
              style={styles.hero}
              fallback={<Text style={styles.heroFallback}>{opt.placeName}</Text>}
            />
            <View style={[styles.heroScrim, { backgroundColor: theme.scrub }]} />
            <View style={styles.heroCopy}>
              <Text style={[styles.heroKicker, { color: theme.accent }]} numberOfLines={1}>
                {opt.placeName}
              </Text>
              <Text style={styles.heroTitle} textBreakStrategy="simple">
                {opt.title}
              </Text>
              {windowBadge ? (
                <View style={styles.windowBadge}>
                  <Text style={styles.windowBadgeText} numberOfLines={1}>
                    Flugfenster · {windowBadge}
                  </Text>
                </View>
              ) : null}
              <Text style={styles.heroMeta}>
                {[nightsLine(nights, adults)].filter(Boolean).join('  ·  ')}
              </Text>
              {opt.weatherLine ? (
                <View style={styles.weatherChip}>
                  <Text style={styles.weatherChipText} numberOfLines={1}>
                    {opt.weatherLine}
                  </Text>
                </View>
              ) : null}
              {buyIn != null ? (
                <View style={[styles.priceBadge, { backgroundColor: theme.accent }]}>
                  <Text style={[styles.priceBadgeNum, { color: theme.header }]}>
                    {formatFinalPriceEur(buyIn)}
                  </Text>
                  <Text style={[styles.priceBadgeCap, { color: theme.header }]}>pro Person</Text>
                </View>
              ) : null}
            </View>
          </View>
          {summary ? (
            <View style={[styles.intro, { backgroundColor: theme.frost }]}>
              <Text style={[styles.introText, { color: theme.ink }]}>{summary}</Text>
              {opt.priceIncludes ? (
                <Text style={[styles.includes, { color: theme.muted }]}>{opt.priceIncludes}</Text>
              ) : null}
            </View>
          ) : null}
        </View>

        <View
          onLayout={(e) => onLayoutSection('anreise', e.nativeEvent.layout.y)}
          style={styles.section}
        >
          <Text style={styles.eyebrow}>So kommt ihr hin</Text>
          <Text style={styles.sectionTitle}>Anreise</Text>
          {outbound.length ? (
            <View style={styles.timeline}>
              {outbound.map((b, i) => (
                <View
                  key={b.id}
                  onLayout={(e) =>
                    onLayoutChildSnap('anreise', `beat:${b.id}`, e.nativeEvent.layout.y)
                  }
                >
                  <ItineraryStep beat={b} index={i + 1} last={i === outbound.length - 1} />
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>Anreise folgt aus der Recherche.</Text>
          )}
        </View>

        <View onLayout={(e) => onLayoutSection('stay', e.nativeEvent.layout.y)} style={styles.section}>
          <Text style={styles.eyebrow}>Wo ihr schlaft</Text>
          <Text style={styles.sectionTitle}>Unterkunft</Text>
          {featuredStay ? (
            <View style={styles.property}>
              <SafeImage
                uri={featuredStay.photoUrl || heroUri || resolveOptionPhoto(opt)}
                style={styles.propertyImg}
                fallback={<Text style={styles.heroFallback}>🏡</Text>}
              />
              <View style={styles.propertyBody}>
                <Text style={styles.propertyTag}>1 · Empfohlenes Haus</Text>
                <Text style={styles.propertyName} textBreakStrategy="simple">
                  {featuredStay.name}
                </Text>
                {featuredStay.priceEur != null ? (
                  <Text style={styles.propertyPrice}>{formatFinalPriceEur(featuredStay.priceEur)}</Text>
                ) : null}
                {featuredStay.why ? (
                  <Text style={styles.propertyWhy} textBreakStrategy="simple">
                    {featuredStay.why}
                  </Text>
                ) : null}
                <Text style={styles.propertyWhy} textBreakStrategy="simple">
                  {[
                    `Check-in ab ${featuredStay.checkInFrom || '15:00'} (Hotel-üblich)`,
                    `Check-out bis ${featuredStay.checkOutUntil || '11:00'}`,
                  ].join(' · ')}
                </Text>
                {featuredStay.bookUrl ? (
                  <Pressable style={styles.ghostBtn} onPress={() => void openUrl(featuredStay.bookUrl)}>
                    <Text style={styles.ghostBtnText}>Zimmer wählen</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : (
            <Text style={styles.muted}>Unterkunft folgt aus der Recherche.</Text>
          )}
          {otherStays.length ? (
            <View style={styles.altList}>
              <Text style={styles.altHead}>Andere Häuser</Text>
              {otherStays.map((s, si) => (
                <Pressable key={s.id} onPress={() => preferStay(opt.id, s.id)} style={styles.altRow}>
                  <Text style={styles.altName} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={styles.altPrice}>{formatFinalPriceEur(s.priceEur)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <View
          onLayout={(e) => onLayoutSection('momente', e.nativeEvent.layout.y)}
          style={styles.section}
        >
          <Text style={styles.eyebrow}>Vor Ort</Text>
          <Text style={styles.sectionTitle}>Eure Momente</Text>
          {chapters.length ? (
            chapters.map((c) => (
              <View
                key={c.id}
                collapsable={false}
                onLayout={(e) =>
                  onLayoutChildSnap('momente', `wish:${c.id}`, e.nativeEvent.layout.y)
                }
              >
                <MomentCard
                  chapter={c}
                  placeName={opt.placeName}
                  dateKey={ledger.dateStart?.value}
                  onResolved={(next) => {
                    try {
                      const { useReisebueroStore } = require('../../reisebuero/store') as typeof import('../../reisebuero/store');
                      const snap = useReisebueroStore.getState().trip;
                      useReisebueroStore.setState({
                        trip: {
                          ...snap,
                          options: snap.options.map((o) =>
                            o.id !== opt.id
                              ? o
                              : {
                                  ...o,
                                  wishChapters: (o.wishChapters ?? []).map((x) =>
                                    x.id === next.id ? next : x,
                                  ),
                                },
                          ),
                        },
                      });
                    } catch {
                      /* soft */
                    }
                  }}
                />
              </View>
            ))
          ) : (
            <Text style={styles.muted}>Keine Extra-Wünsche im Brief — Fokus auf Ort und Haus.</Text>
          )}
          {openWishes.length ? (
            <Text style={styles.muted}>
              Noch ohne Beleg: {openWishes.map((c) => c.title).join(', ')}.
            </Text>
          ) : null}
        </View>

        {showDays ? (
          <View onLayout={(e) => onLayoutSection('tage', e.nativeEvent.layout.y)} style={styles.section}>
            <Text style={styles.eyebrow}>Ablauf</Text>
            <Text style={styles.sectionTitle}>Tagesplan</Text>
            <Text style={styles.dayHint}>Tag antippen — jeder Tag hat eigene Planpunkte</Text>
            {mapLayout.length ? (
              <View style={styles.mapCanvas} accessibilityLabel="Magazin-Karte mit Tagesnummern">
                <View style={styles.mapCanvasGrid} />
                {mapLayout.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      if (p.dayNum != null) setDayIdx(Math.max(0, p.dayNum - 1));
                    }}
                    style={[
                      styles.mapDot,
                      p.kind === 'stay' ? styles.mapDotStay : null,
                      {
                        left: `${p.xPct}%`,
                        top: `${p.yPct}%`,
                      },
                    ]}
                    accessibilityLabel={
                      p.dayNum != null ? `Tag ${p.dayNum} ${p.label}` : p.label
                    }
                  >
                    <Text style={styles.mapDotText}>
                      {p.dayNum != null ? String(p.dayNum) : p.kind === 'stay' ? '⌂' : '•'}
                    </Text>
                  </Pressable>
                ))}
                <View style={styles.mapLegend}>
                  {mapLayout
                    .filter((p) => p.dayNum != null)
                    .slice(0, 6)
                    .map((p) => (
                      <Pressable
                        key={`leg_${p.id}`}
                        onPress={() => {
                          if (p.dayNum != null) setDayIdx(Math.max(0, p.dayNum - 1));
                        }}
                        style={styles.mapPinChip}
                      >
                        <View style={styles.mapPinBadge}>
                          <Text style={styles.mapPinBadgeText}>{p.dayNum}</Text>
                        </View>
                        <Text style={styles.mapPinLabel} numberOfLines={1}>
                          {p.label}
                        </Text>
                      </Pressable>
                    ))}
                </View>
              </View>
            ) : mapPins.some((p) => p.dayNum != null) ? (
              <View style={styles.mapPinRow}>
                {mapPins
                  .filter((p) => p.dayNum != null)
                  .slice(0, 8)
                  .map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => {
                        if (p.dayNum != null) setDayIdx(Math.max(0, p.dayNum - 1));
                      }}
                      style={styles.mapPinChip}
                      accessibilityLabel={`Tag ${p.dayNum} ${p.label}`}
                    >
                      <View style={styles.mapPinBadge}>
                        <Text style={styles.mapPinBadgeText}>{p.dayNum}</Text>
                      </View>
                      <Text style={styles.mapPinLabel} numberOfLines={1}>
                        {p.label}
                      </Text>
                    </Pressable>
                  ))}
              </View>
            ) : null}
            <ScrollView
              ref={dayTabsRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.dayTabs}
              contentContainerStyle={styles.dayTabsInner}
            >
              {days.map((d, i) => {
                const on = i === safeDayIdx;
                const n = d.blocks?.length ?? 0;
                const short =
                  d.weekdayLabel
                    ? `${d.weekdayLabel} ${d.title.split('·')[0]?.replace(d.weekdayLabel, '').trim() || ''}`.trim()
                    : d.title.split('·')[0]?.trim() || `Tag ${i + 1}`;
                return (
                  <Pressable
                    key={d.dayKey}
                    onPress={() => {
                      setDayIdx(i);
                      dayTabsRef.current?.scrollTo({
                        x: Math.max(0, i * 88 - 24),
                        animated: true,
                      });
                    }}
                    style={[styles.dayTab, on && styles.dayTabOn]}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${d.title}, ${n} Planpunkte`}
                  >
                    <View style={styles.dayTabNum}>
                      <Text style={[styles.dayTabNumText, on && styles.dayTabTextOn]}>{i + 1}</Text>
                    </View>
                    <Text style={[styles.dayTabText, on && styles.dayTabTextOn]} numberOfLines={1}>
                      {short}
                    </Text>
                    <Text style={[styles.dayTabMeta, on && styles.dayTabMetaOn]}>
                      {n} {n === 1 ? 'Punkt' : 'Punkte'}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {day ? (
              <View style={styles.dayBody}>
                <Text style={styles.dayBodyHead} numberOfLines={2}>
                  {[
                    day.weekdayLabel,
                    /^\d{4}-\d{2}-\d{2}/.test(day.dayKey)
                      ? `${Number(day.dayKey.slice(8, 10))}.${Number(day.dayKey.slice(5, 7))}.`
                      : null,
                    day.title
                      .split('·')
                      .map((s) => s.trim())
                      .filter(
                        (s) =>
                          s &&
                          s !== day.weekdayLabel &&
                          !/^\d{1,2}\.\d{1,2}\.?$/.test(s),
                      )
                      .join(' · ') || null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {(day.blocks ?? []).map((b, bi) => {
                  const linkLabel = /flug/i.test(b.title)
                    ? 'Flug öffnen'
                    : /zug|bahn/i.test(b.title)
                      ? 'Bahn öffnen'
                      : /check-in|hotel|unterkunft|stay/i.test(b.title)
                        ? 'Stay öffnen'
                        : /ticket|konzert|event|festival/i.test(`${b.title} ${b.detail || ''}`)
                          ? 'Ticket öffnen'
                          : 'Link öffnen';
                  return (
                  <View key={b.id} style={styles.dayBlock}>
                    <View style={styles.dayBlockRail}>
                      <Text style={styles.dayBlockNum}>{String(bi + 1).padStart(2, '0')}</Text>
                      {bi < (day.blocks?.length ?? 0) - 1 ? <View style={styles.dayBlockLine} /> : null}
                    </View>
                    <View style={styles.dayBlockMain}>
                      <Text style={styles.dayBlockTitle}>
                        {b.time ? `${String(b.time).slice(0, 5)} · ` : ''}
                        {b.title}
                      </Text>
                      {b.detail ? (
                        <Text style={styles.dayBlockDetail}>{b.detail}</Text>
                      ) : null}
                      {b.costEur != null ? (
                        <Text style={styles.propertyPrice}>{formatFinalPriceEur(b.costEur)}</Text>
                      ) : null}
                      {b.bookUrl ? (
                        <Pressable
                          onPress={() => {
                            void Linking.openURL(b.bookUrl!);
                          }}
                          hitSlop={6}
                        >
                          <Text style={styles.stepLink}>{linkLabel}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}

        <View
          onLayout={(e) => onLayoutSection('rueckflug', e.nativeEvent.layout.y)}
          style={styles.section}
        >
          <Text style={styles.eyebrow}>Nach Hause</Text>
          <Text style={styles.sectionTitle}>Rückreise</Text>
          {inbound.length ? (
            <View style={styles.timeline}>
              {inbound.map((b, i) => (
                <ItineraryStep key={b.id} beat={b} index={i + 1} last={i === inbound.length - 1} />
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>Rückflug steckt oft im Hin-Preis — Link unten prüfen.</Text>
          )}
        </View>

        <View onLayout={(e) => onLayoutSection('kosten', e.nativeEvent.layout.y)} style={styles.section}>
          <Text style={styles.eyebrow}>Transparent</Text>
          <Text style={styles.sectionTitle}>Was es kostet</Text>
          <View style={styles.invoice}>
            <Text style={styles.invoiceHero}>
              {buyIn != null ? `${formatFinalPriceEur(buyIn)} p.P.` : 'Preis noch offen'}
            </Text>
            {buyIn != null ? (
              <Text style={styles.invoiceSub}>Buy-in = Wohnen + Anreise (ohne Tickets)</Text>
            ) : null}
            {buyIn != null && opt.totalEur != null ? (
              <Text style={styles.invoiceSub}>
                Paket {formatFinalPriceEur(opt.totalEur)} · {adults} Pers.
              </Text>
            ) : buyIn == null ? (
              <Text style={styles.invoiceSub}>{incompleteHint}</Text>
            ) : null}
            <View style={styles.invoiceRule} />
            {(buyIn != null ? breakdown : breakdown.filter((line) => line.id !== 's')).map((line) => (
              <View key={line.id} style={styles.invoiceRow}>
                <Text style={styles.invoiceLabel}>
                  {line.label}
                  {line.scope === 'per_person' ? ' p.P.' : line.scope === 'group' ? ' (Gruppe)' : ''}
                  {buyIn == null ? ' · noch ohne volles Paket' : ''}
                </Text>
                <Text style={styles.invoiceAmt}>{formatFinalPriceEur(line.amountEur)}</Text>
              </View>
            ))}
          </View>
        </View>

        <View onLayout={(e) => onLayoutSection('buchen', e.nativeEvent.layout.y)} style={styles.section}>
          <Text style={styles.eyebrow}>Nächster Schritt</Text>
          <Text style={styles.sectionTitle}>Buchen</Text>
          {(() => {
            const raw = (opt.bookingChecklist ?? []) as BookingCheckItem[];
            const selectedStay = (opt.stays ?? []).find((s) => s.id === opt.selectedStayId) || (opt.stays ?? [])[0];
            const filtered = raw.filter((item) => {
              if (item.alreadyBooked) return true;
              if (/noch nachziehen/i.test(item.label)) return true;
              if (!item.url) return false;
              // Pauschal-Portal nur wenn wirklich packageBookUrl hinterlegt (nicht DIY-Leerlink)
              if (item.kind === 'package' || /check24|ab-in-den|pauschal|lidl\s*reisen|magic\s*life/i.test(item.label)) {
                if (!opt.packageBookUrl) return false;
              }
              if (item.kind === 'stay' && selectedStay) {
                return (
                  item.label.includes(selectedStay.name.slice(0, 12)) ||
                  item.url === selectedStay.bookUrl ||
                  Boolean(selectedStay.expediaPropertyId)
                );
              }
              return true;
            });
            const list = filtered.length
              ? filtered
              : raw
                  .filter((i) => Boolean(i.url) || i.alreadyBooked || /noch nachziehen/i.test(i.label))
                  .slice(0, 3);
            return list.length ? (
            list.map((item) => (
              <Pressable
                key={item.id}
                style={[
                  styles.bookBtn,
                  item.clickedAtMs || item.alreadyBooked ? styles.bookBtnDone : null,
                ]}
                onPress={() => {
                  if (item.alreadyBooked || !item.url) return;
                  void openBook(item);
                }}
              >
                <Text style={styles.bookBtnText}>
                  {item.alreadyBooked || item.clickedAtMs ? '✓ ' : ''}
                  {item.label}
                </Text>
                {item.priceLabel && !item.label.includes(item.priceLabel) ? (
                  <Text style={styles.bookBtnPrice}>{item.priceLabel}</Text>
                ) : null}
              </Pressable>
            ))
          ) : (
            <Text style={styles.muted}>Noch keine Buchungs-Links belegt.</Text>
          );
          })()}
          <Pressable onPress={pushTimeline} style={styles.textLink}>
            <Text style={styles.textLinkLabel}>In die Timeline übernehmen</Text>
          </Pressable>
          {otherIdeas.length ? (
            <View style={styles.moreIdeas}>
              <Text style={styles.altHead}>Weitere Ideen</Text>
              {otherIdeas.map((s) => (
                <Pressable key={s.id} onPress={() => onSwitch(s.id)} style={styles.altRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.altName} numberOfLines={1}>
                      {s.placeName || s.title}
                    </Text>
                    {flightWindowBadge(s) ? (
                      <Text style={styles.altFenster} numberOfLines={1}>
                        Fenster · {flightWindowBadge(s)}
                      </Text>
                    ) : (s.decisionNotes ?? []).some((d) => /^Stay-Spur:/i.test(d)) ? (
                      <Text style={styles.altFenster} numberOfLines={1}>
                        {(s.decisionNotes ?? [])
                          .find((d) => /^Stay-Spur:/i.test(d))
                          ?.replace(/^Stay-Spur:\s*/i, 'Stay · ') || 'Stay-Spur'}
                      </Text>
                    ) : null}
                  </View>
                  <Feather name="chevron-right" size={16} color={GOLD} />
                </Pressable>
              ))}
            </View>
          ) : (
            <Pressable onPress={onClose} style={styles.textLink}>
              <Text style={styles.textLinkLabel}>Andere Idee wählen</Text>
            </Pressable>
          )}
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
      {notice ? (
        <ConfirmSheet
          title={notice.title}
          body={notice.body}
          zone={notice.zone}
          primaryLabel="Alles klar"
          primaryTone={notice.zone === 'green' ? 'green' : notice.zone === 'red' ? 'danger' : 'accent'}
          singleAction
          onPrimary={() => setNotice(null)}
        />
      ) : null}
    </Animated.View>
  );
}

function ItineraryStep({
  beat,
  index,
  last,
}: {
  beat: JourneyBeat;
  index: number;
  last: boolean;
}) {
  const showPrice =
    beat.priceEur != null &&
    beat.kind !== 'destination' &&
    beat.kind !== 'flight_return' &&
    beat.kind !== 'train_return';
  const inner = (
    <View style={styles.stepRow}>
      <View style={styles.stepRail}>
        <View style={styles.stepNum}>
          <Text style={styles.stepNumText}>{String(index).padStart(2, '0')}</Text>
        </View>
        {last ? null : <View style={styles.stepLine} />}
      </View>
      <View style={styles.stepCard}>
        {beat.photoUrl ? (
          <SafeImage uri={beat.photoUrl} style={styles.stepImg} />
        ) : (
          <View style={[styles.stepImg, styles.stepImgPh]}>
            <Feather name={beatIcon(beat.kind)} size={18} color={GOLD} />
          </View>
        )}
        <View style={styles.stepBody}>
          <Text style={styles.stepTitle} textBreakStrategy="simple">
            {beat.title}
          </Text>
          {beat.detail ? (
            <Text style={styles.stepDetail} textBreakStrategy="simple">
              {beat.detail}
            </Text>
          ) : null}
          {beat.durationHint ? <Text style={styles.stepMeta}>{beat.durationHint}</Text> : null}
          {showPrice ? <Text style={styles.stepMeta}>{formatFinalPriceEur(beat.priceEur)}</Text> : null}
          {beat.alreadyBooked ? (
            <Text style={styles.stepMeta}>schon gebucht</Text>
          ) : beat.bookUrl ? (
            <Text style={styles.stepLink}>Link öffnen</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
  if (!beat.bookUrl) return inner;
  return (
    <Pressable
      onPress={() => {
        void Linking.openURL(beat.bookUrl!);
      }}
    >
      {inner}
    </Pressable>
  );
}

function MomentCard({
  chapter,
  placeName,
  dateKey,
  onResolved,
}: {
  chapter: WishChapter;
  placeName?: string;
  dateKey?: string | null;
  onResolved?: (next: WishChapter) => void;
}) {
  const openMoment = async () => {
    if (!chapter.bookUrl) return;
    let url = chapter.bookUrl;
    if (/club|concert|activity|stadium/i.test(chapter.mustHaveId) && placeName) {
      try {
        const { lookupVenueLivePrice, formatWishPriceLabel } = await import(
          '../../reisebuero/research/wishPrice'
        );
        const quote = await lookupVenueLivePrice({
          venueName: chapter.title,
          city: placeName,
          dateKey: dateKey || null,
          kind: chapter.mustHaveId,
        });
        const priceLabel = formatWishPriceLabel({
          priceEur: quote.priceEur,
          priceMinEur: quote.priceMinEur,
          priceMaxEur: quote.priceMaxEur,
        });
        if (quote.eventUrl) url = quote.eventUrl;
        if (priceLabel || quote.eventUrl) {
          onResolved?.({
            ...chapter,
            bookUrl: url,
            priceEur: quote.priceEur ?? chapter.priceEur,
            priceMinEur: quote.priceMinEur ?? chapter.priceMinEur,
            priceMaxEur: quote.priceMaxEur ?? chapter.priceMaxEur,
            costHint: priceLabel || chapter.costHint,
          });
        }
      } catch {
        /* soft */
      }
    }
    try {
      await Linking.openURL(url);
    } catch {
      /* soft */
    }
  };

  return (
    <View style={[styles.moment, !chapter.met && styles.momentMiss]}>
      <SafeImage
        uri={chapter.photoUrl}
        style={styles.momentImg}
        fallback={<Text style={styles.heroFallback}>{chapter.emoji || '✨'}</Text>}
      />
      <View style={styles.momentBody}>
        <Text style={styles.momentTitle}>
          {chapter.emoji ? `${chapter.emoji} ` : ''}
          {chapter.title}
          {!chapter.met ? ' · noch offen' : ''}
        </Text>
        <Text style={styles.momentBlurb}>{chapter.blurb}</Text>
        {(chapter.distanceHint || chapter.costHint) && (
          <Text style={styles.momentMeta}>
            {[chapter.distanceHint, chapter.costHint].filter(Boolean).join(' · ')}
          </Text>
        )}
        {chapter.bookUrl ? (
          <Pressable onPress={() => void openMoment()} hitSlop={8}>
            <Text style={styles.momentMeta}>
              {chapter.priceEur != null
                ? `Tickets · ${Math.round(chapter.priceEur)}€`
                : chapter.costHint
                  ? `Tickets · ${chapter.costHint}`
                  : 'Tickets / Eintritt öffnen'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: FOREST, overflow: 'hidden' },
  ambientLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  ambientImg: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  ambientFrost: {
    ...StyleSheet.absoluteFillObject,
  },
  siteBar: {
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: FOREST,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  siteBarBtn: {
    minWidth: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  siteBarBack: { color: PAPER, fontWeight: '700', fontSize: 14 },
  siteBarBrand: {
    flex: 1,
    textAlign: 'center',
    color: GOLD,
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  nav: {
    zIndex: 2,
    flexGrow: 0,
    backgroundColor: FOREST,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(196,163,90,0.25)',
  },
  navInner: { paddingHorizontal: 10, paddingBottom: 10, gap: 6, alignItems: 'center' },
  navItem: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  navItemOn: { backgroundColor: 'rgba(196,163,90,0.28)' },
  navLabel: { color: 'rgba(244,239,230,0.7)', fontWeight: '700', fontSize: 12 },
  navLabelOn: { color: PAPER },
  scroll: { flex: 1, zIndex: 1, backgroundColor: 'transparent' },
  scrollContent: { paddingBottom: 16 },
  heroWrap: { height: 340, backgroundColor: FOREST, overflow: 'hidden' },
  hero: { width: '100%', height: '100%' },
  heroPh: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#234339' },
  phLabel: { color: PAPER, opacity: 0.7, fontWeight: '600' },
  heroFallback: { color: PAPER, fontSize: 22, fontWeight: '800' },
  heroScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 28, 24, 0.42)',
  },
  heroCopy: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 22,
    gap: 6,
  },
  heroKicker: {
    color: GOLD,
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: PAPER,
    fontSize: 28,
    fontWeight: '800',
    lineHeight: 34,
    letterSpacing: -0.4,
  },
  windowBadge: {
    alignSelf: 'flex-start',
    marginTop: 2,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(244,180,60,0.22)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,180,60,0.55)',
  },
  windowBadgeText: {
    color: PAPER,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  heroMeta: { color: 'rgba(244,239,230,0.88)', fontSize: 13, fontWeight: '600' },
  weatherChip: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,251,245,0.18)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,251,245,0.35)',
  },
  weatherChipText: {
    color: PAPER,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  priceBadge: {
    alignSelf: 'flex-start',
    marginTop: 6,
    backgroundColor: GOLD,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  priceBadgeNum: { color: FOREST, fontWeight: '800', fontSize: 18 },
  priceBadgeCap: { color: FOREST, fontWeight: '700', fontSize: 10, letterSpacing: 0.4 },
  intro: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 6,
    gap: 10,
    backgroundColor: 'rgba(243,235,224,0.72)',
  },
  offerChip: {
    alignSelf: 'flex-start',
    color: FOREST,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    borderWidth: 1,
    borderColor: 'rgba(26,46,40,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  introText: { color: INK, fontSize: 16, lineHeight: 24 },
  includes: { color: MUTED, fontSize: 13, lineHeight: 18 },
  section: { paddingHorizontal: 18, paddingTop: spacing.xl, gap: 10 },
  eyebrow: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  sectionTitle: { color: INK, fontSize: 24, fontWeight: '800', letterSpacing: -0.3, marginTop: -4 },
  muted: { color: MUTED, fontSize: 14, lineHeight: 20 },
  timeline: { gap: 0, marginTop: 6 },
  stepRow: { flexDirection: 'row', gap: 10, minHeight: 88 },
  stepRail: { width: 28, alignItems: 'center' },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: FOREST,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { color: GOLD, fontWeight: '800', fontSize: 10 },
  stepLine: {
    flex: 1,
    width: 1,
    backgroundColor: 'rgba(26,46,40,0.18)',
    marginTop: 4,
    marginBottom: 2,
  },
  stepCard: {
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(255,251,245,0.86)',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(26,46,40,0.08)',
  },
  stepImg: { width: 84, height: 84, backgroundColor: '#E7E0D4' },
  stepImgPh: { alignItems: 'center', justifyContent: 'center' },
  stepBody: { flex: 1, paddingVertical: 10, paddingRight: 10, gap: 3, minWidth: 0 },
  stepTitle: { color: INK, fontSize: 15, fontWeight: '800', lineHeight: 20 },
  stepDetail: { color: MUTED, fontSize: 13, lineHeight: 18 },
  stepMeta: { color: FOREST, fontSize: 12, fontWeight: '700' },
  stepLink: { color: GOLD, fontSize: 12, fontWeight: '800' },
  property: {
    backgroundColor: 'rgba(255,251,245,0.86)',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(26,46,40,0.08)',
  },
  propertyImg: { width: '100%', height: 200, backgroundColor: '#E7E0D4' },
  propertyBody: { padding: 16, gap: 6 },
  propertyTag: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  propertyName: { color: INK, fontSize: 20, fontWeight: '800', lineHeight: 26 },
  propertyPrice: { color: FOREST, fontSize: 15, fontWeight: '800' },
  propertyWhy: { color: MUTED, fontSize: 14, lineHeight: 20 },
  ghostBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderColor: FOREST,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  ghostBtnText: { color: FOREST, fontWeight: '800', fontSize: 13 },
  altList: { gap: 6, marginTop: 4 },
  altHead: { color: MUTED, fontSize: 12, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  altRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,251,245,0.86)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(26,46,40,0.08)',
    gap: 8,
  },
  altName: { flex: 1, color: INK, fontWeight: '700', fontSize: 14 },
  altFenster: { color: FOREST, fontWeight: '700', fontSize: 11, marginTop: 2 },
  altPrice: { color: FOREST, fontWeight: '800', fontSize: 13 },
  moment: {
    marginBottom: 14,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,251,245,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(26,46,40,0.08)',
  },
  momentMiss: { opacity: 0.72 },
  momentImg: { width: '100%', height: 210, backgroundColor: '#E7E0D4' },
  momentBody: { padding: 14, gap: 6 },
  momentTitle: { color: INK, fontSize: 18, fontWeight: '800' },
  momentBlurb: { color: INK, fontSize: 14, lineHeight: 21 },
  momentMeta: { color: FOREST, fontSize: 12, fontWeight: '800' },
  dayHint: { color: MUTED, fontSize: 13, marginBottom: 10, marginTop: -4 },
  mapPinRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  mapCanvas: {
    height: 168,
    borderRadius: 14,
    backgroundColor: '#1a2e28',
    marginBottom: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  mapCanvasGrid: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.22,
    backgroundColor: '#2a4a40',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  mapDot: {
    position: 'absolute',
    width: 26,
    height: 26,
    marginLeft: -13,
    marginTop: -13,
    borderRadius: 13,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: PAPER,
  },
  mapDotStay: {
    backgroundColor: '#4a7c6a',
    width: 28,
    height: 28,
    marginLeft: -14,
    marginTop: -14,
    borderRadius: 14,
  },
  mapDotText: {
    color: PAPER,
    fontWeight: '800',
    fontSize: 11,
  },
  mapLegend: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  mapPinChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(26,46,40,0.08)',
    maxWidth: '48%',
  },
  mapPinBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: FOREST,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPinBadgeText: { color: PAPER, fontWeight: '800', fontSize: 11 },
  mapPinLabel: { color: INK, fontWeight: '700', fontSize: 12, flexShrink: 1 },
  dayTabs: { marginBottom: 10, flexGrow: 0 },
  dayTabsInner: { paddingRight: 8, gap: 8, alignItems: 'stretch' },
  dayTab: {
    minWidth: 84,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(26,46,40,0.08)',
    marginRight: 0,
    gap: 2,
  },
  dayTabOn: { backgroundColor: FOREST },
  dayTabNum: {
    alignSelf: 'flex-start',
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: 'rgba(201,162,39,0.25)',
    marginBottom: 2,
  },
  dayTabNumText: { color: FOREST, fontWeight: '800', fontSize: 10 },
  dayTabText: { color: INK, fontWeight: '800', fontSize: 13 },
  dayTabTextOn: { color: PAPER },
  dayTabMeta: { color: MUTED, fontWeight: '600', fontSize: 11 },
  dayTabMetaOn: { color: 'rgba(255,251,245,0.78)' },
  dayBody: { gap: 0 },
  dayBodyHead: { color: INK, fontWeight: '800', fontSize: 16, marginBottom: 10 },
  dayBlock: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 4,
    minHeight: 56,
  },
  dayBlockRail: { width: 28, alignItems: 'center' },
  dayBlockNum: {
    color: FOREST,
    fontWeight: '800',
    fontSize: 11,
    backgroundColor: 'rgba(26,46,40,0.08)',
    overflow: 'hidden',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  dayBlockLine: {
    flex: 1,
    width: 2,
    backgroundColor: 'rgba(26,46,40,0.12)',
    marginTop: 4,
    minHeight: 12,
  },
  dayBlockMain: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,251,245,0.86)',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(26,46,40,0.08)',
    marginBottom: 8,
  },
  dayBlockTitle: { color: INK, fontWeight: '800', fontSize: 14 },
  dayBlockDetail: { color: MUTED, fontSize: 13, lineHeight: 18 },
  invoice: {
    backgroundColor: 'rgba(255,251,245,0.86)',
    borderRadius: 16,
    padding: 18,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(196,163,90,0.45)',
  },
  invoiceHero: { color: FOREST, fontSize: 28, fontWeight: '800' },
  invoiceSub: { color: MUTED, fontSize: 13 },
  invoiceRule: { height: 1, backgroundColor: 'rgba(26,46,40,0.12)', marginVertical: 6 },
  invoiceRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  invoiceLabel: { flex: 1, color: INK, fontSize: 13 },
  invoiceAmt: { color: FOREST, fontWeight: '800', fontSize: 13 },
  bookBtn: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: GOLD,
    marginBottom: 8,
  },
  bookBtnDone: { backgroundColor: 'rgba(61,207,122,0.35)' },
  bookBtnText: { color: FOREST, fontWeight: '800', fontSize: 15, textAlign: 'center' },
  bookBtnPrice: {
    color: FOREST,
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    opacity: 0.85,
  },
  textLink: { paddingVertical: 10, alignItems: 'center' },
  textLinkLabel: { color: FOREST, fontWeight: '800', fontSize: 14 },
  moreIdeas: { gap: 6, marginTop: 8 },
});
