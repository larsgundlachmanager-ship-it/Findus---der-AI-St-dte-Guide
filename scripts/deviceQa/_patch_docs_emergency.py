#!/usr/bin/env python3
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\concierge\emergencyConcierge.ts")
t = p.read_text(encoding="utf-8")

if "DOCS_LOST_RE" not in t:
    needle = (
        "const LOST_RE =\n"
        "  /\\b(verloren|verlaufen|verirrt|ich\\s+(find|finde)\\s+(den\\s+weg\\s+)?nicht|"
        "ich\\s+hab\\s+mich\\s+(verlaufen|verirrt|verloren)|bin\\s+ich\\s+verloren|lost)\\b/iu;\n\n"
        "const FOOT_RE ="
    )
    # read exact LOST_RE from file
    i = t.find("const LOST_RE =")
    j = t.find("const FOOT_RE =", i)
    if i < 0 or j < 0:
        raise SystemExit(f"markers missing i={i} j={j}")
    insert = (
        t[i:j]
        + "/** Reisepass / Ausweis / Konsulat — VOR person-lost. */\n"
        + "const DOCS_LOST_RE =\n"
        + "  /\\b(reisepass|pass(?:wort)?|ausweis|personalausweis|konsulat|botschaft|"
        + "auslandsvertretung|portemonnaie|geldbeutel|kreditkarte|geklaut|gestohlen)\\b/iu;\n\n"
    )
    t = t[:i] + insert + t[j:]
    print("added DOCS_LOST_RE")
else:
    print("DOCS_LOST_RE exists")

if "return 'docs'" not in t:
    t = t.replace(
        "  if (ILL_RE.test(t) && HELP_FAST_RE.test(t)) return 'doctor';\n"
        "  if (LOST_RE.test(t)) return 'lost';\n"
        "  return null;\n"
        "}",
        "  if (ILL_RE.test(t) && HELP_FAST_RE.test(t)) return 'doctor';\n"
        "  if (DOCS_LOST_RE.test(t)) return 'docs';\n"
        "  if (LOST_RE.test(t)) return 'lost';\n"
        "  return null;\n"
        "}",
        1,
    )
    print("added detect docs")
else:
    print("detect docs exists")

marker = "  // Lost without GPS → hotel if known, else calm tip\n  if (kind === 'lost') {"
if "kind === 'docs'" not in t and marker in t:
    docs = '''  // Reisepass / Konsulat — nie Orientierungs-Lost / Heimatverein
  if (kind === 'docs') {
    let top: DiscoveryCandidate | null = null;
    if (origin) {
      try {
        const expanded = await searchPlacesExpanding({
          lat: origin.lat,
          lng: origin.lng,
          placeType: 'embassy',
          keyword: 'Konsulat Botschaft Auslandsvertretung',
          openNow: false,
          minResults: 1,
          rings: [15_000, 40_000, 80_000],
          fallbackTypes: ['local_government_office', 'city_hall'],
        });
        const ranked = [...expanded.places]
          .filter((pl) => {
            const blob = `${pl.name ?? ''}`.toLowerCase();
            return !/heimatverein|museum|verein\\b|kirche\\b/.test(blob);
          })
          .sort((a, b) => {
            const da = distanceMeters(origin.lat, origin.lng, a.lat, a.lng);
            const db = distanceMeters(origin.lat, origin.lng, b.lat, b.lng);
            return da - db;
          });
        if (ranked[0]) {
          const pl = ranked[0];
          top = {
            name: pl.name || 'Auslandsvertretung',
            lat: pl.lat,
            lng: pl.lng,
            distanceM: distanceMeters(origin.lat, origin.lng, pl.lat, pl.lng),
            phoneNumber: pl.phoneNumber ?? null,
            openNow: pl.openNow ?? null,
            websiteUri: pl.websiteUri ?? null,
          } as DiscoveryCandidate;
        }
      } catch {
        /* soft */
      }
    }
    const bullets: string[] = [];
    const actions: QuickAction[] = [dialSos];
    let speech = '';
    if (top) {
      const km =
        typeof top.distanceM === 'number'
          ? Math.round(top.distanceM / 100) / 10
          : null;
      bullets.push(top.name);
      if (km != null) bullets.push(`ca. ${km} km`);
      speech =
        `Für den verlorenen Ausweis/Pass: nächste Anlaufstelle ist ${top.name}` +
        (km != null ? `, circa ${km} km` : '') +
        `. Route liegt bereit — keine Heimatvereine oder Museen.`;
      actions.push({
        id: 'docs_nav',
        type: 'START_NAVIGATION',
        label: shortenActionLabel(`Route ${top.name}`),
        payload: {
          destName: top.name,
          destLat: top.lat,
          destLng: top.lng,
        },
      } as QuickAction);
      if (top.phoneNumber) {
        actions.push({
          id: 'docs_dial',
          type: 'DIAL_PHONE',
          label: 'Anrufen',
          payload: { phoneNumber: top.phoneNumber },
        } as QuickAction);
      }
    } else {
      bullets.push('Konsulat / Bürgeramt');
      bullets.push(primaryBullet(emergencyInfo));
      speech =
        `Reisepass weg — ich suche die zuständige Vertretung oder das Bürgeramt mit Route. ` +
        (origin
          ? 'Sag mir deine Nationalität, falls die Botschaft landen muss.'
          : 'GPS kurz an, dann zeig ich die nächste Auslandsvertretung.');
    }
    const concierge = buildEmergencyConcierge({
      speech,
      bullets: bullets.slice(0, 3),
      actions: actions.slice(0, 5),
      title: 'Pass / Konsulat',
    });
    return { handled: true, reply: speech, concierge };
  }

'''
    t = t.replace(marker, docs + marker, 1)
    print("added docs handler")
else:
    print("docs handler skip", "kind === 'docs'" in t, marker in t)

out = Path(r"c:\Users\larsf\Findus 2.0\src\services\concierge\emergencyConcierge.ts.new")
out.write_text(t, encoding="utf-8")
print("wrote", out, "bytes", out.stat().st_size)
