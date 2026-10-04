# -*- coding: utf-8 -*-
"""Patch Live-HUD rain fact + kill soft pitches."""
from pathlib import Path
import re

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def patch_file(rel: str, replacer):
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    new = replacer(text)
    if new == text:
        raise SystemExit(f"no change: {rel}")
    tmp = ROOT / ".phone-check" / f"_patch_{path.name}"
    tmp.write_text(new, encoding="utf-8")
    path.unlink(missing_ok=True)
    tmp.replace(path)
    print("patched", rel)


def patch_proactive(text: str) -> str:
    # Block 1: primary rain tip from getWeatherHudLine
    old1 = """      if (line) {
        const rainingNow = /^(🌧\\s*)?Regen (jetzt|noch )/i.test(line);
        const soonClock = /^Regen ab /i.test(line);
        const mins = rainingNow
          ? 0
          : soonClock
            ? 90
            : st?.nextRainAtMs != null
              ? Math.round((st.nextRainAtMs - Date.now()) / 60_000)
              : 99;
        const soon = rainingNow || mins <= 30;
        tips.push({
          id: `rain-hud-${st?.nextRainAtMs ?? 'now'}`,
          kind: 'weather_rain',
          text: line.startsWith('🌧') ? line : `🌧 ${line}`,
          meta: rainingNow
            ? 'Aktuelle Dauer'
            : soon
              ? 'Schirm dabei?'
              : mins <= 90
                ? 'Bald nass'
                : undefined,
          tellMorePrompt: rainingNow
            ? 'Es regnet — Café oder Indoor in der Nähe mit Route.'
            : soon
              ? 'Regen bald — Café oder Indoor in der Nähe mit Route, und sag mir ob Schirm sinnvoll ist.'
              : `In etwa ${mins} Minuten könnte es regnen — was soll ich anpassen (Route, Indoor, Schirm)?`,
          score: rainingNow || mins <= 5 ? 95 : mins <= 30 ? 88 : mins <= 90 ? 74 : 60,
        });
      }"""
    new1 = """      if (line) {
        let rainingNow = false;
        try {
          const { isRainHudFallingLine } = require('../weather/rainIncomingPolicy') as {
            isRainHudFallingLine: (line: string) => boolean;
          };
          rainingNow = isRainHudFallingLine(line);
        } catch {
          rainingNow = /Aktuell|noch |bis /i.test(line) && /regen/i.test(line);
        }
        const soonClock = /Regen ab /i.test(line);
        const mins = rainingNow
          ? 0
          : soonClock
            ? 90
            : st?.nextRainAtMs != null
              ? Math.round((st.nextRainAtMs - Date.now()) / 60_000)
              : 99;
        tips.push({
          id: `rain-hud-${st?.nextRainAtMs ?? 'now'}`,
          kind: 'weather_rain',
          text: line.startsWith('🌧') ? line : `🌧 ${line}`,
          // Banner = Fakt only — kein Schirm/Indoor/Jacke oben.
          meta: undefined,
          tellMorePrompt: '__WEATHER_DAY_CHECK__',
          score: rainingNow || mins <= 5 ? 95 : mins <= 30 ? 88 : mins <= 90 ? 74 : 60,
        });
      }"""
    if old1 not in text:
        raise SystemExit("proactive block1 missing")
    text = text.replace(old1, new1, 1)

    old2 = """      if (line && /^(🌧\\s*)?Regen (jetzt|noch )/i.test(line)) {
        tips.push({
          id: 'rain-hud-now',
          kind: 'weather_rain',
          text: line.startsWith('🌧') ? line : `🌧 ${line}`,
          meta: 'Aktuelle Regendauer',
          tellMorePrompt: 'Es regnet — Café oder Indoor in der Nähe mit Route.',
          score: 95,
        });
      }"""
    new2 = """      let rainingNow = /Aktuell|noch |bis /i.test(line) && /regen/i.test(line);
      try {
        const { isRainHudFallingLine } = require('../weather/rainIncomingPolicy') as {
          isRainHudFallingLine: (line: string) => boolean;
        };
        rainingNow = isRainHudFallingLine(line);
      } catch {
        /* soft */
      }
      if (line && rainingNow) {
        tips.push({
          id: 'rain-hud-now',
          kind: 'weather_rain',
          text: line.startsWith('🌧') ? line : `🌧 ${line}`,
          meta: undefined,
          tellMorePrompt: '__WEATHER_DAY_CHECK__',
          score: 95,
        });
      }"""
    if old2 not in text:
        raise SystemExit("proactive block2 missing")
    text = text.replace(old2, new2, 1)

    old3 = """      if (line) {
        const rainingNow = /^(🌧\\s*)?Regen (jetzt|noch )/i.test(line);
        const mins =
          !rainingNow && weather.nextRainAtMs != null
            ? Math.round((weather.nextRainAtMs - Date.now()) / 60_000)
            : rainingNow
              ? 0
              : 99;
        const soon = rainingNow || mins <= 30;
        tips.push({
          id: `rain-${weather.nextRainAtMs ?? 'now'}`,
          kind: 'weather_rain',
          text: `🌧 ${line}${
            !rainingNow && weather.nextRainAtMs != null
              ? ` (${formatClock(weather.nextRainAtMs)})`
              : ''
          }`,
          meta: soon
            ? 'Schirm/Indoor?'
            : weather.nextRainAtMs != null
              ? `Ab ~${formatClock(weather.nextRainAtMs)} · Schirm?`
              : undefined,
          tellMorePrompt: rainingNow
            ? 'Es regnet — Café oder Indoor in der Nähe mit Route.'
            : soon
              ? 'Regen bald — Café oder Indoor in der Nähe mit Route.'
              : `In etwa ${mins} Minuten Regen möglich — Schirm/Jacke oder Plan anpassen?`,
          score: rainingNow || mins <= 5 ? 95 : soon ? 84 : 72,
        });
      }"""
    new3 = """      if (line) {
        let rainingNow = false;
        try {
          const { isRainHudFallingLine } = require('../weather/rainIncomingPolicy') as {
            isRainHudFallingLine: (line: string) => boolean;
          };
          rainingNow = isRainHudFallingLine(line);
        } catch {
          rainingNow = /Aktuell|noch |bis /i.test(line) && /regen/i.test(line);
        }
        const mins =
          !rainingNow && weather.nextRainAtMs != null
            ? Math.round((weather.nextRainAtMs - Date.now()) / 60_000)
            : rainingNow
              ? 0
              : 99;
        const soon = rainingNow || mins <= 30;
        tips.push({
          id: `rain-${weather.nextRainAtMs ?? 'now'}`,
          kind: 'weather_rain',
          text: `🌧 ${line}`,
          meta: undefined,
          tellMorePrompt: '__WEATHER_DAY_CHECK__',
          score: rainingNow || mins <= 5 ? 95 : soon ? 84 : 72,
        });
      }"""
    if old3 not in text:
        raise SystemExit("proactive block3 missing")
    text = text.replace(old3, new3, 1)

    old4 = """    if (t.id === 'lunch_nearby' || t.id === 'dinner_reservation') return false;
    return true;"""
    new4 = """    if (t.id === 'lunch_nearby' || t.id === 'dinner_reservation') return false;
    // Kein Soft-Pitch oben: Regen→Indoor / Profil-Burger
    if (t.id === 'sudden_rain_indoor' || t.id === 'profile_burger') return false;
    return true;"""
    if old4 not in text:
        raise SystemExit("proactive block4 missing")
    text = text.replace(old4, new4, 1)
    return text


