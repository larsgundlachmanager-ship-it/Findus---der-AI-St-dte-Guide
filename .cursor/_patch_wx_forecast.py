# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\agents\umweltAgent.ts")
text = p.read_text(encoding="utf-8")

old1 = """    let tomorrowSummary: string | null = null;
    let weatherCode: number | null = null;
    try {
      const snap = await ensureWeatherFresh(
        'force',
        a ? { lat: a.lat, lng: a.lng } : null,
        { userAsked: true },
      );
      refreshRucksackWeather();
      summary = snap?.summaryLine ?? null;
      tomorrowSummary = snap?.tomorrowSummary?.trim() || null;
      weatherCode = snap?.weatherCode ?? null;"""

new1 = """    let tomorrowSummary: string | null = null;
    let day2Summary: string | null = null;
    let windSpeedMs: number | null = null;
    let windGustMs: number | null = null;
    let weatherCode: number | null = null;
    try {
      const snap = await ensureWeatherFresh(
        'force',
        a ? { lat: a.lat, lng: a.lng } : null,
        { userAsked: true },
      );
      refreshRucksackWeather();
      summary = snap?.summaryLine ?? null;
      tomorrowSummary = snap?.tomorrowSummary?.trim() || null;
      day2Summary =
        (snap as { day2Summary?: string | null } | null)?.day2Summary?.trim() ||
        null;
      const windSnap = snap as {
        windSpeedMs?: number | null;
        windGustMs?: number | null;
      } | null;
      windSpeedMs =
        typeof windSnap?.windSpeedMs === 'number' ? windSnap.windSpeedMs : null;
      windGustMs =
        typeof windSnap?.windGustMs === 'number' ? windSnap.windGustMs : null;
      weatherCode = snap?.weatherCode ?? null;"""

if old1 not in text:
    raise SystemExit("block1 not found")
text = text.replace(old1, new1, 1)

old2 = """    const futureDay = /\\b(morgen|übermorgen|uebermorgen)\\b/iu.test(
      task.rewrittenText,
    );
    const plan = planEveningHint();
    const windyWater =
      /\\b(wind|wasser|förde|foerde|strand|elbe|meer|küste|kueste)\\b/i.test(
        task.rewrittenText,
      );"""

new2 = """    const futureDay = /\\b(morgen|übermorgen|uebermorgen)\\b/iu.test(
      task.rewrittenText,
    );
    const wantsOutfitEarly =
      /\\b(anzieh|outfit|kleidung|jacke|pulli|hose)\\b/i.test(task.rewrittenText);
    const rainFocusAsk =
      /\\b(regnet|regnen|regen|schauer|schirm)\\b/iu.test(task.rewrittenText) &&
      !/\\bwettervorhersage\\b/iu.test(task.rewrittenText);
    const immediateAsk =
      /\\b(jetzt|gerade|im moment|momentan|aktuell)\\b/iu.test(task.rewrittenText);
    const generalForecast =
      !wantsOutfitEarly &&
      !rainFocusAsk &&
      !immediateAsk &&
      !futureDay &&
      /\\b(wetter|wettervorhersage|wie\\s+(?:wird|ist)\\s+(?:das\\s+)?wetter|wochenende)\\b/iu.test(
        task.rewrittenText,
      );
    const plan = planEveningHint();
    const windyWater =
      /\\b(wind|wasser|förde|foerde|strand|elbe|meer|küste|kueste)\\b/i.test(
        task.rewrittenText,
      ) ||
      (typeof windSpeedMs === 'number' && windSpeedMs >= 8) ||
      (typeof windGustMs === 'number' && windGustMs >= 12);"""

if old2 not in text:
    raise SystemExit("block2 not found")
text = text.replace(old2, new2, 1)

old3 = """    const wantsOutfit =
      /\\b(anzieh|outfit|kleidung|jacke|pulli|hose)\\b/i.test(task.rewrittenText);

    const draft = [
      'FAKTEN Umwelt (nicht wörtlich vorlesen):',
      dest ? `Ort-Kontext: ${dest}` : null,
      futureDay && tomorrowSummary
        ? `Morgen-Vorhersage (belegt): ${tomorrowSummary}`
        : summary
          ? `Wetter-Summary: ${summary}`
          : null,
      !futureDay && nowTemp != null
        ? `Jetzt ~${Math.round(Number(nowTemp))} °C`
        : null,
      !futureDay && dayHigh != null
        ? `Tageshoch bis Abend ~${Math.round(dayHigh)} °C`
        : null,
      weatherCode != null ? `Wettercode: ${weatherCode}` : null,"""

