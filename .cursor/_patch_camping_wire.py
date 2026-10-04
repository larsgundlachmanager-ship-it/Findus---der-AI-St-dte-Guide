# -*- coding: utf-8 -*-
from pathlib import Path
import os

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def atomic_replace(path: Path, old: str, new: str) -> None:
    t = path.read_text(encoding="utf-8")
    if old not in t:
        raise SystemExit(f"pattern missing in {path}")
    out = t.replace(old, new, 1)
    tmp = path.with_suffix(path.suffix + ".tmp_write")
    tmp.write_text(out, encoding="utf-8")
    os.replace(tmp, path)
    print(f"ok {path.relative_to(ROOT)}")


CAMPING_CASE_PLAN = """      case 'camping':
        pushUniqueAction(
          actions,
          aff().buildCampingInfoAction({ cityOrQuery: city || undefined }),
        );
        break;"""

CAMPING_CASE_PLAN_NEW = """      case 'camping': {
        const { buildCampingBookingActions } = require('./campingPartnerPick') as {
          buildCampingBookingActions: (o: {
            city?: string | null;
            userText?: string | null;
          }) => Array<{ type: 'OPEN_URL'; label: string; payload: { url: string } }>;
        };
        for (const a of buildCampingBookingActions({
          city: city || undefined,
          userText: opts.planBlob,
        })) {
          if (actions.length >= 2) break;
          pushUniqueAction(actions, a as QuickAction);
        }
        break;
      }"""

CAMPING_CASE_TURN = """      case 'camping':
        pushUniqueAction(
          actions,
          aff().buildCampingInfoAction({ cityOrQuery: city || undefined }),
        );
        break;"""

CAMPING_CASE_TURN_NEW = """      case 'camping': {
        const { buildCampingBookingActions } = require('./campingPartnerPick') as {
          buildCampingBookingActions: (o: {
            city?: string | null;
            placeName?: string | null;
            userText?: string | null;
          }) => Array<{ type: 'OPEN_URL'; label: string; payload: { url: string } }>;
        };
        for (const a of buildCampingBookingActions({
          city: city || undefined,
          userText: blob,
        })) {
          if (actions.length >= 2) break;
          pushUniqueAction(actions, a as QuickAction);
        }
        break;
      }"""

# helpFirst has two identical camping cases — replace both carefully by unique context
hf = ROOT / "src/services/affiliate/helpFirstMonetization.ts"
text = hf.read_text(encoding="utf-8")
if text.count(CAMPING_CASE_PLAN) < 1:
    # after first batch prompt change, cases still use buildCampingInfoAction
    pass

# Replace plan path (first occurrence — uses opts.planBlob context nearby)
old_plan = """      case 'travel_insurance':
        pushUniqueAction(actions, aff().buildTravelInsuranceAction());
        break;
      case 'camping':
        pushUniqueAction(
          actions,
          aff().buildCampingInfoAction({ cityOrQuery: city || undefined }),
        );
        break;
      case 'spain_package':
        pushUniqueAction(actions, aff().buildSolmarAction());
        break;
      case 'package_holiday':
        pushUniqueAction(
          actions,
          aff().buildPackageHolidayAction({
            cityOrQuery: city || undefined,
            speechOrBlob: opts.planBlob,
          }),
        );
        break;
      case 'dining_reserve':
        // Plan-Pfad: ohne belegte Venue-ID keinen Fake-OpenTable
        break;"""

new_plan = """      case 'travel_insurance':
        pushUniqueAction(actions, aff().buildTravelInsuranceAction());
        break;
      case 'camping': {
        const { buildCampingBookingActions } = require('./campingPartnerPick') as {
          buildCampingBookingActions: (o: {
            city?: string | null;
            userText?: string | null;
          }) => Array<{ type: 'OPEN_URL'; label: string; payload: { url: string } }>;
        };
        for (const a of buildCampingBookingActions({
          city: city || undefined,
          userText: opts.planBlob,
        })) {
          if (actions.length >= 2) break;
          pushUniqueAction(actions, a as QuickAction);
        }
        break;
      }
      case 'spain_package':
        pushUniqueAction(actions, aff().buildSolmarAction());
        break;
      case 'package_holiday':
        pushUniqueAction(
          actions,
          aff().buildPackageHolidayAction({
            cityOrQuery: city || undefined,
            speechOrBlob: opts.planBlob,
          }),
        );
        break;
      case 'dining_reserve':
        // Plan-Pfad: ohne belegte Venue-ID keinen Fake-OpenTable
        break;"""

