import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
data = json.loads((root / "src/module2/blueprints/ownerGold.pack.json").read_text(encoding="utf-8"))
items = data.get("blueprints") or []
out = []
for i, b in enumerate(items, 1):
    sk = (b.get("situationKey") or "").strip()
    summary = (b.get("summary") or "").strip()
    if sk:
        label = sk
        legacy = False
    else:
        title = summary.split(":")[0].strip() if ":" in summary else summary[:48]
        label = title
        legacy = True
    out.append(
        {
            "n": i,
            "k": label,
            "legacy": legacy,
            "f": b.get("intentFamily") or "other",
            "s": summary,
            "e": b.get("expect") or [],
            "a": b.get("avoid") or [],
        }
    )

compact_path = Path(__file__).with_name("_gold69_compact.json")
compact_path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")

lines = [
    "# Owner-Gold — 69 Blaupausen",
    "",
    f"Anzahl: **{len(out)}** — davon **{sum(1 for x in out if x['legacy'])}** Legacy ohne `situationKey`.",
    "",
    "Quelle: `src/module2/blueprints/ownerGold.pack.json`",
    "",
]
by: dict[str, list] = {}
for b in out:
    by.setdefault(b["f"], []).append(b)
for f in sorted(by):
    lines.append(f"## {f} ({len(by[f])})")
    lines.append("")
    for b in by[f]:
        leg = " _(legacy)_" if b["legacy"] else ""
        lines.append(f"### {b['n']}. `{b['k']}`{leg}")
        lines.append("")
        lines.append(b["s"])
        lines.append("")
        if b["e"]:
            lines.append("**Expect:** " + ", ".join(f"`{x}`" for x in b["e"]))
            lines.append("")
        if b["a"]:
            lines.append("**Avoid:** " + ", ".join(f"`{x}`" for x in b["a"]))
            lines.append("")

md_path = Path(__file__).with_name("OWNER_GOLD_69.md")
md_path.write_text("\n".join(lines), encoding="utf-8")
print("wrote", md_path)
print("count", len(out), "legacy", sum(1 for x in out if x["legacy"]))
print(json.dumps({f: len(v) for f, v in sorted(by.items())}))
