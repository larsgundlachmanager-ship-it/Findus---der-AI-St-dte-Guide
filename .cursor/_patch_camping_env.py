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
    print(f"ok {path.name}")


atomic_replace(
    ROOT / "src/config/env.ts",
    """  campingInfoAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_CAMPING_INFO_AFFILIATE_URL'),
  /** Solmar DE AWIN Tracking-URL (optional Override). */""",
    """  campingInfoAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_CAMPING_INFO_AFFILIATE_URL'),
  /** Camping-and-Co AWIN Merchant-ID (Default DE 16438). */
  campingAndCoAwinMid: () =>
    getPublicEnv('EXPO_PUBLIC_CAMPING_AND_CO_AWIN_MID') || '16438',
  /** Camping-and-Co AWIN Tracking-URL (optional Override). */
  campingAndCoAffiliateUrl: () =>
    getPublicEnv('EXPO_PUBLIC_CAMPING_AND_CO_AFFILIATE_URL'),
  /** Solmar DE AWIN Tracking-URL (optional Override). */""",
)

atomic_replace(
    ROOT / "src/services/affiliate/affiliateRegistry.ts",
    "  camping_info: 71,\n  solmar: 69,",
    "  camping_info: 71,\n  camping_and_co: 88,\n  solmar: 69,",
)