def patch_live_hud(text: str) -> str:
    old_tip = """      : tip.kind === 'weather_rain'
        ? 'Regen-Hinweis: Schirm/Jacke oder Indoor/Café mit Route — was hilft mir jetzt?'
        : `Hinweis „${tip.text}“ — hilft mir das? Wenn ja, setz es konkret um (Route, Reminder oder nächster Schritt).`;"""
    new_tip = """      : tip.kind === 'weather_rain'
        ? '__WEATHER_DAY_CHECK__'
        : `Hinweis „${tip.text}“ — hilft mir das? Wenn ja, setz es konkret um (Route, Reminder oder nächster Schritt).`;"""
    if old_tip not in text:
        raise SystemExit("liveHud tipToCard missing")
    text = text.replace(old_tip, new_tip, 1)

    # Drop soft dinner card from idle priority slot
    old_dinner = """  // Konkrete Gastro-Treffer (Cache) — unabhängig vom Theme-Mix
  if (allowActivitySoftTips(nowMs)) push(dinnerCard(nowMs));

  // Utility-Tipps zuerst"""
    new_dinner = """  // Kein Soft-Gastro („Hunger?“ / Burgerlokal) im Live-Banner.

  // Utility-Tipps zuerst"""
    if old_dinner not in text:
        raise SystemExit("liveHud dinner push missing")
    text = text.replace(old_dinner, new_dinner, 1)

    # Skip duplicate rain tips + soft rain/burger advice tips
    old_util = """  for (const tip of utilityTips) {
    if (tip.id.startsWith('wx-')) continue;
    // Parken schon als parkingCard
    if (tip.kind === 'parking_ticket' && seen.has('parking-spot')) continue;
    push(tipToCard(tip));
    if (cards.length >= MAX_IDLE_CARDS) break;
  }"""
    new_util = """  for (const tip of utilityTips) {
    if (tip.id.startsWith('wx-')) continue;
    // Parken schon als parkingCard
    if (tip.kind === 'parking_ticket' && seen.has('parking-spot')) continue;
    // Wetter-Karte ist SSOT — kein zweites Regen-Banner mit Soft-Meta
    if (tip.kind === 'weather_rain' && seen.has('weather-live')) continue;
    // Keine Soft-Ratschläge oben (Jacke/Indoor/Burger)
    if (
      tip.kind === 'umbrella_day' ||
      /Jacke mitnehmen|Regen möglich|Regen → Indoor|Burger lokal|Hunger\\?/i.test(
        tip.text,
      )
    ) {
      continue;
    }
    push(tipToCard(tip));
    if (cards.length >= MAX_IDLE_CARDS) break;
  }"""
    if old_util not in text:
        raise SystemExit("liveHud utility loop missing")
    text = text.replace(old_util, new_util, 1)

    # Theme dinner also off
    text = text.replace(
        "  if (themes.has('dinner')) push(dinnerCard(nowMs));\n",
        "  // Soft-Gastro-Theme absichtlich stumm (kein Hunger?/Burger-Pitch).\n",
        1,
    )
    return text


