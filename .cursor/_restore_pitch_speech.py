# -*- coding: utf-8 -*-
"""Restore Ideal-Refresh bits on pitchSpeech + wire search-process strip."""
from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\pitch\pitchSpeech.ts")
s = p.read_text(encoding="utf-8")

# --- imports ---
old_imp = """import {
  buildPersonalityMatrixPromptBlock,
} from '../../services/persona/personalityMatrixPrompt';

function hoursHint"""
new_imp = """import {
  buildPersonalityMatrixPromptBlock,
} from '../../services/persona/personalityMatrixPrompt';
import { diversifyPitchBullets } from './diversifyPitchBullets';
import { stripSearchProcessFromSpeech } from './searchProcessSpeechStrip';

export { diversifyPitchBullets };
export { stripSearchProcessFromSpeech };

function hoursHint"""
if old_imp not in s:
    raise SystemExit("imports marker missing")
s = s.replace(old_imp, new_imp, 1)

# --- system prompt key lines ---
repls = [
(
"""2) Konkret zum Wunsch + Gerichtspreis NUR wenn dish_price in den Daten. Distanz aus dist_km einweben (nie weglassen). Fahrzeit NUR wenn car=yes und drive_min gesetzt — sonst nur Kilometer, keine erfundenen Minuten.""",
"""2) Konkret zum Wunsch + Gerichtspreis NUR wenn dish_price in den Daten. Distanz: nur bei here_now / nahe GPS einweben. Bei city_best / Tagesplan in anderer Stadt: KEINE GPS-Heimat-Kilometer („24 km entfernt“) — die Anreise ist schon separat geplant.""",
),
(
"""MODUS city_best / „am besten“: Lead mit warum DIESE Option zum Wunsch (Gericht/Küche) die stärkere ist — nur rating, ratingCount, insider/Reviews, hard_match. Nichts erfinden. Nähe allein reicht nicht.""",
"""MODUS city_best / „am besten“ / Hard-Amenity (AYCE, Spezial): Favorit ZUERST mit konkreten Gründen (Beleg, Küche, Preis wenn belegt, Review-Tenor) — dann Alternative mit anderen Gründen. Rating nur als Wort (top/gut/okay bewertet), NIE „4,5 Sterne bei 9650 Bewertungen“. Insider/Reviews/hard_match. Nichts erfinden. Nähe allein reicht nicht — nie „nimm den näheren, weil näher“. Keine Heimat-GPS-km.""",
),
(
"""WUNSCH NICHT BELEGT (soft_fail, kein hard_match auf dem Gericht): ehrlich — Wunsch so nicht belegt → nächste Stufe derselben Familie (Pannfisch → Fischlokal), nie die Gegen-Diät (Fisch-Wunsch ≠ vegan). Immer konkrete Orte, nie leere Absage.""",
"""WUNSCH NICHT BELEGT (soft_fail / Cascade soft_miss): finale Antwort — Top-Option(en) mit Beleg. VERBOTEN in Speech: Such-Prozess („in 10 km nichts“, „in 20 km erweitert“, „ringweise“, „nicht nur Datensatz“, „soll ich weiter suchen?“). Distanz nur als kurze Lage am Ort (z. B. „liegt etwas weiter raus“), nie als Recherche-Log. Nie Gegen-Diät.""",
),
(
"""Ohne Auto (car=no): Distanz in km, keine Auto-Kurzfahrt. „Ihr habt Zeit / kein Problem was zu finden“ NUR bei soft_fail, zu, oder viel zu weit — sonst Wunsch würdigen.
IMMER eine Antwort mit Orten, sobald der Katalog welche hat.
Stichpunkte: max 3 — Wunsch-Beleg (Gericht/Amenity/Preis), Öffnung wenn relevant, Distanz höchstens 1×. KEINE Roh-Sterne, KEINE „X Sterne bei Y Bewertungen“, KEINE doppelte km-Angabe.""",
"""Ohne Auto (car=no): Distanz in km nur bei here_now. „Ihr habt Zeit / kein Problem was zu finden“ NUR bei soft_fail, zu, oder viel zu weit — sonst Wunsch würdigen.
IMMER eine Antwort mit Orten, sobald der Katalog welche hat.
Stichpunkte: max 3 — Wunsch-Beleg (Gericht/Amenity/Preis), Öffnung wenn relevant, Distanz höchstens 1× und nur wenn hier_now. KEINE Roh-Sterne, KEINE „X Sterne bei Y Bewertungen“, KEINE doppelte km-Angabe. Sterne nur als „top/gut/okay bewertet“.
TYPISCH HAMBURGERISCH / Franzbrötchen: wenn Call-1/Wunsch das nennt → Orte pitchen die das belegen (Bäcker/Café mit Franzbrötchen), nicht generisches „Frühstück“.""",
),
]
for a, b in repls:
    if a not in s:
        raise SystemExit(f"prompt chunk missing: {a[:60]}...")
    s = s.replace(a, b, 1)

