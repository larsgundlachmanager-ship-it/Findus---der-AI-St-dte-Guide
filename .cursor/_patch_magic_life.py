# -*- coding: utf-8 -*-
from pathlib import Path
import os

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def atomic_replace(path: Path, old: str, new: str) -> None:
    t = path.read_text(encoding="utf-8")
    if old not in t:
        raise SystemExit(f"MISSING in {path}:\n{old[:120]}...")
    tmp = path.with_suffix(path.suffix + ".tmp_write")
    tmp.write_text(t.replace(old, new, 1), encoding="utf-8")
    os.replace(tmp, path)
    print(f"ok {path.relative_to(ROOT)}")


# env.ts
atomic_replace(
    ROOT / "src/config/env.ts",
    """  solmarAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_SOLMAR_AFFILIATE_URL'),""",
    """  solmarAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_SOLMAR_AFFILIATE_URL'),
  /** TUI Magic Life DE AWIN Tracking-URL (optional Override). */
  magicLifeAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_MAGIC_LIFE_AFFILIATE_URL'),""",
)

# .env.example
atomic_replace(
    ROOT / ".env.example",
    """# EXPO_PUBLIC_SOLMAR_AFFILIATE_URL=""",
    """# EXPO_PUBLIC_SOLMAR_AFFILIATE_URL=
# TUI Magic Life DE (AWIN mid=15933) — optional Override
# EXPO_PUBLIC_MAGIC_LIFE_AFFILIATE_URL=""",
)

# registry
atomic_replace(
    ROOT / "src/services/affiliate/affiliateRegistry.ts",
    "  solmar: 69,\n  weg_de: 73,",
    "  solmar: 69,\n  magic_life: 80,\n  weg_de: 73,",
)

# affiliateService constant + normalize + catalog
atomic_replace(
    ROOT / "src/services/affiliate/affiliateService.ts",
    """/** Solmar DE — AWIN Advertiser (Spanien-Bus-/Pauschalreisen). */
export const SOLMAR_AWIN_MID = '114510';""",
    """/** Solmar DE — AWIN Advertiser (Spanien-Bus-/Pauschalreisen). */
export const SOLMAR_AWIN_MID = '114510';

/** TUI Magic Life DE — AWIN Advertiser (Club-/All-inclusive ~4 %). */
export const MAGIC_LIFE_AWIN_MID = '15933';""",
)

atomic_replace(
    ROOT / "src/services/affiliate/affiliateService.ts",
    """  if (/solmar\\.de|awin1\\.com\\/cread\\.php.*114510/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    return getSolmarUrl(/solmar\\.de/i.test(inner) ? inner : url);
  }""",
    """  if (/solmar\\.de|awin1\\.com\\/cread\\.php.*114510/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    return getSolmarUrl(/solmar\\.de/i.test(inner) ? inner : url);
  }
  if (/magiclife\\.com|awin1\\.com\\/cread\\.php.*15933/i.test(url)) {
    const inner = unwrapPartnerLandingUrl(url);
    const { getMagicLifeUrl } = require('./magicLifeAffiliate') as {
      getMagicLifeUrl: (d?: string | null, q?: string | null) => string;
    };
    return getMagicLifeUrl(/^https?:\\/\\//i.test(inner) ? inner : url);
  }""",
)

