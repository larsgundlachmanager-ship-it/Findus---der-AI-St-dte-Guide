/**
 * Stadtauswahl: Suche oben (über der Tastatur), Hero nur ohne Tastatur.
 * Katalog/GPS werden früher gewärmt, damit kein sichtbarer Resort-Sprung entsteht.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  OnboardingShell,
  PrimaryButton,
  SecondaryButton,
  StepTitle,
} from './OnboardingUI';
import { colors, spacing } from '../constants/theme';
import { useKeyboardInset } from '../hooks/useKeyboardInset';
import { CityCatalogCard } from '../components/CityCatalogCard';
import { t, type AppLanguage } from '../i18n';
import {
  getWarmCityCatalogGpsStatus,
  installCityPack,
  peekWarmCityCatalog,
  resortCatalogByCoords,
  warmCityCatalogForOnboarding,
  type CityCatalogItem,
} from '../services/cityCatalogService';
import { citiesForPickerGrid } from '../services/citySearch';
import { getCurrentCoords } from '../services/locationService';

type Props = {
  lang: AppLanguage;
  selectedId: string | null;
  onSelect: (id: string, name: string) => void;
  onNext: (city: { cityId: string; cityName: string }) => void;
};

export function CityStep({ lang, selectedId, onSelect, onNext }: Props) {
  const warmed = peekWarmCityCatalog();
  const [cities, setCities] = useState<CityCatalogItem[]>(warmed ?? []);
  const [loading, setLoading] = useState(!warmed?.length);
  const [gpsStatus, setGpsStatus] = useState<
    'pending' | 'ready' | 'unavailable'
  >(warmed?.length ? getWarmCityCatalogGpsStatus() : 'pending');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const kbInset = useKeyboardInset();
  const nearestAutoPicked = useRef(!!selectedId);
  const scrollRef = useRef<ScrollView>(null);
  const keyboardUp = kbInset > 80 || searchFocused;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const peeked = peekWarmCityCatalog();
      const forceReload = reloadToken > 0;
      if (!peeked?.length || forceReload) {
        setLoading(true);
        setGpsStatus('pending');
      } else {
        // Intro-/Mount-Warmup schon da → sofort anzeigen, kein Force-Reload
        setCities(peeked);
        setGpsStatus(getWarmCityCatalogGpsStatus());
        setLoading(false);
      }
      setLoadError(null);

      try {
        const catalog = await warmCityCatalogForOnboarding({
          force: forceReload,
        });
        if (cancelled) return;
        setCities(catalog);
        setGpsStatus(getWarmCityCatalogGpsStatus());
        setLoading(false);

        if (catalog.length === 0) {
          setLoadError(t(lang, 'noCitiesHint'));
        }

        // Später GPS-Nachzug nur still, falls Warmup noch pending war
        if (getWarmCityCatalogGpsStatus() === 'pending') {
          const coords = await getCurrentCoords({ timeoutMs: 8000 });
          if (cancelled) return;
          if (coords) {
            setCities((prev) => resortCatalogByCoords(prev, coords));
            setGpsStatus('ready');
          } else {
            setGpsStatus('unavailable');
          }
        }
      } catch (err) {
        console.warn('[CityStep]', err);
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
          setLoading(false);
          setGpsStatus('unavailable');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lang, reloadToken]);

  // Nächste Stadt vorauswählen — still, sobald Liste da ist
  useEffect(() => {
    if (nearestAutoPicked.current || loading || cities.length === 0) return;
    if (gpsStatus === 'pending') return;
    const nearest = cities[0];
    if (!nearest) return;
    if (!selectedId) {
      onSelect(nearest.id, nearest.name);
    }
    nearestAutoPicked.current = true;
  }, [cities, gpsStatus, loading, onSelect, selectedId]);

  const searching = query.trim().length > 0;
  const nearest = !searching ? cities[0] ?? null : null;
  const selected = cities.find((c) => c.id === selectedId) ?? null;

  /** Oben immer die Auswahl mit Stats; sonst nächste Stadt. */
  const featured = selected ?? nearest;
  const featuredIsNearest = !!(
    featured &&
    nearest &&
    featured.id === nearest.id
  );

  /** Ohne Suche: max. 8 Nächste; mit Suche: Treffer (Tippfehler/Land/Region). */
  const gridCities = useMemo(
    () =>
      citiesForPickerGrid(cities, {
        excludeId: searching ? null : featured?.id ?? null,
        query,
      }),
    [cities, featured?.id, query, searching],
  );

  const pickCity = (id: string, name: string) => {
    onSelect(id, name);
    setQuery('');
    setSearchFocused(false);
    Keyboard.dismiss();
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  };

  const handleContinue = async () => {
    if (!selected) return;
    onSelect(selected.id, selected.name);
    void installCityPack(selected.id, { checkRemote: true, reason: 'install' })
      .then((result) => {
        if (__DEV__) {
          console.log(
            `[CityStep] background pack ${result.poiCount} POIs / ${result.factCount} facts`,
          );
        }
      })
      .catch((err) => {
        console.warn('[CityStep] Hintergrund-Download:', err);
      });
    onNext({
      cityId: selected.id,
      cityName: selected.name,
    });
  };

  const showHero = !!(featured && !searching && !keyboardUp);

  return (
    <OnboardingShell style={keyboardUp ? styles.shellKb : undefined}>
      <StepTitle>{t(lang, 'cityTitle')}</StepTitle>
      {!loading ? (
        <Text style={styles.gpsStatus}>
          {gpsStatus === 'pending'
            ? t(lang, 'locatingGps')
            : gpsStatus === 'ready'
              ? t(lang, 'gpsReady')
              : t(lang, 'gpsUnavailable')}
        </Text>
      ) : null}

      {loading ? (
        <Text style={styles.muted}>{t(lang, 'loadingCities')}</Text>
      ) : cities.length === 0 ? (
        <View style={styles.emptyCities}>
          <Text style={styles.emptyTitle}>{t(lang, 'noCities')}</Text>
          <Text style={styles.muted}>
            {loadError ?? t(lang, 'noCitiesHint')}
          </Text>
          <SecondaryButton
            label={t(lang, 'retryCities')}
            onPress={() => setReloadToken((n) => n + 1)}
          />
        </View>
      ) : (
        <>
          <Text style={styles.sectionLabel}>{t(lang, 'citySearchTitle')}</Text>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder={t(lang, 'citySearchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
            blurOnSubmit
          />

          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[
              styles.scrollPad,
              kbInset > 0 && { paddingBottom: kbInset + spacing.md },
            ]}
          >
            {featured && showHero ? (
              <>
                <Text style={styles.sectionLabel}>
                  {selected && !featuredIsNearest
                    ? 'Ausgewählt'
                    : t(lang, 'nearby')}
                </Text>
                <CityCatalogCard
                  city={featured}
                  lang={lang}
                  selected={selectedId === featured.id}
                  variant="hero"
                  onPress={() => pickCity(featured.id, featured.name)}
                />
              </>
            ) : null}

            <Text style={styles.sectionLabel}>
              {searching
                ? gridCities.length > 0
                  ? `${gridCities.length} ${t(lang, 'citySearchHits')}`
                  : t(lang, 'citySearchNoHits')
                : t(lang, 'otherCities')}
            </Text>

            <View style={styles.grid}>
              {gridCities.map((c) => (
                <View key={c.id} style={styles.gridItem}>
                  <CityCatalogCard
                    city={c}
                    lang={lang}
                    selected={selectedId === c.id}
                    variant="grid"
                    onPress={() => pickCity(c.id, c.name)}
                  />
                </View>
              ))}
            </View>
          </ScrollView>
        </>
      )}

      {keyboardUp ? null : (
        <PrimaryButton
          label={
            selected
              ? `${t(lang, 'continueWith')} ${selected.name}`.trim()
              : 'Stadt wählen'
          }
          onPress={() => void handleContinue()}
          disabled={!selected}
        />
      )}
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  shellKb: { paddingBottom: spacing.sm },
  scroll: { flex: 1 },
  scrollPad: { paddingBottom: spacing.md, gap: spacing.sm },
  gpsStatus: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  muted: { color: colors.textMuted, fontSize: 13 },
  emptyCities: { gap: spacing.sm, marginVertical: spacing.lg },
  emptyTitle: { color: colors.text, fontWeight: '700', fontSize: 16 },
  sectionLabel: {
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 11,
    marginBottom: 4,
    marginTop: 4,
  },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.text,
    backgroundColor: colors.surface,
    fontSize: 15,
    marginTop: 2,
    marginBottom: spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  gridItem: {
    width: '48%',
    flexGrow: 1,
    maxWidth: '48%',
  },
});