# --- fitPitchBullets before fallbackPitch ---
if "function fitPitchBullets" not in s:
    helper = '''
function fitPitchBullets(raw: string[]): string[] {
  let maxChars = 56;
  let maxCount = 3;
  try {
    const { peekBulletUiBudget } = require('../reboot/pipeline/bulletUiBudget') as {
      peekBulletUiBudget: () => { bulletMaxChars: number; bulletCount: number };
    };
    const b = peekBulletUiBudget();
    maxChars = b.bulletMaxChars || 56;
    maxCount = b.bulletCount || 3;
  } catch {
    /* soft */
  }
  try {
    const { rewriteBulletToFit } = require('../../services/concierge/visualBullets') as {
      rewriteBulletToFit: (t: string, max: number) => string;
    };
    return raw
      .map((t) => rewriteBulletToFit(String(t || '').trim(), maxChars))
      .filter(Boolean)
      .slice(0, maxCount);
  } catch {
    return raw
      .map((t) => String(t || '').trim().slice(0, maxChars))
      .filter(Boolean)
      .slice(0, maxCount);
  }
}

'''
    s = s.replace("function fallbackPitch(", helper + "function fallbackPitch(", 1)

# fallback bullets fit
s = s.replace(
    """    .filter(Boolean)
    .slice(0, 3) as string[];
  return { speechPitch: withLook, bullets };
}""",
    """    .filter(Boolean)
    .slice(0, 6) as string[];
  return { speechPitch: withLook, bullets: fitPitchBullets(bullets) };
}""",
    1,
)

# --- opts: criteriaChecklist ---
old_opts = """export async function generatePitchSpeech(opts: {
  req: PitchRequest;
  top: PitchCandidate[];
  /** Full Top-5 for ResearchPack; speak still uses top (2) */
  shortlist?: PitchCandidate[];
  softFail: boolean;
  softFailReason?: string;
  signal?: AbortSignal;
}): Promise<{ summary: string; cards: PitchedCard[]; spokenText: string }> {"""
new_opts = """export async function generatePitchSpeech(opts: {
  req: PitchRequest;
  top: PitchCandidate[];
  /** Full Top-5 for ResearchPack; speak still uses top (2) */
  shortlist?: PitchCandidate[];
  softFail: boolean;
  softFailReason?: string;
  criteriaChecklist?: Array<{
    key: string;
    label: string;
    status: string;
    remaining: number;
  }>;
  signal?: AbortSignal;
}): Promise<{ summary: string; cards: PitchedCard[]; spokenText: string }> {"""
if old_opts not in s:
    raise SystemExit("opts block missing")
s = s.replace(old_opts, new_opts, 1)

# --- summary sanitize ---
old_sum = """  let summary = opts.softFail
    ? opts.softFailReason ||
      'Nichts Perfektes — hier zwei Alternativen mit besseren Chancen.'
    : '';"""
new_sum = """  let summary = opts.softFail
    ? stripSearchProcessFromSpeech(
        opts.softFailReason ||
          'Hier zwei Alternativen, die am besten passen.',
      )
    : '';
  if (/\\b(?:km|ringweise|Datensatz|erweitert|weiter suchen)\\b/iu.test(summary)) {
    summary = 'Hier zwei Alternativen, die am besten passen.';
  }"""