atomic_replace(
    ROOT / "src/services/affiliate/affiliateService.ts",
    """    {
      id: 'solmar',
      name: 'Solmar DE (AWIN)',
      category: 'Pauschal / Busreisen Spanien',""",
    """    {
      id: 'magic_life',
      name: 'TUI Magic Life DE (AWIN)',
      category: 'Club / All-inclusive',
      envKeys: [
        'EXPO_PUBLIC_AWIN_PUBLISHER_ID',
        'EXPO_PUBLIC_MAGIC_LIFE_AFFILIATE_URL',
      ],
      value: (() => {
        try {
          const { getMagicLifeUrl } = require('./magicLifeAffiliate') as {
            getMagicLifeUrl: () => string;
          };
          return getMagicLifeUrl();
        } catch {
          return '';
        }
      })(),
      helperFns: [
        'getMagicLifeUrl',
        'getMagicLifeLandingUrl',
        'buildMagicLifeAction',
        'buildAwinClickUrl',
      ],
      conciergeActions: ['OPEN_URL'],
      status: 'ready',
      notes:
        'AWIN mid=15933. ~4 % Club-/All-inclusive (Ägypten, GR, ES, TR, TN). Freigabe Publisher 3021215. Button bei Magic-Life-/Cluburlaub-Intent.',
    },
    {
      id: 'solmar',
      name: 'Solmar DE (AWIN)',
      category: 'Pauschal / Busreisen Spanien',""",
)

# hollow
atomic_replace(
    ROOT / "src/services/affiliate/hollowPartnerUrl.ts",
    """  if (isBareHostPath(landing, /solmar\\.de$/i)) return true;""",
    """  if (isBareHostPath(landing, /solmar\\.de$/i)) return true;
  if (isBareHostPath(landing, /(?:www\\.)?magiclife\\.com$/i)) return true;""",
)

# helpFirst
atomic_replace(
    ROOT / "src/services/affiliate/helpFirstMonetization.ts",
    """  | 'spain_package'
  | 'package_holiday'""",
    """  | 'spain_package'
  | 'club_magic_life'
  | 'package_holiday'""",
)

atomic_replace(
    ROOT / "src/services/affiliate/helpFirstMonetization.ts",
    """const SOLMAR_RE =
  /\\b(solmar|busreise\\s+spanien|spanien\\s+bus|bus\\s+nach\\s+spanien|costa\\s+blanca|costa\\s+brava|costa\\s+dorada|pauschalreise\\s+spanien|spanien\\s+pauschal|spanienurlaub)\\b/iu;
const PACKAGE_HOLIDAY_RE =""",
    """const SOLMAR_RE =
  /\\b(solmar|busreise\\s+spanien|spanien\\s+bus|bus\\s+nach\\s+spanien|costa\\s+blanca|costa\\s+brava|costa\\s+dorada|pauschalreise\\s+spanien|spanien\\s+pauschal|spanienurlaub)\\b/iu;
const MAGIC_LIFE_RE =
  /\\b(magic\\s*life|tui\\s*magic\\s*life|cluburlaub|club\\s*urlaub|all[\\s-]?inclusive\\s*club|club\\s*all[\\s-]?inclusive)\\b/iu;
const PACKAGE_HOLIDAY_RE =""",
)

atomic_replace(
    ROOT / "src/services/affiliate/helpFirstMonetization.ts",
    """  if (SOLMAR_RE.test(blob)) {
    out.push({
      kind: 'spain_package',
      priority: 2,
      promptHint:
        'FLOW Spanien-Pauschal/Busreise: Solmar-Button anbieten wenn Bus/Costa/Pauschal im Kontext. Hilfe-Ton, kein Pitch.',
    });
  }

  if (PACKAGE_HOLIDAY_RE.test(blob)) {""",
    """  if (SOLMAR_RE.test(blob)) {
    out.push({
      kind: 'spain_package',
      priority: 2,
      promptHint:
        'FLOW Spanien-Pauschal/Busreise: Solmar-Button anbieten wenn Bus/Costa/Pauschal im Kontext. Hilfe-Ton, kein Pitch.',
    });
  }

  if (MAGIC_LIFE_RE.test(blob)) {
    out.push({
      kind: 'club_magic_life',
      priority: 2,
      promptHint:
        'FLOW Club-/All-inclusive: Magic Life Button wenn Cluburlaub/Magic Life im Kontext. Hilfe-Ton, kein Pitch.',
    });
  }

  if (PACKAGE_HOLIDAY_RE.test(blob)) {""",
)

