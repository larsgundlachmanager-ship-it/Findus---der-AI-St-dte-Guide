from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\pitch\runPitchModule.ts")
s = p.read_text(encoding="utf-8")
needle = "  const top = shortlist.slice(0, 2);"
if "Belt: AYCE never publish" in s:
    print("already guarded")
    raise SystemExit(0)
if needle not in s:
    raise SystemExit("needle missing")

bt = chr(96)  # backtick
guard = f"""  // Belt: AYCE never publish non-evidence venues (Goldschaetzchen Soft-Fill)
  try {{
    const {{ looksLikeAyceQuery }} = require('./ayceIntent') as {{
      looksLikeAyceQuery: (t: string) => boolean;
    }};
    const {{ scoreAyceEvidence }} = require('./hardMatchVerify') as {{
      scoreAyceEvidence: (b: string) => number;
    }};
    const q = {bt}${{req.title}} ${{req.context}}{bt};
    if (
      looksLikeAyceQuery(q) ||
      req.wishes.some((w) =>
        /all_you_can_eat|ayce|schlemmer|buffet/i.test(w.text),
      )
    ) {{
      const ok = shortlist.filter((c) => {{
        const blob = {bt}${{c.name}} ${{(c.softTags ?? []).join(' ')}} ${{(c.hardEvidence ?? []).join(' ')}} ${{(c.hookNotes ?? []).join(' ')}}{bt};
        return scoreAyceEvidence(blob) >= 2;
      }});
      if (ok.length !== shortlist.length) {{
        shortlist = ok;
        if (!ok.length) {{
          ranked = {{
            ...ranked,
            top: [],
            softFail: true,
            reason:
              ranked.reason ||
              'Kein belegtes All-you-can-eat — Expand/Web weiter, kein Soft-Fill.',
          }};
        }} else {{
          ranked = {{ ...ranked, top: ok.slice(0, 2) }};
        }}
      }}
    }}
  }} catch {{
    /* soft */
  }}

  const top = shortlist.slice(0, 2);"""

# The f-string above doubled braces for literals but ${{ became ${ which is wrong for TS.
# Rebuild more carefully:
guard = (
    "  // Belt: AYCE never publish non-evidence venues (Goldschaetzchen Soft-Fill)\n"
    "  try {\n"
    "    const { looksLikeAyceQuery } = require('./ayceIntent') as {\n"
    "      looksLikeAyceQuery: (t: string) => boolean;\n"
    "    };\n"
    "    const { scoreAyceEvidence } = require('./hardMatchVerify') as {\n"
    "      scoreAyceEvidence: (b: string) => number;\n"
    "    };\n"
    "    const q = `" + "${req.title} ${req.context}" + "`;\n"
    "    if (\n"
    "      looksLikeAyceQuery(q) ||\n"
    "      req.wishes.some((w) =>\n"
    "        /all_you_can_eat|ayce|schlemmer|buffet/i.test(w.text),\n"
    "      )\n"
    "    ) {\n"
    "      const ok = shortlist.filter((c) => {\n"
    "        const blob = `"
    + "${c.name} ${(c.softTags ?? []).join(' ')} ${(c.hardEvidence ?? []).join(' ')} ${(c.hookNotes ?? []).join(' ')}"
    + "`;\n"
    "        return scoreAyceEvidence(blob) >= 2;\n"
    "      });\n"
    "      if (ok.length !== shortlist.length) {\n"
    "        shortlist = ok;\n"
    "        if (!ok.length) {\n"
    "          ranked = {\n"
    "            ...ranked,\n"
    "            top: [],\n"
    "            softFail: true,\n"
    "            reason:\n"
    "              ranked.reason ||\n"
    "              'Kein belegtes All-you-can-eat — Expand/Web weiter, kein Soft-Fill.',\n"
    "          };\n"
    "        } else {\n"
    "          ranked = { ...ranked, top: ok.slice(0, 2) };\n"
    "        }\n"
    "      }\n"
    "    }\n"
    "  } catch {\n"
    "    /* soft */\n"
    "  }\n"
    "\n"
    "  const top = shortlist.slice(0, 2);"
)

s2 = s.replace(needle, guard, 1)
tmp = p.with_suffix(".ts.patching")
tmp.write_text(s2, encoding="utf-8")
tmp.replace(p)
print("guard ok", "Belt: AYCE" in p.read_text(encoding="utf-8"))