if old_sum not in s:
    raise SystemExit("summary block missing")
s = s.replace(old_sum, new_sum, 1)

# --- MUST_HAVES humanize ---
old_must = """        `MUST_HAVES: ${
          (opts.req.call1MustHaves ?? []).join(', ') ||
          opts.req.wishes
            .filter((w) => w.hardness === 'must')
            .map((w) => `${w.kind ?? 'x'}:${w.text}`)
            .join(' | ') ||
          '—'
        }`,"""
new_must = """        `MUST_HAVES: ${
          (() => {
            try {
              const { humanizePitchLabels } = require('./pitchLabelHumanize') as {
                humanizePitchLabels: (a: string[]) => string[];
              };
              const raw =
                (opts.req.call1MustHaves ?? []).length > 0
                  ? opts.req.call1MustHaves!
                  : opts.req.wishes
                      .filter((w) => w.hardness === 'must')
                      .map((w) => w.text);
              return humanizePitchLabels(raw).join(', ') || '—';
            } catch {
              return (
                (opts.req.call1MustHaves ?? []).join(', ') ||
                opts.req.wishes
                  .filter((w) => w.hardness === 'must')
                  .map((w) => w.text)
                  .join(' | ') ||
                '—'
              );
            }
          })()
        }`,"""
if old_must not in s:
    raise SystemExit("MUST_HAVES missing")
s = s.replace(old_must, new_must, 1)

# --- softFail + cascade prompt ---
old_sf = """        opts.softFail ? `SOFT_FAIL: ${opts.softFailReason ?? 'yes'}` : '',
        `ORTE (bereits gerankt, #1 = beste Entscheidung):\\n${catalog}`,"""
new_sf = """        opts.softFail
          ? `SOFT_FAIL (intern): ${opts.softFailReason ?? 'yes'}\\nSpeech = nur finale Option(en). VERBOTEN vorlesen: km-Ringe, „nichts in X km“, Expand/Datensatz/ringweise, „weiter suchen?“.`
          : '',
        (() => {
          try {
            const { formatCascadeForPrompt } = require('./criteriaCascade') as {
              formatCascadeForPrompt: (
                c: NonNullable<typeof opts.criteriaChecklist>,
              ) => string;
            };
            return opts.criteriaChecklist?.length
              ? formatCascadeForPrompt(opts.criteriaChecklist as never)
              : '';
          } catch {
            return '';
          }
        })(),
        `ORTE (bereits gerankt, #1 = beste Entscheidung):\\n${catalog}`,"""
if old_sf not in s:
    raise SystemExit("softFail ORTE missing")
s = s.replace(old_sf, new_sf, 1)

# --- LLM bullets fit ---
old_bul = """          .filter((b, i, arr) => arr.indexOf(b) === i)
          .slice(0, 3);
        next.push({ candidate: c, speechPitch: speech, bullets });"""
new_bul = """          .filter((b, i, arr) => arr.indexOf(b) === i)
          .slice(0, 6);
        next.push({
          candidate: c,
          speechPitch: speech,
          bullets: fitPitchBullets(bullets),
        });"""
if old_bul not in s:
    raise SystemExit("bullets push missing")
s = s.replace(old_bul, new_bul, 1)

# diversify after cards assigned
if "diversifyPitchBullets(cards)" not in s:
    s = s.replace(
        "      if (next.length) cards = next;\n    }\n  } catch {",
        "      if (next.length) cards = diversifyPitchBullets(next);\n    }\n  } catch {",
        1,
    )

# spokenText strip
s = s.replace(
    "    spokenText: parts.join(' ').replace(/\\s+/g, ' ').trim(),",
    "    spokenText: stripSearchProcessFromSpeech(\n      parts.map((p) => stripSearchProcessFromSpeech(p)).join(' ').replace(/\\s+/g, ' ').trim(),\n    ),",
    1,
)

tmp = p.with_suffix(".ts.patching")
tmp.write_text(s, encoding="utf-8")
tmp.replace(p)
print("pitchSpeech restored+wired", p.stat().st_size)