new3 = """    const wantsOutfit = wantsOutfitEarly;

    const draft = [
      'FAKTEN Umwelt (nicht wörtlich vorlesen):',
      dest ? `Ort-Kontext: ${dest}` : null,
      futureDay && tomorrowSummary
        ? `Morgen-Vorhersage (belegt): ${tomorrowSummary}`
        : summary
          ? `Wetter-Summary: ${summary}`
          : null,
      generalForecast && tomorrowSummary
        ? `Morgen (belegt): ${tomorrowSummary}`
        : null,
      generalForecast && day2Summary
        ? `Übermorgen/Tag+2 (belegt): ${day2Summary}`
        : null,
      typeof windSpeedMs === 'number'
        ? `Wind ~${Math.round(windSpeedMs)} m/s${
            typeof windGustMs === 'number'
              ? `, Böen ~${Math.round(windGustMs)} m/s`
              : ''
          }`
        : null,
      !futureDay && nowTemp != null
        ? `Jetzt ~${Math.round(Number(nowTemp))} °C`
        : null,
      !futureDay && dayHigh != null
        ? `Tageshoch bis Abend ~${Math.round(dayHigh)} °C`
        : null,
      weatherCode != null ? `Wettercode: ${weatherCode}` : null,"""

if old3 not in text:
    raise SystemExit("block3 not found")
text = text.replace(old3, new3, 1)

old4 = """      wantsOutfit
        ? targetHour != null
          ? `1) Konkrete Kleidung ZUERST — für ca. ${String(targetHour).padStart(2, '0')}:00, am belegten Trend.`
          : '1) Konkrete Kleidung ZUERST — am Jetzt + Tageshoch ausrichten.'
        : futureDay
          ? '1) Morgen: Himmel (Sonne/Wolken), Temperatur von–bis, Regenrisiko — locker erzählen.'
          : '1) Himmel + Temperatur (Jetzt/Spitze) + wann Regen — locker erzählen.',
      wantsOutfit
        ? '2) Wetter kurz als Begründung — Kleidung im Fließtext weben, keine Parenthesen/Meta-Klammern.'
        : '2) Ein Kleidungstipp im Fließtext hinten (bei Nässe Jacke/Schirm); Jacke nicht erzwingen wenn mild/trocken; keine (…)-Klammern.',"""

new4 = """      wantsOutfit
        ? targetHour != null
          ? `1) Konkrete Kleidung ZUERST — für ca. ${String(targetHour).padStart(2, '0')}:00, am belegten Trend.`
          : '1) Konkrete Kleidung ZUERST — am Jetzt + Tageshoch ausrichten.'
        : generalForecast
          ? '1) ALLGEMEINE VORHERSAGE (Radio-Stil, 2–3 Fließsätze): Himmel über heute/morgen/Tag+2 kontrastieren (gleiche Tage bündeln); Schauer den betroffenen Tagen zuordnen; Wind nur wenn belegt+spürbar; Höchstwerte am Ende weben. Kein Telegramm, kein Prozent-Dump, keine Kleidung in Speech.'
          : futureDay
            ? '1) Morgen: Himmel (Sonne/Wolken), Temperatur von–bis, Regenrisiko — locker erzählen.'
            : '1) Himmel + Temperatur (Jetzt/Spitze) + wann Regen — locker erzählen.',
      wantsOutfit
        ? '2) Wetter kurz als Begründung — Kleidung im Fließtext weben, keine Parenthesen/Meta-Klammern.'
        : generalForecast
          ? '2) Kein Outfit-Essay in Speech — Outfit nur als UI-Chip.'
          : '2) Ein Kleidungstipp im Fließtext hinten (bei Nässe Jacke/Schirm); Jacke nicht erzwingen wenn mild/trocken; keine (…)-Klammern.',"""

if old4 not in text:
    raise SystemExit("block4 not found")
text = text.replace(old4, new4, 1)

with p.open("r+", encoding="utf-8", newline="\n") as f:
    f.seek(0)
    f.write(text)
    f.truncate()
print("umweltAgent patched ok")
