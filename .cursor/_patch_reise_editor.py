# Patch AktuelleReiseEditor: Anreise multi + In-Stadt multi + party emojis
from pathlib import Path

p = Path(r"C:\Users\larsf\Findus 2.0\src\components\settings\AktuelleReiseEditor.tsx")
t = p.read_text(encoding="utf-8")

# imports
if "TRAVEL_MODE_OPTIONS" not in t:
    t = t.replace(
        """import {
  BUDGET_OPTIONS,
  ENERGY_OPTIONS,
  MOBILITY_OPTIONS,
  MUST_HAVE_STYLE_OPTIONS,
  patchFromMustHaveStyles,
  patchFromTourLength,
  TOUR_LENGTH_OPTIONS,
  TRAVEL_PARTY_OPTIONS,
} from '../../constants/conciergePrefs';""",
        """import {
  BUDGET_OPTIONS,
  ENERGY_OPTIONS,
  MOBILITY_OPTIONS,
  MUST_HAVE_STYLE_OPTIONS,
  patchFromMustHaveStyles,
  patchFromTourLength,
  TOUR_LENGTH_OPTIONS,
  TRAVEL_MODE_EMOJI,
  TRAVEL_MODE_OPTIONS,
  TRAVEL_PARTY_EMOJI,
  TRAVEL_PARTY_OPTIONS,
  type TravelModeId,
} from '../../constants/conciergePrefs';""",
    )

# after mustHaves line, ensure cityModes / travelModes helpers exist
if "toggleCityMobility" not in t:
    anchor = "  const mustHaves = draft.mustHaveStyles ?? [];\n  const periodPreset = matchTravelPeriodPreset(draft.travelPeriod);"
    insert = """  const mustHaves = draft.mustHaveStyles ?? [];
  const periodPreset = matchTravelPeriodPreset(draft.travelPeriod);
  const travelModes = draft.travelModes ?? [];
  const cityModes: MobilityMode[] =
    draft.cityMobilityModes?.length
      ? draft.cityMobilityModes
      : draft.mobilityMode
        ? [draft.mobilityMode]
        : [];

  const toggleTravelMode = (id: TravelModeId) => {
    const next = travelModes.includes(id)
      ? travelModes.filter((x) => x !== id)
      : [...travelModes, id];
    onChange({ travelModes: next });
  };

  const toggleCityMobility = (id: MobilityMode) => {
    const next = cityModes.includes(id)
      ? cityModes.filter((x) => x !== id)
      : [...cityModes, id];
    onChange({
      cityMobilityModes: next,
      mobilityMode: next[0] ?? null,
    });
  };"""
    if anchor not in t:
        raise SystemExit("anchor for helpers not found")
    t = t.replace(anchor, insert)

# party chips with emoji
old_party = """        <EqualChipRow count={TRAVEL_PARTY_OPTIONS.length}>
          {TRAVEL_PARTY_OPTIONS.map((o) => {
            const on = draft.travelParty === o.id;
            return (
              <Pressable
                key={o.id}
                onPress={() => onChange({ travelParty: o.id as TravelParty })}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={styles.chipLabel}>{o.label}</Text>
              </Pressable>
            );
          })}
        </EqualChipRow>"""

new_party = """        <EqualChipRow count={TRAVEL_PARTY_OPTIONS.length}>
          {TRAVEL_PARTY_OPTIONS.map((o) => {
            const on = draft.travelParty === o.id;
            const emoji = TRAVEL_PARTY_EMOJI[o.id as TravelParty] ?? '';
            return (
              <Pressable
                key={o.id}
                onPress={() => onChange({ travelParty: o.id as TravelParty })}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={styles.chipLabel}>
                  {emoji ? `${emoji} ` : ''}
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </EqualChipRow>"""

if old_party not in t:
    raise SystemExit("party block not found")
t = t.replace(old_party, new_party)

old_mob = """      <View style={styles.group}>
        <Text style={styles.label}>
          Wie bewegst du dich in der Stadt während der aktuellen Reise?
        </Text>
        <Text style={styles.hint}>
          Deine Präferenz — plus, womit du gerade unterwegs bist.
        </Text>
        <ChipRow
          options={MOBILITY_OPTIONS}
          value={draft.mobilityMode}
          onSelect={(mobilityMode: MobilityMode) => onChange({ mobilityMode })}
        />
        <Text style={[styles.subLabel, { marginTop: spacing.sm }]}>
          Jetzt unterwegs mit
        </Text>
        <TravelModeSelector />
      </View>"""

new_mob = """      <View style={styles.group}>
        <Text style={styles.label}>Wie kommst du zur Stadt?</Text>
        <Text style={styles.hint}>Mehrfachauswahl — Anreise / Ankunft.</Text>
        <EqualChipRow count={TRAVEL_MODE_OPTIONS.length}>
          {TRAVEL_MODE_OPTIONS.map((o) => {
            const on = travelModes.includes(o.id);
            const emoji = TRAVEL_MODE_EMOJI[o.id] ?? '';
            return (
              <Pressable
                key={o.id}
                onPress={() => toggleTravelMode(o.id)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={styles.chipLabel}>
                  {emoji ? `${emoji} ` : ''}
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </EqualChipRow>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>
          Wie bewegst du dich in der Stadt?
        </Text>
        <Text style={styles.hint}>
          Mehrfachauswahl — plus, womit du gerade unterwegs bist.
        </Text>
        <EqualChipRow count={MOBILITY_OPTIONS.length}>
          {MOBILITY_OPTIONS.map((o) => {
            const on = cityModes.includes(o.id);
            return (
              <Pressable
                key={o.id}
                onPress={() => toggleCityMobility(o.id)}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={styles.chipLabel}>{o.label}</Text>
                {o.hint ? <Text style={styles.chipHint}>{o.hint}</Text> : null}
              </Pressable>
            );
          })}
        </EqualChipRow>
        <Text style={[styles.subLabel, { marginTop: spacing.sm }]}>
          Jetzt unterwegs mit
        </Text>
        <TravelModeSelector />
      </View>"""

if old_mob not in t:
    raise SystemExit("mobility block not found")
t = t.replace(old_mob, new_mob)

p.write_text(t, encoding="utf-8")
print("AktuelleReiseEditor OK")