old_turn = """      case 'travel_insurance':
        pushUniqueAction(actions, aff().buildTravelInsuranceAction());
        break;
      case 'camping':
        pushUniqueAction(
          actions,
          aff().buildCampingInfoAction({ cityOrQuery: city || undefined }),
        );
        break;
      case 'spain_package':
        pushUniqueAction(actions, aff().buildSolmarAction());
        break;
      case 'package_holiday':
        pushUniqueAction(
          actions,
          aff().buildPackageHolidayAction({
            cityOrQuery: city || undefined,
            speechOrBlob: blob,
          }),
        );
        break;"""

new_turn = """      case 'travel_insurance':
        pushUniqueAction(actions, aff().buildTravelInsuranceAction());
        break;
      case 'camping': {
        const { buildCampingBookingActions } = require('./campingPartnerPick') as {
          buildCampingBookingActions: (o: {
            city?: string | null;
            userText?: string | null;
          }) => Array<{ type: 'OPEN_URL'; label: string; payload: { url: string } }>;
        };
        for (const a of buildCampingBookingActions({
          city: city || undefined,
          userText: blob,
        })) {
          if (actions.length >= 2) break;
          pushUniqueAction(actions, a as QuickAction);
        }
        break;
      }
      case 'spain_package':
        pushUniqueAction(actions, aff().buildSolmarAction());
        break;
      case 'package_holiday':
        pushUniqueAction(
          actions,
          aff().buildPackageHolidayAction({
            cityOrQuery: city || undefined,
            speechOrBlob: blob,
          }),
        );
        break;"""

atomic_replace(hf, old_plan, new_plan)
atomic_replace(hf, old_turn, new_turn)

# presentConcierge
atomic_replace(
    ROOT / "src/services/concierge/presentConcierge.ts",
    """  buildCampingInfoAction,
  buildSolmarAction,""",
    """  buildSolmarAction,""",
)

atomic_replace(
    ROOT / "src/services/concierge/presentConcierge.ts",
    """  // Camping — camping.info (AWIN mid=44063)
  const offerCamping = /\\b(camping|campingplatz|camper|wohnwagen|wohnmobil|glamping|stellplatz|zeltplatz)\\b/iu.test(
    response.speechText,
  );
  if (offerCamping) {
    const hasCamp = actions.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        /camping\\.info|awin1\\.com.*44063/i.test(a.payload.url ?? ''),
    );
    if (!hasCamp) {
      const city = getCachedUserProfile()?.cityName?.trim() || null;
      const campsite = extractCampingplatzName(response.speechText);
      const arrival = parseTravelDateYmd(response.speechText);
      const departure = arrival ? addDaysYmd(arrival, 2) : null;
      actions.push(
        buildCampingInfoAction({
          cityOrQuery: campsite ? null : city,
          campsiteName: campsite,
          arrival,
          departure,
          adults: 2,
        }),
      );
    }
  }""",
    """  // Camping — camping.info + Camping-and-Co (pickAffiliateOffer)
  const offerCamping = /\\b(camping|campingplatz|camper|wohnwagen|wohnmobil|glamping|stellplatz|zeltplatz)\\b/iu.test(
    response.speechText,
  );
  if (offerCamping) {
    const hasCamp = actions.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        /camping\\.info|camping-and-co\\.com|awin1\\.com.*(44063|16438|13348)/i.test(
          a.payload.url ?? '',
        ),
    );
    if (!hasCamp) {
      const { buildCampingBookingActions } = require('../affiliate/campingPartnerPick') as {
        buildCampingBookingActions: (o: {
          city?: string | null;
          campsiteName?: string | null;
          arrival?: string | null;
          departure?: string | null;
          adults?: number | null;
          userText?: string | null;
        }) => Array<{ type: 'OPEN_URL'; label: string; payload: { url: string } }>;
      };
      const city = getCachedUserProfile()?.cityName?.trim() || null;
      const campsite = extractCampingplatzName(response.speechText);
      const arrival = parseTravelDateYmd(response.speechText);
      const departure = arrival ? addDaysYmd(arrival, 2) : null;
      for (const a of buildCampingBookingActions({
        city: campsite ? null : city,
        campsiteName: campsite,
        arrival,
        departure,
        adults: 2,
        userText: response.speechText,
      })) {
        actions.push(a as QuickAction);
      }
    }
  }""",
)

print("wire concierge done")
