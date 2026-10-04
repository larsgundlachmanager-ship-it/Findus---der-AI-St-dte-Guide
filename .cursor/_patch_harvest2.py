from pathlib import Path

# After expand rings in runPitchModule: forced second web harvest if still thin
p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\pitch\runPitchModule.ts")
s = p.read_text(encoding="utf-8")
if "Open-World: zweiter Web-Harvest" in s:
    print("already")
else:
    needle = """  // Shortlist (bis 5) → Kriterien-Score → Speak Top-2
  let shortlist = (ranked.shortlist ?? ranked.top).slice(
    0,
    req.shortlistSize ?? 5,
  );"""
    insert = """  // Open-World: zweiter Web-Harvest wenn nach Expand noch Thin (until_evidence)
  if (
    (req.kind === 'food' || req.kind === 'bar') &&
    (ranked.softFail || ranked.top.length < 2)
  ) {
    try {
      const {
        shouldRunDiscoveryHarvest,
        discoveryHarvest,
        harvestClaimsToSeedCandidates,
      } = await import('./discoveryHarvest');
      if (
        shouldRunDiscoveryHarvest({
          kind: req.kind,
          topLen: ranked.top.length,
          softFail: true,
          checklist: ranked.criteriaChecklist,
        })
      ) {
        const harvested = await discoveryHarvest(req);
        const seeds = harvestClaimsToSeedCandidates(
          harvested.claims.filter((c) => c.constraintFit !== 'rejected'),
          {
            lat: req.anchor?.lat ?? 53.55,
            lng: req.anchor?.lng ?? 9.99,
          },
        );
        const nameBoost = [
          ...harvested.rawNames.slice(0, 6),
          ...seeds.map((c) => c.name).slice(0, 4),
        ]
          .filter(Boolean)
          .join(' ');
        if (nameBoost) {
          const harvestReq: PitchRequest = {
            ...req,
            title: `${req.title} ${nameBoost}`.slice(0, 160),
            context: `${req.context} harvest2:${nameBoost}`.slice(0, 400),
            liveExpandRadiusM: Math.max(req.liveExpandRadiusM ?? 0, 100_000),
          };
          const next = await rankDiningPool(harvestReq);
          if (
            next.ranked.top.length > ranked.top.length ||
            (next.ranked.top.length >= 1 && ranked.top.length === 0)
          ) {
            ranked = next.ranked;
            pool = next.pool;
            req = harvestReq;
          }
        }
      }
    } catch {
      /* soft */
    }
  }

"""
    if needle not in s:
        raise SystemExit("needle missing")
    s = s.replace(needle, insert + needle, 1)
    tmp = p.with_suffix(".ts.patching")
    tmp.write_text(s, encoding="utf-8")
    tmp.replace(p)
    print("harvest2 ok")

# price-link sync helper in hardMatchVerify / pitchSpeech — strip speech prices without bullet
p2 = Path(r"c:\Users\larsf\Findus 2.0\src\module2\pitch\priceEvidenceSync.ts")
p2.write_text(
    '''/**
 * Speech-Preis = Bullet-Preis = belegter Hint — kein Fake-Preis nur in Audio.
 */

export function syncPriceEvidence(opts: {
  speech: string;
  bullets: string[];
  dishPriceHint?: string | null;
  allowPriceInBullets?: boolean;
}): { speech: string; bullets: string[] } {
  const hint = String(opts.dishPriceHint || "").trim();
  const allow = opts.allowPriceInBullets !== false;
  let bullets = [...(opts.bullets || [])].map((b) => String(b || "").trim()).filter(Boolean);
  let speech = String(opts.speech || "");

  const priceRe = /\\b\\d{1,4}\\s*€|\\b\\d{1,4}\\s*euro\\b/iu;
  if (hint && allow) {
    if (!bullets.some((b) => priceRe.test(b) || b.includes(hint.slice(0, 12)))) {
      bullets = [hint, ...bullets].slice(0, 3);
    }
    if (!priceRe.test(speech) && !speech.includes(hint.slice(0, 12))) {
      speech = `${speech} ${hint}.`.replace(/\\s+/g, " ").trim();
    }
  } else if (!hint) {
    // Kein Beleg → Preise aus Speech/Bullets streichen (Fake-Schutz)
    speech = speech
      .replace(/\\b(?:ca\\.?\\s*)?\\d{1,4}\\s*(?:€|euro)\\b/giu, "")
      .replace(/\\s{2,}/g, " ")
      .trim();
    bullets = bullets.filter((b) => !priceRe.test(b) || /live|belegt|website/i.test(b));
  }

  return { speech, bullets: bullets.slice(0, 3) };
}
''',
    encoding="utf-8",
)
print("priceEvidenceSync written")
