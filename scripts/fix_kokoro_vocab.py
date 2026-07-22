# -*- coding: utf-8 -*-
"""Force KOKORO_VOCAB + roughGermanPhonemes to ASCII-only Unicode escapes."""
from pathlib import Path
import re

PATH = Path(r"C:\Users\larsf\Findus 2.0\src\services\kokoroTtsService.ts")

# (char, id) — values match current file semantics
VOCAB = [
    (";", 1),
    (":", 2),
    (",", 3),
    (".", 4),
    ("!", 5),
    ("?", 6),
    ("\u2014", 9),
    ("\u2026", 10),
    ('"', 11),
    ("(", 12),
    (")", 13),
    ("\u201c", 14),
    ("\u201d", 15),
    (" ", 16),
    ("\u0303", 17),
    ("\u02a3", 18),
    ("\u02a5", 19),
    ("\u02a6", 20),
    ("\u02a8", 21),
    ("\u1d5d", 22),
    ("\uab67", 23),
    ("A", 24),
    ("I", 25),
    ("O", 31),
    ("Q", 33),
    ("S", 35),
    ("T", 36),
    ("W", 39),
    ("Y", 41),
    ("a", 47),
    ("b", 48),
    ("c", 49),
    ("d", 50),
    ("e", 51),
    ("f", 52),
    ("g", 53),
    ("h", 54),
    ("i", 55),
    ("j", 56),
    ("k", 57),
    ("l", 58),
    ("m", 59),
    ("n", 60),
    ("o", 61),
    ("p", 62),
    ("q", 63),
    ("r", 64),
    ("s", 65),
    ("t", 66),
    ("u", 67),
    ("v", 68),
    ("w", 69),
    ("x", 70),
    ("y", 71),
    ("z", 72),
    ("\u0251", 73),
    ("\u0250", 74),
    ("\u0252", 75),
    ("\u00e6", 76),
    ("\u03b2", 77),
    ("\u0254", 78),
    ("\u0255", 79),
    ("\u00e7", 80),
    ("\u0257", 82),
    ("\u00f0", 83),
    ("\u02a4", 86),
    ("\u0259", 87),
    ("\u025a", 88),
    ("\u025b", 89),
    ("\u025c", 90),
    ("\u025f", 92),
    ("\u0261", 93),
    ("\u0265", 95),
    ("\u0268", 96),
    ("\u026a", 98),
    ("\u029d", 99),
    ("\u026b", 101),
    ("\u026f", 102),
    ("\u0270", 103),
    ("\u014b", 104),  # eng
    ("\u0273", 105),
    ("\u0272", 106),
    ("\u0274", 107),
    ("\u00f8", 108),
    ("\u0275", 110),
    ("\u0278", 112),
    ("\u03b8", 113),
    ("\u0279", 116),
    ("\u027e", 118),
    ("\u027b", 119),
    ("\u0281", 120),
    ("\u027d", 121),
    ("\u0282", 122),
    ("\u0283", 123),
    ("\u0288", 125),
    ("\u02a7", 126),
    ("\u028a", 129),
    ("\u028b", 130),  # v with hook
    ("\u028c", 132),  # turned v
    ("\u0263", 133),
    ("\u0264", 134),
    ("\u03c7", 135),
    ("\u028e", 136),
    ("\u028f", 137),
    ("\u0291", 138),
    ("\u0290", 139),
    ("\u0292", 140),
    ("\u00e4", 47),
    ("\u00f6", 108),
    ("\u00fc", 67),
    ("\u00df", 65),
    ("\u00c4", 47),
    ("\u00d6", 108),
    ("\u00dc", 67),
]


def esc_key(ch: str) -> str:
    if ch == "'":
        return '"\'"'
    if ch == '"':
        return "'\"'"
    if len(ch) == 1 and ord(ch) < 128 and ch.isascii() and ch not in "\\\n\r":
        return "'" + ch + "'"
    return "'" + "".join(f"\\u{ord(c):04x}" for c in ch) + "'"


VOCAB_BLOCK = (
    "// Kokoro phoneme / char vocab (ASCII-safe Unicode escapes; Windows-CP sicher)\n"
    "const KOKORO_VOCAB: Record<string, number> = {\n"
    + "".join(f"  {esc_key(ch)}: {vid},\n" for ch, vid in VOCAB)
    + "};\n"
)

G2P_BLOCK = r'''/** Offline-G2P fuer Kokoro lang_code='d' (Deutsch). IPA nur als \\u-Escapes. */
function roughGermanPhonemes(text: string): string {
  return text
    .toLowerCase()
    .replace(/\u00df/g, 'ss')
    .replace(/tsch/g, '\u02a7')
    .replace(/sch/g, '\u0283')
    .replace(/ch/g, '\u00e7')
    .replace(/ck/g, 'k')
    .replace(/tz/g, '\u02a6')
    .replace(/pf/g, 'pf')
    .replace(/ph/g, 'f')
    .replace(/qu/g, 'kv')
    .replace(/ie/g, 'i')
    .replace(/ei|ai/g, 'ai')
    .replace(/eu|\u00e4u/g, 'oi')
    .replace(/au/g, 'au')
    .replace(/\u00f6/g, '\u00f8')
    .replace(/\u00fc/g, 'y')
    .replace(/\u00e4/g, '\u025b')
    .replace(/r/g, '\u0281')
    .replace(
      /[^a-z\u00e7\u00f8\u028f\u026a\u025b\u00f8y\u0281\u02a6\u02a7pf\s.,!?]/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}
'''


def main() -> None:
    text = PATH.read_text(encoding="utf-8")

    # Replace vocab
    m = re.search(
        r"// Kokoro phoneme / char vocab.*?^const KOKORO_VOCAB: Record<string, number> = \{.*?\n\};\n",
        text,
        flags=re.S | re.M,
    )
    if not m:
        m = re.search(
            r"const KOKORO_VOCAB: Record<string, number> = \{.*?\n\};\n",
            text,
            flags=re.S,
        )
    if not m:
        raise SystemExit("KOKORO_VOCAB block not found")
    text = text[: m.start()] + VOCAB_BLOCK + text[m.end() :]

    # Replace G2P
    m2 = re.search(
        r"/\*\* Offline-G2P.*?^function roughGermanPhonemes\(text: string\): string \{.*?\n\}\n",
        text,
        flags=re.S | re.M,
    )
    if not m2:
        m2 = re.search(
            r"function roughGermanPhonemes\(text: string\): string \{.*?\n\}\n",
            text,
            flags=re.S,
        )
    if not m2:
        raise SystemExit("roughGermanPhonemes not found")
    text = text[: m2.start()] + G2P_BLOCK + text[m2.end() :]

    # Write as UTF-8; vocab/g2p sections are ASCII-only
    PATH.write_bytes(text.encode("utf-8"))

    # Verify
    check = PATH.read_text(encoding="utf-8")
    start = check.find("const KOKORO_VOCAB")
    end = check.find("};", start)
    block = check[start:end]
    non = [c for c in block if ord(c) > 127]
    print("vocab_nonascii", len(non))
    print("has_u0283_escape", "\\u0283" in check)
    print("has_raw_esh", "\u0283" in check[start:end])
    if non:
        raise SystemExit("FAILED: vocab still has non-ascii")
    print("OK")


if __name__ == "__main__":
    main()
