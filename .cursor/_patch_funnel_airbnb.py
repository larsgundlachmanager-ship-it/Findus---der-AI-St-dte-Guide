# -*- coding: utf-8 -*-
from pathlib import Path

path = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\research\funnel.ts")
text = path.read_text(encoding="utf-8")

marker = "  // Camping-Modus: Platz-Buchung immer camping.info + Camping-and-Co vergleichen"
idx = text.find(marker)
if idx < 0:
    raise SystemExit("camping marker not found")

# Find end of camping block: closing brace of if (campingStayMode) + catch
# Look for the next section after camping block
end_marker = "\n  const surfaceTravel ="
end = text.find(end_marker, idx)
if end < 0:
    raise SystemExit("surfaceTravel marker not found")

# Check if already patched
if "airbnbStayMode" in text[idx:end]:
    print("already patched")
    raise SystemExit(0)

camping_block = text[idx:end]

airbnb_append = r'''

  // Airbnb — nur bei lodgingKind airbnb / Must / User-Blob mit \bairbnb\b
  const userBlobAirbnb = [
    ledger.highlightWant?.value,
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
    ledger.lodgingKind?.value,
  ]
    .filter(Boolean)
    .join(' ');
  const airbnbStayMode =
    ledger.lodgingKind?.value === 'airbnb' ||
    must.has('airbnb') ||
    /\bairbnb\b/iu.test(userBlobAirbnb);
  if (airbnbStayMode && !campingStayMode) {
    try {
      const {
        pickAirbnbStayActions,
        buildAirbnbStayCandidates,
      } = await import('../../services/affiliate/airbnbStayPick');
      const { getAirbnbSearchUrl } = await import(
        '../../services/affiliate/airbnbDeepLink'
      );
      const liveStays = realStayChoices
        .filter((s) => s.bookUrl)
        .map((s) => ({
          name: s.name,
          priceEur: s.priceEur,
          bookUrl: s.bookUrl,
        }));
      const pickOpts = {
        city: place.name,
        checkin,
        checkout,
        adults,
        userText: `airbnb ${userBlobAirbnb}`,
        liveStays,
      };
      const airbnbActs = pickAirbnbStayActions(pickOpts);
      const cands = buildAirbnbStayCandidates(pickOpts);
      const airbnbSearchUrl = getAirbnbSearchUrl({
        city: place.name,
        checkin,
        checkout,
        adults,
      });
      const abnbStays: import('../types').StayChoice[] = [
        {
          id: 'airbnb-search',
          name: `Airbnb · ${place.name}`,
          priceEur: null,
          bookUrl: airbnbSearchUrl,
          photoUrl: null,
          why: 'Airbnb-Suche (keine Fake-Preise)',
          lat: place.lat,
          lng: place.lng,
        },
        ...cands
          .filter((c) => !(c.id === 'airbnb' && c.deepLinkLevel === 'search'))
          .slice(0, 2)
          .map((c, i) => ({
            id: `airbnb-alt-${i}`,
            name: c.label,
            priceEur: c.partnerPriceEur,
            bookUrl: c.url,
            photoUrl: null,
            why: 'Live-Partner-Vergleich',
            lat: place.lat,
            lng: place.lng,
          })),
      ];
      realStayChoices = [
        ...abnbStays,
        ...realStayChoices.filter((s) => !/^airbnb-/.test(s.id)),
      ].slice(0, Math.max(REAL_STAY_CHOICE_MAX, abnbStays.length));
      const primaryUrl = airbnbActs[0]?.payload.url;
      if (primaryUrl) {
        stayBookUrl = primaryUrl;
        if (/airbnb\./i.test(primaryUrl)) {
          stayName = `Airbnb · ${place.name}`;
          stayPrice = null;
        } else if (primaryStay?.bookUrl === primaryUrl) {
          stayName = primaryStay.name;
          stayPrice = primaryStay.priceEur;
        } else {
          const hit = liveStays.find((s) => s.bookUrl === primaryUrl);
          stayName = hit?.name || stayName;
          stayPrice = hit?.priceEur ?? stayPrice;
        }
      }
    } catch {
      /* soft */
    }
  }
'''

# Insert before surfaceTravel
new_text = text[:end] + airbnb_append + text[end:]
tmp = path.with_suffix(".ts.tmp_airbnb")
tmp.write_text(new_text, encoding="utf-8")
tmp.replace(path)
print("funnel.ts patched OK")