def patch_nice(text: str) -> str:
    # Umbrella: fact only
    old_u = """        text: `🌂 Regen ab ~${new Date(weather.nextRainAtMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`,
        meta: 'Schirm einpacken?',
        tellMorePrompt:
          'Später Regen möglich — kurz sagen ob Schirm/Jacke sinnvoll ist, ohne Panik.',"""
    new_u = """        text: `🌂 Regen ab ~${new Date(weather.nextRainAtMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`,
        meta: undefined,
        tellMorePrompt: '__WEATHER_DAY_CHECK__',"""
    if old_u not in text:
        raise SystemExit("nice umbrella missing")
    text = text.replace(old_u, new_u, 1)

    old_if = """    if (
      (typeof precip === 'number' && precip >= 45) ||
      (typeof high === 'number' && (high <= 10 || high >= 28))
    ) {
      tips.push({
        id: `outfit-${dayKey}`,
        kind: 'nice_tip',
        text:
          typeof high === 'number' && high >= 28
            ? '👕 Heiß — luftig + Sonnenschutz'
            : typeof precip === 'number' && precip >= 45
              ? '🧥 Regen möglich — Jacke mitnehmen'
              : '🧥 Cooler Tag — Schicht empfohlen',
        meta: weather.summaryLine?.slice(0, 40) || 'Wetter',
        tellMorePrompt:
          'Kurzer Kleidungs-Tipp für heute aus dem Wetter, ohne Vorlesung.',
        score: 60,
      });
"""
    new_block = """    const outfitText =
      typeof high === 'number' && high >= 28
        ? '👕 Heiß — luftig + Sonnenschutz'
        : typeof high === 'number' && high <= 10
          ? '🧥 Cooler Tag — Schicht empfohlen'
          : null; // Regen → weatherCard (Fakt), kein Jacke-Ratschlag im Banner
    if (outfitText) {
      tips.push({
        id: `outfit-${dayKey}`,
        kind: 'nice_tip',
        text: outfitText,
        meta: weather.summaryLine?.slice(0, 40) || 'Wetter',
        tellMorePrompt:
          'Kurzer Kleidungs-Tipp für heute aus dem Wetter, ohne Vorlesung.',
        score: 60,
      });
"""
    if old_if not in text:
        raise SystemExit("nice outfit if missing")
    text = text.replace(old_if, new_block, 1)
    return text


def patch_weather_speech(text: str) -> str:
    old = """    (!rainHud || !/^Regen (jetzt|noch |in )/i.test(rainHud))"""
    new = """    (!rainHud || !/^(Aktuell\\s+)?(Starker\\s+|Leichter\\s+)?Regen(\\s+(jetzt|noch |in |bis )|$)/i.test(rainHud))"""
    if old not in text:
        raise SystemExit("weatherDayPlanSpeech regex missing")
    return text.replace(old, new, 1)


def patch_smokes_rain(text: str) -> str:
    # Add intensity assertions at end before console if present
    return text


patch_file("src/services/ui/proactiveHudEngine.ts", patch_proactive)
patch_file("src/services/ui/liveHudCards.ts", patch_live_hud)
patch_file("src/services/ui/niceInfoScenarios.ts", patch_nice)
patch_file("src/services/ui/weatherDayPlanSpeech.ts", patch_weather_speech)
print("all ok")
