# -*- coding: utf-8 -*-
from pathlib import Path
import os

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
path = ROOT / "src/reisebuero/research/funnel.ts"
t = path.read_text(encoding="utf-8")

old = """  const { filterRealStays } = await import('./packagePartner');
  const { REAL_STAY_CHOICE_MAX } = await import('./composePlan');
  const realStayChoices = filterRealStays(stayChoices).slice(0, REAL_STAY_CHOICE_MAX);
  const primaryStay = realStayChoices[0];
  if (primaryStay && (!stayName || /check24|ab-in-den|pauschal/i.test(stayName))) {
    stayName = primaryStay.name;
    stayBookUrl = primaryStay.bookUrl;
    stayPrice = primaryStay.priceEur;
    stayPhoto = primaryStay.photoUrl;
    stayLat = primaryStay.lat ?? place.lat;
    stayLng = primaryStay.lng ?? place.lng;
  }"""

new = """  const { filterRealStays } = await import('./packagePartner');
  const { REAL_STAY_CHOICE_MAX } = await import('./composePlan');
  let realStayChoices = filterRealStays(stayChoices).slice(0, REAL_STAY_CHOICE_MAX);
  const primaryStay = realStayChoices[0];
  if (primaryStay && (!stayName || /check24|ab-in-den|pauschal/i.test(stayName))) {
    stayName = primaryStay.name;
    stayBookUrl = primaryStay.bookUrl;
    stayPrice = primaryStay.priceEur;
    stayPhoto = primaryStay.photoUrl;
    stayLat = primaryStay.lat ?? place.lat;
    stayLng = primaryStay.lng ?? place.lng;
  }

  // Camping-Modus: Platz-Buchung immer camping.info + Camping-and-Co vergleichen
  const campingStayMode =
    ledger.mode?.value === 'camping' || must.has('camping');
  if (campingStayMode) {
    try {
      const {
        buildCampingPartnerCandidates,
        pickCampingBookingOffer,
      } = await import('../../services/affiliate/campingPartnerPick');
      const userBlob = [
        ledger.highlightWant?.value,
        ...(ledger.mustHaves?.value ?? []),
        ...(ledger.wishHaves?.value ?? []),
        place.name,
      ]
        .filter(Boolean)
        .join(' ');
      const campOpts = {
        city: place.name,
        arrival: checkin,
        departure: checkout,
        adults,
        userText: userBlob,
      };
      const cands = buildCampingPartnerCandidates(campOpts);
      const campPick = pickCampingBookingOffer(campOpts);
      const campStays: import('../types').StayChoice[] = cands.map((c) => ({
        id: `camp-${c.id}`,
        name:
          c.id === 'camping_and_co'
            ? `Campingplatz · Camping-and-Co (${place.name})`
            : `Campingplatz · camping.info (${place.name})`,
        priceEur: c.partnerPriceEur,
        bookUrl: c.url,
        photoUrl: null,
        why: 'Camping-Partner vergleichen',
        lat: place.lat,
        lng: place.lng,
      }));
      realStayChoices = [
        ...campStays,
        ...realStayChoices.filter((s) => !/^camp-/.test(s.id)),
      ].slice(0, Math.max(REAL_STAY_CHOICE_MAX, campStays.length));
      if (campPick?.url) {
        stayBookUrl = campPick.url;
        stayName = `Camping · ${place.name}`;
        stayPrice = campPick.partnerPriceEur;
      }
    } catch {
      /* soft */
    }
  }"""

if old not in t:
    raise SystemExit("funnel pattern missing")
tmp = path.with_suffix(path.suffix + ".tmp_write")
tmp.write_text(t.replace(old, new, 1), encoding="utf-8")
os.replace(tmp, path)
print("ok funnel.ts")

# After preferAffiliateIfSameOffer for stay, re-assert camping pick winner
# so package affiliate doesn't steal camping stay URL
old2 = """    // Direkt-Stay-URL schlägt Affiliate, wenn nicht dasselbe Angebot
    if (stayBookUrl) {
      stayBookUrl = preferAffiliateIfSameOffer({
        affiliateUrl: packageBookUrl,
        directUrl: stayBookUrl,
        sameOffer: false,
      });
    }
  } catch {
    /* soft */
  }
  const checklist = buildBookingChecklist({"""

new2 = """    // Direkt-Stay-URL schlägt Affiliate, wenn nicht dasselbe Angebot
    if (stayBookUrl && !campingStayMode) {
      stayBookUrl = preferAffiliateIfSameOffer({
        affiliateUrl: packageBookUrl,
        directUrl: stayBookUrl,
        sameOffer: false,
      });
    }
  } catch {
    /* soft */
  }
  const checklist = buildBookingChecklist({"""

t2 = path.read_text(encoding="utf-8")
if old2 not in t2:
    raise SystemExit("funnel preferAffiliate pattern missing")
tmp = path.with_suffix(path.suffix + ".tmp_write")
tmp.write_text(t2.replace(old2, new2, 1), encoding="utf-8")
os.replace(tmp, path)
print("ok funnel preferAffiliate skip for camping")