# plan + turn cases — insert after spain_package
atomic_replace(
    ROOT / "src/services/affiliate/helpFirstMonetization.ts",
    """      case 'spain_package':
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
        break;""",
    """      case 'spain_package':
        pushUniqueAction(actions, aff().buildSolmarAction());
        break;
      case 'club_magic_life': {
        const { buildMagicLifeAction } = require('./magicLifeAffiliate') as {
          buildMagicLifeAction: (o?: {
            cityOrQuery?: string | null;
          }) => { type: 'OPEN_URL'; label: string; payload: { url: string } };
        };
        pushUniqueAction(
          actions,
          buildMagicLifeAction({ cityOrQuery: city || undefined }) as QuickAction,
        );
        break;
      }
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
        break;""",
)

atomic_replace(
    ROOT / "src/services/affiliate/helpFirstMonetization.ts",
    """      case 'spain_package':
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
        break;""",
    """      case 'spain_package':
        pushUniqueAction(actions, aff().buildSolmarAction());
        break;
      case 'club_magic_life': {
        const { buildMagicLifeAction } = require('./magicLifeAffiliate') as {
          buildMagicLifeAction: (o?: {
            cityOrQuery?: string | null;
          }) => { type: 'OPEN_URL'; label: string; payload: { url: string } };
        };
        pushUniqueAction(
          actions,
          buildMagicLifeAction({ cityOrQuery: city || undefined }) as QuickAction,
        );
        break;
      }
      case 'package_holiday':
        pushUniqueAction(
          actions,
          aff().buildPackageHolidayAction({
            cityOrQuery: city || undefined,
            speechOrBlob: blob,
          }),
        );
        break;""",
)

# presentConcierge
atomic_replace(
    ROOT / "src/services/concierge/presentConcierge.ts",
    """  buildSolmarAction,
  buildPackageHolidayAction,""",
    """  buildSolmarAction,
  buildPackageHolidayAction,""",
)

# Insert Magic Life block before Solmar or after - after Solmar before package
atomic_replace(
    ROOT / "src/services/concierge/presentConcierge.ts",
    """  // Solmar — Spanien Bus-/Pauschalreisen (AWIN mid=114510)
  const offerSolmar =""",
    """  // TUI Magic Life — Club-/All-inclusive (AWIN mid=15933)
  const offerMagicLife =
    /\\b(magic\\s*life|tui\\s*magic\\s*life|cluburlaub|club\\s*urlaub|all[\\s-]?inclusive\\s*club|club\\s*all[\\s-]?inclusive)\\b/iu.test(
      response.speechText,
    );
  if (offerMagicLife) {
    const hasMl = actions.some(
      (a) =>
        a.type === 'OPEN_URL' &&
        /magiclife\\.com|awin1\\.com.*15933/i.test(a.payload.url ?? ''),
    );
    if (!hasMl) {
      const { buildMagicLifeAction } = require('../affiliate/magicLifeAffiliate') as {
        buildMagicLifeAction: (o?: {
          cityOrQuery?: string | null;
        }) => { type: 'OPEN_URL'; label: string; payload: { url: string } };
      };
      const city = getCachedUserProfile()?.cityName?.trim() || null;
      actions.push(buildMagicLifeAction({ cityOrQuery: city }) as QuickAction);
    }
  }

  // Solmar — Spanien Bus-/Pauschalreisen (AWIN mid=114510)
  const offerSolmar =""",
)

# policy hint
atomic_replace(
    ROOT / "src/services/concierge/findusResponsePolicy.ts",
    """Spanien-Bus/Pauschal → Solmar; Pauschal/Last-Minute/Kurztrip → CHECK24""",
    """Spanien-Bus/Pauschal → Solmar; Club-/Magic-Life → Magic Life; Pauschal/Last-Minute/Kurztrip → CHECK24""",
)

# fix magicLifeAffiliate env access - use proper typing
print("all patches done")
